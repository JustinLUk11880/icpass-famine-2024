// LifeMon station catalog: every station, its stage, its education
// requirement and what it does, transcribed from the Famine24 LifeMon rules
// document.
//
// Pure data and functions only. Nothing here may import React, Firebase or
// CSS: the same module runs in the browser and under `node --test`, which is
// what lets the tests exercise the real rules rather than a copy. For the same
// reason every relative import carries an explicit `.js` extension.
//
// Where the two documents disagree, the stations table ("Earn/Loss" column)
// wins over the helper guide; the guide fills in what the table leaves blank.
//
// A station's `effect(inputs)` returns a declarative description of what a
// scan does. engine.js applies it to a group, enforcing affordability, caps,
// once-only rules, cooldowns and event-wide limits.

export const EDU = { NONE: 0, PRIMARY: 1, SECONDARY: 2, UG: 3, PHD: 4 };
export const EDUCATION_LABELS = ['No degree', 'Primary', 'Secondary', 'University', 'PhD'];

export const APPLE_MAX = 8;
// Group numbers the app accepts. How many appear in the join list is set on
// the helper page (config/game.groupCount, default DEFAULT_GROUP_COUNT).
export const MAX_GROUPS = 20;
export const DEFAULT_GROUP_COUNT = 10;

// Each group splits into sub-groups ("teams") that play separate profiles:
// group 1 plays as teams 1.1 and 1.2. Stations, cooldowns, limits and
// marriages work per team; the leaderboard adds a group's teams together.
export const SUBGROUPS = 2;

// The supermarket donation box starts with this many apples after a reset.
export const INITIAL_DONATION_APPLES = 50;
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
const customFields = () => [
  number('money', 'Money change ($)', -10000, 10000, 0),
  number('food', 'Apple change', -APPLE_MAX, APPLE_MAX, 0),
  number('happiness', 'Happiness change', -100, 100, 0),
  toggle('penalty', 'Penalty (apply even if they cannot afford it; stops at 0)'),
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
  { id: 'supermarket', label: 'Supermarket' },
  { id: 'community', label: 'Community' },
  { id: 'wedding', label: 'Wedding and bank' },
];

// ------------------------------------------------------------- cooldowns ---

// "15 mins cool down for all games other than entertainments." Per group and
// per station: a group that played Banker can play Police straight away, but
// not Banker again for 15 minutes. Losses count as a try.
export const GAME_COOLDOWN_MS = 15 * MINUTE;
export const DEPOSIT_COOLDOWN_MS = 30 * MINUTE;

// Firestore map keys must not contain dots.
export const cooldownKeyFor = (stationId) => String(stationId).replace(/\./g, '_');

// Wraps a station so every scan of it (win or lose) starts its cooldown,
// unless its effect already declares one (food delivery's is 20 minutes).
function game(station, ms = GAME_COOLDOWN_MS) {
  const inner = station.effect;
  return {
    ...station,
    cooldownMs: ms,
    effect: (i) => {
      const e = inner(i) || {};
      return e.cooldown ? e : { ...e, cooldown: { key: cooldownKeyFor(station.id), ms } };
    },
  };
}

// -------------------------------------------------------------- stations ---

const exam = (id, label, level, cost, extra = {}) => game({
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
  limitKey: extra.limitKey,
});

const custom = (id, stage, label, minEducation, notes) => ({
  id,
  stage,
  label,
  minEducation,
  custom: true,
  fields: customFields(),
  effect: customEffect,
  notes: notes || 'Amounts not set in the rules document - enter them for this group.',
});

// University jobs: win or lose, the work costs an apple. A loss is owed even
// by a group that cannot cover it (it stops at 0).
const uniJob = (id, label, win, notes) => game({
  id,
  stage: 'jobsUniversity',
  label,
  minEducation: EDU.UG,
  fields: [winLose],
  effect: (i) => (i.result === 'win'
    ? { money: win, food: -1 }
    : { money: -50, food: -1, penalty: true }),
  notes,
});

