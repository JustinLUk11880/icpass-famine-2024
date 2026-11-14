// Rules-engine tests: every number in the LifeMon rules document, every
// requirement, and a seeded fuzz over random groups and random inputs.
// Run: npm run test:game

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  APPLE_MAX, DEFAULT_GROUP_COUNT, EDU, GAME_COOLDOWN_MS, LIMITS, MAX_GROUPS, MINUTE, STAGES, STATIONS,
  cooldownKeyFor, cooldownLabel, cooldownMsFor, getStation,
} from '../src/game/catalog.js';
import {
  QR_HEADER, QR_LIFETIME_MS, buildPayload, describeStation, effectOf, formatDelta,
  isComplete, isValidGroupId, missingFields, newQrId, planReads, randomProfile,
  reasonMessage, resolveAdjustment, resolveGlobalEvent, resolveMarriagePayout, resolveScan,
  sanitizeInputs, summaryText, tallyVotes, validatePayload,
} from '../src/game/engine.js';

// ---------------------------------------------------------------- helpers ---

const T0 = 1_800_000_000_000;

const baseGroup = (over = {}) => ({
  group: 1, money: 1000, food: 5, happiness: 10, education: EDU.PHD,
  married: false, marriageId: null, gymMember: true, raffleTickets: 0,
  once: {}, cooldowns: {}, ...over,
});

// Inputs that make a station's QR complete, with optional overrides.
function inputsFor(station, over = {}) {
  const i = {};
  for (const f of station.fields) {
    if (f.type === 'select') i[f.key] = f.options[0].value;
    else if (f.type === 'number') i[f.key] = f.default ?? (f.nonZero ? 1 : f.min);
    else i[f.key] = f.default;
  }
  return { ...i, ...over };
}

// A full marriage of groups 1 and 2, the default for deposit scans.
const MARRIAGE_1_2 = { participants: ['1', '2'], hasDivorced: false, createdAt: T0, pot: 0, deposits: {} };

function scan(stationId, inputs, group, extra = {}) {
  const station = getStation(stationId);
  assert.ok(station, `unknown station ${stationId}`);
  return resolveScan({
    station,
    payload: buildPayload(stationId, inputsFor(station, inputs), extra.q || 'testQR1234', extra.t ?? T0),
    group,
    groupId: extra.groupId || '1',
    limit: extra.limit ?? null,
    marriage: extra.marriage !== undefined ? extra.marriage : (stationId === 'wed.deposit' ? MARRIAGE_1_2 : null),
    partners: extra.partners ?? {},
    pool: extra.pool !== undefined ? extra.pool : (station.poolKey ? { count: 20 } : null),
    voting: extra.voting ?? null,
  });
}

const deltas = (r) => ({ money: r.summary.money, food: r.summary.food, happiness: r.summary.happiness });

// A group that satisfies every requirement of a station, so a rejection can
// only come from what the test is examining.
function eligibleGroup(station) {
  const g = baseGroup({ education: station.minEducation, money: 3000, food: 4, happiness: 20 });
  if (station.id === 'secret.robbery') g.money = 100;
  if (station.id === 'com.gymMembership') g.gymMember = false;
  if (station.id === 'wed.divorce' || station.id === 'wed.deposit') Object.assign(g, { married: true, marriageId: 'm_x' });
  return g;
}

// mulberry32: small, seeded, reproducible.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- catalog ---

test('catalog: ids unique, stages valid, every station reachable', () => {
  const ids = STATIONS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate station id');
  const stageIds = new Set(STAGES.map((s) => s.id));
  for (const s of STATIONS) {
    assert.ok(stageIds.has(s.stage), `${s.id}: unknown stage ${s.stage}`);
    assert.ok(Number.isInteger(s.minEducation) && s.minEducation >= 0 && s.minEducation <= EDU.PHD);
    assert.equal(typeof s.effect, 'function');
    for (const f of s.fields) {
      assert.ok(['select', 'number', 'toggle'].includes(f.type), `${s.id}.${f.key}: bad type`);
      if (f.type === 'select') assert.ok(f.options.length > 0);
      if (f.type === 'number') assert.ok(f.min <= f.max);
    }
  }
  for (const stage of STAGES) {
    assert.ok(STATIONS.some((s) => s.stage === stage.id), `stage ${stage.id} has no stations`);
  }
});

test('catalog: every station from the rules document is present', () => {
  const expected = [
    'college.primary', 'college.secondary', 'college.ug', 'college.phd',
    'jobs.foodDelivery', 'jobs.warehouse',
    'jobs.police', 'jobs.policeRobbery', 'jobs.nurse', 'jobs.teacher', 'jobs.artist',
    'jobs.surgeon', 'jobs.banker', 'jobs.lawyer', 'jobs.engineer',
    'illegal.drug', 'illegal.assassin', 'illegal.prisoner',
    'secret.finalWill', 'secret.robbery',
    'ent.casino', 'ent.raffle', 'ent.sauna',
    'shop.buyApples', 'shop.donate', 'shop.receive',
    'com.gymMembership', 'com.gymChallenge', 'com.foodWaste', 'com.bowling', 'com.hospital',
    'wed.wedding', 'wed.deposit', 'wed.divorce',
  ];
  for (const id of expected) assert.ok(getStation(id), `missing station ${id}`);
  assert.equal(STATIONS.length, expected.length, 'unexpected extra station');
});

test('catalog: every option of every select produces a finite effect', () => {
  for (const s of STATIONS) {
    const selects = s.fields.filter((f) => f.type === 'select');
    const combos = selects.reduce(
      (acc, f) => acc.flatMap((c) => f.options.map((o) => ({ ...c, [f.key]: o.value }))),
      [{}],
    );
    for (const c of combos) {
      const e = effectOf(s, inputsFor(s, c));
      for (const k of ['money', 'food', 'happiness']) {
        assert.ok(Number.isFinite(e[k]), `${s.id} ${JSON.stringify(c)}: ${k} not finite`);
      }
    }
  }
});

// ------------------------------------------------- numbers from the rules ---

