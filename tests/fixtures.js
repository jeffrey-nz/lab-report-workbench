/* fixtures.js — hand-built grids in the shape sheetsToGrids produces, and
   reference values taken from SciPy, statsmodels and pingouin. */

export function sheet(name, rows) {
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  return {
    name,
    width,
    merges: [],
    grid: rows.map((r) => [...r, ...Array(width - r.length).fill(null)])
  };
}

/** Independent cohorts, one value per animal, with the quirks the parser must catch. */
export const cytokineSheet = sheet("Cytokine- Protein", [
  ["Tissue cytokine protein levels"],
  [],
  [null, null, null, null, null, "WHITE ADIPOSE TISSUE", null, null, null, "LIVER"],
  [null, null, null, null, null, "ng per mg  tissue", null, null, null, "ng per mg  tissue"],
  [null, null, "ANIMAL ID", "DIET/time", null, "IL1b", "TNFa", "IL6", null, "IL1b", "TNFa", "IL6"],
  [null, null, 1, "0W Chow", null, 5.0, 3.0, 0.30, null, 7.0, 2.5, 0.26],
  [null, null, 2, "0W Chow", null, 5.4, 3.2, 0.31, null, 7.4, 2.6, 0.27],
  [null, null, 3, "0W Chow", null, 4.8, 2.9, 0.28, null, 6.6, 2.4, 0.25],
  [null, null, null, null, "Avg", 5.07, 3.03, 0.297, "Avg", 7.0, 2.5, 0.26],
  [],
  [null, null, 11, "HFD/2W", null, 8.0, 4.0, 0.40, null, 12.0, 3.4, 0.40],
  [null, null, 12, "HFD/2W", null, 8.4, 4.2, 0.42, null, "#VALUE!", 3.5, 0.41],
  [null, null, 13, "HFD/2W", null, 7.6, 3.8, 0.38, null, 11.2, 3.3, 0.39, null, "don\u2019t use \u2014 haemolysed"],
  [],
  [null, null, 21, "HFD/4W", null, 9.0, 4.5, 0.45, null, 14.0, 3.8, 0.44],
  [null, null, 22, "HFD/4W", null, 9.4, 4.7, 0.47, null, 14.4, 3.9, 0.45],
  [null, null, 23, "4W", null, 8.6, 4.3, 0.43, null, 13.6, 3.7, 0.43]
]);

/** Repeated measures: the same animals at several durations, each a time course. */
export const gttSheet = sheet("Glucose Tolerance Data", [
  ["GLUCOSE TOLERANCE"],
  [],
  [null, "CONTROL GROUP (week 0)", null, null, "BLOOD GLUCOSE VALUES"],
  [null, null, null, null, 0, 30, 60, 120],
  [null, "Mouse ID", "BW (g)", "Diet", 0, "30m", "60m", "120m"],
  [null, 1, 28.1, "NCD", 6.3, 24.5, 11.7, 6.0],
  [null, 2, 27.3, "NCD", 6.9, 25.6, 12.9, 6.8],
  [null, 3, 26.1, "NCD", 5.5, 24.5, 12.9, 6.5],
  [null, 4, 25.4, "NCD", 6.3, 26.1, 12.2, 7.0],
  [null, 5, 29.3, "NCD", 5.8, 26.8, 16.8, 7.3],
  [null, null, null, "Avg", 6.16, 25.5, 13.3, 6.72],
  [],
  [null, "EXPERIMENTAL  GROUP (10 WEEKS HFD)", null, null, "BLOOD GLUCOSE VALUES"],
  [null, null, null, null, 0, 30, 60, 120],
  [null, "Mouse ID", "BW (g)", "Diet", 0, "30m", "60m", "120m"],
  [null, 10, 40.9, "HFD", 8.0, 18.6, 13.2, 12.8],
  [null, 11, 26.5, "HFD", 8.2, 18.0, 16.0, 14.4],
  [null, 12, 42.4, "HFD", 8.2, 17.3, 16.0, 9.9],
  [null, 13, 44.9, "HFD", 8.7, 18.1, 13.4, 9.3],
  [null, 18, 46.0, "HFD", 10.4, 19.3, 16.4, 10.6],
  [null, 19, 39.0, "HFD", 8.0, 19.3, 15.7, 9.5],
  [null, 20, 43.0, "HFD", 6.4, 19.7, 14.5, 7.4],
  [null, 21, 36.1, "HFD", 7.4, 16.8, 12.7, 9.8],
  // a summary row whose range has slipped — the audit must catch this one
  [null, null, null, "Avg", 8.162, 99.0, 14.738, 10.463]
]);

