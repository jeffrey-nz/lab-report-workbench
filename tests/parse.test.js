import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseWorkbook, readGroupLabel, seriesIndex } from "../src/lib/parse.js";
import { allSheets, sheet, cytokineSheet, gttSheet, bodyWeightSheet, typoSheet } from "./fixtures.js";

const parsed = parseWorkbook(allSheets);
const issueOf = (kind, sheetName) =>
  parsed.issues.filter((i) => i.kind === kind && (!sheetName || i.sheet === sheetName));
const valuesFor = (pred) => parsed.records.filter(pred);

describe("group labels", () => {
  test("reads the diet and the weeks from the shapes the sheets use", () => {
    assert.deepEqual(readGroupLabel("HFD/2W"), { diet: "HFD", weeks: 2, raw: "HFD/2W" });
    assert.deepEqual(readGroupLabel("10W chow"), { diet: "NCD", weeks: 10, raw: "10W chow" });
    assert.equal(readGroupLabel("EXPERIMENTAL  GROUP (5 WEEKS HFD)").diet, "HFD");
    assert.equal(readGroupLabel("EXPERIMENTAL  GROUP (5 WEEKS HFD)").weeks, 5);
    assert.equal(readGroupLabel("CONTROL GROUP (week 0)").diet, "NCD");
    assert.equal(readGroupLabel("Start -HFD").diet, "HFD");
  });

  test("a week-zero block with no diet word is the chow baseline", () => {
    assert.equal(readGroupLabel("0W").diet, "NCD");
    assert.equal(readGroupLabel("0W Chow").diet, "NCD");
  });

  test("an empty label yields nothing rather than guessing", () => {
    assert.deepEqual(readGroupLabel(""), { diet: null, weeks: null, raw: "" });
    assert.deepEqual(readGroupLabel(null), { diet: null, weeks: null, raw: "" });
  });
});

describe("finding the data in a sheet", () => {
  test("reads animal rows and skips the sheet's own summary rows", () => {
    const wat = valuesFor((r) => r.tissue === "WAT" && r.analyte === "IL-1β");
    assert.equal(wat.length, 9, "three animals in each of three blocks");
    assert.ok(!wat.some((r) => r.value === 5.07), "the Avg row must not become an animal");
  });

  test("carries the tissue band across the columns it spans", () => {
    const tissues = new Set(valuesFor((r) => r.sheet === "Cytokine- Protein").map((r) => r.tissue));
    assert.deepEqual([...tissues].sort(), ["Liver", "WAT"]);
  });

  test("normalises analyte names and keeps the unit", () => {
    const one = valuesFor((r) => r.tissue === "Liver")[0];
    assert.equal(one.analyte, "IL-1β");
    assert.equal(one.unit, "ng per mg tissue");
  });

  test("a sheet with no ID column yields nothing and does not throw", () => {
    const blank = sheet("Notes", [["some prose"], [null, "and more"]]);
    const out = parseWorkbook([blank]);
    assert.equal(out.records.length, 0);
    assert.equal(out.tables.length, 0);
  });

  test("an empty workbook is handled", () => {
    const out = parseWorkbook([]);
    assert.deepEqual(out.records, []);
    assert.deepEqual(out.tables, []);
  });
});

describe("time courses", () => {
  test("reads time levels from the column headers", () => {
    const gtt = valuesFor((r) => r.analyte === "Blood glucose");
    assert.deepEqual([...new Set(gtt.map((r) => r.x))].sort((a, b) => a - b), [0, 30, 60, 120]);
    assert.equal(gtt[0].xUnit, "min");
  });

  test("reads time levels from a band row when the headers repeat", () => {
    const bw = valuesFor((r) => r.sheet === "Body Weight");
    const xs = [...new Set(bw.map((r) => r.x))].sort((a, b) => a - b);
    assert.deepEqual(xs, [-4, 0, 4, 7, 11, 14, 18]);
    assert.equal(bw[0].xUnit, "day");
  });

  test("says so when it had to extrapolate the leading time points", () => {
    const flagged = issueOf("inferred-time", "Body Weight");
    assert.equal(flagged.length, 1);
    assert.match(flagged[0].detail, /-4, 0/);
    assert.equal(flagged[0].severity, "info");
  });

  test("a covariate column is a measurement, not a time level", () => {
    const bw = valuesFor((r) => r.sheet === "Glucose Tolerance Data" && r.analyte === "Body weight");
    assert.ok(bw.length > 0, "BW (g) should survive as its own measurement");
    assert.equal(bw[0].x, null);
  });
});

