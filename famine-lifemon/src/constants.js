// One shared account per group. Document id is the group number as a string,
// e.g. groups/3, so the account cannot be duplicated by construction.
export const NUM_GROUPS = 10;
export const GROUPS = Array.from({ length: NUM_GROUPS }, (_, i) => i + 1);

export const isValidGroup = (g) => {
  const n = Number(g);
  return Number.isInteger(n) && n >= 1 && n <= NUM_GROUPS;
};

// Identical for every group. The per-player randomisation used previously
// modelled starting inequality, but scoring is now the raw group total, so
// randomising per group would decide the leaderboard before play begins.
export const STARTING_STATS = {
  money: 200,
  food: 6,
  charityFood: 0,
  happiness: 5,
  education: 0,
  charity: 0,
  married: false,
  marriageId: null,
};

// Leaderboard weights, unchanged from the previous per-capita formula.
export const SCORE_WEIGHTS = { charity: 30, money: 20, food: 20, happiness: 30 };
export const MARRIAGE_BONUS = 1000;

export const scoreOf = (g, intactMarriages = 0) =>
  Math.floor(
    (Number(g?.charity) || 0) * SCORE_WEIGHTS.charity +
    ((Number(g?.money) || 0) + intactMarriages * MARRIAGE_BONUS) * SCORE_WEIGHTS.money +
    ((Number(g?.food) || 0) + (Number(g?.charityFood) || 0)) * SCORE_WEIGHTS.food +
    (Number(g?.happiness) || 0) * SCORE_WEIGHTS.happiness
  );
