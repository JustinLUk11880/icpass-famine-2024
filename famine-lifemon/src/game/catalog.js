// LifeMon station catalog: every station, its stage, its education
// requirement and what it does, transcribed from the Famine24 LifeMon rules
// document.
//
// Pure data and functions only. Nothing here may import React, Firebase or
// CSS: the same module runs in the browser and under `node --test`, which is
// what lets the tests exercise the real rules rather than a copy. For the same
// reason every relative import carries an explicit `.js` extension.
//
// A station's `effect(inputs)` returns a declarative description of what a
// scan does. engine.js applies it to a group, enforcing affordability, caps,
// once-only rules, cooldowns and event-wide limits.

export const EDU = { NONE: 0, PRIMARY: 1, SECONDARY: 2, UG: 3, PHD: 4 };
export const EDUCATION_LABELS = ['No degree', 'Primary', 'Secondary', 'University', 'PhD'];

export const APPLE_MAX = 8;
export const MAX_GROUPS = 20;
export const MINUTE = 60 * 1000;

// ---------------------------------------------------------------- fields ---
// Selects have no default, so a helper must make an explicit choice before a
// QR code appears. A wrong default is how "Fail" turns into "Pass".

const select = (key, label, options) => ({ key, label, type: 'select', options, default: null });
const number = (key, label, min, max, def, extra = {}) =>
  ({ key, label, type: 'number', min, max, default: def, ...extra });
const toggle = (key, label, def = false) => ({ key, label, type: 'toggle', default: def });

const passFail = select('result', 'Result', [
  { value: 'pass', label: 'Pass - graduated' },
  { value: 'fail', label: 'Fail' },
]);
const winLose = select('result', 'Result', [
  { value: 'win', label: 'Won' },
  { value: 'lose', label: 'Lost' },
]);

// Stations whose rules the document leaves blank. The helper enters the
// amounts on the day; the education requirement still comes from the stage.
const customFields = (defaults = {}, { allowPenalty = true } = {}) => [
  number('money', 'Money change ($)', -10000, 10000, defaults.money ?? 0),
  number('food', 'Apple change', -APPLE_MAX, APPLE_MAX, defaults.food ?? 0),
  number('happiness', 'Happiness change', -100, 100, defaults.happiness ?? 0),
  ...(allowPenalty ? [toggle('penalty', 'Penalty (apply even if they cannot afford it; stops at 0)')] : []),
];
const customEffect = (i) => ({
  money: i.money,
  food: i.food,
  happiness: i.happiness,
  penalty: !!i.penalty,
});

// ---------------------------------------------------------------- stages ---

export const STAGES = [
  { id: 'college', label: 'College' },
  { id: 'jobsPrimary', label: 'Jobs - Primary' },
  { id: 'jobsSecondary', label: 'Jobs - Secondary' },
  { id: 'jobsUniversity', label: 'Jobs - University' },
  { id: 'illegal', label: 'Illegal' },
  { id: 'secret', label: 'Secret tasks' },
  { id: 'entertainment', label: 'Entertainment' },
  { id: 'community', label: 'Community' },
  { id: 'wedding', label: 'Wedding' },
];

// -------------------------------------------------------------- stations ---

const exam = (id, label, level, cost, extra = {}) => ({
  id,
  stage: 'college',
  label,
  minEducation: level - 1,
  fields: [passFail],
  effect: (i) => ({
    ...cost,
    educationTo: i.result === 'pass' ? level : null,
    checks: [{ type: 'belowEducation', level }],
    ...(typeof extra.effect === 'function' ? extra.effect(i) : {}),
  }),
  notes: extra.notes,
});

const custom = (id, stage, label, minEducation, defaults) => ({
  id,
  stage,
  label,
  minEducation,
  custom: true,
  fields: customFields(defaults),
  effect: customEffect,
  notes: 'Amounts not set in the rules document - enter them for this group.',
});