const RULES = [
  // [station, inputs, expected deltas, expected education afterwards]
  ['college.primary', { result: 'pass' }, { money: 0, food: -1, happiness: -1 }, EDU.PRIMARY],
  ['college.primary', { result: 'fail' }, { money: 0, food: -1, happiness: -1 }, null],
  ['college.secondary', { result: 'pass' }, { money: 0, food: -2, happiness: -1 }, EDU.SECONDARY],
  ['college.secondary', { result: 'fail' }, { money: 0, food: -2, happiness: -1 }, null],
  ['college.ug', { result: 'pass' }, { money: 0, food: -2, happiness: -2 }, EDU.UG],
  ['college.ug', { result: 'fail' }, { money: 0, food: -2, happiness: -2 }, null],
  ['college.phd', { result: 'pass' }, { money: -250, food: -2, happiness: -2 }, EDU.PHD],
  ['college.phd', { result: 'fail' }, { money: -250, food: -2, happiness: -2 }, null],
  ['jobs.foodDelivery', { result: 'win' }, { money: 70, food: -1, happiness: 0 }],
  ['jobs.foodDelivery', { result: 'lose' }, { money: 0, food: 0, happiness: 0 }],
  ['jobs.warehouse', { time: 'under90' }, { money: 50, food: -1, happiness: 0 }],
  ['jobs.warehouse', { time: 'under60' }, { money: 75, food: -1, happiness: 0 }],
  ['jobs.warehouse', { time: 'over90' }, { money: 0, food: 0, happiness: 0 }],
  ['jobs.police', { smugglers: 0 }, { money: 150, food: -1, happiness: -1 }],
  ['jobs.police', { smugglers: 3 }, { money: 450, food: -1, happiness: -1 }],
  ['jobs.policeRobbery', {}, { money: 500, food: 0, happiness: 0 }],
  ['jobs.nurse', {}, { money: 200, food: -1, happiness: 0 }],
  ['jobs.teacher', {}, { money: 300, food: -1, happiness: -1 }],
  ['jobs.artist', { watchers: 0 }, { money: 200, food: -2, happiness: 0 }],
  ['jobs.artist', { watchers: 4 }, { money: 1000, food: -2, happiness: 0 }],
  ['jobs.surgeon', { result: 'win' }, { money: 350, food: -1, happiness: 0 }],
  ['jobs.surgeon', { result: 'lose' }, { money: -50, food: -1, happiness: 0 }],
  ['jobs.banker', { result: 'win' }, { money: 350, food: -1, happiness: 0 }],
  ['jobs.banker', { result: 'lose' }, { money: -50, food: -1, happiness: 0 }],
  ['jobs.lawyer', { result: 'win' }, { money: 350, food: -1, happiness: 0 }],
  ['jobs.lawyer', { result: 'lose' }, { money: -50, food: -1, happiness: 0 }],
  ['jobs.engineer', { result: 'win' }, { money: 500, food: -1, happiness: 0 }],
  ['jobs.engineer', { result: 'lose' }, { money: 0, food: -1, happiness: 0 }],
  ['illegal.drug', {}, { money: 500, food: -1, happiness: 0 }],
  ['illegal.assassin', {}, { money: 750, food: -1, happiness: 0 }],
  ['illegal.prisoner', { outcome: 'bothSilent' }, { money: -50, food: 0, happiness: -2 }],
  ['illegal.prisoner', { outcome: 'silentBetrayed' }, { money: -150, food: 0, happiness: -2 }],
  ['illegal.prisoner', { outcome: 'betrayedSilent' }, { money: 100, food: 0, happiness: -2 }],
  ['illegal.prisoner', { outcome: 'bothBetrayed' }, { money: -200, food: 0, happiness: -2 }],
  ['illegal.prisoner', { outcome: 'alone' }, { money: -100, food: 0, happiness: -2 }],
  ['secret.finalWill', {}, { money: 1000, food: 0, happiness: 0 }],
  ['secret.robbery', {}, { money: 2000, food: 0, happiness: 0 }],
  ['ent.casino', { amount: 300 }, { money: 300, food: 0, happiness: 0 }],
  ['ent.casino', { amount: -120 }, { money: -120, food: 0, happiness: 0 }],
  ['ent.raffle', { tickets: 1 }, { money: -50, food: 0, happiness: 0 }],
  ['ent.raffle', { tickets: 6 }, { money: -300, food: 0, happiness: 0 }],
  ['ent.sauna', {}, { money: -100, food: 0, happiness: 2 }],
  ['com.gymMembership', {}, { money: -350, food: 0, happiness: 0 }],
  ['com.gymChallenge', { sets: 1 }, { money: 0, food: 1, happiness: 0 }],
  ['com.gymChallenge', { sets: 3 }, { money: 0, food: 3, happiness: 0 }],
  ['shop.buyApples', { price: 120, apples: 2 }, { money: -240, food: 2, happiness: 0 }],
  ['shop.buyApples', { price: 50, apples: 1 }, { money: -50, food: 1, happiness: 0 }],
  ['shop.donate', { apples: 3 }, { money: 0, food: -3, happiness: 0 }],
  ['shop.receive', { apples: 2 }, { money: 0, food: 2, happiness: 0 }],
  ['com.foodWaste', { boxes: 1 }, { money: 10, food: 0, happiness: 0 }],
  ['com.foodWaste', { boxes: 3 }, { money: 30, food: 0, happiness: 0 }],
  ['wed.wedding', {}, { money: 0, food: 0, happiness: 0 }],
  ['wed.deposit', { amount: 300 }, { money: -300, food: 0, happiness: 0 }],
];

for (const [id, inputs, expected, eduAfter] of RULES) {
  test(`rules: ${id} ${JSON.stringify(inputs)} -> ${formatDelta(expected) || 'no change'}`, () => {
    const station = getStation(id);
    const g = eligibleGroup(station);
    const r = scan(id, inputs, g);
    assert.equal(r.ok, true, `rejected: ${r.reason}`);
    assert.deepEqual(deltas(r), expected);
    if (eduAfter !== undefined) {
      assert.equal(r.summary.educationTo, eduAfter);
      if (eduAfter !== null) assert.equal(r.groupUpdate.education, eduAfter);
    }
  });
}

test('rules: starting profile matches the document', () => {
  const r = rng(7);
  const counts = [0, 0, 0, 0, 0];
  const N = 100000;
  for (let i = 0; i < N; i++) {
    const p = randomProfile(1, r);
    assert.equal(p.happiness, 5);
    assert.ok([100, 150, 200, 250, 300].includes(p.money), `money ${p.money}`);
    assert.ok(Number.isInteger(p.food) && p.food >= 0 && p.food <= 3, `apples ${p.food}`);
    assert.ok(p.education <= EDU.SECONDARY);
    counts[p.education] += 1;
  }
  const share = counts.map((c) => c / N);
  assert.ok(Math.abs(share[EDU.NONE] - 0.5) < 0.01, `no degree ${share[0]}`);
  assert.ok(Math.abs(share[EDU.PRIMARY] - 0.3) < 0.01, `primary ${share[1]}`);
  assert.ok(Math.abs(share[EDU.SECONDARY] - 0.2) < 0.01, `secondary ${share[2]}`);
});