/** Repeated identical headers with the day numbers only on a band row above. */
export const bodyWeightSheet = sheet("Body Weight", [
  ["BODY WEIGHT DATA"],
  [],
  [null, null, "TIME In Days", null, null, 4, 7, 11, 14, 18],
  [null, "Animal ID", "Diet", "BW (g)", "BW (g)", "BW (g)", "BW (g)", "BW (g)", "BW (g)", "BW (g)"],
  [null, "Control"],
  [null, 1, "NCD", 24.5, 25.2, 26.7, 27.6, 27.7, 28.2, 28.6],
  [null, 2, "NCD", 27.0, 28.5, 31.4, 31.4, 31.5, 31.7, 30.1],
  [null, 3, "NCD", 27.8, 29.1, 30.7, 31.5, 31.8, 32.6, 32.3],
  [null, null, "HF DIET group"],
  [null, 10, "HFD", 25.7, 26.5, 31.2, 30.3, 33.8, 34.9, 36.8],
  [null, 11, "HFD", 21.3, 22.8, 24.2, 23.3, 23.4, 23.9, 24.9],
  [null, 12, "HFD", 25.7, 27.4, 30.4, 30.4, 32.0, 33.7, 35.7]
]);

/** A malformed number that must be reported, not silently coerced. */
export const typoSheet = sheet("Cytokine mRNA levels", [
  ["mRNA levels"],
  [],
  [null, null, null, null, null, "Ilium Tissue"],
  [null, null, null, null, null, "Fold expression"],
  [null, null, "ANIMAL ID", "DIET/time", null, "IL6"],
  [null, null, 1, "0W Chow", null, 0.96],
  [null, null, 2, "0W Chow", null, "0.1.0"],
  [null, null, 3, "0W Chow", null, 1.02]
]);

/** Twenty-four time points: the case where every label cannot be printed. */
export const denseSheet = (() => {
  const days = Array.from({ length: 24 }, (_, i) => i * 3 + 1);
  const rows = [
    ["DENSE BODY WEIGHT"],
    [],
    [null, null, "TIME In Days", null, ...days],
    [null, "Animal ID", "Diet", ...days.map(() => "BW (g)")]
  ];
  const grow = (id, diet, start, rate) =>
    [null, id, diet, ...days.map((d) => +(start + rate * d + ((id * 7 + d) % 5) * 0.1).toFixed(2))];
  for (let i = 1; i <= 6; i++) rows.push(grow(i, "NCD", 25, 0.05));
  for (let i = 7; i <= 12; i++) rows.push(grow(i, "HFD", 25, 0.22));
  return sheet("Dense Weight", rows);
})();

export const allSheets = [bodyWeightSheet, gttSheet, cytokineSheet, typoSheet];

/* ---------- reference values ---------- */

