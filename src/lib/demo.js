/* demo.js — a synthetic workbook in the same shape as a course data sheet, so the
   app opens in a working state without carrying anyone's real study data. The
   numbers are generated here; they describe no actual experiment. The quirks are
   deliberate: they are the ones the data-check step exists to catch. */

const rng = (seed) => () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const r = rng(20260912);
const jitter = (m, sd) => +(m + (r() + r() + r() - 1.5) * 2 * sd).toFixed(2);

function pad(grid) {
  const w = grid.reduce((m, row) => Math.max(m, row.length), 0);
  return { grid: grid.map((row) => [...row, ...Array(w - row.length).fill(null)]), width: w };
}

function bodyWeightSheet() {
  const days = [0, 4, 7, 11, 14, 18, 21, 25, 28, 32, 35, 39, 42];
  const g = [
    ["BODY WEIGHT DATA (synthetic)"],
    [],
    [null, null, "TIME In Days", null, ...days],
    [null, "Animal ID", "Diet", null, ...days.map(() => "BW (g)")],
    [null, "Control"]
  ];
  const mk = (id, diet, start, gain) => [null, id, diet, null,
    ...days.map((d) => jitter(start + gain * d, 0.7))];
  for (let i = 1; i <= 8; i++) g.push(mk(i, "NCD", 24 + r() * 4, 0.055));
  g.push([null, null, "HF DIET group"]);
  for (let i = 9; i <= 20; i++) g.push(mk(i, "HFD", 24 + r() * 4, 0.155));
  return { name: "Body Weight", merges: [], ...pad(g) };
}

function toleranceSheet(name, times, shape) {
  const g = [[`${name.toUpperCase()} (synthetic)`], []];
  const block = (title, ids, scale) => {
    g.push([null, title]);
    g.push([null, null, null, null, ...times]);
    g.push([null, "Mouse ID", "BW (g)", "Diet", ...times.map((t) => `${t}m`)]);
    const rows = ids.map((id) => {
      const row = [null, id, jitter(30 * scale, 3), scale > 1 ? "HFD" : "NCD",
        ...times.map((t, i) => jitter(shape[i] * scale, shape[i] * 0.09))];
      g.push(row);
      return row;
    });
    // the workbook's own summary row — deliberately computed over the wrong range
    const avg = times.map((_, i) => {
      const vals = rows.map((row) => row[4 + i]);
      const wrong = i === 2 ? vals.slice(0, 3) : vals;      // the planted mistake
      return +(wrong.reduce((a, b) => a + b, 0) / wrong.length).toFixed(3);
    });
    g.push([null, null, null, "Avg", ...avg]);
    g.push([]);
  };
  block("CONTROL GROUP (week 0)", [1, 2, 3, 4, 5, 6], 1);
  block("EXPERIMENTAL GROUP (5 WEEKS HFD)", [9, 10, 11, 12, 13, 14], 1.35);
  block("EXPERIMENTAL GROUP (10 WEEKS HFD)", [9, 10, 11, 12, 13, 14], 1.6);
  return { name, merges: [], ...pad(g) };
}

function cytokineSheet() {
  const g = [
    ["The following tissues were analysed for cytokine protein levels (synthetic)"],
    [],
    [null, null, null, null, null, "WHITE ADIPOSE TISSUE", null, null, null, "LIVER"],
    [null, null, null, null, null, "ng per mg  tissue", null, null, null, "ng per mg  tissue"],
    [null, null, "ANIMAL ID", "DIET/time", null, "IL1b", "TNFa", "IL6", null, "IL1b", "TNFa", "IL6"]
  ];
  const blocks = [
    ["0W Chow", [1, 2, 3, 4, 5], 1, 1],
    ["HFD/2W", [11, 12, 13, 14, 15], 1.1, 1.5],
    ["HFD/4W", [21, 22, 23, 24, 25], 1.25, 2.3],
    ["HFD/6W", [31, 32, 33, 34, 35], 1.4, 3.1],
    ["HFD/8W", [41, 42, 43, 44, 45], 1.3, 2.6],
    ["HFD/10W", [51, 52, 53, 54, 55], 1.2, 2.1]
  ];
  for (const [label, ids, wat, liver] of blocks) {
    ids.forEach((id, k) => {
      // one animal in the last block is labelled with the week only, as happens
      const lbl = label === "HFD/10W" && k === 4 ? "10W" : label;
      const row = [null, null, id, lbl, null,
        jitter(5.4 * wat, 0.9), jitter(3.2 * wat, 0.6), jitter(0.3 * wat, 0.05), null,
        jitter(7.1 * liver, 1.4), jitter(2.7 * liver, 0.5), jitter(0.27 * liver, 0.05)];
      if (label === "HFD/4W" && k === 2) row[10] = "#VALUE!";   // a failed assay
      if (label === "HFD/6W" && k === 0) row.push("don't use — haemolysed");
      g.push(row);
    });
    g.push([]);
  }
  return { name: "Cytokine- Protein", merges: [], ...pad(g) };
}

export function demoWorkbook() {
  return [
    bodyWeightSheet(),
    toleranceSheet("Glucose Tolerance Data", [0, 30, 60, 120], [5.8, 24.5, 13.0, 6.6]),
    toleranceSheet("Insulin Tolerance Data", [0, 15, 30, 60, 120], [7.4, 5.2, 3.8, 5.5, 7.6]),
    cytokineSheet()
  ];
}
