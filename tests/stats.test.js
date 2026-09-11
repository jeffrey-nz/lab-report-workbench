import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as S from "../src/lib/stats.js";
import { REF, mixedRmGroups, fullRmSubjects } from "./fixtures.js";

const close = (actual, expected, tol, what) =>
  assert.ok(Math.abs(actual - expected) <= tol,
    `${what}: got ${actual}, expected ${expected} (±${tol})`);

describe("special functions", () => {
  test("logGamma matches known factorials", () => {
    for (const [x, want] of [[1, 0], [2, 0], [3, Math.log(2)], [5, Math.log(24)], [10, Math.log(362880)]])
      close(S.logGamma(x), want, 1e-9, `logGamma(${x})`);
  });

  test("incomplete beta matches scipy.special.betainc", () => {
    for (const [a, b, x, want] of REF.incBeta)
      close(S.incBeta(a, b, x), want, 1e-12, `incBeta(${a},${b},${x})`);
  });

  test("incomplete beta is bounded and monotone in x", () => {
    assert.equal(S.incBeta(2, 3, 0), 0);
    assert.equal(S.incBeta(2, 3, 1), 1);
    let prev = -1;
    for (let x = 0; x <= 1.0001; x += 0.05) {
      const v = S.incBeta(2, 3, Math.min(x, 1));
      assert.ok(v >= prev - 1e-12, `not monotone at x=${x}`);
      assert.ok(v >= 0 && v <= 1, `out of range at x=${x}`);
      prev = v;
    }
  });

  test("t distribution: two-tailed p is symmetric and bounded", () => {
    for (const df of [1, 5, 30, 200]) {
      close(S.tTwoTailed(0, df), 1, 1e-12, `t=0 df=${df}`);
      for (const t of [0.5, 2, 6]) {
        close(S.tTwoTailed(t, df), S.tTwoTailed(-t, df), 1e-15, "symmetry");
        const p = S.tTwoTailed(t, df);
        assert.ok(p > 0 && p < 1, `p out of range: ${p}`);
      }
    }
  });

  test("F survival matches scipy.stats.f.sf", () => {
    for (const [F, d1, d2, want] of REF.fSf)
      close(S.fSurvival(F, d1, d2), want, 1e-11, `fSurvival(${F},${d1},${d2})`);
  });

  test("invalid arguments return NaN rather than throwing", () => {
    assert.ok(Number.isNaN(S.tTwoTailed(NaN, 5)));
    assert.ok(Number.isNaN(S.tTwoTailed(2, 0)));
    assert.ok(Number.isNaN(S.fSurvival(-1, 3, 4)));
    assert.ok(Number.isNaN(S.fSurvival(2, 0, 4)));
  });
});

describe("descriptives", () => {
  test("mean, sd and sem on a known sample", () => {
    const v = [2, 4, 4, 4, 5, 5, 7, 9];
    close(S.mean(v), 5, 1e-12, "mean");
    close(S.sd(v), 2.138089935299395, 1e-12, "sd");          // sample sd, n-1
    close(S.sem(v), 2.138089935299395 / Math.sqrt(8), 1e-12, "sem");
  });

  test("describe reports quartiles and range", () => {
    const d = S.describe([1, 2, 3, 4, 5]);
    assert.equal(d.n, 5);
    assert.equal(d.min, 1);
    assert.equal(d.max, 5);
    assert.equal(d.median, 3);
    assert.equal(d.q1, 2);
    assert.equal(d.q3, 4);
  });

  test("a single value has no spread", () => {
    const d = S.describe([7]);
    assert.equal(d.n, 1);
    assert.equal(d.mean, 7);
    assert.ok(Number.isNaN(d.sd), "sd of one value should be NaN, not 0");
  });

  test("identical values have zero spread", () => {
    close(S.sd([3, 3, 3, 3]), 0, 1e-15, "sd");
    close(S.sem([3, 3, 3, 3]), 0, 1e-15, "sem");
  });
});

