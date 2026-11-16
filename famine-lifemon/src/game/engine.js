// LifeMon rules engine: decides what a scan does to a group.
//
// Pure functions only, so the browser and `node --test` run identical code.
// Firestore reads and writes live in firestore.js. This module takes the
// documents that were read inside the transaction and returns the documents
// to write - it never talks to the network itself.

import {
  APPLE_MAX, EDU, EDUCATION_LABELS, INITIAL_DONATION_APPLES, LIMITS, MAX_GROUPS, MINUTE, SUBGROUPS,
  cooldownLabel, getStation,
} from './catalog.js';

export const QR_HEADER = 'lifemon-v2';
const LEGACY_HEADER = 'famine-2023-lifemon';

// How old a QR code may be when scanned. Replay is stopped by the per-group
// redemption record, so this window only limits screenshot sharing - and is
// generous enough to survive a phone whose clock drifts by a minute.
export const QR_LIFETIME_MS = 2 * MINUTE;

const QR_ID_RE = /^[A-Za-z0-9_-]{6,40}$/;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const fail = (reason, detail = {}) => ({ ok: false, reason, detail });

export const isValidGroupId = (g) => {
  const n = Number(g);
  // Exact string match: ' 3' or '03' would otherwise become a distinct
  // Firestore document id - the leading-space bug the 2024 user ids had.
  return Number.isInteger(n) && n >= 1 && n <= MAX_GROUPS && String(g) === String(n);
};

// A team is one sub-group of a group: "1.1", "1.2", ... "20.2". Every group
// document, scan, cooldown and marriage belongs to a team; votes, the join
// list and the leaderboard work in whole groups.
export const isValidTeamId = (t) => {
  if (typeof t !== 'string') return false;
  const m = /^(\d{1,2})\.(\d)$/.exec(t);
  if (!m || !isValidGroupId(m[1])) return false;
  const sub = Number(m[2]);
  return sub >= 1 && sub <= SUBGROUPS;
};
export const teamIdFor = (group, sub) => `${Number(group)}.${Number(sub)}`;
export const parentOf = (teamId) => Number(String(teamId).split('.')[0]);
export const teamsOf = (group) => Array.from({ length: SUBGROUPS }, (_, i) => teamIdFor(group, i + 1));

// Leaderboard: a group's score is the sum of its teams. `teams` is a list of
// { id: teamId, data: groupDocument }; anything that is not a team is ignored.
export function groupTotals(teams = []) {
  const stat = (d, k) => Math.max(0, Math.floor(num(d?.[k])));
  const byGroup = new Map();
  for (const t of teams) {
    if (!t || !isValidTeamId(t.id)) continue;
    const id = parentOf(t.id);
    const cur = byGroup.get(id) || { id, money: 0, happiness: 0, food: 0, teams: 0 };
    cur.money += stat(t.data, 'money');
    cur.happiness += stat(t.data, 'happiness');
    cur.food += stat(t.data, 'food');
    cur.teams += 1;
    byGroup.set(id, cur);
  }
  return [...byGroup.values()].sort((a, b) => a.id - b.id);
}

// The donation box counts as full (INITIAL_DONATION_APPLES) until first used.
export const poolCount = (pool) => (pool && pool.count !== undefined
  ? Math.max(0, Math.trunc(num(pool.count)))
  : INITIAL_DONATION_APPLES);

export const marriageIdFor = (qrId) => `m_${qrId}`;
export const redemptionIdFor = (qrId, groupId) => `${qrId}_${groupId}`;
export const eventRedemptionIdFor = (eventId, groupId) => `evt_${eventId}_${groupId}`;

// ---------------------------------------------------------------- inputs ---

// Helpers' inputs travel inside the QR code, so they are re-validated here
// rather than trusted: out-of-range numbers are clamped and unknown select
// values become null (which makes the QR incomplete).
export function sanitizeInputs(station, raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const f of station.fields) {
    const v = src[f.key];
    if (f.type === 'select') {
      out[f.key] = f.options.some((o) => o.value === v) ? v : null;
    } else if (f.type === 'number') {
      const n = Number(v);
      const blank = v === null || v === undefined || v === '' || !Number.isFinite(n);
      out[f.key] = blank ? f.default : Math.min(f.max, Math.max(f.min, Math.trunc(n)));
    } else if (f.type === 'toggle') {
      out[f.key] = v === true || v === 'true';
    }
  }
  return out;
}