describe("data quality", () => {
  test("a spreadsheet error is reported and its value dropped", () => {
    const flagged = issueOf("bad-cell").filter((i) => /#VALUE/.test(i.detail));
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0].severity, "warn");
    const liver = valuesFor((r) => r.tissue === "Liver" && r.analyte === "IL-1β" && r.subject === 12);
    assert.equal(liver.length, 0, "the failed assay must not become a number");
  });

  test("a malformed number is reported, never coerced", () => {
    const flagged = issueOf("bad-cell").filter((i) => /0\.1\.0/.test(i.detail));
    assert.equal(flagged.length, 1);
    const ileum = valuesFor((r) => r.tissue === "Ileum" && r.subject === 2);
    assert.equal(ileum.length, 0);
  });

  test("a row the sheet marks unusable is excluded and reported", () => {
    const flagged = issueOf("excluded");
    assert.equal(flagged.length, 1);
    assert.match(flagged[0].where, /Animal 13/);
    const rows = valuesFor((r) => r.subject === 13 && r.sheet === "Cytokine- Protein");
    assert.ok(rows.length > 0, "the row is kept in the data");
    assert.ok(rows.every((r) => r.excluded), "but every value is marked excluded");
  });

  test("a group label missing its diet is read from the block around it", () => {
    const flagged = issueOf("label");
    assert.equal(flagged.length, 1);
    assert.match(flagged[0].detail, /"4W".*HFD 4W/);
    const animal = valuesFor((r) => r.subject === 23)[0];
    assert.equal(animal.groupLabel, "HFD 4W");
    assert.equal(animal.diet, "HFD");
  });
});

describe("auditing the workbook's own summary cells", () => {
  test("catches an Avg that disagrees with the animals above it", () => {
    const flagged = issueOf("stat-mismatch", "Glucose Tolerance Data");
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0].severity, "error");
    assert.match(flagged[0].detail, /99\.00/);
    assert.match(flagged[0].detail, /18\.39/);   // the real mean of that column
  });

  test("does not cry wolf on a correct Avg", () => {
    assert.equal(issueOf("stat-mismatch", "Cytokine- Protein").length, 0);
  });

  test("does not sweep in the numeric band rows above a header", () => {
    // the control block's own Avg row is correct; a scan that ran past the
    // header would pick up the "0 30 60 120" band and report a false mismatch
    const detail = issueOf("stat-mismatch", "Glucose Tolerance Data")[0].detail;
    assert.ok(!/6\.16/.test(detail), "the correct control Avg was flagged");
  });
});

describe("the series index", () => {
  const index = seriesIndex(parsed.records);

  test("one entry per sheet, tissue and measurement", () => {
    const keys = index.map((s) => s.key);
    assert.equal(new Set(keys).size, keys.length, "keys must be unique");
  });

  test("excluded animals do not inflate a series", () => {
    const wat = index.find((s) => s.tissue === "WAT" && s.analyte === "IL-1β");
    assert.equal(wat.n, 8, "nine rows, one of them excluded");
  });

  test("carries the shape the figure builder needs", () => {
    const gtt = index.find((s) => s.analyte === "Blood glucose");
    assert.equal(gtt.hasTime, true);
    assert.deepEqual(gtt.groups.sort(), ["HFD 10W", "NCD 0W"]);
    const wat = index.find((s) => s.tissue === "WAT" && s.analyte === "IL-6");
    assert.equal(wat.hasTime, false);
  });
});
