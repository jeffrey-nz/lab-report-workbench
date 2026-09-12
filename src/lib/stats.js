import { t as msg } from "../i18n/index.js";

/* stats.js — distributions and tests used by the report workbench.
   Everything is recomputed from raw animal-level values; nothing here
   trusts the Avg/StDev/StErr cells that ship inside the course workbook. */

/* ---------- special functions ---------- */

const LG_C = [76.18009172947146, -86.50532032941677, 24.01409824083091,
              -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];

export function logGamma(x) {
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += LG_C[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

/* Continued-fraction core for the regularised incomplete beta (Lentz). */
function betacf(a, b, x) {
  const FPMIN = 1e-300, EPS = 3e-16;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularised incomplete beta I_x(a,b). */
export function incBeta(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) +
                         a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2)
    ? front * betacf(a, b, x) / a
    : 1 - front * betacf(b, a, 1 - x) / b;
}

/** Two-tailed p for Student's t on df degrees of freedom. */
export function tTwoTailed(t, df) {
  if (!isFinite(t) || !isFinite(df) || df <= 0) return NaN;
  return incBeta(df / 2, 0.5, df / (df + t * t));
}

/** Upper-tail p for F on (df1, df2) — the ANOVA p-value. */
export function fSurvival(F, df1, df2) {
  if (!isFinite(F) || F < 0 || df1 <= 0 || df2 <= 0) return NaN;
  if (F === 0) return 1;          // groups that do not differ at all
  return incBeta(df2 / 2, df1 / 2, df2 / (df2 + df1 * F));
}

/* ---------- descriptives ---------- */

export function mean(v) { return v.reduce((a, b) => a + b, 0) / v.length; }

export function sd(v) {
  if (v.length < 2) return NaN;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

export function sem(v) { return sd(v) / Math.sqrt(v.length); }

export function describe(v) {
  const s = [...v].sort((a, b) => a - b);
  const q = (p) => {
    const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  };
  return { n: v.length, mean: mean(v), sd: sd(v), sem: sem(v),
           min: s[0], max: s[s.length - 1], median: q(0.5), q1: q(0.25), q3: q(0.75) };
}

/* ---------- tests ---------- */

/** Unpaired t-test. Welch by default; Student when welch:false. */
export function tTest(a, b, { welch = true } = {}) {
  const na = a.length, nb = b.length;
  const ma = mean(a), mb = mean(b);
  const va = sd(a) ** 2, vb = sd(b) ** 2;
  let t, df;
  if (welch) {
    const se = Math.sqrt(va / na + vb / nb);
    t = (ma - mb) / se;
    df = (va / na + vb / nb) ** 2 /
         ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1));
  } else {
    df = na + nb - 2;
    const sp2 = ((na - 1) * va + (nb - 1) * vb) / df;
    t = (ma - mb) / Math.sqrt(sp2 * (1 / na + 1 / nb));
  }
  const pooledSd = Math.sqrt(((na - 1) * va + (nb - 1) * vb) / (na + nb - 2));
  return { test: welch ? msg("test.welch") : msg("test.student"),
           t, df, p: tTwoTailed(t, df), meanDiff: ma - mb,
           cohensD: (ma - mb) / pooledSd, groups: [describe(a), describe(b)] };
}

/** One-way ANOVA across independent groups. */
export function oneWayAnova(groups) {
  const k = groups.length;
  const all = groups.flat();
  const N = all.length, grand = mean(all);
  let ssB = 0, ssW = 0;
  for (const g of groups) {
    const m = mean(g);
    ssB += g.length * (m - grand) ** 2;
    for (const v of g) ssW += (v - m) ** 2;
  }
  const df1 = k - 1, df2 = N - k;
  const msB = ssB / df1, msW = ssW / df2, F = msB / msW;
  return { test: msg("test.oneWay"), F, df1, df2, p: fSurvival(F, df1, df2),
           ssBetween: ssB, ssWithin: ssW, msBetween: msB, msWithin: msW,
           etaSq: ssB / (ssB + ssW), N, k };
}

/**
 * Two-way repeated-measures (mixed-design) ANOVA.
 * `groups` = [{ label, subjects: [{ id, values: [v per level] }] }], one
 * between-subjects factor and one within-subjects factor measured on every
 * subject. Error terms follow the standard mixed-model partition, which is
 * what Prism reports as a two-way RM ANOVA.
 */