export function missingFields(station, inputs) {
  return station.fields
    .filter((f) => {
      const v = inputs[f.key];
      if (f.type === 'select') return v === null || v === undefined;
      if (f.type === 'number') {
        if (v === null || v === undefined) return true;
        if (f.nonZero && v === 0) return true;
      }
      return false;
    })
    .map((f) => f.key);
}

export const isComplete = (station, inputs) => missingFields(station, inputs).length === 0;

// Normalise whatever a station's effect() returned into one fixed shape.
export function effectOf(station, inputs) {
  const e = station.effect(inputs) || {};
  return {
    money: Math.trunc(num(e.money)),
    food: Math.trunc(num(e.food)),
    happiness: Math.trunc(num(e.happiness)),
    penalty: !!e.penalty,
    educationTo: Number.isInteger(e.educationTo) ? e.educationTo : null,
    checks: Array.isArray(e.checks) ? e.checks : [],
    once: e.once || null,
    limit: e.limit || null,
    cooldown: e.cooldown || null,
    raffle: Math.max(0, Math.trunc(num(e.raffle))),
    setFlag: e.setFlag || null,
    marriage: e.marriage || null,
    deposit: Math.max(0, Math.trunc(num(e.deposit))),
    pool: e.pool && e.pool.key ? { key: String(e.pool.key), delta: Math.trunc(num(e.pool.delta)) } : null,
    couple: Array.isArray(e.couple) ? e.couple.map((x) => (x == null ? null : String(x))) : null,
  };
}

// --------------------------------------------------------------- payload ---

// Returns null when the payload may be scanned, otherwise a reason code.
export function validatePayload(p, now = Date.now()) {
  if (!p || typeof p !== 'object') return 'invalid';
  if (p.h === LEGACY_HEADER) return 'old_qr';
  if (p.h !== QR_HEADER) return 'invalid';
  if (!getStation(p.s)) return 'incomplete_qr';
  if (typeof p.q !== 'string' || !QR_ID_RE.test(p.q)) return 'invalid';
  if (!Number.isFinite(p.t)) return 'invalid';
  if (Math.abs(now - p.t) > QR_LIFETIME_MS) return 'outdated';
  return null;
}

export function buildPayload(stationId, inputs, qrId, timestamp) {
  return { h: QR_HEADER, s: stationId, i: inputs, q: qrId, t: timestamp };
}

export function newQrId(rng = Math.random) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let id = '';
  for (let i = 0; i < 12; i++) id += alphabet[Math.floor(rng() * alphabet.length) % alphabet.length];
  return id;
}

// Which extra documents a transaction must read before resolveScan can run.
export function planReads(station, payload, group) {
  if (!station) return {};
  const inputs = sanitizeInputs(station, payload?.i);
  if (!isComplete(station, inputs)) return {};
  const e = effectOf(station, inputs);
  const plan = {};
  if (e.limit) plan.limitKey = e.limit.key;
  if (e.pool) plan.poolKey = e.pool.key;
  if (e.checks.some((c) => c.type === 'voteWinner')) plan.votingId = 'finalWill';
  if (e.marriage === 'wedding' && typeof payload?.q === 'string') {
    plan.marriageId = marriageIdFor(payload.q);
    // The other team of the couple, read so both can be married at once.
    plan.partnerIds = (e.couple || []).filter((t) => isValidTeamId(t) && t !== String(group?.team ?? ''));
  }
  if ((e.marriage === 'deposit' || e.marriage === 'divorce') && group?.marriageId) {
    plan.marriageId = String(group.marriageId);
  }
  if (e.marriage === 'divorce' && group?.marriageId) plan.readPartners = true;
  return plan;
}

// ------------------------------------------------------------------ core ---

// Apply one stat change. Costs a group cannot afford fail outright; penalties
// are always applied and stop at zero; apples never rise above APPLE_MAX.
function applyStat(cur, delta, penalty, cap) {
  let v = cur + delta;
  if (delta < 0 && v < 0) {
    if (!penalty) return { blocked: true };
    // Floor at 0, except a legacy negative value is left where it is rather
    // than being "raised" by a penalty.
    v = Math.max(v, Math.min(cur, 0));
  }
  let capped = false;
  if (cap !== undefined && delta > 0 && v > cap) {
    v = Math.max(cur, cap);
    capped = true;
  }
  return { value: v, capped };
}

