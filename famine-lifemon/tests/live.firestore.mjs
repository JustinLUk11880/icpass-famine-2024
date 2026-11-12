// Live tests against the real Firestore project and the deployed rules,
// driving the same src/game/firestore.js the phones use.
//
// DESTRUCTIVE: resets the game (every group, scan, marriage, limit and
// announcement) before and after. Never run during an event.
// Run: npm run test:live

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { getApp, deleteApp } from 'firebase/app';
import { signInAnonymously } from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, terminate, updateDoc } from 'firebase/firestore';

import { db, auth } from '../src/database/firebase.js';
import { APPLE_MAX, EDU, STATIONS } from '../src/game/catalog.js';
import { buildPayload, newQrId, randomProfile } from '../src/game/engine.js';
import {
  joinGroup, performAdjust, performGlobalEvent, performScan, resetGame,
} from '../src/game/firestore.js';

const groupRef = (g) => doc(db, 'groups', String(g));
const read = async (g) => (await getDoc(groupRef(g))).data();
const put = (g, over = {}) => setDoc(groupRef(g), { ...randomProfile(g), money: 1000, food: 5, happiness: 10, education: EDU.PHD, ...over });
const qr = (stationId, inputs = {}, q = newQrId()) => buildPayload(stationId, inputs, q, Date.now());
const scan = (g, payload) => performScan(db, g, payload);
const count = (results, pred) => results.filter(pred).length;
const ok = (r) => r.ok === true;
const reason = (x) => (r) => r.reason === x;

before(async () => {
  await signInAnonymously(auth);
  await resetGame(db);
});

after(async () => {
  await resetGame(db);
  // Firebase holds its connections open, which would keep the test process
  // alive until the runner's timeout.
  await terminate(db);
  await deleteApp(getApp());
});

test('join: 8 phones joining one group at once create exactly one account', async () => {
  const results = await Promise.all(Array.from({ length: 8 }, () => joinGroup(db, 1)));
  assert.equal(count(results, (r) => r.created), 1);
  assert.ok(results.every(ok));
  const g = await read(1);
  assert.equal(g.happiness, 5);
  assert.ok([100, 150, 200, 250, 300].includes(g.money));
  assert.ok(g.food >= 0 && g.food <= 3);
  assert.ok(g.education <= EDU.SECONDARY);
});

test('one QR, 8 members of the same group scanning at once: applied exactly once', async () => {
  await put(2, { money: 100, food: 5, happiness: 10, education: EDU.SECONDARY });
  const payload = qr('jobs.police', { smugglers: 1, robbery: false });
  const results = await Promise.all(Array.from({ length: 8 }, () => scan(2, payload)));
  assert.equal(count(results, ok), 1, JSON.stringify(results.map((r) => r.reason)));
  assert.equal(count(results, reason('already_scanned')), 7);
  const g = await read(2);
  assert.deepEqual({ money: g.money, food: g.food, happiness: g.happiness }, { money: 350, food: 4, happiness: 9 });
});

test('one QR, many groups: each group redeems it once', async () => {
  await Promise.all([3, 4, 5, 6, 7].map((g) => put(g, { money: 500 })));
  const payload = qr('ent.sauna');
  const first = await Promise.all([3, 4, 5, 6, 7].map((g) => scan(g, payload)));
  assert.ok(first.every(ok));
  const again = await Promise.all([3, 4, 5, 6, 7].map((g) => scan(g, payload)));
  assert.ok(again.every(reason('already_scanned')));
  for (const g of [3, 4, 5, 6, 7]) assert.equal((await read(g)).money, 400);
});

test('assassin: 5 groups at once, exactly 1 gets the job', async () => {
  const gs = [8, 9, 10, 11, 12];
  await Promise.all(gs.map((g) => put(g, { education: EDU.PRIMARY })));
  const payload = qr('illegal.assassin');
  const results = await Promise.all(gs.map((g) => scan(g, payload)));
  assert.equal(count(results, ok), 1);
  assert.equal(count(results, reason('limit_reached')), 4);
  const limit = (await getDoc(doc(db, 'limits', 'assassin'))).data();
  assert.equal(limit.holders.length, 1);
});