// ----------------------------------------------------------- requirements ---

test('requirements: every station rejects a group one degree short', () => {
  for (const s of STATIONS) {
    if (s.minEducation === EDU.NONE) continue;
    const g = eligibleGroup(s);
    g.education = s.minEducation - 1;
    const r = scan(s.id, {}, g);
    assert.equal(r.ok, false, `${s.id} accepted education ${g.education}`);
    assert.equal(r.reason, 'needs_education');
  }
});

test('requirements: every station accepts an eligible group', () => {
  for (const s of STATIONS) {
    const r = scan(s.id, {}, eligibleGroup(s));
    assert.equal(r.ok, true, `${s.id} rejected eligible group: ${r.reason}`);
  }
});

test('requirements: job tiers follow the degree ladder', () => {
  const tier = (stage) => STATIONS.filter((s) => s.stage === stage).map((s) => s.minEducation);
  assert.ok(tier('jobsPrimary').every((e) => e === EDU.PRIMARY));
  assert.ok(tier('jobsSecondary').every((e) => e === EDU.SECONDARY));
  assert.ok(tier('jobsUniversity').every((e) => e === EDU.UG));
  assert.equal(getStation('college.primary').minEducation, EDU.NONE);
  assert.equal(getStation('college.secondary').minEducation, EDU.PRIMARY);
  assert.equal(getStation('college.ug').minEducation, EDU.SECONDARY);
  assert.equal(getStation('college.phd').minEducation, EDU.UG, 'PhD: UG required');
  assert.equal(getStation('illegal.drug').minEducation, EDU.PRIMARY);
  assert.equal(getStation('illegal.assassin').minEducation, EDU.PRIMARY);
  assert.equal(getStation('illegal.prisoner').minEducation, EDU.NONE, 'anyone can be jailed');
});

test('requirements: exams refuse a group that already holds the degree', () => {
  for (const [id, level] of [['college.primary', 1], ['college.secondary', 2], ['college.ug', 3], ['college.phd', 4]]) {
    const r = scan(id, { result: 'pass' }, baseGroup({ education: level }));
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'already_qualified', id);
  }
});

test('requirements: passing never lowers education', () => {
  const r = scan('college.primary', { result: 'pass' }, baseGroup({ education: EDU.NONE }));
  assert.equal(r.groupUpdate.education, EDU.PRIMARY);
  const f = scan('college.ug', { result: 'fail' }, baseGroup({ education: EDU.SECONDARY }));
  assert.equal(f.groupUpdate.education, undefined, 'a fail must not touch education');
});

test('costs: unaffordable costs are refused, nothing is half-applied', () => {
  assert.equal(scan('college.primary', { result: 'pass' }, baseGroup({ education: 0, food: 0 })).reason, 'hungry');
  assert.equal(scan('college.primary', { result: 'pass' }, baseGroup({ education: 0, happiness: 0 })).reason, 'sad');
  assert.equal(scan('college.phd', { result: 'pass' }, baseGroup({ education: 3, money: 249 })).reason, 'poor');
  assert.equal(scan('ent.sauna', {}, baseGroup({ money: 99 })).reason, 'poor');
  assert.equal(scan('ent.raffle', { tickets: 3 }, baseGroup({ money: 149 })).reason, 'poor');
  assert.equal(scan('com.gymMembership', {}, baseGroup({ gymMember: false, money: 349 })).reason, 'poor');
  assert.equal(scan('jobs.artist', { watchers: 0 }, baseGroup({ food: 1 })).reason, 'hungry');
  // exactly affordable is allowed and lands on 0
  const exact = scan('college.phd', { result: 'fail' }, baseGroup({ education: 3, money: 250, food: 2, happiness: 2 }));
  assert.equal(exact.ok, true);
  assert.deepEqual({ m: exact.groupUpdate.money, f: exact.groupUpdate.food, h: exact.groupUpdate.happiness }, { m: 0, f: 0, h: 0 });
});

test('penalties: always applied, never below zero', () => {
  const broke = baseGroup({ money: 30, happiness: 1 });
  const p = scan('illegal.prisoner', { outcome: 'bothBetrayed' }, broke);
  assert.equal(p.ok, true);
  assert.equal(p.groupUpdate.money, 0);
  assert.equal(p.groupUpdate.happiness, 0);
  const b = scan('jobs.banker', { result: 'lose' }, baseGroup({ money: 20 }));
  assert.equal(b.ok, true);
  assert.equal(b.groupUpdate.money, 0);
  const c = scan('ent.casino', { amount: -5000 }, baseGroup({ money: 120 }));
  assert.equal(c.groupUpdate.money, 0);
  const d = scan('wed.divorce', {}, baseGroup({ married: true, marriageId: 'm_x', happiness: 1, food: 2 }), { marriage: MARRIAGE_1_2 });
  assert.equal(d.ok, true, 'a sad, hungry group can still divorce');
  assert.equal(d.groupUpdate.happiness, 0);
  assert.equal(d.groupUpdate.food, 0);
});

test('apples: capped at 8 and never reduced by a gain', () => {
  const r = scan('com.gymChallenge', { sets: 5 }, baseGroup({ food: 6 }));
  assert.equal(r.groupUpdate.food, APPLE_MAX);
  assert.equal(r.summary.food, 2);
  assert.equal(r.summary.capped, true);
  const full = scan('com.gymChallenge', { sets: 1 }, baseGroup({ food: 8 }));
  assert.equal(full.groupUpdate.food, 8);
  const legacy = scan('com.gymChallenge', { sets: 1 }, baseGroup({ food: 11 }));
  assert.equal(legacy.groupUpdate.food, 11, 'must not cut an existing over-cap value');
  const custom = scan('com.hospital', { food: 8 }, baseGroup({ food: 3 }));
  assert.equal(custom.groupUpdate.food, 8);
});

