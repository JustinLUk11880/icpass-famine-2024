// Every Firestore read and write the game makes. The rules themselves are in
// engine.js; this module only fetches the documents a decision needs, inside
// a transaction, and writes back what the engine returned.
//
// Every write path is idempotent, because withRetry may re-run a transaction
// whose first commit actually succeeded but whose reply was lost:
//  - scans are keyed by redemptions/{qrId}_{group}: one use per group per QR
//  - global events by redemptions/evt_{event}_{group}: once per group
//  - manual adjustments by a pre-generated redemptions/adj_... id

import {
  collection, deleteDoc, doc, getDocs, runTransaction, setDoc, writeBatch,
} from 'firebase/firestore';

import { MAX_GROUPS, getStation } from './catalog.js';
import {
  eventRedemptionIdFor, isValidGroupId, newQrId, planReads, randomProfile,
  redemptionIdFor, resolveAdjustment, resolveGlobalEvent, resolveScan,
} from './engine.js';

// Firestore serialises concurrent transactions on one document, but its own
// retry budget can run out during a burst (measured: 40 simultaneous writes
// lost 4 without this). Jitter stops the retries colliding in lockstep.
const RETRYABLE = new Set([
  'aborted', 'failed-precondition', 'unavailable', 'deadline-exceeded', 'resource-exhausted',
]);

export async function withRetry(fn, attempts = 7) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!RETRYABLE.has(e?.code)) throw e;
      lastError = e;
      await new Promise((r) => setTimeout(r, 100 * 2 ** i + Math.random() * 200));
    }
  }
  throw lastError;
}

export const isRetryableError = (e) => RETRYABLE.has(e?.code);

// Firestore rejects `undefined` anywhere in a document.
const clean = (o) => JSON.parse(JSON.stringify(o));

// ------------------------------------------------------------------ scans ---

export async function performScan(db, groupId, payload) {
  const station = getStation(payload?.s);
  if (!station) return { ok: false, reason: 'incomplete_qr' };
  const gid = String(groupId);
  if (!isValidGroupId(gid)) return { ok: false, reason: 'missing_group' };

  const groupRef = doc(db, 'groups', gid);
  const redemptionRef = doc(db, 'redemptions', redemptionIdFor(payload.q, gid));

  return withRetry(() => runTransaction(db, async (tx) => {
    // All reads first - Firestore forbids reading after a write.
    const groupSnap = await tx.get(groupRef);
    if (!groupSnap.exists()) return { ok: false, reason: 'missing_group' };
    const group = groupSnap.data();

    const redemptionSnap = await tx.get(redemptionRef);
    if (redemptionSnap.exists()) return { ok: false, reason: 'already_scanned' };

    const plan = planReads(station, payload, group);

    let limit = null;
    let limitRef = null;
    if (plan.limitKey) {
      limitRef = doc(db, 'limits', plan.limitKey);
      const s = await tx.get(limitRef);
      limit = s.exists() ? s.data() : null;
    }

    let marriage = null;
    let marriageRef = null;
    const partners = {};
    if (plan.marriageId) {
      marriageRef = doc(db, 'marriages', plan.marriageId);
      const s = await tx.get(marriageRef);
      marriage = s.exists() ? s.data() : null;
      if (plan.readPartners && Array.isArray(marriage?.participants)) {
        for (const p of marriage.participants.map(String)) {
          if (p === gid || !isValidGroupId(p)) continue;
          const ps = await tx.get(doc(db, 'groups', p));
          if (ps.exists()) partners[p] = ps.data();
        }
      }
    }

    const result = resolveScan({ station, payload, group, groupId: gid, limit, marriage, partners });
    if (!result.ok) return result;

    tx.update(groupRef, result.groupUpdate);
    tx.set(redemptionRef, clean({
      kind: 'scan',
      groupId: gid,
      stationId: station.id,
      inputs: result.inputs,
      qrId: payload.q,
      issuedAt: payload.t,
      at: Date.now(),
      summary: result.summary,
    }));
    if (result.limitUpdate) tx.set(limitRef, result.limitUpdate);
    if (result.marriageWrite) tx.set(marriageRef, clean(result.marriageWrite));
    for (const [p, update] of Object.entries(result.partnerUpdates)) {
      tx.update(doc(db, 'groups', p), update);
    }
    return result;
  }));
}