test('PhD: 4 university groups pass at once, exactly 2 get a place', async () => {
  const gs = [13, 14, 15, 16];
  await Promise.all(gs.map((g) => put(g, { education: EDU.UG, money: 1000, food: 5, happiness: 5 })));
  const results = await Promise.all(gs.map((g) => scan(g, qr('college.phd', { result: 'pass' }))));
  assert.equal(count(results, ok), 2, JSON.stringify(results.map((r) => r.reason)));
  assert.equal(count(results, reason('limit_reached')), 2);
  const phds = (await Promise.all(gs.map(read))).filter((g) => g.education === EDU.PHD);
  assert.equal(phds.length, 2);
  for (const g of phds) assert.deepEqual([g.money, g.food, g.happiness], [750, 3, 3]);
});

test('Final Will: 3 groups at once, exactly 1 gets $1000', async () => {
  await Promise.all([17, 18, 19].map((g) => put(g, { money: 0 })));
  const payload = qr('secret.finalWill');
  const results = await Promise.all([17, 18, 19].map((g) => scan(g, payload)));
  assert.equal(count(results, ok), 1);
  const total = (await Promise.all([17, 18, 19].map(read))).reduce((s, g) => s + g.money, 0);
  assert.equal(total, 1000);
});

test('wedding: 3 groups scan one wedding QR at once, 2 marry; divorce frees both', async () => {
  await resetGame(db);
  await Promise.all([1, 2, 3].map((g) => put(g, { money: 1000, food: 5, happiness: 5, married: false })));
  const payload = qr('wed.wedding', { money: -500, food: -2, happiness: 2 });
  const results = await Promise.all([1, 2, 3].map((g) => scan(g, payload)));
  assert.equal(count(results, ok), 2);
  assert.equal(count(results, reason('marriage_full')), 1);
  const married = (await Promise.all([1, 2, 3].map(async (g) => ({ g, ...(await read(g)) })))).filter((x) => x.married);
  assert.equal(married.length, 2);
  assert.equal(married[0].marriageId, married[1].marriageId);
  const m = (await getDoc(doc(db, 'marriages', married[0].marriageId))).data();
  assert.equal(m.participants.length, 2);
  for (const x of married) assert.deepEqual([x.money, x.food, x.happiness], [500, 3, 7]);

  const d = await scan(married[0].g, qr('wed.divorce', { money: 0, food: 0, happiness: -2 }));
  assert.equal(d.ok, true, d.reason);
  const [a, b] = await Promise.all(married.map((x) => read(x.g)));
  assert.equal(a.married, false);
  assert.equal(b.married, false, 'the partner is freed too');
  assert.equal(b.marriageId, null);
  assert.equal((await getDoc(doc(db, 'marriages', married[0].marriageId))).data().hasDivorced, true);
  // and can marry again
  const again = await scan(married[1].g, qr('wed.wedding', { money: -500, food: -2, happiness: 2 }));
  assert.equal(again.ok, true, again.reason);
});

test('once-only and cooldown hold across separate QR codes', async () => {
  await put(4, { education: EDU.SECONDARY, food: 8, happiness: 10 });
  assert.equal((await scan(4, qr('jobs.teacher'))).ok, true);
  assert.equal((await scan(4, qr('jobs.teacher'))).reason, 'already_done');
  assert.equal((await scan(4, qr('jobs.foodDelivery', { result: 'lose' }))).ok, true);
  const second = await scan(4, qr('jobs.foodDelivery', { result: 'win' }));
  assert.equal(second.reason, 'cooldown');
  assert.equal(second.detail.minutes, 20);
});

test('the last apple: 10 simultaneous apple-costing scans, 2 apples, exactly 2 succeed', async () => {
  await put(5, { education: EDU.PRIMARY, food: 2, money: 0 });
  const results = await Promise.all(Array.from({ length: 10 }, () => scan(5, qr('jobs.warehouse', { time: 'under90' }))));
  assert.equal(count(results, ok), 2, JSON.stringify(results.map((r) => r.reason)));
  assert.equal(count(results, reason('hungry')), 8);
  const g = await read(5);
  assert.equal(g.food, 0);
  assert.equal(g.money, 100);
});

test('apples never exceed 8, even with simultaneous gym sets', async () => {
  await put(6, { food: 6, gymMember: true });
  const results = await Promise.all(Array.from({ length: 6 }, () => scan(6, qr('com.gymChallenge', { sets: 1 }))));
  assert.ok(results.every(ok));
  assert.equal((await read(6)).food, APPLE_MAX);
});