test('once: teacher and artist pay a group only once', () => {
  for (const id of ['jobs.teacher', 'jobs.artist']) {
    const first = scan(id, {}, baseGroup());
    assert.equal(first.ok, true);
    const again = scan(id, {}, baseGroup({ once: first.groupUpdate.once }));
    assert.equal(again.ok, false);
    assert.equal(again.reason, 'already_done', id);
  }
  // doing one does not block the other
  const t = scan('jobs.teacher', {}, baseGroup());
  assert.equal(scan('jobs.artist', {}, baseGroup({ once: t.groupUpdate.once })).ok, true);
});

test('cooldown: food delivery is one try per 20 minutes, losses included', () => {
  const first = scan('jobs.foodDelivery', { result: 'lose' }, baseGroup(), { t: T0 });
  assert.equal(first.ok, true);
  const g = baseGroup({ cooldowns: first.groupUpdate.cooldowns });
  const early = scan('jobs.foodDelivery', { result: 'win' }, g, { t: T0 + 19 * MINUTE });
  assert.equal(early.ok, false);
  assert.equal(early.reason, 'cooldown');
  assert.equal(early.detail.minutes, 1);
  assert.equal(early.detail.label, 'Food delivery');
  const onTime = scan('jobs.foodDelivery', { result: 'win' }, g, { t: T0 + 20 * MINUTE });
  assert.equal(onTime.ok, true);
  assert.equal(onTime.summary.money, 70);
  // the cooldown belongs to the group, not the station: another group is free
  assert.equal(scan('jobs.foodDelivery', { result: 'win' }, baseGroup(), { t: T0 + MINUTE }).ok, true);
});

test('cooldown: 15 minutes per game per group; entertainment, shop, penalties and bank exempt', () => {
  const games = ['college.primary', 'college.phd', 'jobs.warehouse', 'jobs.police', 'jobs.nurse', 'jobs.surgeon',
    'jobs.banker', 'jobs.lawyer', 'jobs.engineer', 'illegal.drug', 'com.gymChallenge'];
  for (const id of games) {
    const st = getStation(id);
    const g0 = eligibleGroup(st);
    const first = scan(id, {}, g0, { t: T0 });
    assert.equal(first.ok, true, `${id}: ${first.reason}`);
    assert.equal(first.groupUpdate.cooldowns[cooldownKeyFor(id)], T0, id);
    const g = { ...g0, cooldowns: first.groupUpdate.cooldowns };
    const early = scan(id, {}, g, { t: T0 + 14 * MINUTE });
    assert.equal(early.reason, 'cooldown', id);
    assert.equal(early.detail.label, st.label);
    assert.ok(!reasonMessage('cooldown', early.detail).includes('undefined'));
    assert.equal(scan(id, {}, g, { t: T0 + GAME_COOLDOWN_MS }).ok, true, `${id} after 15 min`);
    assert.equal(cooldownMsFor(cooldownKeyFor(id)), GAME_COOLDOWN_MS);
    assert.equal(cooldownLabel(cooldownKeyFor(id)), st.label);
  }
  // a loss starts the cooldown too
  const lost = scan('jobs.banker', { result: 'lose' }, baseGroup(), { t: T0 });
  assert.equal(scan('jobs.banker', { result: 'win' }, baseGroup({ cooldowns: lost.groupUpdate.cooldowns }), { t: T0 + MINUTE }).reason, 'cooldown');
  // cooldowns are per station: banker does not block police
  assert.equal(scan('jobs.police', {}, baseGroup({ cooldowns: lost.groupUpdate.cooldowns }), { t: T0 + MINUTE }).ok, true);
  const exempt = ['ent.casino', 'ent.raffle', 'ent.sauna', 'illegal.prisoner', 'jobs.policeRobbery', 'secret.robbery',
    'shop.buyApples', 'shop.donate', 'shop.receive', 'com.foodWaste', 'com.gymMembership', 'wed.wedding', 'wed.divorce'];
  for (const id of exempt) {
    const e = effectOf(getStation(id), inputsFor(getStation(id)));
    assert.equal(e.cooldown, null, `${id} must have no cooldown`);
  }
  // the bank: one deposit per 30 minutes
  const dep = getStation('wed.deposit');
  assert.equal(effectOf(dep, inputsFor(dep)).cooldown.ms, 30 * MINUTE);
});

test('supermarket: buying needs room for the apples; donation box in and out', () => {
  assert.equal(scan('shop.buyApples', { price: 100, apples: 3 }, baseGroup({ food: 6 })).reason, 'apples_full');
  assert.equal(scan('shop.buyApples', { price: 100, apples: 2 }, baseGroup({ food: 6 })).ok, true);
  assert.equal(scan('shop.buyApples', { price: 200, apples: 2 }, baseGroup({ money: 399 })).reason, 'poor');
  const buy = getStation('shop.buyApples');
  assert.deepEqual(missingFields(buy, sanitizeInputs(buy, { apples: 1 })), ['price'], 'price must be entered');
  assert.equal(sanitizeInputs(buy, { price: 20, apples: 1 }).price, 50, 'price clamped to $50-$200');
  const d = scan('shop.donate', { apples: 2 }, baseGroup({ food: 3 }), { pool: { count: 1 } });
  assert.deepEqual(d.poolUpdate, { count: 3 });
  assert.equal(d.groupUpdate.food, 1);
  assert.equal(scan('shop.donate', { apples: 4 }, baseGroup({ food: 3 }), { pool: null }).reason, 'hungry');
  const rcv = scan('shop.receive', { apples: 2 }, baseGroup({ food: 1 }), { pool: { count: 2 } });
  assert.deepEqual(rcv.poolUpdate, { count: 0 });
  assert.equal(rcv.groupUpdate.food, 3);
  assert.equal(scan('shop.receive', { apples: 3 }, baseGroup({ food: 1 }), { pool: { count: 2 } }).reason, 'pool_empty');
  assert.equal(scan('shop.receive', { apples: 1 }, baseGroup({ food: 1 }), { pool: null }).reason, 'pool_empty');
  assert.equal(scan('shop.receive', { apples: 2 }, baseGroup({ food: 7 }), { pool: { count: 5 } }).reason, 'apples_full');
});

