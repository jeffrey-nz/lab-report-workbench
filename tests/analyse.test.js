import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseWorkbook } from "../src/lib/parse.js";
import * as A from "../src/lib/analyse.js";
import { allSheets } from "./fixtures.js";

const { records } = parseWorkbook(allSheets);
const key = (sheet, tissue, analyte) => `${sheet}|${tissue || ""}|${analyte}`;
const GTT = key("Glucose Tolerance Data", "", "Blood glucose");
const WAT = key("Cytokine- Protein", "WAT", "IL-1β");
const BW = key("Body Weight", "", "Body weight");

const run = (k, groups) => {
  const sel = A.buildSelection(records, k, groups);
  return { sel, analysis: A.analyse(sel) };
};

describe("ordering and controls", () => {
  test("groups run chow, then high fat by duration, then the age-matched chow", () => {
    const ordered = A.orderGroups(["HFD 10W", "NCD 0W", "HFD 2W", "NCD 10W"], records);
    assert.deepEqual(ordered, ["NCD 0W", "HFD 2W", "HFD 10W", "NCD 10W"]);
  });

  test("the control is the earliest chow group", () => {
    assert.equal(A.pickControl(["HFD 4W", "NCD 0W", "HFD 2W"], records), "NCD 0W");
  });

  test("with no chow group at all, the first group stands in", () => {
    assert.equal(A.pickControl(["HFD 2W", "HFD 4W"], records), "HFD 2W");
  });
});

describe("choosing the model from the design", () => {
  test("two independent groups get an unpaired t-test", () => {
    const { analysis } = run(WAT, ["NCD 0W", "HFD 2W"]);
    assert.equal(analysis.ok, true);
    assert.equal(analysis.kind, "two-group");
    assert.match(analysis.model.test, /t-test/);
  });

  test("three independent groups get a one-way ANOVA with multiple comparisons", () => {
    const { analysis } = run(WAT, ["NCD 0W", "HFD 2W", "HFD 4W"]);
    assert.equal(analysis.kind, "one-way");
    assert.match(analysis.model.test, /one-way ANOVA/);
    assert.equal(analysis.posthoc.length, 2, "each group against the control");
    assert.ok(analysis.posthoc.every((c) => c.label.includes("vs NCD 0W")));
  });

  test("separate animals per time point are never treated as repeated measures", () => {
    const { sel, analysis } = run(WAT, ["NCD 0W", "HFD 2W", "HFD 4W"]);
    assert.equal(sel.repeatedAcrossGroups, false);
    assert.match(analysis.designNote, /independent/);
  });

  test("animals measured at every time point get a mixed repeated-measures ANOVA", () => {
    const { analysis } = run(GTT, ["NCD 0W", "HFD 10W"]);
    assert.equal(analysis.kind, "time");
    assert.match(analysis.model.test, /repeated-measures/);
    assert.equal(analysis.model.effects.between.name, "Diet");
    assert.match(analysis.designNote, /within-subject/);
  });

  test("fewer than two groups is refused, not guessed at", () => {
    const { analysis } = run(WAT, ["NCD 0W"]);
    assert.equal(analysis.ok, false);
    assert.match(analysis.reason, /at least two groups/);
  });

  test("a figure-wide control absent from a panel falls back to that panel's own", () => {
    const sel = A.buildSelection(records, WAT, ["HFD 2W", "HFD 4W"]);
    const analysis = A.analyse(sel, { control: "NCD 0W" });   // not in this selection
    assert.equal(analysis.ok, true);
    assert.ok(sel.groups.includes(analysis.control), "control must be one of the groups");
  });
});

describe("default group selection", () => {
  test("offers a selection that actually produces a test", () => {
    for (const k of [GTT, WAT, BW]) {
      const groups = A.defaultGroups(records, k);
      assert.ok(groups.length >= 2, `${k}: too few groups`);
      assert.equal(A.analyse(A.buildSelection(records, k, groups)).ok, true, `${k}: not analysable`);
    }
  });
});