export const STATIONS = [
  // College. Exam fees are paid whether or not the group passes.
  exam('college.primary', 'Primary exam', EDU.PRIMARY, { food: -1, happiness: -1 },
    { notes: 'Kahoot, RSM 1.31. Pass: at least 60%. Sessions 15:10 and 15:55.' }),
  exam('college.secondary', 'Secondary exam', EDU.SECONDARY, { food: -2, happiness: -1 },
    { notes: 'Kahoot, RSM 1.31. Pass: top 75% of the class. Sessions 15:25 and 16:10.' }),
  exam('college.ug', 'University exam', EDU.UG, { food: -2, happiness: -2 },
    { notes: 'Kahoot, RSM 1.31. Pass: 15 or more out of 20. Sessions 15:40 and 16:25.' }),
  exam('college.phd', 'PhD (citation task)', EDU.PHD, { money: -250, food: -2, happiness: -2 }, {
    // Only the pass consumes one of the two event-wide PhD places.
    effect: (i) => (i.result === 'pass' ? { limit: { key: 'phd', max: 2 } } : {}),
    limitKey: 'phd',
    notes: 'G.20. Underline 80% of the words within 5 mins. University degree needed. Max 2 groups ever. PhD groups may cut the line at every university job.',
  }),

  // Jobs - Primary
  {
    id: 'jobs.foodDelivery',
    stage: 'jobsPrimary',
    label: 'Food delivery',
    minEducation: EDU.PRIMARY,
    fields: [select('result', 'Result', [
      { value: 'win', label: 'Delivered - photo shown (+$70)' },
      { value: 'lose', label: 'Lost the game (no delivery)' },
    ])],
    // A loss still counts as the group's try for the 20-minute limit.
    effect: (i) => ({
      ...(i.result === 'win' ? { money: 70, food: -1 } : {}),
      cooldown: { key: cooldownKeyFor('jobs.foodDelivery'), ms: 20 * MINUTE },
    }),
    cooldownMs: 20 * MINUTE,
    notes: 'G.20. Play 左一拳右一拳 with the helper; a win delivers to LT2.28, LT1.47 or LT1.31. Pay on return with the photo. Max 4 deliverers out at once. One try every 20 mins.',
  },
  game({
    id: 'jobs.warehouse',
    stage: 'jobsPrimary',
    label: 'Warehouse packer',
    minEducation: EDU.PRIMARY,
    fields: [select('time', 'Mahjong tidied in', [
      { value: 'under60', label: 'Under 60 seconds (+$75)' },
      { value: 'under90', label: '60 - 90 seconds (+$50)' },
      { value: 'over90', label: 'Over 90 seconds (nothing)' },
    ])],
    effect: (i) => (i.time === 'over90' ? {} : { money: i.time === 'under60' ? 75 : 50, food: -1 }),
    notes: 'G.20. Max 3 people, tidy within 90s. $50, plus $25 if within 60s.',
  }),

  // Jobs - Secondary
  game({
    id: 'jobs.police',
    stage: 'jobsSecondary',
    label: 'Police (shift)',
    minEducation: EDU.SECONDARY,
    fields: [number('smugglers', 'Smugglers caught this shift', 0, 20, 0)],
    effect: (i) => ({ money: 150 + 100 * i.smugglers, food: -1, happiness: -1 }),
    notes: 'G.20. 5-min shift: $150 per shift plus $100 per smuggler caught. Max 2 groups per shift (helper checks). Use "Police: stopped the robbery" for the $500.',
  }),
  {
    id: 'jobs.policeRobbery',
    stage: 'jobsSecondary',
    label: 'Police: stopped the robbery',
    minEducation: EDU.SECONDARY,
    fields: [],
    effect: () => ({ money: 500 }),
    notes: 'Police group that tagged the robbers. No cooldown, so it can follow a shift QR.',
  },
  game({
    id: 'jobs.nurse',
    stage: 'jobsSecondary',
    label: 'Nurse',
    minEducation: EDU.SECONDARY,
    fields: [],
    effect: () => ({ money: 200, food: -1 }),
    notes: 'Blind drawing, RSM 1.47, 2 people, about 5 mins.',
  }),
  game({
    id: 'jobs.teacher',
    stage: 'jobsSecondary',
    label: 'Teacher',
    minEducation: EDU.SECONDARY,
    fields: [],
    effect: () => ({ money: 300, food: -1, happiness: -1, once: 'teacher' }),
    notes: 'RSM 1.31, 1-2 people. 文言文 + English literature + maths questions. Once per group.',
  }),
  game({
    id: 'jobs.artist',
    stage: 'jobsSecondary',
    label: 'Artist',
    minEducation: EDU.SECONDARY,
    fields: [number('watchers', 'Other groups watching', 0, MAX_GROUPS * SUBGROUPS - 1, 0)],
    effect: (i) => ({ money: 200 + 200 * i.watchers, food: -2, once: 'artist' }),
    notes: 'Concert of at least 3 mins. $200 plus $200 per watching group (they do not pay). Once per group.',
  }),

  // Jobs - University
  uniJob('jobs.surgeon', 'Surgeon / doctor', 350, 'X-ray puzzle, RSM 1.47. Guess the item in the box within 1 min = win.'),
  uniJob('jobs.banker', 'Banker', 350, 'RSM 1.47. 合24 / counting cards. Winner +$350, loser -$50.'),
  uniJob('jobs.lawyer', 'Lawyer', 350, 'Guess the law, RSM 1.47. 10 questions, +10 right / -5 wrong. Winner +$350, loser -$50.'),
  game({
    id: 'jobs.engineer',
    stage: 'jobsUniversity',
    label: 'Engineer',
    minEducation: EDU.UG,
    fields: [winLose],
    effect: (i) => (i.result === 'win' ? { money: 500, food: -1 } : { food: -1, penalty: true }),
    notes: 'Win +$500. Win or lose, the work costs 1 apple.',
  }),

  // Illegal. Drug and assassin need Primary ("Illegal bong (primary)").
  // Prisoner has no requirement: a robber may hold no degree at all.
  game({
    id: 'illegal.drug',
    stage: 'illegal',
    label: 'Drug smuggling (success)',
    minEducation: EDU.PRIMARY,
    fields: [],
    effect: () => ({ money: 500, food: -1 }),
    notes: 'RSM 2.28. Only when the bell comes back without the leader being tagged. Caught groups go to Prisoner instead.',
  }),
  game({
    id: 'illegal.assassin',
    stage: 'illegal',
    label: 'Assassin',
    minEducation: EDU.PRIMARY,
    fields: [],
    limitKey: 'assassin',
    effect: () => ({ money: 750, food: -1, limit: { key: 'assassin', max: 1 } }),
    notes: 'Sticker on the selected committee member, plus a photo. Max 1 team ever.',
  }),
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
    notes: 'RSM G.20, after 5 mins in prison. Everyone loses 2 happiness. A penalty: no cooldown, and it applies even if they cannot pay (stops at $0).',
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
    effect: () => ({ money: 1000, limit: { key: 'finalWill', max: 1 }, checks: [{ type: 'voteWinner' }] }),
    notes: 'Starts 15:40. Run the vote in Live events → The Final Will vote. Once a winner is announced, only that group can scan this QR.',
  },
  {
    id: 'secret.robbery',
    stage: 'secret',
    label: 'Robbery (success)',
    minEducation: EDU.NONE,
    fields: [],
    effect: () => ({ money: 2000, checks: [{ type: 'moneyBelow', value: 500 }] }),
    notes: 'Starts 16:15 - send the "Robbery started" announcement. Only teams under $500 may attempt. Caught teams go to Prisoner instead.',
  },

  // Entertainment: no cooldown.
  {
    id: 'ent.casino',
    stage: 'entertainment',
    label: 'Casino',
    minEducation: EDU.NONE,
    fields: [number('amount', 'Won (+) or lost (-) in $', -5000, 5000, null, { required: true, nonZero: true })],
    // Entertainment always raises happiness by 2, win or lose.
    effect: (i) => ({ money: i.amount, happiness: 2, penalty: true }),
    notes: 'RSM 2.28. Poker and 21. +2 happiness win or lose. Check they can cover the bet before they play.',
  },
  {
    id: 'ent.raffle',
    stage: 'entertainment',
    label: 'Raffle tickets',
    minEducation: EDU.NONE,
    fields: [number('tickets', 'Tickets bought', 1, 100, 1)],
    effect: (i) => ({ money: -50 * i.tickets, happiness: 2, raffle: i.tickets }),
    notes: '$50 per ticket, +2 happiness. Wheel spins at the end (1st and 2nd prize). Other groups never see how many tickets you hold.',
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

  // Supermarket (RSM 2.28): shopping, not a game, so no cooldown.
  {
    id: 'shop.buyApples',
    stage: 'supermarket',
    label: 'Buy apples',
    minEducation: EDU.NONE,
    fields: [
      number('price', 'Price per apple today ($50 - $200)', 50, 200, null, { required: true }),
      number('apples', 'Apples bought', 1, APPLE_MAX, 1),
    ],
    effect: (i) => ({ money: -i.price * i.apples, food: i.apples, checks: [{ type: 'appleRoom', count: i.apples }] }),
    notes: 'Change the price at least every 15 minutes. Refused if the group cannot hold that many apples (max 8), so nobody pays for apples they cannot keep.',
  },
  {
    id: 'shop.donate',
    stage: 'supermarket',
    label: 'Donate apples',
    minEducation: EDU.NONE,
    fields: [number('apples', 'Apples donated', 1, APPLE_MAX, 1)],
    poolKey: 'apples',
    effect: (i) => ({ food: -i.apples, happiness: 2, pool: { key: 'apples', delta: i.apples } }),
    notes: 'Donating makes the team happier: +2 happiness. Apples go into the shared donation box.',
  },
  {
    id: 'shop.receive',
    stage: 'supermarket',
    label: 'Receive donated apples',
    minEducation: EDU.NONE,
    fields: [number('apples', 'Apples received', 1, APPLE_MAX, 1)],
    poolKey: 'apples',
    effect: (i) => ({
      food: i.apples,
      pool: { key: 'apples', delta: -i.apples },
      checks: [{ type: 'moneyBelow', value: 200 }, { type: 'appleRoom', count: i.apples }],
    }),
    notes: `Only for teams with under $200, while the donation box has apples (it starts with ${INITIAL_DONATION_APPLES}).`,
  },

  // Community: games, so the 15-minute cooldown applies to the challenge.
  {
    id: 'com.gymMembership',
    stage: 'community',
    label: 'Gym membership',
    minEducation: EDU.NONE,
    fields: [],
    effect: () => ({ money: -350, setFlag: 'gymMember', checks: [{ type: 'notFlag', flag: 'gymMember' }] }),
    notes: 'One-off. Needed before any gym challenge.',
  },
  game({
    id: 'com.gymChallenge',
    stage: 'community',
    label: 'Gym challenge',
    minEducation: EDU.NONE,
    fields: [number('sets', 'Sets completed (20 push-ups or a 60s plank each)', 1, APPLE_MAX, 1)],
    effect: (i) => ({ food: i.sets, checks: [{ type: 'flag', flag: 'gymMember' }] }),
    notes: '+1 apple per set, within 5 mins. Members only.',
  }),
  {
    id: 'com.foodWaste',
    stage: 'community',
    label: 'Recycling: food waste returned',
    minEducation: EDU.NONE,
    fields: [number('boxes', 'Food boxes brought back to G.20', 1, 4, 1)],
    effect: (i) => ({ money: 10 * i.boxes }),
    notes: '$10 per leftover food box, with a photo as proof. A group may not bring back the food it just delivered.',
  },
  custom('com.bowling', 'community', 'Recycling: bottle bowling', EDU.NONE,
    'Reward not set in the rules document - enter it (community games raise happiness or apples).'),
  custom('com.hospital', 'community', 'Hospital', EDU.NONE),

  // Wedding: "Marry (actually bank)", RSM 1.31.
  {
    id: 'wed.wedding',
    stage: 'wedding',
    label: 'Wedding',
    minEducation: EDU.NONE,
    fields: [],
    effect: () => ({ happiness: 5, marriage: 'wedding', checks: [{ type: 'notMarried' }] }),
    notes: 'BOTH teams scan this same QR to marry each other: free, and +5 happiness each. Teams of the same group cannot marry. They then save money together with "Bank: deposit".',
  },
  {
    id: 'wed.deposit',
    stage: 'wedding',
    label: 'Bank: deposit into the marriage pot',
    minEducation: EDU.NONE,
    fields: [number('amount', 'Deposit ($100 - $500)', 100, 500, null, { required: true })],
    effect: (i) => ({
      money: -i.amount,
      marriage: 'deposit',
      deposit: i.amount,
      checks: [{ type: 'married' }],
      cooldown: { key: 'marriageDeposit', ms: DEPOSIT_COOLDOWN_MS },
    }),
    cooldownMs: DEPOSIT_COOLDOWN_MS,
    notes: 'Each married group deposits separately and secretly. Every 30 mins they may deposit again. At the end each group gets the pot x 2 plus 10 apples (Live events → Pay out marriages).',
  },
  {
    id: 'wed.divorce',
    stage: 'wedding',
    label: 'Divorce',
    minEducation: EDU.NONE,
    fields: [],
    effect: () => ({ marriage: 'divorce', checks: [{ type: 'married' }] }),
    notes: 'Only the group asking for the divorce scans. They get the pot x 1.5 at once but lose 3 happiness and 10 apples; the other group gets +3 happiness and +10 apples. The pot is gone.',
  },
];

const BY_ID = new Map(STATIONS.map((s) => [s.id, s]));
export const getStation = (id) => BY_ID.get(id) || null;
export const stationsForStage = (stageId) => STATIONS.filter((s) => s.stage === stageId);

// Label for a cooldown key, for the passport's "again in N min" chips.
export function cooldownLabel(key) {
  if (key === 'marriageDeposit') return 'Bank deposit';
  const st = STATIONS.find((x) => cooldownKeyFor(x.id) === key);
  return st ? st.label : key;
}
export function cooldownMsFor(key) {
  if (key === 'marriageDeposit') return DEPOSIT_COOLDOWN_MS;
  const st = STATIONS.find((x) => cooldownKeyFor(x.id) === key);
  return st?.cooldownMs || GAME_COOLDOWN_MS;
}

// Event-wide limits, keyed as they appear in effect().limit. Exported so the
// admin page can show how many places remain.
export const LIMITS = {
  phd: { label: 'PhD places', max: 2 },
  assassin: { label: 'Assassin', max: 1 },
  finalWill: { label: 'The Final Will', max: 1 },
};
