import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { parseWorkbook, seriesIndex } from "../src/lib/parse.js";
import { state, loadRecords, setSeries, setGroups, setFigureOption,
         layoutThatFits, figureExtent, A4_TEXT_MM, SIZES } from "../src/state.js";
import { csv, tidyRows, prismRows, statsRows, draftBundle } from "../src/exports.js";
import { allSheets } from "./fixtures.js";

const parsed = parseWorkbook(allSheets);

before(() => {
  loadRecords(parsed, "fixtures.xlsx");
  const wat = state.series.find((s) => s.tissue === "WAT" && s.analyte === "IL-1β");
  setSeries([wat.key]);
  setGroups(["NCD 0W", "HFD 2W", "HFD 4W"]);
});

describe("CSV encoding", () => {
  test("quotes only what needs quoting, and doubles inner quotes", () => {
    assert.equal(csv([["a", "b"]]), "a,b");
    assert.equal(csv([["a,b"]]), '"a,b"');
    assert.equal(csv([['say "hi"']]), '"say ""hi"""');
    assert.equal(csv([["line\nbreak"]]), '"line\nbreak"');
  });

  test("empty cells stay empty rather than becoming 'null'", () => {
    assert.equal(csv([[null, undefined, "", 0]]), ",,,0");
  });

  test("rows are newline separated", () => {
    assert.equal(csv([["a"], ["b"]]), "a\nb");
  });
});

describe("tidy export", () => {
  const rows = tidyRows();

  test("has a header and one row per value", () => {
    assert.deepEqual(rows[0].slice(0, 4), ["sheet", "tissue", "measurement", "unit"]);
    assert.equal(rows.length, state.records.length + 1);
  });

  test("marks the animals the sheet excluded rather than dropping them", () => {
    const excluded = rows.slice(1).filter((r) => r[11] === "yes");
    assert.ok(excluded.length > 0, "the excluded animal should still be in the export");
  });

  test("survives the CSV encoder without producing placeholders", () => {
    const text = csv(rows);
    assert.doesNotMatch(text, /\bundefined\b/);
    assert.doesNotMatch(text, /\bNaN\b/);
  });
});

describe("Prism export", () => {
  const rows = prismRows();

  test("lays out one column per group", () => {
    const header = rows.find((r) => r.includes("NCD 0W"));
    assert.ok(header, "a row naming the groups is required");
    assert.deepEqual(header, ["NCD 0W", "HFD 2W", "HFD 4W"]);
  });

  test("names the measurement and its unit first", () => {
    assert.match(rows[0][0], /WAT IL-1β/);
    assert.match(rows[0][0], /ng per mg tissue/);
  });

  test("pads short columns instead of misaligning them", () => {
    const start = rows.findIndex((r) => r.includes("NCD 0W"));
    const body = rows.slice(start + 1).filter((r) => r.length > 1);
    for (const r of body) assert.equal(r.length, 3, `ragged row: ${r}`);
  });

  test("produces nothing to trip the encoder", () => {
    assert.doesNotMatch(csv(rows), /\bundefined\b|\bNaN\b/);
  });
});

describe("statistics export", () => {
  const rows = statsRows();

  test("names the panel, the test and the source of every line", () => {
    assert.deepEqual(rows[0].slice(0, 4), ["panel", "measurement", "test", "source"]);
    assert.ok(rows.length > 1);
    assert.equal(rows[1][0], "A");
  });

  test("carries degrees of freedom for every test line", () => {
    for (const r of rows.slice(1)) {
      if (/multiple comparisons/.test(r[2]) || /ANOVA|t-test/.test(r[2]))
        assert.ok(String(r[4]).length > 0, `missing df: ${r.join(" | ")}`);
    }
  });

  test("reports the multiple comparisons after the overall test", () => {
    const overall = rows.findIndex((r) => /ANOVA|t-test/.test(r[2]));
    const posthoc = rows.findIndex((r) => /multiple comparisons/.test(r[2]));
    assert.ok(overall > 0 && posthoc > overall, "ordering must match how it is reported");
  });

  test("encodes without placeholders", () => {
    assert.doesNotMatch(csv(rows), /\bundefined\b|\bNaN\b/);
  });
});

describe("draft bundle", () => {
  const text = draftBundle();

  test("carries the legend, the results and the statistics", () => {
    assert.match(text, /FIGURE \d+ LEGEND/);
    assert.match(text, /RESULTS PARAGRAPH/);
    assert.match(text, /STATISTICS, WRITTEN OUT/);
  });

  test("says plainly that it needs rewriting", () => {
    assert.match(text, /Rewrite this in your own words/);
  });

  test("contains no placeholder values", () => {
    assert.doesNotMatch(text, /\bundefined\b|\bNaN\b|\bnull\b/);
  });

  test("prefers an edited draft over the generated one", () => {
    state.edits[`legend-${state.figNumber}`] = "My own wording.";
    assert.match(draftBundle(), /My own wording\./);
    delete state.edits[`legend-${state.figNumber}`];
  });
});

describe("fitting the printed page", () => {
  test("reports the printed size of the figure", () => {
    setSeries(state.series.filter((s) => s.tissue).slice(0, 4).map((s) => s.key));
    setFigureOption({ cols: 2, size: "comfortable" });
    const extent = figureExtent();
    assert.ok(extent, "a drawn figure should have an extent");
    assert.equal(extent.mmWide, Math.round(2 * SIZES.comfortable.w / 96 * 25.4));
  });

  test("offers a layout that genuinely fits, not merely a smaller one", () => {
    setFigureOption({ cols: 4, size: "large" });
    assert.ok(figureExtent().mmWide > A4_TEXT_MM, "the fixture should start too wide");
    const fit = layoutThatFits();
    assert.ok(fit, "a workable layout exists and should be found");
    assert.ok(fit.mmWide <= A4_TEXT_MM, `${fit.mmWide} mm still does not fit`);
    setFigureOption({ cols: fit.cols, size: fit.size });
    assert.ok(figureExtent().mmWide <= A4_TEXT_MM, "applying the suggestion must fix it");
  });

  test("keeps as many columns as will fit rather than jumping to one", () => {
    setFigureOption({ cols: 3, size: "large" });
    const fit = layoutThatFits();
    assert.ok(fit.cols >= 2, `dropped to ${fit.cols} column(s) when 2 would fit`);
  });

  test("a single comfortable panel is already within the page", () => {
    setSeries([state.series[0].key]);
    setFigureOption({ cols: 1, size: "comfortable" });
    assert.ok(figureExtent().mmWide <= A4_TEXT_MM);
  });
});

describe("state consistency", () => {
  test("a selection always leaves each panel something to compare", () => {
    const two = state.series.filter((s) => s.analyte === "Body weight").map((s) => s.key);
    setSeries(two);
    for (const p of state.panels)
      assert.equal(p.analysis.ok, true, `${p.key} has no usable test after selection`);
  });

  test("the figure is redrawn whenever the selection changes", () => {
    const wat = state.series.find((s) => s.tissue === "WAT" && s.analyte === "IL-6");
    setSeries([wat.key]);
    assert.equal(state.panels.length, 1);
    assert.match(state.svg, /^<svg/);
  });
});