export function twoWayRmAnova(groups, levelLabels,
                              { betweenName = "Diet", withinName = "Time" } = {}) {
  const a = groups.length, b = levelLabels.length;
  const subjects = groups.flatMap(g => g.subjects);
  const N = subjects.length;
  if (a < 2 || b < 2 || N <= a) return null;

  const all = subjects.flatMap(s => s.values);
  const grand = mean(all);
  const subjMeans = subjects.map(s => mean(s.values));

  // Between-subjects partition
  let ssA = 0;
  for (const g of groups) {
    const gm = mean(g.subjects.flatMap(s => s.values));
    ssA += g.subjects.length * b * (gm - grand) ** 2;
  }
  let ssSubjWithinA = 0;
  let si = 0;
  for (const g of groups) {
    const gm = mean(g.subjects.flatMap(s => s.values));
    for (let i = 0; i < g.subjects.length; i++, si++) {
      ssSubjWithinA += b * (subjMeans[si] - gm) ** 2;
    }
  }

  // Within-subjects partition
  let ssB = 0;
  for (let j = 0; j < b; j++) {
    const lm = mean(subjects.map(s => s.values[j]));
    ssB += N * (lm - grand) ** 2;
  }
  let ssCells = 0;
  for (const g of groups) {
    for (let j = 0; j < b; j++) {
      const cm = mean(g.subjects.map(s => s.values[j]));
      ssCells += g.subjects.length * (cm - grand) ** 2;
    }
  }
  const ssAB = ssCells - ssA - ssB;

  let ssTotal = 0;
  for (const v of all) ssTotal += (v - grand) ** 2;
  const ssError = ssTotal - ssCells - ssSubjWithinA;

  const dfA = a - 1, dfSubj = N - a;
  const dfB = b - 1, dfAB = (a - 1) * (b - 1), dfError = dfSubj * (b - 1);
  const msSubj = ssSubjWithinA / dfSubj, msError = ssError / dfError;

  const row = (name, ss, df, ms, msErr, dfErr) => {
    const F = (ss / df) / msErr;
    return { name, ss, df, ms: ss / df, F, dfError: dfErr, p: fSurvival(F, df, dfErr) };
  };

  return {
    test: msg("test.rmMixed"),
    betweenName, withinName, a, b, N,
    effects: {
      between: row(betweenName, ssA, dfA, null, msSubj, dfSubj),
      within: row(withinName, ssB, dfB, null, msError, dfError),
      interaction: row(msg("effect.interaction", { within: withinName, between: betweenName }), ssAB, dfAB, null, msError, dfError)
    },
    msSubject: msSubj, msError, dfSubjectError: dfSubj, dfWithinError: dfError,
    ssTotal
  };
}

/**
 * Two-way ANOVA with BOTH factors measured on the same subjects
 * (e.g. the same animals tested at several diet durations, each test giving a
 * time course). Every effect is tested against its own interaction-with-subjects
 * error term, as Prism does for a two-way RM ANOVA with matching in both factors.
 * `subjects` = [{ id, cells: number[aLevels][bLevels] }].
 */
export function twoWayFullRmAnova(subjects, aLabels, bLabels,
                                  { aName = "Duration", bName = "Time" } = {}) {
  const n = subjects.length, a = aLabels.length, b = bLabels.length;
  if (n < 2 || a < 2 || b < 2) return null;
  const at = (s, i, j) => s.cells[i][j];
  const all = subjects.flatMap(s => s.cells.flat());
  if (all.some(v => !isFinite(v))) return null;
  const grand = mean(all);

  const mA = i => mean(subjects.flatMap(s => s.cells[i]));
  const mB = j => mean(subjects.map(s => mean(s.cells.map(r => r[j]))) ) ;
  const mAB = (i, j) => mean(subjects.map(s => at(s, i, j)));
  const mS = s => mean(s.cells.flat());
  const mAS = (s, i) => mean(s.cells[i]);
  const mBS = (s, j) => mean(s.cells.map(r => r[j]));

  let ssA = 0, ssB = 0, ssAB = 0, ssS = 0, ssAS = 0, ssBS = 0, ssABS = 0;
  for (let i = 0; i < a; i++) ssA += n * b * (mA(i) - grand) ** 2;
  for (let j = 0; j < b; j++) ssB += n * a * (mB(j) - grand) ** 2;
  for (let i = 0; i < a; i++)
    for (let j = 0; j < b; j++)
      ssAB += n * (mAB(i, j) - mA(i) - mB(j) + grand) ** 2;
  for (const s of subjects) ssS += a * b * (mS(s) - grand) ** 2;
  for (const s of subjects)
    for (let i = 0; i < a; i++)
      ssAS += b * (mAS(s, i) - mA(i) - mS(s) + grand) ** 2;
  for (const s of subjects)
    for (let j = 0; j < b; j++)
      ssBS += a * (mBS(s, j) - mB(j) - mS(s) + grand) ** 2;
  for (const s of subjects)
    for (let i = 0; i < a; i++)
      for (let j = 0; j < b; j++)
        ssABS += (at(s, i, j) - mAS(s, i) - mBS(s, j) - mAB(i, j)
                  + mA(i) + mB(j) + mS(s) - grand) ** 2;

  const dfA = a - 1, dfB = b - 1, dfAB = dfA * dfB, dfS = n - 1;
  const dfAS = dfA * dfS, dfBS = dfB * dfS, dfABS = dfAB * dfS;
  const eff = (name, ss, df, ssErr, dfErr) => {
    const F = (ss / df) / (ssErr / dfErr);
    return { name, ss, df, ms: ss / df, F, dfError: dfErr, p: fSurvival(F, df, dfErr),
             msError: ssErr / dfErr };
  };
  return {
    test: msg("test.rmBoth"),
    betweenName: aName, withinName: bName, a, b, N: n,
    effects: {
      between: eff(aName, ssA, dfA, ssAS, dfAS),
      within: eff(bName, ssB, dfB, ssBS, dfBS),
      interaction: eff(msg("effect.interaction", { within: bName, between: aName }), ssAB, dfAB, ssABS, dfABS)
    },
    msError: ssABS / dfABS, dfError: dfABS
  };
}