export const REF = {
  // scipy.stats.ttest_ind(A, B, equal_var=False) and equal_var=True
  welch: { t: -4.279019546113281, df: 10.53881462677896, p: 1.4328010361044597e-3 },
  student: { t: -3.6494222289911575, df: 11, p: 3.824591636982887e-3 },
  A: [6.3, 6.9, 5.5, 6.3, 5.8],
  B: [8.0, 8.2, 8.2, 8.7, 10.4, 8.0, 6.4, 7.4],

  // scipy.stats.f_oneway
  anovaGroups: [
    [5.458, 7.864, 4.789, 5.326, 5.851],
    [5.458, 2.977, 5.655, 4.378, 5.72],
    [4.516, 5.192, 8.59, 3.959, 4.1, 5.786],
    [4.378, 4.378, 3.457, 3.164, 5.916, 5.192]
  ],
  anova: { F: 1.230653605796131, df1: 3, df2: 18, p: 0.32756966840161633 },

  // scipy.special.betainc / scipy.stats.f.sf
  incBeta: [[2.5, 3.5, 0.31, 0.3151753474404032], [0.5, 60, 0.9, 1.0]],
  fSf: [[4.2, 3, 19, 0.01940145820159788], [0.5, 2, 100, 0.6080388246889497]],

  // Grubbs' two-sided critical values, alpha 0.05, published tables
  grubbsCrit: { 5: 1.7150, 6: 1.8871, 8: 2.1266 },

  // mixed-design two-way RM ANOVA, verified against a statsmodels partition
  mixedRm: {
    between: { F: 0.001229874776386164, df: 1, dfError: 11 },
    within: { F: 304.2745545435217, df: 3, dfError: 33 },
    interaction: { F: 44.3984727614375, df: 3, dfError: 33 }
  },

  // fully-within two-way RM ANOVA, verified against pingouin.rm_anova
  fullRm: {
    between: { F: 0.320335, df: 3, dfError: 21 },
    within: { F: 251.413920, df: 3, dfError: 21 },
    interaction: { F: 14.838042, df: 9, dfError: 63 }
  }
};

export const mixedRmGroups = [
  { label: "NCD", subjects: [
    { id: 1, values: [6.3, 24.5, 11.7, 6.0] }, { id: 2, values: [6.9, 25.6, 12.9, 6.8] },
    { id: 3, values: [5.5, 24.5, 12.9, 6.5] }, { id: 4, values: [6.3, 26.1, 12.2, 7.0] },
    { id: 5, values: [5.8, 26.8, 16.8, 7.3] }] },
  { label: "HFD", subjects: [
    { id: 6, values: [8.0, 18.6, 13.2, 12.8] }, { id: 7, values: [8.2, 18.0, 16.0, 14.4] },
    { id: 8, values: [8.2, 17.3, 16.0, 9.9] }, { id: 9, values: [8.7, 18.1, 13.4, 9.3] },
    { id: 10, values: [10.4, 19.3, 16.4, 10.6] }, { id: 11, values: [8.0, 19.3, 15.7, 9.5] },
    { id: 12, values: [6.4, 19.7, 14.5, 7.4] }, { id: 13, values: [7.4, 16.8, 12.7, 9.8] }] }
];

export const fullRmSubjects = [
  { id: 1, cells: [[5.4, 21.9, 14.9, 7.0], [8.0, 18.6, 13.2, 12.8], [10.7, 22.8, 24.8, 13.6], [10.5, 19.9, 18.0, 12.3]] },
  { id: 2, cells: [[6.4, 27.0, 14.0, 7.5], [8.2, 18.0, 16.0, 14.4], [8.4, 19.9, 17.2, 12.7], [6.8, 23.0, 22.7, 12.8]] },
  { id: 3, cells: [[5.4, 23.8, 13.3, 7.5], [8.2, 17.3, 16.0, 9.9], [9.7, 17.9, 9.7, 9.0], [11.2, 21.0, 15.4, 14.0]] },
  { id: 4, cells: [[5.9, 23.6, 14.5, 9.3], [8.7, 18.1, 13.4, 9.3], [8.5, 13.4, 12.6, 8.4], [10.9, 20.0, 17.3, 12.8]] },
  { id: 5, cells: [[6.0, 29.2, 19.0, 7.7], [10.4, 19.3, 16.4, 10.6], [9.0, 16.2, 15.5, 8.9], [6.4, 11.3, 9.6, 7.7]] },
  { id: 6, cells: [[5.4, 26.4, 10.8, 6.5], [8.0, 19.3, 15.7, 9.5], [7.7, 16.2, 13.2, 8.3], [8.6, 19.9, 16.0, 14.6]] },
  { id: 7, cells: [[5.2, 26.1, 12.8, 7.8], [6.4, 19.7, 14.5, 7.4], [8.7, 18.2, 13.6, 9.3], [6.9, 11.4, 11.5, 7.7]] },
  { id: 8, cells: [[5.6, 21.3, 12.8, 6.5], [7.4, 16.8, 12.7, 9.8], [9.5, 16.4, 11.9, 9.0], [10.0, 16.0, 19.0, 13.9]] }
];