test('marriage bank: deposits need a complete marriage and add to the pot', () => {
  const married = baseGroup({ married: true, marriageId: 'm_x' });
  const d1 = scan('wed.deposit', { amount: 200 }, married, { groupId: '1' });
  assert.equal(d1.ok, true);
  assert.equal(d1.marriageWrite.pot, 200);
  assert.deepEqual(d1.marriageWrite.deposits, { 1: 200 });
  const d2 = scan('wed.deposit', { amount: 500 }, married, { groupId: '2', marriage: d1.marriageWrite });
  assert.equal(d2.marriageWrite.pot, 700);
  assert.deepEqual(d2.marriageWrite.deposits, { 1: 200, 2: 500 });
  // 30 minutes between deposits
  const again = scan('wed.deposit', { amount: 100 }, { ...married, cooldowns: d1.groupUpdate.cooldowns },
    { groupId: '1', marriage: d2.marriageWrite, t: T0 + 29 * MINUTE });
  assert.equal(again.reason, 'cooldown');
  assert.equal(scan('wed.deposit', { amount: 100 }, { ...married, cooldowns: d1.groupUpdate.cooldowns },
    { groupId: '1', marriage: d2.marriageWrite, t: T0 + 30 * MINUTE }).marriageWrite.pot, 800);
  // refusals
  assert.equal(scan('wed.deposit', { amount: 100 }, baseGroup()).reason, 'not_married');
  assert.equal(scan('wed.deposit', { amount: 100 }, married, { marriage: { participants: ['1'] } }).reason, 'marriage_not_ready');
  assert.equal(scan('wed.deposit', { amount: 100 }, married, { marriage: { ...MARRIAGE_1_2, hasDivorced: true } }).reason, 'marriage_over');
  assert.equal(scan('wed.deposit', { amount: 100 }, married, { marriage: { ...MARRIAGE_1_2, paidOut: true } }).reason, 'marriage_over');
  assert.equal(scan('wed.deposit', { amount: 100 }, married, { marriage: null }).reason, 'marriage_over');
  assert.equal(scan('wed.deposit', { amount: 400 }, { ...married, money: 399 }).reason, 'poor');
  const dep = getStation('wed.deposit');
  assert.deepEqual(missingFields(dep, sanitizeInputs(dep, {})), ['amount']);
  assert.equal(sanitizeInputs(dep, { amount: 9999 }).amount, 500);
  assert.equal(sanitizeInputs(dep, { amount: 1 }).amount, 100);
});

test('divorce: divorcer gets pot x 1.5, -3 happiness, -10 apples; the other +3 happiness, +10 apples', () => {
  const marriage = { ...MARRIAGE_1_2, pot: 700, deposits: { 1: 200, 2: 500 } };
  const me = baseGroup({ married: true, marriageId: 'm_x', money: 100, food: 5, happiness: 10 });
  const partner = baseGroup({ married: true, marriageId: 'm_x', food: 2, happiness: 4 });
  const d = scan('wed.divorce', {}, me, { groupId: '1', marriage, partners: { 2: partner } });
  assert.equal(d.ok, true);
  assert.deepEqual(deltas(d), { money: 1050, food: -5, happiness: -3 });
  assert.equal(d.groupUpdate.food, 0);
  assert.deepEqual(d.partnerUpdates, { 2: { married: false, marriageId: null, happiness: 7, food: 8 } });
  assert.equal(d.marriageWrite.hasDivorced, true);
  assert.equal(d.marriageWrite.pot, 0);
  assert.equal(d.marriageWrite.potAtDivorce, 700);
  // pot x 1.5 rounds to whole dollars
  assert.equal(scan('wed.divorce', {}, me, { groupId: '1', marriage: { ...MARRIAGE_1_2, pot: 333 } }).summary.money, 500);
  // a wedding the partner never scanned is just cancelled
  const half = scan('wed.divorce', {}, me, { groupId: '1', marriage: { participants: ['1'] } });
  assert.deepEqual(deltas(half), { money: 0, food: 0, happiness: 0 });
  assert.equal(half.groupUpdate.married, false);
});

test('marriage payout: each partner gets pot x 2 and +10 apples, once', () => {
  const m = { ...MARRIAGE_1_2, pot: 600 };
  const r = resolveMarriagePayout(m, { 1: baseGroup({ money: 100, food: 3 }), 2: baseGroup({ money: 0, food: 0 }) });
  assert.equal(r.ok, true);
  assert.deepEqual(r.updates, { 1: { money: 1300, food: 8 }, 2: { money: 1200, food: 8 } });
  assert.equal(r.marriageWrite.paidOut, true);
  assert.equal(r.marriageWrite.pot, 0);
  assert.equal(resolveMarriagePayout(r.marriageWrite, { 1: baseGroup(), 2: baseGroup() }).reason, 'marriage_over');
  assert.equal(resolveMarriagePayout({ ...m, hasDivorced: true }, {}).reason, 'marriage_over');
  assert.equal(resolveMarriagePayout({ participants: ['1'], pot: 0 }, { 1: baseGroup() }).reason, 'marriage_not_ready');
  assert.equal(resolveMarriagePayout(m, { 1: baseGroup() }).reason, 'missing_group');
  // a pot-less marriage still pays the apples
  assert.deepEqual(resolveMarriagePayout({ ...m, pot: 0 }, { 1: baseGroup({ food: 0 }), 2: baseGroup({ food: 0 }) }).updates[1], { money: 1000, food: 8 });
});

test('final will vote: tally, ties, no self-votes; only the winner can scan', () => {
  const t = tallyVotes([
    { voter: '1', for: 3 }, { voter: '2', for: 3 }, { voter: '3', for: 1 }, { voter: '4', for: 1 },
    { voter: '5', for: 5 }, { voter: '6', for: 99 }, { voter: 'x', for: 2 },
  ]);
  assert.deepEqual(t.rows, [{ group: 1, count: 2 }, { group: 3, count: 2 }]);
  assert.deepEqual(t.leaders, [1, 3], 'a tie is reported, not silently broken');
  assert.deepEqual(tallyVotes([{ voter: '1', for: 2 }]).leaders, [2]);
  assert.deepEqual(tallyVotes([]).leaders, []);
  const fw = (gid, voting, holders = []) => scan('secret.finalWill', {}, baseGroup(), { groupId: gid, voting, limit: { holders } });
  assert.equal(fw('2', { status: 'done', winner: 3 }).reason, 'not_vote_winner');
  assert.ok(reasonMessage('not_vote_winner', { winner: 3 }).includes('Group 3'));
  assert.equal(fw('3', { status: 'done', winner: 3 }).summary.money, 1000);
  assert.equal(fw('2', null).ok, true, 'with no in-app vote, the QR still works (paper vote)');
  assert.equal(fw('3', { status: 'done', winner: 3 }, ['3']).reason, 'already_done');
});