const marriageParts = (m) => (Array.isArray(m?.participants) ? m.participants.map(String) : []);
export const potOf = (m) => Math.max(0, Math.trunc(num(m?.pot)));

export function resolveScan({
  station, payload, group, groupId, limit = null, marriage = null, partners = {}, pool = null, voting = null,
}) {
  if (!station) return fail('unknown_station');
  if (!group) return fail('missing_group');
  const gid = String(groupId);
  const inputs = sanitizeInputs(station, payload?.i);
  if (!isComplete(station, inputs)) return fail('incomplete_qr');
  const e = effectOf(station, inputs);
  const t = num(payload?.t);

  // Requirements, cheapest and most informative first.
  const edu = Math.trunc(num(group.education));
  if (edu < station.minEducation) return fail('needs_education', { level: station.minEducation });

  for (const c of e.checks) {
    if (c.type === 'belowEducation' && edu >= c.level) return fail('already_qualified', { level: c.level });
    if (c.type === 'moneyBelow' && !(num(group.money) < c.value)) return fail('too_rich', { value: c.value });
    if (c.type === 'flag' && !group[c.flag]) return fail(`needs_${c.flag}`);
    if (c.type === 'notFlag' && group[c.flag]) return fail(`already_${c.flag}`);
    if (c.type === 'notMarried' && group.married) return fail('already_married');
    if (c.type === 'married' && !(group.married && group.marriageId)) return fail('not_married');
    // Only enforced once the in-app vote has announced a winner, so the QR
    // still works if the vote is run on paper instead.
    if (c.type === 'voteWinner' && voting?.winner != null && Number(voting.winner) !== parentOf(gid)) {
      return fail('not_vote_winner', { winner: voting.winner });
    }
    if (c.type === 'appleRoom') {
      const room = APPLE_MAX - Math.max(0, Math.trunc(num(group.food)));
      if (room < c.count) return fail('apples_full', { room: Math.max(0, room) });
    }
  }

  // Marriage bank: a deposit needs a complete, still-running marriage.
  if (e.marriage === 'deposit') {
    const parts = marriageParts(marriage);
    if (!marriage || marriage.hasDivorced || marriage.paidOut || !parts.includes(gid)) return fail('marriage_over');
    if (parts.length < 2) return fail('marriage_not_ready');
  }

  // Divorce: the group that asks gets the pot x 1.5 but loses 3 happiness and
  // 10 apples; the other group gets +3 happiness and +10 apples. A wedding
  // the partner never scanned is simply cancelled.
  let divorcePot = 0;
  let divorceComplete = false;
  if (e.marriage === 'divorce') {
    const parts = marriageParts(marriage);
    divorceComplete = !!marriage && !marriage.hasDivorced && parts.length === 2 && parts.includes(gid);
    if (divorceComplete) {
      divorcePot = potOf(marriage);
      e.money += Math.round(divorcePot * 1.5);
      e.happiness -= 3;
      e.food -= 10;
      e.penalty = true;
    }
  }

  // Shared donation box (supermarket).
  let poolUpdate = null;
  if (e.pool) {
    const have = poolCount(pool);
    if (e.pool.delta < 0 && have < -e.pool.delta) return fail('pool_empty', { count: have });
    poolUpdate = { count: have + e.pool.delta };
  }

  const once = { ...(group.once || {}) };
  if (e.once) {
    if (once[e.once]) return fail('already_done', { key: e.once });
    once[e.once] = true;
  }

  const cooldowns = { ...(group.cooldowns || {}) };
  if (e.cooldown) {
    const last = num(cooldowns[e.cooldown.key]);
    const elapsed = t - last;
    if (last && elapsed < e.cooldown.ms) {
      return fail('cooldown', {
        minutes: Math.max(1, Math.ceil((e.cooldown.ms - elapsed) / MINUTE)),
        label: cooldownLabel(e.cooldown.key),
      });
    }
    cooldowns[e.cooldown.key] = t;
  }

  let limitUpdate = null;
  if (e.limit) {
    const holders = Array.isArray(limit?.holders) ? limit.holders.map(String) : [];
    if (holders.includes(gid)) return fail('already_done', { key: e.limit.key });
    if (holders.length >= e.limit.max) return fail('limit_reached', { key: e.limit.key, max: e.limit.max });
    limitUpdate = { holders: [...holders, gid] };
  }

  // Stats. Food is checked first because hunger is the most common blocker.
  const cur = { money: num(group.money), food: num(group.food), happiness: num(group.happiness) };
  const blockedReason = { food: 'hungry', happiness: 'sad', money: 'poor' };
  const next = {};
  let capped = false;
  for (const k of ['food', 'happiness', 'money']) {
    const r = applyStat(cur[k], e[k], e.penalty, k === 'food' ? APPLE_MAX : undefined);
    if (r.blocked) return fail(blockedReason[k]);
    next[k] = r.value;
    capped = capped || r.capped;
  }

  const education = e.educationTo !== null ? Math.max(edu, e.educationTo) : edu;

  const groupUpdate = { money: next.money, food: next.food, happiness: next.happiness };
  if (education !== edu) groupUpdate.education = education;
  if (e.once) groupUpdate.once = once;
  if (e.cooldown) groupUpdate.cooldowns = cooldowns;
  if (e.raffle) groupUpdate.raffleTickets = Math.trunc(num(group.raffleTickets)) + e.raffle;
  if (e.setFlag) groupUpdate[e.setFlag] = true;

  let marriageId = null;
  let marriageWrite = null;
  const partnerUpdates = {};
  if (e.marriage === 'wedding') {
    marriageId = marriageIdFor(payload.q);
    const [a, b] = e.couple || [];
    if (!isValidTeamId(a) || !isValidTeamId(b)) return fail('incomplete_qr');
    // Sister teams of one group (or a team with itself) cannot marry.
    if (parentOf(a) === parentOf(b)) return fail('same_group');
    if (gid !== a && gid !== b) return fail('not_in_wedding', { a, b });
    const other = gid === a ? b : a;
    // This QR has already been used for a wedding (one that has since ended:
    // a live one would have failed notMarried above).
    if (marriage) return fail('marriage_over');
    const partner = partners[other];
    if (!partner) return fail('missing_partner', { team: other });
    if (partner.married) return fail('partner_married', { team: other });
    marriageWrite = {
      participants: [a, b],
      hasDivorced: false,
      createdAt: t,
      pot: 0,
      deposits: {},
    };
    groupUpdate.married = true;
    groupUpdate.marriageId = marriageId;
    partnerUpdates[other] = {
      married: true,
      marriageId,
      happiness: applyStat(num(partner.happiness), e.happiness, true).value,
    };
  } else if (e.marriage === 'deposit') {
    marriageId = String(group.marriageId);
    const deposits = { ...(marriage.deposits || {}) };
    deposits[gid] = Math.trunc(num(deposits[gid])) + e.deposit;
    marriageWrite = { ...marriage, pot: potOf(marriage) + e.deposit, deposits };
  } else if (e.marriage === 'divorce') {
    marriageId = String(group.marriageId);
    const parts = marriageParts(marriage);
    marriageWrite = {
      ...(marriage || {}),
      participants: parts.length ? parts : [gid],
      hasDivorced: true,
      createdAt: marriage?.createdAt ?? t,
      dissolvedBy: gid,
      dissolvedAt: t,
      potAtDivorce: divorcePot,
      pot: 0,
    };
    // The marriage ends for both groups, so the partner is not left showing
    // MARRIED to a marriage that no longer exists.
    for (const p of parts) {
      if (p !== gid && partners[p] && String(partners[p].marriageId) === marriageId) {
        const pg = partners[p];
        partnerUpdates[p] = { married: false, marriageId: null };
        if (divorceComplete) {
          partnerUpdates[p].happiness = applyStat(num(pg.happiness), 3, true).value;
          partnerUpdates[p].food = applyStat(num(pg.food), 10, true, APPLE_MAX).value;
        }
      }
    }
    groupUpdate.married = false;
    groupUpdate.marriageId = null;
  }

  // Invariant: nothing above may produce a fresh negative. If it ever does,
  // refuse rather than write it (the Firestore rules would refuse it anyway).
  for (const k of ['money', 'food', 'happiness']) {
    if (groupUpdate[k] < 0 && groupUpdate[k] < cur[k]) return fail('internal');
  }

  return {
    ok: true,
    stationId: station.id,
    inputs,
    groupUpdate,
    limitKey: e.limit ? e.limit.key : null,
    limitUpdate,
    marriageId,
    marriageWrite,
    partnerUpdates,
    poolKey: e.pool ? e.pool.key : null,
    poolUpdate,
    summary: {
      money: next.money - cur.money,
      food: next.food - cur.food,
      happiness: next.happiness - cur.happiness,
      educationTo: education !== edu ? education : null,
      capped,
      raffle: e.raffle,
      marriage: e.marriage,
      deposit: e.deposit || 0,
      gymMember: e.setFlag === 'gymMember',
    },
  };
}

