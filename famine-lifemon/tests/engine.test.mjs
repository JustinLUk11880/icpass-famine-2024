// Rules-engine tests: every number in the LifeMon rules document, every
// requirement, and a seeded fuzz over random groups and random inputs.
// Run: npm run test:game

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  APPLE_MAX, EDU, LIMITS, MAX_GROUPS, MINUTE, STAGES, STATIONS, getStation,
} from '../src/game/catalog.js';
import {
  QR_HEADER, QR_LIFETIME_MS, buildPayload, describeStation, effectOf, formatDelta,
  isComplete, isValidGroupId, missingFields, newQrId, planReads, randomProfile,
  reasonMessage, resolveAdjustment, resolveGlobalEvent, resolveScan, sanitizeInputs,
  summaryText, validatePayload,
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

function scan(stationId, inputs, group, extra = {}) {
  const station = getStation(stationId);
  assert.ok(station, `unknown station ${stationId}`);
  return resolveScan({
    station,
    payload: buildPayload(stationId, inputsFor(station, inputs), extra.q || 'testQR1234', extra.t ?? T0),
    group,
    groupId: extra.groupId || '1',
    limit: extra.limit ?? null,
    marriage: extra.marriage ?? null,
    partners: extra.partners ?? {},
  });
}

const deltas = (r) => ({ money: r.summary.money, food: r.summary.food, happiness: r.summary.happiness });

// A group that satisfies every requirement of a station, so a rejection can
// only come from what the test is examining.
function eligibleGroup(station) {
  const g = baseGroup({ education: station.minEducation, money: 3000, food: 4, happiness: 20 });
  if (station.id === 'secret.robbery') g.money = 100;
  if (station.id === 'com.gymMembership') g.gymMember = false;
  if (station.id === 'wed.divorce') Object.assign(g, { married: true, marriageId: 'm_x' });
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
    'jobs.police', 'jobs.nurse', 'jobs.teacher', 'jobs.artist',
    'jobs.surgeon', 'jobs.banker', 'jobs.lawyer', 'jobs.engineer',
    'illegal.drug', 'illegal.assassin', 'illegal.prisoner',
    'secret.finalWill', 'secret.robbery',
    'ent.casino', 'ent.raffle', 'ent.sauna',
    'com.gymMembership', 'com.gymChallenge', 'com.foodBank', 'com.supermarket', 'com.hospital', 'com.bank',
    'wed.wedding', 'wed.divorce',
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
  ['jobs.police', { smugglers: 0, robbery: false }, { money: 150, food: -1, happiness: -1 }],
  ['jobs.police', { smugglers: 3, robbery: false }, { money: 450, food: -1, happiness: -1 }],
  ['jobs.police', { smugglers: 2, robbery: true }, { money: 850, food: -1, happiness: -1 }],
  ['jobs.teacher', {}, { money: 300, food: -1, happiness: -1 }],
  ['jobs.artist', { watchers: 0 }, { money: 200, food: -2, happiness: 0 }],
  ['jobs.artist', { watchers: 4 }, { money: 1000, food: -2, happiness: 0 }],
  ['jobs.banker', { result: 'win' }, { money: 500, food: 0, happiness: 0 }],
  ['jobs.banker', { result: 'lose' }, { money: -50, food: 0, happiness: 0 }],
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
  ['wed.wedding', {}, { money: -500, food: -2, happiness: 2 }],
  ['wed.divorce', {}, { money: 0, food: 0, happiness: -2 }],
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
  const d = scan('wed.divorce', {}, baseGroup({ married: true, marriageId: 'm_x', happiness: 1 }));
  assert.equal(d.ok, true, 'a sad group can still divorce');
  assert.equal(d.groupUpdate.happiness, 0);
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
  const custom = scan('com.supermarket', { food: 8 }, baseGroup({ food: 3 }));
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
  const onTime = scan('jobs.foodDelivery', { result: 'win' }, g, { t: T0 + 20 * MINUTE });
  assert.equal(onTime.ok, true);
  assert.equal(onTime.summary.money, 70);
  // the cooldown belongs to the group, not the station: another group is free
  assert.equal(scan('jobs.foodDelivery', { result: 'win' }, baseGroup(), { t: T0 + MINUTE }).ok, true);
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
  assert.deepEqual(d.partnerUpdates, { 7: { married: false, marriageId: null } });
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
  assert.deepEqual(sanitizeInputs(police, { smugglers: 9999, robbery: 'yes', extra: 1 }), { smugglers: 20, robbery: false });
  assert.deepEqual(sanitizeInputs(police, { smugglers: -4 }), { smugglers: 0, robbery: false });
  assert.deepEqual(sanitizeInputs(police, { smugglers: 'x' }), { smugglers: 0, robbery: false });
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
    'unknown_station', 'busy', 'internal', 'whatever'];
  for (const r of reasons) {
    const m = reasonMessage(r, { level: 2, value: 500, minutes: 3, key: 'phd' });
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
      cooldowns: r() < 0.3 ? { foodDelivery: T0 - Math.floor(r() * 40) * MINUTE } : {},
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
    const marriage = r() < 0.5 ? { participants: ['1', '4'].slice(0, Math.floor(r() * 3)), hasDivorced: r() < 0.2 } : null;
    const groupId = String(1 + Math.floor(r() * MAX_GROUPS));

    let res;
    try {
      res = resolveScan({
        station, group, groupId, limit, marriage,
        payload: buildPayload(station.id, inputs, 'fuzzQR0001', T0),
        partners: { 4: { marriageId: 'm_q' } },
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
    if (!e.penalty) {
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