test('group count: defaults to 10', () => {
  assert.equal(DEFAULT_GROUP_COUNT, 10);
});

test('limits: every limited station declares its limitKey, and the max matches LIMITS', () => {
  for (const s of STATIONS) {
    const selects = s.fields.filter((f) => f.type === 'select');
    const combos = selects.reduce((acc, f) => acc.flatMap((c) => f.options.map((o) => ({ ...c, [f.key]: o.value }))), [{}]);
    const keys = new Set(combos.map((c) => effectOf(s, inputsFor(s, c)).limit).filter(Boolean).map((l) => {
      assert.equal(l.max, LIMITS[l.key].max, `${s.id}: max differs from LIMITS`);
      return l.key;
    }));
    if (keys.size) assert.deepEqual([...keys], [s.limitKey], `${s.id}: limitKey`);
    else assert.equal(s.limitKey, undefined, `${s.id}: declares a limit it never applies`);
  }
});

test('limits: PhD max 2 groups, assassin and Final Will max 1', () => {
  const g = baseGroup({ education: EDU.UG });
  const phd = (holders) => scan('college.phd', { result: 'pass' }, g, { groupId: '9', limit: { holders } });
  assert.deepEqual(phd([]).limitUpdate.holders, ['9']);
  assert.deepEqual(phd(['1']).limitUpdate.holders, ['1', '9']);
  assert.equal(phd(['1', '2']).reason, 'limit_reached');
  // a failed attempt takes no place and is still charged
  const failed = scan('college.phd', { result: 'fail' }, g, { groupId: '9', limit: { holders: ['1', '2'] } });
  assert.equal(failed.ok, true);
  assert.equal(failed.limitUpdate, null);
  assert.equal(failed.summary.money, -250);

  assert.equal(scan('illegal.assassin', {}, baseGroup(), { limit: { holders: [] } }).ok, true);
  assert.equal(scan('illegal.assassin', {}, baseGroup(), { groupId: '2', limit: { holders: ['1'] } }).reason, 'limit_reached');
  assert.equal(scan('secret.finalWill', {}, baseGroup(), { groupId: '2', limit: { holders: ['5'] } }).reason, 'limit_reached');
});

test('robbery: only teams under $500 may attempt', () => {
  assert.equal(scan('secret.robbery', {}, baseGroup({ money: 500 })).reason, 'too_rich');
  assert.equal(scan('secret.robbery', {}, baseGroup({ money: 499 })).ok, true);
  assert.equal(scan('secret.robbery', {}, baseGroup({ money: 0 })).summary.money, 2000);
});

test('gym: membership once, challenges need membership', () => {
  assert.equal(scan('com.gymChallenge', { sets: 2 }, baseGroup({ gymMember: false })).reason, 'needs_gymMember');
  const m = scan('com.gymMembership', {}, baseGroup({ gymMember: false }));
  assert.equal(m.groupUpdate.gymMember, true);
  assert.equal(scan('com.gymMembership', {}, baseGroup({ gymMember: true })).reason, 'already_gymMember');
});

test('raffle: tickets accumulate privately', () => {
  const r = scan('ent.raffle', { tickets: 4 }, baseGroup({ raffleTickets: 3 }));
  assert.equal(r.groupUpdate.raffleTickets, 7);
});

test('wedding: two groups marry, a third is refused, married groups cannot remarry', () => {
  const w1 = scan('wed.wedding', {}, baseGroup(), { groupId: '3', q: 'wedQR00001' });
  assert.equal(w1.ok, true);
  assert.equal(w1.marriageId, 'm_wedQR00001');
  assert.deepEqual(w1.marriageWrite.participants, ['3']);
  const w2 = scan('wed.wedding', {}, baseGroup(), { groupId: '7', q: 'wedQR00001', marriage: w1.marriageWrite });
  assert.deepEqual(w2.marriageWrite.participants, ['3', '7']);
  const w3 = scan('wed.wedding', {}, baseGroup(), { groupId: '8', q: 'wedQR00001', marriage: w2.marriageWrite });
  assert.equal(w3.reason, 'marriage_full');
  assert.equal(scan('wed.wedding', {}, baseGroup({ married: true, marriageId: 'm_x' })).reason, 'already_married');
});

test('divorce: ends the marriage for both groups; needs a marriage', () => {
  const marriage = { participants: ['3', '7'], hasDivorced: false, createdAt: T0 };
  const me = baseGroup({ married: true, marriageId: 'm_abc' });
  const partner = baseGroup({ married: true, marriageId: 'm_abc' });
  const d = scan('wed.divorce', {}, me, { groupId: '3', marriage, partners: { 7: partner } });
  assert.equal(d.ok, true);
  assert.equal(d.groupUpdate.married, false);
  assert.equal(d.groupUpdate.marriageId, null);
  assert.equal(d.marriageWrite.hasDivorced, true);
  assert.deepEqual(d.partnerUpdates, { 7: { married: false, marriageId: null, happiness: 13, food: 8 } });
  assert.equal(scan('wed.divorce', {}, baseGroup()).reason, 'not_married');
  // a partner who has since remarried someone else is left alone
  const moved = scan('wed.divorce', {}, me, {
    groupId: '3', marriage, partners: { 7: baseGroup({ married: true, marriageId: 'm_other' }) },
  });
  assert.deepEqual(moved.partnerUpdates, {});
});

test('planReads: fetches exactly the documents a decision needs', () => {
  const p = (id, inputs, group) => planReads(getStation(id), buildPayload(id, inputsFor(getStation(id), inputs), 'qrABCDEF12', T0), group);
  assert.deepEqual(p('college.phd', { result: 'pass' }), { limitKey: 'phd' });
  assert.deepEqual(p('college.phd', { result: 'fail' }), {});
  assert.deepEqual(p('illegal.assassin', {}), { limitKey: 'assassin' });
  assert.deepEqual(p('wed.wedding', {}), { marriageId: 'm_qrABCDEF12' });
  assert.deepEqual(p('wed.divorce', {}, { marriageId: 'm_z' }), { marriageId: 'm_z', readPartners: true });
  assert.deepEqual(p('wed.deposit', { amount: 100 }, { marriageId: 'm_z' }), { marriageId: 'm_z' });
  assert.deepEqual(p('shop.donate', { apples: 1 }), { poolKey: 'apples' });
  assert.deepEqual(p('shop.receive', { apples: 1 }), { poolKey: 'apples' });
  assert.deepEqual(p('secret.finalWill', {}), { limitKey: 'finalWill', votingId: 'finalWill' });
  assert.deepEqual(p('ent.sauna', {}), {});
});

