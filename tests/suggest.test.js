import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseWorkbook, seriesIndex } from "../src/lib/parse.js";
import { suggestFigures } from "../src/lib/suggest.js";
import { allSheets, sheet } from "./fixtures.js";

const series = seriesIndex(parseWorkbook(allSheets).records);
const suggested = suggestFigures(series);
const titles = suggested.map((s) => s.title);
const find = (re) => suggested.find((s) => re.test(s.title));

describe("proposing figures", () => {
  test("proposes something for a workbook with measurements in it", () => {
    assert.ok(suggested.length > 0);
  });

  test("every proposal names real measurements", () => {
    const keys = new Set(series.map((s) => s.key));
    for (const s of suggested) {
      assert.ok(s.keys.length > 0, `${s.title} has no panels`);
      for (const k of s.keys) assert.ok(keys.has(k), `${s.title} names a key that does not exist`);
    }
  });

  test("a figure never exceeds six panels", () => {
    for (const s of suggested)
      assert.ok(s.keys.length <= 6, `${s.title} proposes ${s.keys.length} panels`);
  });

  test("columns suit the number of panels", () => {
    for (const s of suggested) {
      assert.ok(s.cols >= 1 && s.cols <= 3);
      assert.ok(s.cols <= s.keys.length, `${s.title}: more columns than panels`);
    }
  });

  test("a tissue becomes a figure, with protein before mRNA", () => {
    const wat = find(/^WAT/);
    assert.ok(wat, `no WAT figure among: ${titles.join(", ")}`);
    const byKey = new Map(series.map((s) => [s.key, s]));
    const assays = wat.keys.map((k) => (/fold/i.test(byKey.get(k).unit || "") ? "mRNA" : "protein"));
    const firstMrna = assays.indexOf("mRNA");
    if (firstMrna >= 0)
      assert.ok(!assays.slice(firstMrna).includes("protein"), "mRNA and protein are interleaved");
  });

  test("two sheets measuring the same thing are two panels, not one", () => {
    // glucose tolerance and insulin tolerance both report blood glucose
    const glucose = find(/Blood glucose/);
    assert.ok(glucose, "the time courses should be proposed together");
    assert.equal(glucose.keys.length, 1,
      "these fixtures hold one glucose course; the merge rule must not invent panels");
  });

  test("the same tissue assay on two sheets is proposed once", () => {
    const counts = new Map();
    for (const s of suggested)
      for (const k of s.keys) counts.set(k, (counts.get(k) || 0) + 1);
    const tissueSeries = series.filter((s) => s.tissue);
    for (const s of tissueSeries) {
      const n = counts.get(s.key) || 0;
      assert.ok(n <= 2, `${s.tissue} ${s.analyte} appears in ${n} proposals`);
    }
  });

  test("proposals are labelled so the interface can group them", () => {
    for (const s of suggested)
      assert.ok(["course", "tissue", "across", "single"].includes(s.kind),
        `${s.title} has an unknown kind: ${s.kind}`);
  });

  test("an empty workbook proposes nothing rather than throwing", () => {
    assert.deepEqual(suggestFigures([]), []);
  });
});

describe("across tissues", () => {
  const wide = seriesIndex(parseWorkbook([sheet("Wide", [
    ["Cross-tissue panel"],
    [],
    [null, null, null, null, null, "WAT", null, "LIVER", null, "ILEUM"],
    [null, null, null, null, null, "Fold expression", null, "Fold expression", null, "Fold expression"],
    [null, null, "ANIMAL ID", "DIET/time", null, "CD68", null, "CD68", null, "CD68"],
    [null, null, 1, "0W Chow", null, 1.0, null, 1.1, null, 0.9],
    [null, null, 2, "0W Chow", null, 1.1, null, 1.0, null, 1.0],
    [null, null, 3, "0W Chow", null, 0.9, null, 0.9, null, 1.1],
    [],
    [null, null, 11, "HFD/8W", null, 5.1, null, 1.9, null, 5.8],
    [null, null, 12, "HFD/8W", null, 4.8, null, 2.1, null, 6.1],
    [null, null, 13, "HFD/8W", null, 5.5, null, 1.7, null, 5.5]
  ])]).records);

  test("one measurement made in three tissues is offered as a comparison", () => {
    const across = suggestFigures(wide).filter((s) => s.kind === "across");
    assert.equal(across.length, 1, "expected a single cross-tissue proposal");
    assert.match(across[0].title, /CD68.*across tissues/);
    assert.equal(across[0].keys.length, 3);
  });

  test("a measurement made in two tissues is not", () => {
    const two = wide.filter((s) => s.tissue !== "Ileum");
    assert.equal(suggestFigures(two).filter((s) => s.kind === "across").length, 0);
  });
});
