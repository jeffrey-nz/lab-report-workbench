import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { parseWorkbook, seriesIndex } from "../src/lib/parse.js";
import { state } from "../src/state.js";
import { seriesNames, panelName, panelHint, panelFullName, assayOf } from "../src/labels.js";
import * as A from "../src/lib/analyse.js";
import { allSheets } from "./fixtures.js";

const { records } = parseWorkbook(allSheets);

before(() => {
  state.records = records;
  state.series = seriesIndex(records);
});

const find = (pred) => state.series.find(pred);
const panelFor = (s) => {
  const sel = A.buildSelection(records, s.key, s.groups);
  return { key: s.key, sel, analysis: A.analyse(sel) };
};

describe("assay names", () => {
  test("a concentration is protein and a fold change is mRNA", () => {
    assert.equal(assayOf("ng per mg tissue"), "protein");
    assert.equal(assayOf("Fold expression"), "mRNA");
  });

  test("anything else keeps its own unit", () => {
    assert.equal(assayOf("mmol/L"), "mmol/L");
    assert.equal(assayOf(null), "");
  });
});

describe("naming a measurement", () => {
  test("combines the tissue and the analyte", () => {
    const s = find((x) => x.tissue === "WAT" && x.analyte === "IL-1β");
    assert.equal(seriesNames().get(s.key).name, "WAT IL-1β");
  });

  test("the hint names the assay when that is enough", () => {
    const s = find((x) => x.tissue === "Liver" && x.analyte === "IL-6");
    assert.equal(seriesNames().get(s.key).hint, "protein");
  });

  test("two measurements that would read the same are told apart by sheet", () => {
    const names = seriesNames();
    const bodyWeights = state.series.filter((s) => s.analyte === "Body weight");
    assert.ok(bodyWeights.length > 1, "the fixture should contain more than one");
    const hints = bodyWeights.map((s) => names.get(s.key).hint);
    assert.equal(new Set(hints).size, hints.length, `hints must differ: ${hints}`);
    for (const h of hints) assert.ok(h && h.length, "a hint is required to disambiguate");
  });

  test("a panel carries the same name the chip does", () => {
    const s = find((x) => x.tissue === "WAT" && x.analyte === "IL-6");
    const p = panelFor(s);
    assert.equal(panelName(p), "WAT IL-6");
    assert.equal(panelFullName(p), "WAT IL-6 (protein)");
  });

  test("a hint that only repeats the name is left off", () => {
    const p = panelFor(find((x) => x.analyte === "Blood glucose"));
    const hint = panelHint(p);
    assert.ok(hint === null || hint !== panelName(p));
  });

  test("a panel with no usable selection still has a name", () => {
    const s = find((x) => x.tissue === "WAT");
    const sel = A.buildSelection(records, s.key, []);          // nothing selected
    const p = { key: s.key, sel, analysis: A.analyse(sel) };
    assert.ok(panelName(p).length > 0, "a broken panel must not render as blank");
    assert.doesNotMatch(panelName(p), /undefined|null/);
  });
});