/**
 * Šídák-corrected pairwise comparisons against a pooled error term.
 * `comparisons` = [{ label, a:{mean,n}, b:{mean,n} }]. Matches the family of
 * tests Prism labels "Šídák's multiple comparisons test".
 */
export function sidakPairwise(comparisons, msError, dfError) {
  const m = comparisons.length;
  return comparisons.map(c => {
    const se = Math.sqrt(msError * (1 / c.a.n + 1 / c.b.n));
    const t = (c.a.mean - c.b.mean) / se;
    const pRaw = tTwoTailed(t, dfError);
    const pAdj = Math.min(1, 1 - (1 - pRaw) ** m);
    return { label: c.label, group: c.group, x: c.x, t, df: dfError,
             diff: c.a.mean - c.b.mean, pRaw, p: pAdj, stars: stars(pAdj) };
  });
}

/** Grubbs' test for a single outlier — serves the "aberrant data" rubric line. */
export function grubbs(values, alpha = 0.05) {
  const n = values.length;
  if (n < 3) return null;
  const m = mean(values), s = sd(values);
  if (!s) return null;
  let idx = 0, maxDev = 0;
  values.forEach((v, i) => {
    const d = Math.abs(v - m);
    if (d > maxDev) { maxDev = d; idx = i; }
  });
  const G = maxDev / s;
  const tCrit2 = (() => {
    // upper-tail critical t at alpha/(2n) on n-2 df => two-tailed alpha/n
    const target = alpha / n;
    let lo = 0, hi = 100;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (tTwoTailed(mid, n - 2) > target) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  })();
  const Gcrit = ((n - 1) / Math.sqrt(n)) *
                Math.sqrt(tCrit2 ** 2 / (n - 2 + tCrit2 ** 2));
  return { G, Gcrit, index: idx, value: values[idx], isOutlier: G > Gcrit, n, alpha };
}

/* ---------- formatting ---------- */

export function stars(p) {
  if (!isFinite(p)) return "";
  if (p < 0.0001) return "****";
  if (p < 0.001) return "***";
  if (p < 0.01) return "**";
  if (p < 0.05) return "*";
  return "ns";
}

/**
 * Report a p-value with the digits that matter and no more: two decimals when
 * it is not significant, two significant figures when it is. A p-value is never
 * shown rounded to the far side of 0.05, or as a bare "0.05", because that is
 * the one place the reader draws a conclusion from the digits.
 */
export function fmtP(p) {
  if (!isFinite(p)) return "n/a";
  if (p < 0.0001) return "p < 0.0001";
  const significant = p < 0.05;
  for (let digits = 2; digits <= 6; digits++) {
    const shown = significant ? trimZeros(p.toPrecision(digits)) : p.toFixed(digits);
    const value = Number(shown);
    if (value === 0.05 && p !== 0.05) continue;      // ambiguous either way
    if ((value < 0.05) === significant) return "p = " + shown;
  }
  return "p = " + p.toPrecision(6);
}

function trimZeros(s) {
  return s.includes("e") ? Number(s).toFixed(6) : s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

export function fmtF(effect) {
  return `F(${effect.df}, ${effect.dfError}) = ${effect.F.toFixed(2)}`;
}

export function fmtT(r) {
  return `t(${r.df.toFixed(r.df % 1 ? 1 : 0)}) = ${r.t.toFixed(2)}`;
}