export const STATIONS = [
  // College. Exam fees are paid whether or not the group passes.
  exam('college.primary', 'Primary exam', EDU.PRIMARY, { food: -1, happiness: -1 },
    { notes: 'Pass mark 60%. Kahoot, RSM 1.31.' }),
  exam('college.secondary', 'Secondary exam', EDU.SECONDARY, { food: -2, happiness: -1 },
    { notes: 'Pass mark 75%. Kahoot, RSM 1.31.' }),
  exam('college.ug', 'University exam', EDU.UG, { food: -2, happiness: -2 },
    { notes: 'Top 5 graduate. Kahoot, RSM 1.31.' }),
  { ...exam('college.phd', 'PhD exam', EDU.PHD, { money: -250, food: -2, happiness: -2 }, {
    // Only the pass consumes one of the two event-wide PhD places.
    effect: (i) => (i.result === 'pass' ? { limit: { key: 'phd', max: 2 } } : {}),
    notes: 'Difficult exam within 5 mins, 50% to graduate. Max 2 groups ever. PhD grants line priority at every minigame.',
  }),
  limitKey: 'phd' },

  // Jobs - Primary
  {
    id: 'jobs.foodDelivery',
    stage: 'jobsPrimary',
    label: 'Food delivery',
    minEducation: EDU.PRIMARY,
    fields: [winLose],
    // A loss still counts as the group's try for the 20-minute limit.
    effect: (i) => ({
      ...(i.result === 'win' ? { money: 70, food: -1 } : {}),
      cooldown: { key: 'foodDelivery', ms: 20 * MINUTE },
    }),
    notes: 'Play a game with the helper; only a win delivers. One try every 20 mins.',
  },
  {
    id: 'jobs.warehouse',
    stage: 'jobsPrimary',
    label: 'Warehouse packer',
    minEducation: EDU.PRIMARY,
    fields: [select('time', 'Mahjong tidied in', [
      { value: 'under60', label: 'Under 60 seconds' },
      { value: 'under90', label: '60 - 90 seconds' },
    ])],
    effect: (i) => ({ money: i.time === 'under60' ? 75 : 50, food: -1 }),
    notes: 'Max 3 people, under 90s. No QR if they run over 90s.',
  },

  // Jobs - Secondary
  {
    id: 'jobs.police',
    stage: 'jobsSecondary',
    label: 'Police',
    minEducation: EDU.SECONDARY,
    fields: [
      number('smugglers', 'Smugglers caught this shift', 0, 20, 0),
      toggle('robbery', 'Stopped the robbery'),
    ],
    effect: (i) => ({
      money: 150 + 100 * i.smugglers + (i.robbery ? 500 : 0),
      food: -1,
      happiness: -1,
    }),
    notes: 'One QR per shift. Max 2 groups per shift (helper enforces).',
  },
  custom('jobs.nurse', 'jobsSecondary', 'Nurse', EDU.SECONDARY),
  {
    id: 'jobs.teacher',
    stage: 'jobsSecondary',
    label: 'Teacher',
    minEducation: EDU.SECONDARY,
    fields: [],
    effect: () => ({ money: 300, food: -1, happiness: -1, once: 'teacher' }),
    notes: 'Passed the Classical Chinese, English literature and maths exams. Unlimited time.',
  },
  {
    id: 'jobs.artist',
    stage: 'jobsSecondary',
    label: 'Artist',
    minEducation: EDU.SECONDARY,
    fields: [number('watchers', 'Other groups watching', 0, MAX_GROUPS - 1, 0)],
    effect: (i) => ({ money: 200 + 200 * i.watchers, food: -2, once: 'artist' }),
    notes: 'Concert of at least 3 mins. Watching groups do not pay.',
  },

  // Jobs - University
  custom('jobs.surgeon', 'jobsUniversity', 'Surgeon', EDU.UG),
  {
    id: 'jobs.banker',
    stage: 'jobsUniversity',
    label: 'Banker',
    minEducation: EDU.UG,
    fields: [winLose],
    // A lost game is owed even by a group that cannot cover it.
    effect: (i) => (i.result === 'win' ? { money: 500 } : { money: -50, penalty: true }),
    notes: '24 game (合24). Winner +$500, loser -$50.',
  },
  custom('jobs.lawyer', 'jobsUniversity', 'Lawyer', EDU.UG),
  custom('jobs.engineer', 'jobsUniversity', 'Engineer', EDU.UG),

  // Illegal. Drug and assassin need Primary. Prisoner has no requirement: a
  // group caught robbing the bank may hold no degree at all.
  custom('illegal.drug', 'illegal', 'Drug', EDU.PRIMARY),
  {
    id: 'illegal.assassin',
    stage: 'illegal',
    label: 'Assassin',
    minEducation: EDU.PRIMARY,
    fields: [],
    limitKey: 'assassin',
    effect: () => ({ money: 750, food: -1, limit: { key: 'assassin', max: 1 } }),
    notes: 'Sticker on the selected committee member, plus a photo. Max 1 team ever.',
  },
  {
    id: 'illegal.prisoner',
    stage: 'illegal',
    label: 'Prisoner',
    minEducation: EDU.NONE,
    fields: [select('outcome', "Prisoner's dilemma outcome", [
      { value: 'bothSilent', label: 'Both teams stayed silent (-$50)' },
      { value: 'silentBetrayed', label: 'We stayed silent, they betrayed (-$150)' },
      { value: 'betrayedSilent', label: 'We betrayed, they stayed silent (+$100)' },
      { value: 'bothBetrayed', label: 'Both teams betrayed (-$200)' },
      { value: 'alone', label: 'Only one team in prison (-$100)' },
    ])],
    effect: (i) => ({
      money: {
        bothSilent: -50, silentBetrayed: -150, betrayedSilent: 100, bothBetrayed: -200, alone: -100,
      }[i.outcome],
      happiness: -2,
      penalty: true,
    }),
    notes: 'After 5 mins in prison. Everyone loses 2 happiness.',
  },

  // Secret tasks. Pandemic and ICPASS Tax hit every group at once, so they
  // run from the Live events tab, not as a QR.
  {
    id: 'secret.finalWill',
    stage: 'secret',
    label: 'The Final Will',
    minEducation: EDU.NONE,
    fields: [],
    limitKey: 'finalWill',
    effect: () => ({ money: 1000, limit: { key: 'finalWill', max: 1 } }),
    notes: 'Starts 15:40. Give this QR only to the team that won the vote. Teams cannot vote for themselves.',
  },
  {
    id: 'secret.robbery',
    stage: 'secret',
    label: 'Robbery (success)',
    minEducation: EDU.NONE,
    fields: [],
    effect: () => ({ money: 2000, checks: [{ type: 'moneyBelow', value: 500 }] }),
    notes: 'Starts 16:15. Only teams under $500 may attempt. Caught teams go to Prisoner instead.',
  },

  // Entertainment
  {
    id: 'ent.casino',
    stage: 'entertainment',
    label: 'Casino',
    minEducation: EDU.NONE,
    fields: [number('amount', 'Won (+) or lost (-) in $', -5000, 5000, null, { required: true, nonZero: true })],
    effect: (i) => ({ money: i.amount, penalty: true }),
    notes: 'Poker and blackjack. Check they can cover the bet before they play.',
  },
  {
    id: 'ent.raffle',
    stage: 'entertainment',
    label: 'Raffle tickets',
    minEducation: EDU.NONE,
    fields: [number('tickets', 'Tickets bought', 1, 100, 1)],
    effect: (i) => ({ money: -50 * i.tickets, raffle: i.tickets }),
    notes: '$50 per ticket. Other groups never see how many tickets you hold.',
  },
  {
    id: 'ent.sauna',
    stage: 'entertainment',
    label: 'Sauna / spa',
    minEducation: EDU.NONE,
    fields: [],
    effect: () => ({ money: -100, happiness: 2 }),
    notes: 'Doomscrolling and doing your own stuff.',
  },

  // Community
  {
    id: 'com.gymMembership',
    stage: 'community',
    label: 'Gym membership',
    minEducation: EDU.NONE,
    fields: [],
    effect: () => ({ money: -350, setFlag: 'gymMember', checks: [{ type: 'notFlag', flag: 'gymMember' }] }),
    notes: 'One-off. Needed before any gym challenge.',
  },
  {
    id: 'com.gymChallenge',
    stage: 'community',
    label: 'Gym challenge',
    minEducation: EDU.NONE,
    fields: [number('sets', 'Sets completed (20 push-ups or a 60s plank each)', 1, APPLE_MAX, 1)],
    effect: (i) => ({ food: i.sets, checks: [{ type: 'flag', flag: 'gymMember' }] }),
    notes: '+1 apple per set, within 5 mins. Members only.',
  },
  custom('com.foodBank', 'community', 'Food bank', EDU.NONE),
  custom('com.supermarket', 'community', 'Supermarket', EDU.NONE),
  custom('com.hospital', 'community', 'Hospital', EDU.NONE),
  custom('com.bank', 'community', 'Bank', EDU.NONE),

  // Wedding. The document leaves amounts blank; defaults are last year's.
  {
    id: 'wed.wedding',
    stage: 'wedding',
    label: 'Wedding',
    minEducation: EDU.NONE,
    fields: customFields({ money: -500, food: -2, happiness: 2 }, { allowPenalty: false }),
    effect: (i) => ({
      money: i.money, food: i.food, happiness: i.happiness,
      marriage: 'wedding',
      checks: [{ type: 'notMarried' }],
    }),
    notes: 'BOTH groups scan this same QR to marry each other. Amounts default to last year - adjust if needed.',
  },
  {
    id: 'wed.divorce',
    stage: 'wedding',
    label: 'Divorce',
    minEducation: EDU.NONE,
    fields: customFields({ money: 0, food: 0, happiness: -2 }, { allowPenalty: false }),
    effect: (i) => ({
      money: i.money, food: i.food, happiness: i.happiness,
      penalty: true,
      marriage: 'divorce',
      checks: [{ type: 'married' }],
    }),
    notes: 'Only one group needs to scan; the marriage ends for both.',
  },
];

const BY_ID = new Map(STATIONS.map((s) => [s.id, s]));
export const getStation = (id) => BY_ID.get(id) || null;
export const stationsForStage = (stageId) => STATIONS.filter((s) => s.stage === stageId);

// Event-wide limits, keyed as they appear in effect().limit. Exported so the
// admin page can show how many places remain.
export const LIMITS = {
  phd: { label: 'PhD places', max: 2 },
  assassin: { label: 'Assassin', max: 1 },
  finalWill: { label: 'The Final Will', max: 1 },
};