describe("t-test", () => {
  test("Welch matches scipy", () => {
    const r = S.tTest(REF.A, REF.B);
    close(r.t, REF.welch.t, 1e-12, "t");
    close(r.df, REF.welch.df, 1e-11, "df");
    close(r.p, REF.welch.p, 1e-14, "p");
  });

  test("Student matches scipy", () => {
    const r = S.tTest(REF.A, REF.B, { welch: false });
    close(r.t, REF.student.t, 1e-12, "t");
    assert.equal(r.df, REF.student.df);
    close(r.p, REF.student.p, 1e-14, "p");
  });

  test("reports the direction of the difference and an effect size", () => {
    const r = S.tTest([10, 10, 10], [1, 1, 1], { welch: false });
    assert.ok(r.meanDiff > 0, "meanDiff should follow the argument order");
    assert.ok(r.cohensD > 0);
    assert.equal(r.groups.length, 2);
  });
});

describe("one-way ANOVA", () => {
  test("matches scipy.stats.f_oneway", () => {
    const r = S.oneWayAnova(REF.anovaGroups);
    close(r.F, REF.anova.F, 1e-11, "F");
    assert.equal(r.df1, REF.anova.df1);
    assert.equal(r.df2, REF.anova.df2);
    close(r.p, REF.anova.p, 1e-12, "p");
  });

  test("sums of squares decompose", () => {
    const r = S.oneWayAnova(REF.anovaGroups);
    const all = REF.anovaGroups.flat();
    const grand = S.mean(all);
    const ssTotal = all.reduce((a, v) => a + (v - grand) ** 2, 0);
    close(r.ssBetween + r.ssWithin, ssTotal, 1e-9, "SS_between + SS_within = SS_total");
    assert.ok(r.etaSq >= 0 && r.etaSq <= 1);
  });

  test("identical groups give F of zero", () => {
    const r = S.oneWayAnova([[1, 2, 3], [1, 2, 3], [1, 2, 3]]);
    close(r.F, 0, 1e-12, "F");
    close(r.p, 1, 1e-9, "p");
  });
});

describe("two-way repeated-measures ANOVA (mixed design)", () => {
  const r = S.twoWayRmAnova(mixedRmGroups, ["0", "30", "60", "120"]);

  test("every effect matches the reference partition", () => {
    for (const key of ["between", "within", "interaction"]) {
      const got = r.effects[key], want = REF.mixedRm[key];
      close(got.F, want.F, 1e-9, `${key} F`);
      assert.equal(got.df, want.df, `${key} df`);
      assert.equal(got.dfError, want.dfError, `${key} error df`);
      assert.ok(got.p >= 0 && got.p <= 1);
    }
  });

  test("the between effect uses the subject error term, not the within one", () => {
    assert.notEqual(r.effects.between.dfError, r.effects.within.dfError);
    assert.equal(r.effects.between.dfError, r.dfSubjectError);
    assert.equal(r.effects.within.dfError, r.dfWithinError);
  });

  test("refuses a design it cannot partition", () => {
    assert.equal(S.twoWayRmAnova([mixedRmGroups[0]], ["0", "30"]), null, "one group");
    assert.equal(S.twoWayRmAnova(mixedRmGroups, ["0"]), null, "one level");
  });
});

describe("two-way repeated-measures ANOVA (matched in both factors)", () => {
  const r = S.twoWayFullRmAnova(fullRmSubjects, ["0W", "2W", "5W", "10W"], ["0", "30", "60", "120"]);

  test("every effect matches pingouin", () => {
    for (const key of ["between", "within", "interaction"]) {
      const got = r.effects[key], want = REF.fullRm[key];
      close(got.F, want.F, 1e-5, `${key} F`);
      assert.equal(got.df, want.df, `${key} df`);
      assert.equal(got.dfError, want.dfError, `${key} error df`);
    }
  });

  test("each effect is tested against its own error term", () => {
    const { between, within, interaction } = r.effects;
    assert.notEqual(between.dfError, interaction.dfError);
    assert.notEqual(within.dfError, interaction.dfError);
  });

  test("refuses incomplete cells", () => {
    const holed = structuredClone(fullRmSubjects);
    holed[0].cells[1][2] = undefined;
    assert.equal(S.twoWayFullRmAnova(holed, ["0W", "2W", "5W", "10W"], ["0", "30", "60", "120"]), null);
  });
});

