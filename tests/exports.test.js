import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { parseWorkbook, seriesIndex } from "../src/lib/parse.js";
import { state, loadRecords, setSeries, setGroups, setFigureOption, addFigure,
         switchFigure, removeFigure, buildReport, suggestions, allFigures,
         figureNumber, layoutThatFits, figureExtent, A4_TEXT_MM, SIZES } from "../src/state.js";
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

  test("names the figure, the panel, the test and the source of every line", () => {
    assert.deepEqual(rows[0].slice(0, 5),
      ["figure", "panel", "measurement", "test", "source"]);
    assert.ok(rows.length > 1);
    assert.equal(rows[1][0], 1, "the first line belongs to figure 1");
    assert.equal(rows[1][1], "A");
  });

  test("carries degrees of freedom for every test line", () => {
    for (const r of rows.slice(1)) {
      if (/multiple comparisons/.test(r[3]) || /ANOVA|t-test/.test(r[3]))
        assert.ok(String(r[5]).length > 0, `missing df: ${r.join(" | ")}`);
    }
  });

  test("reports the multiple comparisons after the overall test", () => {
    const overall = rows.findIndex((r) => /ANOVA|t-test/.test(r[3]));
    const posthoc = rows.findIndex((r) => /multiple comparisons/.test(r[3]));
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
    assert.match(text, /STATISTICS/);
  });

  test("says plainly that it needs rewriting", () => {
    assert.match(text, /Rewrite this in your own words/);
  });

  test("contains no placeholder values", () => {
    assert.doesNotMatch(text, /\bundefined\b|\bNaN\b|\bnull\b/);
  });

  test("prefers an edited draft over the generated one", () => {
    state.edits[`legend:${state.activeId}`] = "My own wording.";
    assert.match(draftBundle(), /My own wording\./);
    delete state.edits[`legend:${state.activeId}`];
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

describe("a report made of several figures", () => {
  test("loading a workbook starts one figure", () => {
    assert.equal(state.figures.length, 1);
    assert.equal(figureNumber(), 1);
  });

  test("adding a figure switches to it and leaves the first intact", () => {
    const first = state.activeId;
    const firstPanels = [...state.chosen];
    const added = addFigure();
    assert.equal(state.activeId, added.id);
    assert.equal(figureNumber(), 2);
    switchFigure(first);
    assert.deepEqual(state.chosen, firstPanels, "the first figure was disturbed");
  });

  test("each figure keeps its own panels and options", () => {
    const a = state.activeId;
    setFigureOption({ cols: 3, errorBars: "sd" });
    const b = addFigure();
    setFigureOption({ cols: 1, errorBars: "sem" });
    switchFigure(a);
    assert.equal(state.cols, 3);
    assert.equal(state.errorBars, "sd");
    switchFigure(b.id);
    assert.equal(state.cols, 1);
    assert.equal(state.errorBars, "sem");
  });

  test("removing a figure keeps at least one", () => {
    while (state.figures.length > 1) removeFigure(state.figures[state.figures.length - 1].id);
    removeFigure(state.activeId);
    assert.equal(state.figures.length, 1, "the last figure must not be removable");
  });

  test("nothing untestable is ever suggested", () => {
    const lonely = state.series.filter((s) => s.groups.length < 2);
    assert.ok(lonely.length > 0, "the fixtures should contain a single-group measurement");
    const suggested = new Set(suggestions().flatMap((s) => s.keys));
    for (const s of lonely)
      assert.ok(!suggested.has(s.key), `${s.analyte} has one group and cannot be compared`);
  });

  test("building a report gives every suggestion its own figure", () => {
    const primary = suggestions().filter((s) => s.kind !== "across");
    buildReport(primary);
    assert.equal(state.figures.length, primary.length);
    const built = allFigures();
    for (const { number, panels, svg } of built) {
      assert.ok(panels.length > 0, `figure ${number} has no panels`);
      assert.match(svg, /^<svg/, `figure ${number} was not drawn`);
      for (const p of panels)
        assert.equal(p.analysis.ok, true,
          `figure ${number} panel has no usable test: ${p.analysis.reason}`);
    }
  });

  test("every figure reaches the exports", () => {
    const numbers = [...new Set(statsRows().slice(1).map((r) => r[0]))];
    assert.equal(numbers.length, state.figures.length, "a figure is missing from the statistics");
    for (let n = 1; n <= state.figures.length; n++)
      assert.match(draftBundle(), new RegExp(`FIGURE ${n} LEGEND`), `figure ${n} has no draft`);
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