describe("summaries", () => {
  test("group means and n come from the animal values", () => {
    const { sel, analysis } = run(WAT, ["NCD 0W", "HFD 2W"]);
    const chow = analysis.summary.find((s) => s.group === "NCD 0W").points[0];
    assert.equal(chow.n, 3);
    assert.ok(Math.abs(chow.mean - (5.0 + 5.4 + 4.8) / 3) < 1e-12);
    assert.equal(sel.groups.length, 2);
  });

  test("an animal the sheet excluded is left out of the summary", () => {
    const { analysis } = run(WAT, ["NCD 0W", "HFD 2W"]);
    const hfd = analysis.summary.find((s) => s.group === "HFD 2W").points[0];
    assert.equal(hfd.n, 2, "animal 13 was marked unusable");
  });

  test("outliers are surfaced rather than silently dropped", () => {
    const { analysis } = run(WAT, ["NCD 0W", "HFD 2W", "HFD 4W"]);
    assert.ok(Array.isArray(analysis.outliers));
    for (const o of analysis.outliers) assert.ok(o.G > o.Gcrit);
  });
});

describe("axis labels", () => {
  test("name the analyte and its unit, never just 'protein'", () => {
    const { sel } = run(WAT, ["NCD 0W", "HFD 2W"]);
    assert.equal(A.axisLabel(sel), "WAT IL-1β protein (ng/mg)");
  });

  test("a fold change says what it is relative to", () => {
    const sel = A.buildSelection(records, key("Cytokine mRNA levels", "Ileum", "IL-6"), ["NCD 0W"]);
    assert.match(A.axisLabel(sel), /mRNA \(fold vs chow\)/);
  });

  test("the time axis carries its unit", () => {
    assert.equal(A.xAxisLabel(run(GTT, ["NCD 0W", "HFD 10W"]).sel), "Time after bolus (min)");
    assert.equal(A.xAxisLabel(run(BW, ["NCD", "HFD"]).sel), "Time on diet (days)");
  });

  test("a measurement without a time course is plotted against the groups", () => {
    assert.equal(A.xAxisLabel(run(WAT, ["NCD 0W", "HFD 2W"]).sel), "Weeks on diet");
  });
});

describe("drafted text", () => {
  const panels = [
    { key: WAT, ...run(WAT, ["NCD 0W", "HFD 2W", "HFD 4W"]) },
    { key: GTT, ...run(GTT, ["NCD 0W", "HFD 10W"]) }
  ].map((p) => ({ ...p, labels: { x: A.xAxisLabel(p.sel), y: A.axisLabel(p.sel) } }));

  const legend = A.draftLegend(panels, 2);
  const results = A.draftResults(panels, 2);

  test("never emits a placeholder for a missing value", () => {
    for (const [what, text] of [["legend", legend], ["results", results]]) {
      assert.doesNotMatch(text, /\bundefined\b/, `${what} contains "undefined"`);
      assert.doesNotMatch(text, /\bnull\b/, `${what} contains "null"`);
      assert.doesNotMatch(text, /\bNaN\b/, `${what} contains "NaN"`);
    }
  });

  test("the legend is numbered, lettered and says what the asterisks mean", () => {
    assert.match(legend, /^Figure 2\./);
    assert.match(legend, /\(A\)/);
    assert.match(legend, /\(B\)/);
    assert.match(legend, /mean ± SEM/);
    assert.match(legend, /\*p < 0\.05/);
  });

  test("the legend states findings, not just what was plotted", () => {
    assert.match(legend, /rose|fell|diverged|differed|did not/);
  });

  test("every F and t in the drafted statistics carries its degrees of freedom", () => {
    for (const p of panels) {
      const sentence = A.statsSentence(p.analysis);
      for (const m of sentence.matchAll(/([FT])\(([^)]*)\)/gi))
        assert.match(m[2], /^\s*\d+(\.\d+)?\s*(,\s*\d+\s*)?$/, `bad df in "${m[0]}"`);
      assert.match(sentence, /p [<=]/);
    }
  });

  test("the overall test is named before the multiple comparisons", () => {
    const sentence = A.statsSentence(panels[0].analysis);
    assert.ok(sentence.indexOf("ANOVA") < sentence.indexOf("multiple comparisons"),
      "ANOVA must be reported first");
  });

  test("sentences start with a capital, but acronyms are left alone", () => {
    for (const part of results.split(/(?<=\.)\s+/)) {
      if (!part.trim()) continue;
      assert.match(part.trim()[0], /[A-Z(]/, `sentence starts lower case: "${part.slice(0, 40)}"`);
    }
  });

  test("a selection with no valid test says so instead of emitting empty brackets", () => {
    const bad = [{ key: WAT, ...run(WAT, ["NCD 0W"]), labels: { x: "", y: "" } }];
    const text = A.draftLegend(bad, 1);
    assert.doesNotMatch(text, /\(\)/);
    assert.match(text, /No analysis/);
  });
});
