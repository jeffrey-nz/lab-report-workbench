/* exports.js — everything that leaves the app as a file. */

import { state, figureNumber, allFigures } from "./state.js";
import { svgToPng } from "./lib/charts.js";
import { statsSentence, draftLegend, draftResults } from "./lib/analyse.js";
import { seriesNames, panelFullName } from "./labels.js";
import { stars } from "./lib/stats.js";
import { t } from "./i18n/index.js";
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
  if (!state.svg) return toast(t("msg.chooseFirst"));
  try {
    download(await svgToPng(state.svg, 300), `figure-${figureNumber()}.png`);
    toast(t("msg.pngSaved"));
  } catch {
    toast(t("msg.pngFailed"));
  }
}

export async function copyFigure() {
  if (!state.svg) return;
  try {
    const blob = await svgToPng(state.svg, 300);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    toast(t("msg.imageCopied"));
  } catch {
    toast(t("msg.imageCopyBlocked"));
  }
}

export function saveFigureSvg() {
  if (!state.svg) return;
  download(textBlob(state.svg, "image/svg+xml"), `figure-${figureNumber()}.svg`);
  toast(t("msg.svgSaved"));
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
  toast(t("msg.tidySaved"));
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
  if (!rows.length) return toast(t("msg.chooseFirst"));
  download(textBlob(csv(rows), "text/csv"), "prism-table.csv");
  toast(t("msg.prismSaved"));
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
  if (!state.panels.length) return toast(t("msg.chooseFirst"));
  download(textBlob(csv(statsRows()), "text/csv"), "report-statistics.csv");
  toast(t("msg.statsSaved"));
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
    lines.push(t("file.legendHeading", { n: number }), "", legend, "",
               t("file.resultsHeading", { n: number }), "", results, "",
               t("file.statsHeading", { n: number }), "");
    panels.forEach((p, i) => {
      if (p.analysis?.ok)
        lines.push(`(${String.fromCharCode(65 + i)}) ${statsSentence(p.analysis)}`);
    });
    lines.push("", "—".repeat(60), "");
  }
  lines.push(t("file.footer1"), t("file.footer2"));
  return lines.join("\n");
}

export function saveDrafts() {
  if (!state.panels.length) return toast(t("msg.buildFirst"));
  download(textBlob(draftBundle(), "text/markdown"), `report-draft.md`);
  toast(t("msg.draftSaved"));
}

/* ---------- everything at once ---------- */

/* A browser handed a dozen downloads in one tick quietly drops the tail of
   them, so each is offered in its own turn with a gap between. */
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const DOWNLOAD_GAP_MS = 350;

/** Every figure in the report, plus one statistics file and one draft. */
export async function saveEverything() {
  const figures = allFigures().filter((f) => f.svg);
  if (!figures.length) return toast(t("msg.buildFirst"));

  const write = async (fn) => { fn(); await pause(DOWNLOAD_GAP_MS); };

  for (const { number, svg } of figures) {
    try {
      const png = await svgToPng(svg, 300);
      await write(() => download(png, `figure-${number}.png`));
    } catch {
      toast(t("msg.pngFailedN", { n: number }));
    }
  }
  await write(saveStatsCsv);
  await write(saveDrafts);
  await write(savePrismCsv);
  toast(t("msg.savedEverything", { n: figures.length }));
}