// ----------------------------------------------------------- global events ---

test('pandemic: -$200, -2 apples, -2 happiness, never below zero', () => {
  const r = resolveGlobalEvent('pandemic', baseGroup({ money: 1000, food: 5, happiness: 10 }));
  assert.deepEqual(r.summary, { money: -200, food: -2, happiness: -2 });
  const poor = resolveGlobalEvent('pandemic', baseGroup({ money: 50, food: 1, happiness: 0 }));
  assert.deepEqual(poor.groupUpdate, { money: 0, food: 0, happiness: 0 });
});

test('ICPASS tax: over $2000 -10%, under $1000 +10%, everyone +1 happiness, rounded', () => {
  const tax = (money) => resolveGlobalEvent('tax', baseGroup({ money, happiness: 5 })).groupUpdate;
  assert.equal(tax(2500).money, 2250);
  assert.equal(tax(2001).money, 1801);
  assert.equal(tax(2000).money, 2000, '$2000 exactly is not "over $2000"');
  assert.equal(tax(1500).money, 1500);
  assert.equal(tax(1000).money, 1000, '$1000 exactly is not "under $1000"');
  assert.equal(tax(999).money, 1099);
  assert.equal(tax(555).money, 611);
  assert.equal(tax(0).money, 0);
  for (const m of [0, 999, 1500, 2500]) {
    assert.ok(Number.isInteger(tax(m).money), 'rounded to an integer');
    assert.equal(tax(m).happiness, 6);
  }
});

test('adjustment: floors at 0, caps apples, sets education outright', () => {
  const r = resolveAdjustment(baseGroup({ money: 100, food: 7, happiness: 2 }), { money: -500, food: 5, happiness: -9, education: 2 });
  assert.deepEqual(r.groupUpdate, { money: 0, food: 8, happiness: 0, education: 2 });
  const c = resolveAdjustment(baseGroup({ cooldowns: { jobs_banker: T0 } }), { clearCooldowns: true });
  assert.deepEqual(c.groupUpdate.cooldowns, {});
  assert.ok(summaryText(c.summary).includes('Cooldowns cleared'));
  assert.equal(resolveAdjustment(baseGroup(), { education: 9 }).groupUpdate.education, undefined);
});

// ----------------------------------------------------------------- payload ---

test('payload: header, expiry, structure', () => {
  const ok = buildPayload('ent.sauna', {}, 'abcdEFGH1234', T0);
  assert.equal(validatePayload(ok, T0), null);
  assert.equal(validatePayload(ok, T0 + QR_LIFETIME_MS - 1), null);
  assert.equal(validatePayload(ok, T0 + QR_LIFETIME_MS + 1), 'outdated');
  assert.equal(validatePayload(ok, T0 - QR_LIFETIME_MS - 1), 'outdated', 'clock skew the other way');
  assert.equal(validatePayload({ ...ok, h: 'famine-2023-lifemon' }, T0), 'old_qr');
  assert.equal(validatePayload({ ...ok, h: 'nope' }, T0), 'invalid');
  assert.equal(validatePayload({ ...ok, s: 'no.such' }, T0), 'incomplete_qr');
  assert.equal(validatePayload({ ...ok, q: 'a/b' }, T0), 'invalid', 'qr id must be path-safe');
  assert.equal(validatePayload({ ...ok, t: 'soon' }, T0), 'invalid');
  assert.equal(validatePayload(null, T0), 'invalid');
  assert.equal(ok.h, QR_HEADER);
});

test('payload: qr ids are unique and path-safe', () => {
  const r = rng(11);
  const seen = new Set();
  for (let i = 0; i < 20000; i++) {
    const id = newQrId(r);
    assert.match(id, /^[A-Za-z0-9_-]{12}$/);
    seen.add(id);
  }
  assert.equal(seen.size, 20000);
});

test('inputs: garbage is clamped or rejected, never trusted', () => {
  const police = getStation('jobs.police');
  assert.deepEqual(sanitizeInputs(police, { smugglers: 9999, robbery: 'yes', extra: 1 }), { smugglers: 20 });
  assert.deepEqual(sanitizeInputs(police, { smugglers: -4 }), { smugglers: 0 });
  assert.deepEqual(sanitizeInputs(police, { smugglers: 'x' }), { smugglers: 0 });
  const pf = getStation('college.primary');
  assert.deepEqual(sanitizeInputs(pf, { result: 'PASS' }), { result: null });
  assert.equal(isComplete(pf, sanitizeInputs(pf, {})), false);
  const casino = getStation('ent.casino');
  assert.deepEqual(missingFields(casino, sanitizeInputs(casino, {})), ['amount']);
  assert.deepEqual(missingFields(casino, sanitizeInputs(casino, { amount: 0 })), ['amount'], 'a $0 casino result is not a result');
  const r = resolveScan({ station: pf, payload: buildPayload(pf.id, { result: 'maybe' }, 'qr12345678', T0), group: baseGroup({ education: 0 }), groupId: '1' });
  assert.equal(r.reason, 'incomplete_qr');
});

test('group ids: 1..20 only', () => {
  for (let g = 1; g <= MAX_GROUPS; g++) assert.ok(isValidGroupId(g) && isValidGroupId(String(g)));
  for (const bad of [0, 21, -1, 1.5, '01', ' 3', 'x', null, undefined, '']) assert.equal(isValidGroupId(bad), false, String(bad));
});

// ------------------------------------------------------------------ wording ---

