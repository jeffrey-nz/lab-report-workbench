import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseWorkbook } from "../src/lib/parse.js";
import * as A from "../src/lib/analyse.js";
import { renderFigure, groupColors, groupShapes, DIET_COLORS } from "../src/lib/charts.js";
import { allSheets } from "./fixtures.js";

const { records } = parseWorkbook(allSheets);
const key = (sheet, tissue, analyte) => `${sheet}|${tissue || ""}|${analyte}`;
const GTT = key("Glucose Tolerance Data", "", "Blood glucose");
const WAT = key("Cytokine- Protein", "WAT", "IL-1β");

function panel(k, groups) {
  const sel = A.buildSelection(records, k, groups);
  const analysis = A.analyse(sel);
  return { key: k, sel, analysis, labels: { x: A.xAxisLabel(sel), y: A.axisLabel(sel) } };
}

/** Every tag opens and closes in order, and no attribute is left unquoted. */
function assertWellFormed(svg) {
  assert.match(svg, /^<svg[^>]*>/);
  assert.match(svg, /<\/svg>$/);
  const stack = [];
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, name, attrs, selfClose] = m;
    if (closing) {
      assert.equal(stack.pop(), name, `mismatched </${name}>`);
    } else if (!selfClose) {
      stack.push(name);
    }
    for (const a of attrs.matchAll(/([\w:-]+)=/g)) {
      const after = attrs.slice(attrs.indexOf(a[0]) + a[0].length);
      assert.ok(after.startsWith('"'), `unquoted attribute ${a[1]} in <${name}>`);
    }
  }
  assert.equal(stack.length, 0, `unclosed tags: ${stack.join(", ")}`);
}

/** Rough relative luminance, enough to order two steps of one hue. */
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const NUMERIC_ATTRS = /\b(?:x|y|x1|y1|x2|y2|cx|cy|r|width|height|font-size|stroke-width)="([^"]*)"/g;

function assertNoBadNumbers(svg) {
  assert.doesNotMatch(svg, /NaN|undefined|Infinity/, "the figure contains a non-number");
  for (const m of svg.matchAll(NUMERIC_ATTRS))
    assert.ok(/^-?\d+(\.\d+)?$/.test(m[1]), `non-numeric attribute value: ${m[0]}`);
  for (const m of svg.matchAll(/\bd="([^"]*)"/g))
    assert.doesNotMatch(m[1], /NaN|undefined/, `bad path data: ${m[0].slice(0, 60)}`);
  for (const m of svg.matchAll(/\bpoints="([^"]*)"/g))
    assert.doesNotMatch(m[1], /NaN|undefined/, `bad polygon points`);
}

describe("colour and shape assignment", () => {
  test("two diets take the two validated categorical slots", () => {
    const colors = groupColors(["NCD", "HFD"], records);
    assert.equal(colors.NCD, DIET_COLORS.NCD);
    assert.equal(colors.HFD, DIET_COLORS.HFD);
  });

  test("durations of one diet step through a single hue in time order", () => {
    const groups = ["NCD 0W", "HFD 2W", "HFD 4W"];
    const colors = groupColors(groups, records);
    assert.equal(new Set(Object.values(colors)).size, 3, "every group needs its own step");
    assert.notEqual(colors["HFD 2W"], colors["HFD 4W"]);
  });

  test("a colour follows the group, not its position in the selection", () => {
    const wide = groupColors(["NCD 0W", "HFD 2W", "HFD 4W"], records);
    const same = groupColors(["HFD 4W", "HFD 2W", "NCD 0W"], records);
    assert.deepEqual(wide, same, "reordering must not repaint the groups");
  });

  test("a label absent from the data is still ordered by what it says", () => {
    // "HFD 10W" never appears in these fixtures, so its week has to be read
    // off the label; otherwise it sorts as week 0 and takes the lighter step
    const colors = groupColors(["HFD 10W", "HFD 2W"], records);
    assert.equal(new Set(Object.values(colors)).size, 2);
    assert.ok(luminance(colors["HFD 10W"]) < luminance(colors["HFD 2W"]),
      `10W (${colors["HFD 10W"]}) should be the darker step, not ${colors["HFD 2W"]}`);
  });

  test("longer on the diet is always the darker step", () => {
    const colors = groupColors(["HFD 2W", "HFD 4W"], records);
    assert.ok(luminance(colors["HFD 4W"]) < luminance(colors["HFD 2W"]));
  });

  test("every group gets a distinct marker shape, so greyscale still reads", () => {
    const shapes = groupShapes(["a", "b", "c", "d"]);
    assert.equal(new Set(Object.values(shapes)).size, 4);
  });
});