describe("multiple comparisons", () => {
  const comparisons = [
    { label: "a", group: "a", x: null, a: { mean: 10, n: 6 }, b: { mean: 5, n: 6 } },
    { label: "b", group: "b", x: null, a: { mean: 6, n: 6 }, b: { mean: 5, n: 6 } },
    { label: "c", group: "c", x: null, a: { mean: 5.2, n: 6 }, b: { mean: 5, n: 6 } }
  ];
  const out = S.sidakPairwise(comparisons, 2.0, 20);

  test("adjusted p is never smaller than the raw p", () => {
    for (const r of out) assert.ok(r.p >= r.pRaw - 1e-15, `${r.label}: ${r.p} < ${r.pRaw}`);
  });

  test("a single comparison is not penalised", () => {
    const one = S.sidakPairwise([comparisons[0]], 2.0, 20)[0];
    close(one.p, one.pRaw, 1e-12, "p");
  });

  test("Šídák matches its closed form", () => {
    const m = comparisons.length;
    for (const r of out) close(r.p, 1 - (1 - r.pRaw) ** m, 1e-12, `${r.label}`);
  });

  test("carries the group and time point through for the figure", () => {
    assert.equal(out[0].group, "a");
    assert.equal(out[0].df, 20);
    assert.ok("x" in out[0]);
  });
});

describe("Grubbs' test", () => {
  test("critical values reproduce the published tables", () => {
    for (const [n, want] of Object.entries(REF.grubbsCrit)) {
      const values = Array.from({ length: +n }, (_, i) => (i === +n - 1 ? 500 : i + 1));
      close(S.grubbs(values).Gcrit, want, 5e-5, `n=${n}`);
    }
  });

  test("flags a clear outlier and names it", () => {
    const r = S.grubbs([1, 2, 3, 4, 50]);
    assert.equal(r.isOutlier, true);
    assert.equal(r.value, 50);
    assert.equal(r.index, 4);
  });

  test("leaves a tidy sample alone", () => {
    assert.equal(S.grubbs([10, 11, 12, 11, 10, 12]).isOutlier, false);
  });

  test("declines samples it cannot judge", () => {
    assert.equal(S.grubbs([1, 2]), null, "n < 3");
    assert.equal(S.grubbs([5, 5, 5, 5]), null, "no spread");
  });
});

describe("reporting helpers", () => {
  test("stars follow the conventional thresholds", () => {
    assert.equal(S.stars(0.2), "ns");
    assert.equal(S.stars(0.049), "*");
    assert.equal(S.stars(0.009), "**");
    assert.equal(S.stars(0.0009), "***");
    assert.equal(S.stars(0.00009), "****");
    assert.equal(S.stars(0.05), "ns", "0.05 itself is not significant");
  });

  test("p-values keep the digits that decide significance", () => {
    assert.equal(S.fmtP(0.0341), "p = 0.034");
    assert.equal(S.fmtP(0.048), "p = 0.048");
    assert.equal(S.fmtP(0.0012), "p = 0.0012");
    assert.equal(S.fmtP(0.31), "p = 0.31");
    assert.equal(S.fmtP(0.051), "p = 0.051");
    assert.equal(S.fmtP(0.00002), "p < 0.0001");
    assert.equal(S.fmtP(0.5), "p = 0.50");
    assert.equal(S.fmtP(NaN), "n/a");
  });

  test("a p-value never rounds across the 0.05 line", () => {
    for (const p of [0.0499, 0.04999, 0.0501, 0.05001]) {
      const shown = Number(S.fmtP(p).replace(/^p\s*[<=]\s*/, ""));
      assert.equal(shown < 0.05, p < 0.05, `${p} displayed as ${shown}`);
    }
  });

  test("F and t are reported with their degrees of freedom", () => {
    assert.equal(S.fmtF({ df: 3, dfError: 33, F: 30.2244 }), "F(3, 33) = 30.22");
    assert.equal(S.fmtT({ df: 11, t: -3.6494 }), "t(11) = -3.65");
    assert.equal(S.fmtT({ df: 10.5388, t: -4.279 }), "t(10.5) = -4.28");
  });
});
