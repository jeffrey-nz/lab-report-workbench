/* exports.js — everything that leaves the app as a file. */

import { state, figureNumber, allFigures } from "./state.js";
import { svgToPng } from "./lib/charts.js";
import { statsSentence, draftLegend, draftResults } from "./lib/analyse.js";
import { seriesNames, panelFullName } from "./labels.js";
import { stars } from "./lib/stats.js";
import { toast } from "./dom.js";

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const csv = (rows) => rows.map((row) => row.map((cell) => {
  const s = cell === null || cell === undefined ? "" : String(cell);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}).join(",")).join("\n");

const textBlob = (s, type = "text/plain") => new Blob([s], { type: `${type};charset=utf-8` });

/* ---------- the figure ---------- */

export async function saveFigurePng() {
  if (!state.svg) return toast("Choose at least one measurement first.");
  try {
    download(await svgToPng(state.svg, 300), `figure-${figureNumber()}.png`);
    toast("Saved as a 300 dpi PNG");
  } catch {
    toast("The figure could not be converted to PNG.");
  }
}

export async function copyFigure() {
  if (!state.svg) return;
  try {
    const blob = await svgToPng(state.svg, 300);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    toast("Copied — paste straight into your report");
  } catch {
    toast("This browser will not let a page copy images. Use Download instead.");
  }
}

export function saveFigureSvg() {
  if (!state.svg) return;
  download(textBlob(state.svg, "image/svg+xml"), `figure-${figureNumber()}.svg`);
  toast("Saved as vector SVG");
}

/* ---------- the data ---------- */

export function tidyRows() {
  const head = ["sheet", "tissue", "measurement", "unit", "group", "diet", "weeks_on_diet",
                "animal", "time", "time_unit", "value", "excluded", "note"];
  const rows = state.records.map((r) => [r.sheet, r.tissue, r.analyte, r.unit, r.groupLabel,
    r.diet, r.weeks, r.subject, r.x, r.xUnit, r.value, r.excluded ? "yes" : "", r.note]);
  return [head, ...rows];
}

export function saveTidyCsv() {
  download(textBlob(csv(tidyRows()), "text/csv"), "tidy-data.csv");
  toast("Tidy data saved");
}

/** One column per group, one row per animal — the shape Prism pastes into. */
export function prismRows() {
  const out = [];
  for (const p of state.panels) {
    const sel = p.sel;
    out.push([[sel.tissue, sel.analyte].filter(Boolean).join(" ") +
              (sel.unit ? ` (${sel.unit})` : "")]);
    for (const lv of sel.levels) {
      if (sel.hasTime) out.push([`time = ${lv}${sel.xUnit ? " " + sel.xUnit : ""}`]);
      out.push(sel.groups);
      const cols = sel.groups.map((g) => sel.subjectsBy.get(g)
        .map((s) => sel.cell.get(`${g}|${s}|${lv}`))
        .filter((v) => typeof v === "number"));
      const depth = Math.max(0, ...cols.map((c) => c.length));
      for (let i = 0; i < depth; i++) out.push(cols.map((c) => c[i] ?? ""));
      out.push([]);
    }
  }
  return out;
}

export function savePrismCsv() {
  const rows = prismRows();
  if (!rows.length) return toast("Choose at least one measurement first.");
  download(textBlob(csv(rows), "text/csv"), "prism-table.csv");
  toast("Prism table saved");
}

/* ---------- the statistics ---------- */

export function statsRows() {
  const rows = [["figure", "panel", "measurement", "test", "source",
                 "df", "df_error", "F_or_t", "p", "stars"]];
  const names = seriesNames();
  for (const { number, panels } of allFigures()) {
    panels.forEach((p, i) => {
      const a = p.analysis;
      const letter = String.fromCharCode(65 + i);
      const where = [number, letter, panelFullName(p, names)];
      if (!a?.ok) { rows.push([...where, "not run", a?.reason || ""]); return; }
      const m = a.model;
      if (a.kind === "two-group") {
        rows.push([...where, m.test, "between groups", m.df.toFixed(2), "",
                   m.t.toFixed(4), m.p.toExponential(3), stars(m.p)]);
      } else if (a.kind === "one-way") {
        rows.push([...where, m.test, "between groups", m.df1, m.df2,
                   m.F.toFixed(4), m.p.toExponential(3), stars(m.p)]);
      } else {
        for (const key of ["between", "within", "interaction"]) {
          const e = m.effects[key];
          rows.push([...where, m.test, e.name, e.df, e.dfError,
                     e.F.toFixed(4), e.p.toExponential(3), stars(e.p)]);
        }
      }
      for (const c of a.posthoc || [])
        rows.push([...where, "Šídák multiple comparisons", c.label,
                   c.df, "", c.t.toFixed(4), c.p.toExponential(3), c.stars]);
    });
  }
  return rows;
}

export function saveStatsCsv() {
  if (!state.panels.length) return toast("Choose at least one measurement first.");
  download(textBlob(csv(statsRows()), "text/csv"), "report-statistics.csv");
  toast("Statistics for every figure saved");
}

/* ---------- the drafted text ---------- */

export function draftText(key, fallback) {
  return state.edits[key] ?? fallback;
}

export function draftBundle() {
  const lines = [];
  for (const { fig, number, panels } of allFigures()) {
    const legend = draftText(`legend:${fig.id}`, draftLegend(panels, number));
    const results = draftText(`results:${fig.id}`, draftResults(panels, number));
    lines.push(`FIGURE ${number} LEGEND`, "", legend, "",
               `FIGURE ${number} — RESULTS PARAGRAPH`, "", results, "",
               `FIGURE ${number} — STATISTICS`, "");
    panels.forEach((p, i) => {
      if (p.analysis?.ok)
        lines.push(`(${String.fromCharCode(65 + i)}) ${statsSentence(p.analysis)}`);
    });
    lines.push("", "—".repeat(60), "");
  }
  lines.push("Drafted by Lab Report Workbench from your own data.",
             "Rewrite this in your own words before submitting.");
  return lines.join("\n");
}

export function saveDrafts() {
  if (!state.panels.length) return toast("Build a figure first.");
  download(textBlob(draftBundle(), "text/markdown"), `report-draft.md`);
  toast("Draft saved");
}

/* ---------- everything at once ---------- */

/** Every figure in the report, plus one statistics file and one draft. */
export async function saveEverything() {
  const figures = allFigures().filter((f) => f.svg);
  if (!figures.length) return toast("Build a figure first.");
  for (const { number, svg } of figures) {
    try {
      download(await svgToPng(svg, 300), `figure-${number}.png`);
    } catch {
      toast(`Figure ${number} could not be converted to PNG.`);
    }
  }
  saveStatsCsv();
  saveDrafts();
  savePrismCsv();
  toast(`${figures.length} figure${figures.length > 1 ? "s" : ""}, statistics, draft and Prism table saved`);
}