describe("rendering a figure", () => {
  test("a time course produces well-formed SVG with sound numbers", () => {
    const svg = renderFigure([panel(GTT, ["NCD 0W", "HFD 10W"])], { cols: 1, records });
    assertWellFormed(svg);
    assertNoBadNumbers(svg);
  });

  test("grouped columns produce well-formed SVG with sound numbers", () => {
    const svg = renderFigure([panel(WAT, ["NCD 0W", "HFD 2W", "HFD 4W"])], { cols: 1, records });
    assertWellFormed(svg);
    assertNoBadNumbers(svg);
  });

  test("a multi-panel figure is one SVG with one panel letter each", () => {
    const panels = [panel(GTT, ["NCD 0W", "HFD 10W"]), panel(WAT, ["NCD 0W", "HFD 2W", "HFD 4W"])];
    const svg = renderFigure(panels, { cols: 2, records });
    assertWellFormed(svg);
    assert.equal((svg.match(/<svg/g) || []).length, 1, "panels must share one image");
    assert.match(svg, />A</);
    assert.match(svg, />B</);
    assert.doesNotMatch(svg, />C</);
  });

  test("the canvas grows with the number of rows", () => {
    const p = panel(WAT, ["NCD 0W", "HFD 2W"]);
    const one = renderFigure([p], { cols: 1, records });
    const four = renderFigure([p, p, p, p], { cols: 2, records });
    const h = (svg) => Number(svg.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/)[1]);
    assert.ok(h(four) > h(one), "two rows must be taller than one");
  });

  test("a panel with no valid test explains itself instead of drawing nothing", () => {
    const svg = renderFigure([panel(WAT, ["NCD 0W"])], { cols: 1, records });
    assertWellFormed(svg);
    assert.match(svg, /at least two groups/);
  });

  test("axis labels and group names are escaped", () => {
    const p = panel(WAT, ["NCD 0W", "HFD 2W"]);
    p.labels = { x: "x <script>", y: 'y & "z"' };
    const svg = renderFigure([p], { cols: 1, records });
    assertWellFormed(svg);
    assert.ok(!svg.includes("<script>"), "markup in a label must not reach the output");
    assert.match(svg, /&lt;script&gt;/);
    assert.match(svg, /&amp;/);
  });

  test("a legend names every group present", () => {
    const svg = renderFigure([panel(WAT, ["NCD 0W", "HFD 2W", "HFD 4W"])], { cols: 1, records });
    for (const g of ["NCD 0W", "HFD 2W", "HFD 4W"]) assert.ok(svg.includes(g), `${g} missing`);
  });

  test("the figure is painted on white, whatever theme the app is in", () => {
    const svg = renderFigure([panel(WAT, ["NCD 0W", "HFD 2W"])], { cols: 1, records });
    assert.match(svg, /<rect width="\d+" height="\d+" fill="#ffffff"\/>/);
  });

  test("no panels at all still yields a valid image", () => {
    const svg = renderFigure([], { cols: 1, records });
    assertWellFormed(svg);
    assertNoBadNumbers(svg);
  });

  test("every group in the figure keeps one colour across its panels", () => {
    const panels = [panel(WAT, ["NCD 0W", "HFD 2W"]), panel(WAT, ["NCD 0W", "HFD 4W"])];
    const svg = renderFigure(panels, { cols: 2, records });
    assertWellFormed(svg);
    assertNoBadNumbers(svg);
  });
});