// -------------------------------------------------------- final will vote ---

// Each group casts one vote (changeable while voting is open) for another
// group. Returns every voted-for group with its count, most votes first,
// and the leaders - more than one leader means a tie for the helper to break.
export function tallyVotes(votes = []) {
  const counts = new Map();
  for (const v of votes) {
    if (!v || !isValidGroupId(v.voter) || !isValidGroupId(String(v.for))) continue;
    if (String(v.voter) === String(v.for)) continue;
    const k = Number(v.for);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const rows = [...counts.entries()].map(([group, count]) => ({ group, count }))
    .sort((a, b) => b.count - a.count || a.group - b.group);
  const top = rows.length ? rows[0].count : 0;
  return { rows, leaders: rows.filter((r) => r.count === top && top > 0).map((r) => r.group), total: votes.length };
}

// ----------------------------------------------------- marriages by hand ---

// Helper-page repair: marry two teams directly. Any marriage either team is
// in (complete or half-formed) is ended first, with no penalty, and its other
// team is freed. `groups` maps team id -> document for both teams and for
// those old partners; `marriages` maps marriage id -> document.
export function resolveHandMarriage({
  a, b, groups = {}, marriages = {}, bonus = false, newId, t = Date.now(),
}) {
  a = String(a);
  b = String(b);
  if (!isValidTeamId(a) || !isValidTeamId(b)) return fail('missing_group');
  if (parentOf(a) === parentOf(b)) return fail('same_group');
  if (!groups[a]) return fail('missing_partner', { team: a });
  if (!groups[b]) return fail('missing_partner', { team: b });
  const current = (x) => (groups[x].married && groups[x].marriageId ? String(groups[x].marriageId) : null);
  if (current(a) && current(a) === current(b)) {
    const parts = marriageParts(marriages[current(a)]);
    if (parts.includes(a) && parts.includes(b)) return fail('already_married_together');
  }
  const groupUpdates = {};
  const marriageWrites = {};
  const ended = [];
  for (const x of [a, b]) {
    const mid = current(x);
    if (!mid || marriageWrites[mid]) continue;
    const m = marriages[mid];
    marriageWrites[mid] = {
      ...(m || {}),
      participants: m ? marriageParts(m) : [x],
      hasDivorced: true,
      dissolvedBy: 'helper',
      dissolvedAt: t,
      potAtDivorce: potOf(m),
      pot: 0,
    };
    for (const p of marriageParts(m)) {
      if (p === a || p === b) continue;
      if (groups[p] && String(groups[p].marriageId) === mid) groupUpdates[p] = { married: false, marriageId: null };
    }
    ended.push({ id: mid, participants: marriageParts(m), pot: potOf(m) });
  }
  const id = String(newId);
  marriageWrites[id] = { participants: [a, b], hasDivorced: false, createdAt: t, pot: 0, deposits: {}, byHelper: true };
  for (const x of [a, b]) {
    groupUpdates[x] = { married: true, marriageId: id };
    if (bonus) groupUpdates[x].happiness = applyStat(num(groups[x].happiness), 5, true).value;
  }
  return { ok: true, marriageId: id, groupUpdates, marriageWrites, ended };
}

// Helper-page repair: end a team's marriage for both teams, with no divorce
// money or penalty. The pot is recorded but not paid out.
export function resolveHandUnmarry({ team, groups = {}, marriage = null, t = Date.now() }) {
  team = String(team);
  const g = groups[team];
  if (!g) return fail('missing_group');
  if (!g.married || !g.marriageId) return fail('not_married');
  const mid = String(g.marriageId);
  const parts = marriageParts(marriage);
  const groupUpdates = { [team]: { married: false, marriageId: null } };
  for (const p of parts) {
    if (p !== team && groups[p] && String(groups[p].marriageId) === mid) groupUpdates[p] = { married: false, marriageId: null };
  }
  return {
    ok: true,
    marriageId: mid,
    groupUpdates,
    marriageWrite: {
      ...(marriage || {}),
      participants: parts.length ? parts : [team],
      hasDivorced: true,
      dissolvedBy: 'helper',
      dissolvedAt: t,
      potAtDivorce: potOf(marriage),
      pot: 0,
    },
    pot: potOf(marriage),
    freed: Object.keys(groupUpdates),
  };
}

// ------------------------------------------------------ marriage payout ---

// "At the end both parti can both get the amount in pot * 2 plus 10 apples."
// Each group of a complete, undivorced, unpaid marriage receives pot x 2 and
// +10 apples (capped at 8). `groups` maps group id -> group document.
export function resolveMarriagePayout(marriage, groups = {}) {
  const parts = marriageParts(marriage);
  if (!marriage || marriage.hasDivorced || marriage.paidOut) return fail('marriage_over');
  if (parts.length !== 2) return fail('marriage_not_ready');
  const pot = potOf(marriage);
  const updates = {};
  const summaries = {};
  for (const p of parts) {
    const g = groups[p];
    if (!g) return fail('missing_group', { gid: p });
    const cur = { money: num(g.money), food: num(g.food) };
    const money = cur.money + pot * 2;
    const food = applyStat(cur.food, 10, true, APPLE_MAX).value;
    updates[p] = { money, food };
    summaries[p] = { money: money - cur.money, food: food - cur.food, happiness: 0 };
  }
  return {
    ok: true,
    pot,
    updates,
    summaries,
    marriageWrite: { ...marriage, paidOut: true, potAtPayout: pot, pot: 0 },
  };
}

// --------------------------------------------------------- global events ---

export const GLOBAL_EVENTS = {
  pandemic: {
    id: 'pandemic',
    label: 'Pandemic Pass-26',
    when: '16:00',
    description: 'Every group loses $200, 2 apples and 2 happiness. Nobody goes below 0.',
    announcement: '🦠 Pandemic Pass-26 has struck! Every group loses $200, 2 apples and 2 happiness.',
  },
  tax: {
    id: 'tax',
    label: 'ICPASS Tax',
    when: '16:40 (optional)',
    description: 'Over $2000: lose 10%. Under $1000: gain 10%. Everyone +1 happiness. Rounded to whole dollars.',
    announcement: '💸 President Anastasia has introduced the ICPASS Tax! Over $2000 pay 10%, under $1000 receive 10%, and everyone gains 1 happiness.',
  },
};

export function resolveGlobalEvent(eventId, group) {
  if (!group) return fail('missing_group');
  const cur = { money: num(group.money), food: num(group.food), happiness: num(group.happiness) };
  let next;
  if (eventId === 'pandemic') {
    next = {
      money: applyStat(cur.money, -200, true).value,
      food: applyStat(cur.food, -2, true).value,
      happiness: applyStat(cur.happiness, -2, true).value,
    };
  } else if (eventId === 'tax') {
    let money = cur.money;
    if (cur.money > 2000) money = Math.round(cur.money * 0.9);
    else if (cur.money < 1000 && cur.money > 0) money = Math.round(cur.money * 1.1);
    next = { money, food: cur.food, happiness: cur.happiness + 1 };
  } else {
    return fail('unknown_event');
  }
  return {
    ok: true,
    groupUpdate: next,
    summary: {
      money: next.money - cur.money,
      food: next.food - cur.food,
      happiness: next.happiness - cur.happiness,
    },
  };
}

// ---------------------------------------------------- manual adjustments ---

// Helper-side correction. Deltas stop at 0 and apples stay within the cap;
// an education value, when given, is set outright.
export function resolveAdjustment(group, {
  money = 0, food = 0, happiness = 0, education = null, clearCooldowns = false,
} = {}) {
  if (!group) return fail('missing_group');
  const cur = { money: num(group.money), food: num(group.food), happiness: num(group.happiness) };
  const d = { money: Math.trunc(num(money)), food: Math.trunc(num(food)), happiness: Math.trunc(num(happiness)) };
  const next = {
    money: applyStat(cur.money, d.money, true).value,
    food: applyStat(cur.food, d.food, true, APPLE_MAX).value,
    happiness: applyStat(cur.happiness, d.happiness, true).value,
  };
  const groupUpdate = { ...next };
  const edu = Number(education);
  if (education !== null && education !== '' && Number.isInteger(edu) && edu >= EDU.NONE && edu <= EDU.PHD) {
    groupUpdate.education = edu;
  }
  if (clearCooldowns) groupUpdate.cooldowns = {};
  return {
    ok: true,
    groupUpdate,
    summary: {
      money: next.money - cur.money,
      food: next.food - cur.food,
      happiness: next.happiness - cur.happiness,
      educationTo: groupUpdate.education ?? null,
      clearedCooldowns: !!clearCooldowns,
    },
  };
}

// ------------------------------------------------------ starting profile ---

// "All groups are assigned with different profiles": apples 0-3, happiness 5,
// money $100-$300, degree none 50% / primary 30% / secondary 20%.
export function randomProfile(teamId, rng = Math.random) {
  const r = () => Math.min(Math.max(num(rng()), 0), 0.999999);
  const degree = r();
  return {
    group: parentOf(teamId),
    team: String(teamId),
    money: 100 + 50 * Math.floor(r() * 5),
    food: Math.floor(r() * 4),
    happiness: 5,
    education: degree < 0.5 ? EDU.NONE : degree < 0.8 ? EDU.PRIMARY : EDU.SECONDARY,
    married: false,
    marriageId: null,
    gymMember: false,
    raffleTickets: 0,
    once: {},
    cooldowns: {},
  };
}

// ------------------------------------------------------------- wording ---

const signed = (n, unit = '') => `${n > 0 ? '+' : '−'}${unit}${Math.abs(n).toLocaleString('en-US')}`;

export function formatDelta({ money = 0, food = 0, happiness = 0 } = {}) {
  const parts = [];
  if (money) parts.push(signed(money, '$'));
  if (food) parts.push(`${signed(food)} 🍎`);
  if (happiness) parts.push(`${signed(happiness)} 😄`);
  return parts.join('  ·  ');
}

export function summaryText(s) {
  const parts = [];
  const delta = formatDelta(s);
  if (delta) parts.push(delta);
  if (s.educationTo !== null && s.educationTo !== undefined) parts.push(`🎓 ${EDUCATION_LABELS[s.educationTo]}`);
  if (s.raffle) parts.push(`🎟 +${s.raffle}`);
  if (s.gymMember) parts.push('🏋️ Gym member');
  if (s.marriage === 'wedding') parts.push('💍 Married');
  if (s.marriage === 'deposit') parts.push(`🏦 $${Number(s.deposit || 0).toLocaleString('en-US')} into the marriage pot`);
  if (s.marriage === 'divorce') parts.push('💔 Divorced');
  if (s.clearedCooldowns) parts.push('⏱ Cooldowns cleared');
  if (s.capped) parts.push(`(apples capped at ${APPLE_MAX})`);
  return parts.length ? parts.join('  ·  ') : 'Recorded';
}

const LIMIT_REACHED = {
  phd: 'Both PhD places have already been taken.',
  assassin: 'The assassin job has already been taken by another team.',
  finalWill: 'The Final Will has already been awarded.',
};

export function reasonMessage(reason, detail = {}) {
  switch (reason) {
    case 'missing_group': return 'Group account not found - rejoin your group.';
    case 'already_scanned': return 'Your group has already used this QR code.';
    case 'needs_education': return `Your group needs a ${EDUCATION_LABELS[detail.level] || 'higher'} degree for this.`;
    case 'already_qualified': return 'Your group already holds this qualification.';
    case 'too_rich': return `Only groups with under $${detail.value} can do this.`;
    case 'needs_gymMember': return 'Gym members only - buy a membership first.';
    case 'already_gymMember': return 'Your group is already a gym member.';
    case 'already_married': return 'Your group is already married.';
    case 'not_married': return 'Your group is not married.';
    case 'marriage_full': return 'This wedding already has two groups.';
    case 'marriage_over': return 'This marriage has already ended.';
    case 'missing_partner': return detail.team
      ? `Team ${detail.team} has not joined yet - someone from that team must open the site first.`
      : 'The partner team account was not found.';
    case 'already_done': return 'Your group has already done this - it can only be done once.';
    case 'cooldown': return `Too soon - your group can play ${detail.label || 'this'} again in ${detail.minutes} min.`;
    case 'apples_full': return detail.room
      ? `Your group only has room for ${detail.room} more apple${detail.room === 1 ? '' : 's'} (max ${APPLE_MAX}).`
      : `Your group already has ${APPLE_MAX} apples - the maximum.`;
    case 'pool_empty': return detail.count
      ? `Only ${detail.count} donated apple${detail.count === 1 ? ' is' : 's are'} left in the box.`
      : 'The donation box is empty.';
    case 'not_vote_winner': return `The Final Will went to Group ${detail.winner} - only a team of that group can scan this.`;
    case 'same_group': return 'Teams from the same group cannot marry each other.';
    case 'not_in_wedding': return `This wedding QR is for Team ${detail.a} and Team ${detail.b} - not your team.`;
    case 'already_married_together': return 'These two teams are already married to each other.';
    case 'partner_married': return `Team ${detail.team} is already married.`;
    case 'marriage_not_ready': return 'Your partner group has not scanned the wedding QR yet.';
    case 'limit_reached': return LIMIT_REACHED[detail.key] || 'No places left for this.';
    case 'hungry': return 'Your group does not have enough apples.';
    case 'sad': return 'Your group is too unhappy to do this.';
    case 'poor': return 'Your group cannot afford this.';
    case 'outdated': return 'This QR code has expired - ask the helper for a fresh one.';
    case 'old_qr': return 'This QR comes from an old helper page - ask the helper to refresh it.';
    case 'incomplete_qr':
    case 'unknown_station': return 'This QR code is incomplete - ask the helper to make a new one.';
    case 'busy': return 'Too many people scanning at once - please scan again.';
    case 'internal': return 'Something went wrong - nothing was changed. Please tell a helper.';
    default: return 'Invalid QR code.';
  }
}

// What a station will do, as short chips for the helper page.
export function describeStation(station, inputs) {
  const req = [];
  const fx = [];
  if (station.minEducation > EDU.NONE) req.push(`Needs ${EDUCATION_LABELS[station.minEducation]} degree or higher`);
  if (!isComplete(station, inputs)) return { complete: false, req, fx };
  const e = effectOf(station, inputs);
  for (const c of e.checks) {
    if (c.type === 'belowEducation') req.push(`Not for groups already holding ${EDUCATION_LABELS[c.level]}`);
    if (c.type === 'moneyBelow') req.push(`Only groups under $${c.value}`);
    if (c.type === 'flag' && c.flag === 'gymMember') req.push('Gym members only');
    if (c.type === 'notFlag' && c.flag === 'gymMember') req.push('Not for existing members');
    if (c.type === 'notMarried') req.push('Not for married groups');
    if (c.type === 'married') req.push('Married groups only');
    if (c.type === 'voteWinner') req.push('Only the group that won the vote');
    if (c.type === 'appleRoom') req.push(`Needs room for ${c.count} apple${c.count === 1 ? '' : 's'} (max ${APPLE_MAX})`);
  }
  if (e.pool && e.pool.delta < 0) req.push('Donation box must have enough apples');
  if (e.once) req.push('Once per group');
  if (station.repeatable) req.push('Reusable QR: a team can scan it again');
  if (e.limit) req.push(`Max ${e.limit.max} ${e.limit.max === 1 ? 'team' : 'teams'} for the whole event`);
  if (e.cooldown) req.push(`${Math.round(e.cooldown.ms / MINUTE)}-min cooldown per group (losses count)`);
  const delta = formatDelta(e);
  if (delta) fx.push(delta);
  if (e.educationTo !== null) fx.push(`Graduates to ${EDUCATION_LABELS[e.educationTo]}`);
  if (e.raffle) fx.push(`+${e.raffle} raffle ticket${e.raffle === 1 ? '' : 's'}`);
  if (e.setFlag === 'gymMember') fx.push('Becomes a gym member');
  if (e.penalty) fx.push('Penalty: applies even if they cannot afford it (stops at 0)');
  if (e.marriage === 'wedding') {
    const [a, b] = e.couple || [];
    fx.push(`Marries Team ${a} and Team ${b}: +5 😄 each`);
    fx.push('One scan by either team is enough');
  }
  if (e.marriage === 'deposit') fx.push(`$${e.deposit} goes into the marriage pot`);
  if (e.marriage === 'divorce') {
    fx.push('Divorcing group: + pot x 1.5, −3 😄, −10 🍎');
    fx.push('Other group: +3 😄, +10 🍎');
  }
  if (e.pool && e.pool.delta > 0) fx.push(`+${e.pool.delta} 🍎 into the donation box`);
  if (e.pool && e.pool.delta < 0) fx.push(`${e.pool.delta} 🍎 from the donation box`);
  if (!fx.length) fx.push('Records the try only - no stat change');
  return { complete: true, req, fx };
}

export const LIMIT_INFO = LIMITS;