test('global events: pandemic pressed twice at once still hits each group once', async () => {
  await resetGame(db);
  await Promise.all([1, 2, 3].map((g, i) => put(g, { money: [1000, 50, 2500][i], food: [5, 1, 8][i], happiness: [10, 0, 3][i] })));
  const [r1, r2] = await Promise.all([performGlobalEvent(db, 'pandemic'), performGlobalEvent(db, 'pandemic')]);
  const applied = [...r1, ...r2].filter((r) => r.status === 'applied');
  assert.equal(applied.length, 3, JSON.stringify([...r1, ...r2]));
  const gs = await Promise.all([1, 2, 3].map(read));
  assert.deepEqual(gs.map((g) => [g.money, g.food, g.happiness]), [[800, 3, 8], [0, 0, 0], [2300, 6, 1]]);

  const tax = await performGlobalEvent(db, 'tax');
  assert.equal(tax.filter((r) => r.status === 'applied').length, 3);
  const after = await Promise.all([1, 2, 3].map(read));
  assert.deepEqual(after.map((g) => [g.money, g.happiness]), [[880, 9], [0, 1], [2070, 2]]);
});

test('manual adjustment applies once and is logged', async () => {
  await put(7, { money: 100, food: 7, happiness: 1 });
  const r = await performAdjust(db, 7, { money: 500, food: 5, happiness: -9, education: 2 }, 'raffle 1st prize');
  assert.equal(r.ok, true);
  const g = await read(7);
  assert.deepEqual([g.money, g.food, g.happiness, g.education], [600, 8, 0, 2]);
  const log = (await getDocs(collection(db, 'redemptions'))).docs.map((d) => d.data()).filter((d) => d.kind === 'adjust' && d.groupId === '7');
  assert.equal(log.length, 1);
  assert.equal(log[0].note, 'raffle 1st prize');
});

test('rules: the server refuses impossible states whatever the client sends', async () => {
  await put(8);
  const denied = async (p) => {
    try {
      await p;
      return false;
    } catch (e) {
      return e.code === 'permission-denied';
    }
  };
  assert.ok(await denied(updateDoc(groupRef(8), { food: 9 })), 'apples above 8');
  assert.ok(await denied(updateDoc(groupRef(8), { money: -1 })), 'negative money');
  assert.ok(await denied(updateDoc(groupRef(8), { happiness: -1 })), 'negative happiness');
  assert.ok(await denied(updateDoc(groupRef(8), { education: 5 })), 'degree above PhD');
  assert.ok(await denied(updateDoc(groupRef(8), { money: 'lots' })), 'non-numeric money');
  assert.ok(await denied(setDoc(doc(db, 'groups', '21'), randomProfile(21))), 'group 21');
  assert.ok(await denied(setDoc(doc(db, 'groups', '03'), randomProfile(3))), 'group "03"');
  assert.ok(await denied(setDoc(doc(db, 'marriages', 'x'), { participants: ['1', '2', '3'], hasDivorced: false })), 'three-way marriage');
  assert.ok(await denied(updateDoc(doc(db, 'redemptions', 'nope'), { groupId: '1' })), 'editing a redemption');
  const g = await read(8);
  assert.equal(g.food, 5, 'nothing changed');
});

test('every station resolves end-to-end against the live database', async () => {
  await resetGame(db);
  let g = 1;
  for (const station of STATIONS) {
    const id = ((g - 1) % 20) + 1;
    g += 1;
    const over = { education: station.minEducation, money: 3000, food: 4, happiness: 20, gymMember: station.id !== 'com.gymMembership', married: false, marriageId: null };
    if (station.id === 'secret.robbery') over.money = 100;
    if (station.id === 'wed.divorce') Object.assign(over, { married: true, marriageId: 'm_live' });
    await put(id, over);
    if (station.id === 'wed.divorce') await setDoc(doc(db, 'marriages', 'm_live'), { participants: [String(id)], hasDivorced: false });
    const inputs = {};
    for (const f of station.fields) {
      inputs[f.key] = f.type === 'select' ? f.options[0].value : f.type === 'number' ? (f.default ?? 1) : false;
    }
    const r = await scan(id, qr(station.id, inputs));
    assert.equal(r.ok, true, `${station.id}: ${r.reason}`);
    if (station.id === 'wed.divorce') await deleteDoc(doc(db, 'marriages', 'm_live'));
  }
});

