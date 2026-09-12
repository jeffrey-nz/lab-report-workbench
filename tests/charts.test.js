import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseWorkbook } from "../src/lib/parse.js";
import * as A from "../src/lib/analyse.js";
import { renderFigure, groupColors, groupShapes, planEncoding, xTickPlan, metrics, DIET_COLORS }
  from "../src/lib/charts.js";
import { allSheets, denseSheet } from "./fixtures.js";

const { records } = parseWorkbook(allSheets);
const key = (sheet, tissue, analyte) => `${sheet}|${tissue || ""}|${analyte}`;
const GTT = key("Glucose Tolerance Data", "", "Blood glucose");
const WAT = key("Cytokine- Protein", "WAT", "IL-1β");

function panel(k, groups, opts) {
  const sel = A.buildSelection(records, k, groups);
  const analysis = A.analyse(sel, opts);
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

describe("labelling a crowded axis", () => {
  const m = metrics(360, 290);
  const ticks = (n, width = 2) =>
    Array.from({ length: n }, (_, i) => ({ value: i, label: String(i).padStart(width, "0") }));

  test("a handful of labels are all printed, upright", () => {
    const plan = xTickPlan(ticks(5), 280, m);
    assert.equal(plan.tilt, false);
    assert.ok(plan.show.every(Boolean));
  });

  test("two dozen labels are thinned rather than overlapped", () => {
    const plan = xTickPlan(ticks(24), 280, m);
    const shown = plan.show.filter(Boolean).length;
    assert.ok(shown < 24, "every label was printed into the same space");
    assert.ok(shown >= 4, `too few labels to read the axis: ${shown}`);
  });

  test("the range is always readable: first and last are kept", () => {
    const plan = xTickPlan(ticks(24), 280, m);
    assert.equal(plan.show[0], true, "the first label is missing");
    assert.equal(plan.show[plan.show.length - 1], true, "the last label is missing");
  });

  test("printed labels never sit closer than their own width", () => {
    const plan = xTickPlan(ticks(24), 280, m);
    const slot = 280 / 24;
    const shown = plan.show.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    const widest = 2 * m.tick * 0.58;
    for (let i = 1; i < shown.length; i++)
      assert.ok((shown[i] - shown[i - 1]) * slot >= widest,
        `labels ${shown[i - 1]} and ${shown[i]} overlap`);
  });

  test("long labels tilt rather than disappear when there are few of them", () => {
    const long = [["Normal chow"], ["High-fat diet"], ["Chow, week 10"]]
      .map(([label], i) => ({ value: i, label }));
    assert.equal(xTickPlan(long, 200, m).tilt, true);
  });
});

describe("what carries what", () => {
  const barPanels = [panel(WAT, ["NCD 0W", "HFD 2W", "HFD 4W"])];

  test("duration goes on the axis and diet into the colour", () => {
    const enc = planEncoding(barPanels, records);
    assert.equal(enc.grouped, true);
    assert.equal(enc.legend, "diets");
    assert.deepEqual(enc.diets, ["NCD", "HFD"], "control diet comes first");
  });

  test("the x-axis is labelled with the weeks, not with long group names", () => {
    const svg = renderFigure(barPanels, { cols: 1, records });
    for (const week of ["0", "2", "4"]) assert.ok(svg.includes(`>${week}<`), `week ${week} missing`);
    assert.ok(!svg.includes("chow 0W"), "a group label leaked onto the axis");
  });

  test("a key that would only repeat the axis is left off", () => {
    const svg = renderFigure(barPanels, { cols: 1, records });
    assert.ok(!svg.includes("HFD 2W"), "the legend repeats what the axis already says");
    assert.ok(svg.includes("High-fat diet"), "the diet key should be present");
    assert.ok(svg.includes("Normal chow"));
  });

  test("with one diet there is nothing for a key to say", () => {
    const enc = planEncoding([panel(WAT, ["HFD 2W", "HFD 4W"])], records);
    assert.equal(enc.legend, "none");
    const svg = renderFigure([panel(WAT, ["HFD 2W", "HFD 4W"])], { cols: 1, records });
    assert.ok(!svg.includes("High-fat diet"), "no key is needed here");
  });

  test("a time course keeps a key, because the axis is time", () => {
    const enc = planEncoding([panel(GTT, ["NCD 0W", "HFD 10W"])], records);
    assert.equal(enc.grouped, false);
    assert.equal(enc.legend, "groups");
  });

  test("two diets at one duration sit side by side, not on top of each other", () => {
    const svg = renderFigure([panel(WAT, ["NCD 0W", "HFD 2W"])], { cols: 1, records });
    const bars = [...svg.matchAll(/<rect x="([\d.]+)"[^>]*fill-opacity="0\.16"/g)]
      .map((m) => Number(m[1]));
    assert.equal(new Set(bars).size, bars.length, "two bars share an x position");
  });
});

describe("marking significance without crowding", () => {
  const dense = parseWorkbook([denseSheet]).records;
  const densePanel = () => {
    const key = "Dense Weight||Body weight";
    const sel = A.buildSelection(dense, key, ["NCD", "HFD"]);
    return { key, sel, analysis: A.analyse(sel),
             labels: { x: A.xAxisLabel(sel), y: A.axisLabel(sel) } };
  };
  const stars = (svg) => (svg.match(/>\*+</g) || []).length;

  test("a long sustained run is marked once, spanned by a rule", () => {
    const p = densePanel();
    const significant = p.analysis.posthoc.filter((c) => c.p < 0.05).length;
    assert.ok(significant > 8, `the fixture should be significant throughout, got ${significant}`);
    const svg = renderFigure([p], { cols: 1, records: dense });
    assert.ok(stars(svg) <= 2, `${stars(svg)} separate marks on one sustained run`);
    assertWellFormed(svg);
    assertNoBadNumbers(svg);
  });

  test("a run reports its weakest result, never overstating it", () => {
    const p = densePanel();
    const weakest = Math.max(...p.analysis.posthoc.filter((c) => c.p < 0.05).map((c) => c.p));
    const svg = renderFigure([p], { cols: 1, records: dense });
    const shown = (svg.match(/>(\*+)</) || [])[1];
    const expected = "*".repeat(weakest < 0.0001 ? 4 : weakest < 0.001 ? 3 : weakest < 0.01 ? 2 : 1);
    assert.equal(shown, expected, "the mark should match the weakest point in the run");
  });

  test("with room to spare, every significant point keeps its own mark", () => {
    const p = panel(GTT, ["NCD 0W", "HFD 10W"]);
    const significant = p.analysis.posthoc.filter((c) => c.p < 0.05).length;
    const svg = renderFigure([p], { cols: 1, records, panelW: 430, panelH: 340 });
    assert.equal(stars(svg), significant,
      "short courses should not be collapsed — it hides strong effects");
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

  test("a time course names every line in the legend", () => {
    const svg = renderFigure([panel(GTT, ["NCD 0W", "HFD 10W"])], { cols: 1, records });
    for (const g of ["NCD 0W", "HFD 10W"]) assert.ok(svg.includes(g), `${g} missing from the legend`);
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

  test("the spread drawn follows the choice of error bar", () => {
    const withSem = renderFigure([panel(WAT, ["NCD 0W", "HFD 2W"], { errorBars: "sem" })], { cols: 1, records });
    const withSd = renderFigure([panel(WAT, ["NCD 0W", "HFD 2W"], { errorBars: "sd" })], { cols: 1, records });
    assert.notEqual(withSem, withSd, "SD bars must be drawn longer than SEM bars");
    assertNoBadNumbers(withSd);
  });

  test("the individual animals can be left off", () => {
    const shown = renderFigure([panel(WAT, ["NCD 0W", "HFD 2W"])], { cols: 1, records, showPoints: true });
    const hidden = renderFigure([panel(WAT, ["NCD 0W", "HFD 2W"])], { cols: 1, records, showPoints: false });
    const circles = (svg) => (svg.match(/<circle/g) || []).length;
    assert.ok(circles(shown) > circles(hidden), "points were not removed");
    assertWellFormed(hidden);
  });

  test("every group in the figure keeps one colour across its panels", () => {
    const panels = [panel(WAT, ["NCD 0W", "HFD 2W"]), panel(WAT, ["NCD 0W", "HFD 4W"])];
    const svg = renderFigure(panels, { cols: 2, records });
    assertWellFormed(svg);
    assertNoBadNumbers(svg);
  });
});