// ----------------------------------------------------------------- groups ---

// The first phone to join a group creates its account with a random
// starting profile; everyone after attaches to the same document. The
// transaction stops two phones joining at the same instant from both
// creating it, or from re-rolling a profile that is already in play.
export async function joinGroup(db, groupId, rng = Math.random) {
  const gid = String(groupId);
  if (!isValidGroupId(gid)) return { ok: false, reason: 'missing_group' };
  const ref = doc(db, 'groups', gid);
  return withRetry(() => runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) return { ok: true, created: false };
    const profile = { ...randomProfile(gid, rng), createdAt: Date.now() };
    tx.set(ref, profile);
    return { ok: true, created: true, profile };
  }));
}

export async function createGroups(db, count, rng = Math.random) {
  const n = Math.min(Math.max(Math.trunc(Number(count) || 0), 0), MAX_GROUPS);
  const results = [];
  for (let g = 1; g <= n; g++) results.push(await joinGroup(db, g, rng));
  return results.filter((r) => r.created).length;
}

export async function performAdjust(db, groupId, change, note = '') {
  const gid = String(groupId);
  if (!isValidGroupId(gid)) return { ok: false, reason: 'missing_group' };
  const ref = doc(db, 'groups', gid);
  // Generated once, outside the retry loop, so a retried transaction finds
  // its own earlier commit instead of adjusting the group a second time.
  const logRef = doc(db, 'redemptions', `adj_${newQrId()}_${gid}`);
  return withRetry(() => runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return { ok: false, reason: 'missing_group' };
    const already = await tx.get(logRef);
    if (already.exists()) return { ok: true, duplicate: true, summary: already.data().summary };
    const result = resolveAdjustment(snap.data(), change);
    if (!result.ok) return result;
    tx.update(ref, result.groupUpdate);
    tx.set(logRef, clean({ kind: 'adjust', groupId: gid, note: String(note || ''), at: Date.now(), summary: result.summary }));
    return result;
  }));
}

// --------------------------------------------------------- global events ---

export async function performGlobalEvent(db, eventId) {
  const snap = await getDocs(collection(db, 'groups'));
  const ids = snap.docs.map((d) => d.id).filter(isValidGroupId);
  return Promise.all(ids.map((gid) => withRetry(() => runTransaction(db, async (tx) => {
    const ref = doc(db, 'groups', gid);
    const logRef = doc(db, 'redemptions', eventRedemptionIdFor(eventId, gid));
    const g = await tx.get(ref);
    if (!g.exists()) return { gid, status: 'missing' };
    const done = await tx.get(logRef);
    if (done.exists()) return { gid, status: 'skipped' };
    const result = resolveGlobalEvent(eventId, g.data());
    if (!result.ok) return { gid, status: 'failed', reason: result.reason };
    tx.update(ref, result.groupUpdate);
    tx.set(logRef, clean({ kind: 'event', eventId, groupId: gid, at: Date.now(), summary: result.summary }));
    return { gid, status: 'applied', summary: result.summary };
  })).catch((e) => ({ gid, status: 'failed', reason: e?.code || String(e) }))));
}

// ---------------------------------------------------------- announcements ---

export const broadcast = (db, message, kind = 'info') =>
  setDoc(doc(db, 'announcements', 'current'), { message: String(message), kind, at: Date.now() });

export const clearBroadcast = (db) => deleteDoc(doc(db, 'announcements', 'current'));

// ------------------------------------------------------------------ reset ---

// Wipes the game back to "nobody has joined". The legacy 2024 `users`
// collection is deliberately left alone.
export const GAME_COLLECTIONS = ['redemptions', 'limits', 'marriages', 'announcements', 'groups'];

export async function resetGame(db) {
  let deleted = 0;
  for (const name of GAME_COLLECTIONS) {
    const snap = await getDocs(collection(db, name));
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = writeBatch(db);
      const chunk = snap.docs.slice(i, i + 400);
      chunk.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      deleted += chunk.length;
    }
  }
  return deleted;
}