test('wording: every reason, station and summary renders', () => {
  const reasons = ['missing_group', 'already_scanned', 'needs_education', 'already_qualified', 'too_rich',
    'needs_gymMember', 'already_gymMember', 'already_married', 'not_married', 'marriage_full', 'marriage_over',
    'already_done', 'cooldown', 'limit_reached', 'hungry', 'sad', 'poor', 'outdated', 'old_qr', 'incomplete_qr',
    'unknown_station', 'busy', 'internal', 'apples_full', 'pool_empty', 'marriage_not_ready', 'not_vote_winner',
    'missing_partner', 'whatever'];
  for (const r of reasons) {
    const m = reasonMessage(r, { level: 2, value: 500, minutes: 3, key: 'phd', label: 'Banker', room: 2, count: 1, winner: 4 });
    assert.ok(typeof m === 'string' && m.length > 5 && !m.includes('undefined'), `${r}: "${m}"`);
  }
  for (const key of Object.keys(LIMITS)) assert.ok(!reasonMessage('limit_reached', { key }).includes('undefined'));
  for (const s of STATIONS) {
    const d = describeStation(s, inputsFor(s));
    assert.equal(d.complete, true, s.id);
    assert.ok(d.fx.length > 0, s.id);
    for (const line of [...d.req, ...d.fx]) assert.ok(!line.includes('undefined') && !line.includes('NaN'), `${s.id}: ${line}`);
  }
  assert.equal(summaryText({ money: 0, food: 0, happiness: 0 }), 'Recorded');
  assert.equal(formatDelta({ money: 1500, food: -2, happiness: 1 }), '+$1,500  ·  −2 🍎  ·  +1 😄');
});

// --------------------------------------------------------------------- fuzz ---

test('fuzz: 200k random scans never throw and never break an invariant', () => {
  const r = rng(20251112);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const garbage = [undefined, null, '', 'x', -1, 0, 1, 7, 99999, -99999, true, false, 'pass', 'win', {}, [], NaN, 1.5];
  for (let n = 0; n < 200000; n++) {
    const station = pick(STATIONS);
    const group = {
      group: 1,
      money: Math.floor(r() * 4000),
      food: Math.floor(r() * (APPLE_MAX + 1)),
      happiness: Math.floor(r() * 30),
      education: Math.floor(r() * 5),
      married: r() < 0.3,
      marriageId: r() < 0.3 ? 'm_q' : null,
      gymMember: r() < 0.5,
      raffleTickets: Math.floor(r() * 10),
      once: r() < 0.3 ? { teacher: true, artist: r() < 0.5 } : {},
      cooldowns: r() < 0.3 ? { [cooldownKeyFor(station.id)]: T0 - Math.floor(r() * 40) * MINUTE } : {},
    };
    // half the time sensible inputs, half the time garbage
    const inputs = {};
    for (const f of station.fields) {
      if (r() < 0.5) {
        inputs[f.key] = f.type === 'select' ? pick(f.options).value
          : f.type === 'number' ? f.min + Math.floor(r() * (f.max - f.min + 1))
            : r() < 0.5;
      } else {
        inputs[f.key] = pick(garbage);
      }
    }
    const limit = r() < 0.5 ? { holders: ['2', '3'].slice(0, Math.floor(r() * 3)) } : null;
    const marriage = r() < 0.5 ? {
      participants: ['1', '4'].slice(0, Math.floor(r() * 3)),
      hasDivorced: r() < 0.2,
      paidOut: r() < 0.1,
      pot: pick([undefined, 0, 100, 777, -5, 'x']),
    } : null;
    const pool = r() < 0.5 ? { count: pick([0, 1, 3, 8, -2, 'x', undefined]) } : null;
    const voting = r() < 0.3 ? { status: 'done', winner: pick([1, 2, 3, null]) } : null;
    const groupId = String(1 + Math.floor(r() * MAX_GROUPS));

    let res;
    try {
      res = resolveScan({
        station, group, groupId, limit, marriage,
        payload: buildPayload(station.id, inputs, 'fuzzQR0001', T0),
        partners: { 4: { marriageId: 'm_q', food: Math.floor(r() * 9), happiness: Math.floor(r() * 9) } },
        pool,
        voting,
      });
    } catch (e) {
      assert.fail(`threw on ${station.id} ${JSON.stringify(inputs)}: ${e.stack}`);
    }

    if (!res.ok) {
      assert.equal(typeof res.reason, 'string');
      continue;
    }
    const u = res.groupUpdate;
    for (const k of ['money', 'food', 'happiness']) {
      assert.ok(Number.isFinite(u[k]) && u[k] >= 0, `${station.id}: ${k}=${u[k]}`);
    }
    assert.ok(u.food <= APPLE_MAX, `${station.id}: apples ${u.food}`);
    const edu = u.education ?? group.education;
    assert.ok(edu >= group.education && edu <= EDU.PHD, `${station.id}: education ${group.education}->${edu}`);
    assert.ok(group.education >= station.minEducation, `${station.id}: allowed below its degree`);
    // a cost is never partially applied: without a penalty, money and
    // happiness move by exactly the station's stated amount
    const e = effectOf(station, res.inputs);
    for (const pu of Object.values(res.partnerUpdates)) {
      for (const k of ['food', 'happiness']) if (k in pu) assert.ok(pu[k] >= 0 && (k !== 'food' || pu[k] <= APPLE_MAX));
    }
    if (res.poolUpdate) assert.ok(res.poolUpdate.count >= 0, `${station.id}: pool ${res.poolUpdate.count}`);
    if (res.marriageWrite) assert.ok(!(res.marriageWrite.pot < 0), `${station.id}: pot`);
    if (!e.penalty && e.marriage !== 'divorce') {
      assert.equal(res.summary.money, e.money, `${station.id}: money`);
      assert.equal(res.summary.happiness, e.happiness, `${station.id}: happiness`);
      if (e.food <= 0) assert.equal(res.summary.food, e.food, `${station.id}: food`);
    }
    if (e.food > 0) assert.ok(res.summary.food >= 0 && res.summary.food <= e.food, `${station.id}: apple gain`);
    if (e.limit) assert.ok(res.limitUpdate.holders.length <= e.limit.max, `${station.id}: limit overflow`);
  }
});

test('fuzz: global events never throw or go negative', () => {
  const r = rng(99);
  for (let n = 0; n < 50000; n++) {
    const g = { money: Math.floor(r() * 6000), food: Math.floor(r() * 9), happiness: Math.floor(r() * 20) };
    for (const id of ['pandemic', 'tax']) {
      const res = resolveGlobalEvent(id, g);
      for (const k of ['money', 'food', 'happiness']) {
        assert.ok(Number.isInteger(res.groupUpdate[k]) && res.groupUpdate[k] >= 0, `${id} ${k}`);
      }
      assert.ok(res.groupUpdate.food <= APPLE_MAX);
    }
  }
});