test('load: 80 participants (10 groups x 8) scanning bursts, totals exact', async () => {
  await resetGame(db);
  const GROUPS = 10;
  const MEMBERS = 8;
  const ROUNDS = 3;
  await Promise.all(Array.from({ length: GROUPS }, (_, i) => put(i + 1, {
    education: EDU.SECONDARY, money: 0, food: 8, happiness: 50,
  })));
  const latencies = [];
  const t0 = Date.now();
  // Every member of every group scans their own police-shift QR, 3 rounds,
  // all in flight together: 240 transactions, 24 per group document.
  const jobs = [];
  for (let r = 0; r < ROUNDS; r++) {
    for (let g = 1; g <= GROUPS; g++) {
      for (let m = 0; m < MEMBERS; m++) {
        jobs.push((async () => {
          const s = Date.now();
          const res = await scan(g, qr('ent.sauna'));
          latencies.push(Date.now() - s);
          return res;
        })());
      }
    }
  }
  // sauna costs $100 each; give every group exactly enough for all 24
  await Promise.all(Array.from({ length: GROUPS }, (_, i) => updateDoc(groupRef(i + 1), { money: 100 * MEMBERS * ROUNDS })));
  const results = await Promise.allSettled(jobs);
  const secs = (Date.now() - t0) / 1000;
  const fulfilled = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const rejected = results.filter((r) => r.status === 'rejected');
  latencies.sort((a, b) => a - b);
  const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))];
  console.log(`    load: ${jobs.length} scans in ${secs.toFixed(1)}s · ok=${count(fulfilled, ok)} · poor=${count(fulfilled, reason('poor'))} · threw=${rejected.length} · p50=${pct(0.5)}ms p95=${pct(0.95)}ms max=${latencies[latencies.length - 1]}ms`);
  assert.equal(rejected.length, 0, rejected.map((r) => r.reason?.code).join(','));
  // Each group either afforded every sauna (if its money landed first) or
  // was refused some as "poor"; what must hold is that money and happiness
  // moved in lockstep and nothing was lost or double-applied.
  for (let g = 1; g <= GROUPS; g++) {
    const s = await read(g);
    const visits = (100 * MEMBERS * ROUNDS - s.money) / 100;
    assert.ok(Number.isInteger(visits) && visits >= 0 && visits <= MEMBERS * ROUNDS, `group ${g}: money ${s.money}`);
    assert.equal(s.happiness, 50 + 2 * visits, `group ${g}: happiness out of step with money`);
    const logged = (await getDocs(collection(db, 'redemptions'))).docs.filter((d) => d.data().groupId === String(g) && d.data().stationId === 'ent.sauna').length;
    assert.equal(logged, visits, `group ${g}: ${logged} logged vs ${visits} applied`);
  }
});

test('load: 80 participants at a busy-but-human pace (a scan every ~10s each)', async () => {
  await resetGame(db);
  const GROUPS = 10;
  const MEMBERS = 8;
  const DURATION = 40000;
  const GAP = 10000;
  // Banker needs a University degree.
  await Promise.all(Array.from({ length: GROUPS }, (_, i) => put(i + 1, {
    education: EDU.UG, money: 0, food: 8, happiness: 0,
  })));
  const latencies = [];
  let applied = 0;
  let threw = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: GROUPS * MEMBERS }, (_, p) => (async () => {
    const g = (p % GROUPS) + 1;
    await new Promise((r) => setTimeout(r, Math.random() * GAP));
    while (Date.now() - t0 < DURATION) {
      const s = Date.now();
      try {
        // Banker win: +$500, no costs, so every scan must apply.
        const res = await scan(g, qr('jobs.banker', { result: 'win' }));
        if (res.ok) applied += 1;
        else throw new Error(res.reason);
      } catch (e) {
        threw += 1;
      }
      latencies.push(Date.now() - s);
      await new Promise((r) => setTimeout(r, GAP * (0.5 + Math.random())));
    }
  })()));
  latencies.sort((a, b) => a - b);
  const pct = (q) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * q))];
  const secs = (Date.now() - t0) / 1000;
  console.log(`    paced: ${applied} scans in ${secs.toFixed(0)}s (${(applied / secs).toFixed(1)}/s) · threw=${threw} · p50=${pct(0.5)}ms p95=${pct(0.95)}ms max=${latencies[latencies.length - 1]}ms`);
  assert.equal(threw, 0);
  assert.equal(applied, latencies.length, 'every scan applied');
  const totals = await Promise.all(Array.from({ length: GROUPS }, (_, i) => read(i + 1)));
  assert.equal(totals.reduce((s, g) => s + g.money, 0), 500 * applied, 'money adds up exactly');
});
