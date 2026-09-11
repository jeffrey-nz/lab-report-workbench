/* app.js — wiring. Parsing, statistics and drawing live in their own modules;
   this file owns the state and the DOM. */

import { sheetsToGrids, parseWorkbook, seriesIndex } from "./parse.js";
import * as A from "./analyse.js";
import { renderFigure, svgToPng, groupColors } from "./charts.js";
import * as S from "./stats.js";
import { demoWorkbook } from "./demo.js";
import { CHECKLIST } from "./checklist.js";

const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== false) n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null) n.append(c.nodeType ? c : String(c));
  return n;
};

const STEPS = [
  { id: "load", label: "Load" }, { id: "check", label: "Check" },
  { id: "figure", label: "Figure" }, { id: "stats", label: "Statistics" },
  { id: "draft", label: "Draft" }, { id: "list", label: "Submit" }
];

const state = {
  records: [], issues: [], series: [], loaded: false, fileName: "",
  chosen: [], groups: [], control: null, cols: 2, figNumber: 1,
  panels: [], svg: "", step: "load", edits: {}
};

/* ---------- shell ---------- */

function renderSteps() {
  const nav = $("#steps");
  nav.replaceChildren(...STEPS.map((s, i) =>
    el("button", {
      type: "button", "aria-current": String(state.step === s.id),
      disabled: !state.loaded && s.id !== "load",
      onclick: () => go(s.id)
    }, el("b", {}, String(i + 1)), s.label)));
}

function go(id) {
  state.step = id;
  for (const s of STEPS) $(`#s-${s.id}`).hidden = s.id !== id;
  renderSteps();
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (id === "stats") renderStats();
  if (id === "draft") renderDraft();
  if (id === "list") renderList();
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
}

/* ---------- theme ---------- */

const savedTheme = (() => { try { return localStorage.getItem("lrw-theme"); } catch { return null; } })();
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
$("#theme").addEventListener("click", () => {
  const now = document.documentElement.dataset.theme;
  const dark = now ? now === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  const next = dark ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("lrw-theme", next); } catch {}
});

/* ---------- loading ---------- */

const drop = $("#drop");
$("#pick").addEventListener("click", () => $("#file").click());
$("#file").addEventListener("change", (e) => e.target.files[0] && readFile(e.target.files[0]));
$("#demo").addEventListener("click", () => {
  ingest(demoWorkbook(), "worked example (synthetic data)");
  toast("Loaded a synthetic example — not real study data");
});
["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => {
  e.preventDefault(); drop.classList.add("over");
}));
["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => {
  e.preventDefault(); drop.classList.remove("over");
}));
drop.addEventListener("drop", (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (f) readFile(f);
});

function readFile(file) {
  const fr = new FileReader();
  fr.onerror = () => toast("That file could not be read.");
  fr.onload = () => {
    try {
      const wb = XLSX.read(new Uint8Array(fr.result), { type: "array", cellDates: false });
      ingest(sheetsToGrids(wb, XLSX), file.name);
    } catch (err) {
      toast("That file is not a spreadsheet this tool can read.");
      console.error(err);
    }
  };
  fr.readAsArrayBuffer(file);
}

function ingest(sheets, name) {
  const { records, issues } = parseWorkbook(sheets);
  if (!records.length) {
    toast("No animal rows were found — is there an ID column?");
    return;
  }
  Object.assign(state, {
    records, issues, series: seriesIndex(records), loaded: true, fileName: name,
    chosen: [], groups: [], control: null, panels: [], edits: {}
  });
  const first = state.series[0];
  state.chosen = [first.key];
  state.groups = A.defaultGroups(records, first.key);
  state.control = A.pickControl(state.groups, records);

  syncGroups();
  renderLoadSummary();
  renderIssues();
  renderSeriesTable();
  renderPickers();
  rebuild();
  go("check");
}

function renderLoadSummary() {
  const bad = state.issues.filter((i) => i.severity === "error").length;
  $("#load-summary").replaceChildren(el("div", { class: "card" },
    el("div", { class: "draft-head" },
      el("h3", {}, state.fileName),
      el("span", { class: "note" }, `${state.records.length} values · ${state.series.length} measurements`)),
    el("p", { class: "note", style: "margin:0" },
      bad ? `${bad} thing${bad > 1 ? "s" : ""} in the workbook need${bad > 1 ? "" : "s"} your attention — see the next step.`
          : "No contradictions found in the workbook's own summary rows."),
    el("div", { class: "exports" }, el("button", { class: "btn", onclick: () => go("check") }, "Continue"))));
}

/* ---------- step 2 ---------- */

function renderIssues() {
  const box = $("#issues");
  if (!state.issues.length) {
    box.replaceChildren(el("p", { class: "note", style: "margin:0" },
      "Nothing to flag: every summary cell agrees with the animal values, and every group label parsed cleanly."));
    return;
  }
  const rank = { error: 0, warn: 1, info: 2 };
  const sorted = [...state.issues].sort((a, b) => rank[a.severity] - rank[b.severity]);
  box.replaceChildren(...sorted.map((i) => el("div", { class: `issue ${i.severity}` },
    el("span", { class: "tag" }, i.severity === "error" ? "check" : i.severity === "warn" ? "note" : "fyi"),
    el("div", {},
      el("span", { class: "where" }, `${i.sheet}${i.where ? " · " + i.where : ""}`),
      el("p", {}, i.detail)))));
}

function renderSeriesTable() {
  const rows = state.series.map((s) => el("tr", {},
    el("td", {}, s.tissue || "—"),
    el("td", {}, s.analyte),
    el("td", { class: "mono" }, s.unit || "—"),
    el("td", {}, s.hasTime ? "time course" : "one value per animal"),
    el("td", { class: "num" }, s.groups.length),
    el("td", { class: "num" }, s.n)));
  $("#series-table").replaceChildren(el("table", {},
    el("thead", {}, el("tr", {}, ["Tissue", "Measurement", "Unit", "Shape", "Groups", "Values"]
      .map((h) => el("th", {}, h)))),
    el("tbody", {}, rows)));
  $("#rec-count").textContent = `${state.records.length} animal-level values`;
}

/* ---------- step 3 ---------- */

function assayOf(unit) {
  if (!unit) return "";
  if (/fold/i.test(unit)) return "mRNA";
  if (/\bng\b|\bpg\b|per\s*mg/i.test(unit)) return "protein";
  return unit;
}

function seriesNames() {
  const base = (s) => [s.tissue, s.analyte].filter(Boolean).join(" ");
  const label = (s) => `${base(s)}|${assayOf(s.unit)}`;
  const seen = new Map();
  for (const s of state.series) seen.set(label(s), (seen.get(label(s)) || 0) + 1);
  return new Map(state.series.map((s) => [s.key, {
    name: base(s),
    // name the assay; fall back to the sheet only when that is still ambiguous
    hint: seen.get(label(s)) > 1
      ? s.sheet.replace(/\s*(data|levels)\s*$/i, "").trim()
      : assayOf(s.unit)
  }]));
}

function renderPickers() {
  const colors = groupColors(state.groups, state.records);
  const names = seriesNames();
  $("#pick-series").replaceChildren(...state.series.map((s) => {
    const { name, hint } = names.get(s.key);
    return el("label", { class: "chip" },
      el("input", {
        type: "checkbox", checked: state.chosen.includes(s.key), value: s.key,
        onchange: (e) => {
          state.chosen = e.target.checked
            ? [...state.chosen, s.key]
            : state.chosen.filter((k) => k !== s.key);
          syncGroups(); renderPickers(); rebuild();
        }
      }),
      name, hint ? el("span", { class: "note" }, hint) : null);
  }));

  $("#pick-groups").replaceChildren(...state.availableGroups.map((g) => el("label", { class: "chip" },
    el("input", {
      type: "checkbox", checked: state.groups.includes(g), value: g,
      onchange: (e) => {
        state.groups = e.target.checked
          ? A.orderGroups([...state.groups, g], state.records)
          : state.groups.filter((x) => x !== g);
        if (!state.groups.includes(state.control)) state.control = state.groups[0];
        renderControl(); rebuild();
      }
    }),
    el("span", { class: "dot", style: `background:${colors[g] || "var(--line-2)"}` }), g)));

  renderControl();
}

function renderControl() {
  $("#control").replaceChildren(...state.groups.map((g) =>
    el("option", { value: g, selected: g === state.control }, g)));
}

function syncGroups() {
  const avail = new Set();
  for (const k of state.chosen)
    for (const s of state.series) if (s.key === k) s.groups.forEach((g) => avail.add(g));
  state.availableGroups = A.orderGroups([...avail], state.records);
  state.groups = state.groups.filter((g) => avail.has(g));
  if (!state.groups.length)
    state.groups = state.chosen.length ? A.defaultGroups(state.records, state.chosen[0])
                                       : [...state.availableGroups];
  if (!state.groups.includes(state.control)) state.control = A.pickControl(state.groups, state.records);
}

$("#cols").addEventListener("change", (e) => { state.cols = +e.target.value; rebuild(); });
$("#control").addEventListener("change", (e) => { state.control = e.target.value; rebuild(); });
$("#fignum").addEventListener("input", (e) => { state.figNumber = +e.target.value || 1; renderDraft(); });

function rebuild() {
  if (!state.availableGroups) syncGroups();
  state.panels = state.chosen.map((key) => {
    const sel = A.buildSelection(state.records, key, state.groups);
    const analysis = A.analyse(sel, { control: state.control });
    return { sel, analysis, labels: { x: A.xAxisLabel(sel), y: A.axisLabel(sel) } };
  });
  const cols = Math.max(1, Math.min(state.cols, state.panels.length));
  const wide = cols >= 3;
  state.svg = state.panels.length
    ? renderFigure(state.panels, {
        cols, records: state.records,
        panelW: wide ? 330 : 360, panelH: wide ? 265 : 280 })
    : "";
  $("#figure").innerHTML = state.svg ||
    `<p class="empty">Tick at least one measurement to draw a figure.</p>`;
  if (state.step === "stats") renderStats();
  if (state.step === "draft") renderDraft();
}

/* ---------- exports ---------- */

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

$("#dl-png").addEventListener("click", async () => {
  if (!state.svg) return;
  try {
    const blob = await svgToPng(state.svg, 300);
    download(blob, `figure-${state.figNumber}.png`);
    toast("Saved at 300 dpi");
  } catch (e) { toast("The figure could not be converted to PNG."); }
});

$("#copy-png").addEventListener("click", async () => {
  if (!state.svg) return;
  try {
    const blob = await svgToPng(state.svg, 300);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    toast("Copied — paste straight into your report");
  } catch { toast("This browser will not let a page copy images. Use Download instead."); }
});

$("#dl-svg").addEventListener("click", () => {
  if (!state.svg) return;
  download(new Blob([state.svg], { type: "image/svg+xml" }), `figure-${state.figNumber}.svg`);
});

const csv = (rows) => rows.map((r) => r.map((c) => {
  const s = c == null ? "" : String(c);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}).join(",")).join("\n");

$("#dl-tidy").addEventListener("click", () => {
  const head = ["sheet", "tissue", "measurement", "unit", "group", "diet", "weeks_on_diet",
                "animal", "time", "time_unit", "value", "excluded", "note"];
  const rows = state.records.map((r) => [r.sheet, r.tissue, r.analyte, r.unit, r.groupLabel,
    r.diet, r.weeks, r.subject, r.x, r.xUnit, r.value, r.excluded ? "yes" : "", r.note]);
  download(new Blob([csv([head, ...rows])], { type: "text/csv" }), "tidy-data.csv");
  toast("Tidy data saved");
});

/** One column per group, one row per animal — the shape Prism pastes into. */
$("#dl-prism").addEventListener("click", () => {
  const out = [];
  for (const p of state.panels) {
    const sel = p.sel;
    out.push([[sel.tissue, sel.analyte].filter(Boolean).join(" ") + (sel.unit ? ` (${sel.unit})` : "")]);
    for (const lv of sel.levels) {
      if (sel.hasTime) out.push([`time = ${lv}${sel.xUnit ? " " + sel.xUnit : ""}`]);
      out.push(sel.groups);
      const cols = sel.groups.map((g) => sel.subjectsBy.get(g)
        .map((s) => sel.cell.get(`${g}|${s}|${lv}`)).filter((v) => typeof v === "number"));
      const depth = Math.max(...cols.map((c) => c.length));
      for (let i = 0; i < depth; i++) out.push(cols.map((c) => c[i] ?? ""));
      out.push([]);
    }
  }
  if (!out.length) return toast("Choose at least one measurement first.");
  download(new Blob([csv(out)], { type: "text/csv" }), "prism-table.csv");
  toast("Prism table saved");
});

/* ---------- step 4 ---------- */

/** A p-value as a bare table cell: "0.0023", "<0.0001". */
const pCell = (p) => S.fmtP(p).replace(/^p\s*=?\s*/, "");

function effectRows(m) {
  if (m.effects) return ["between", "within", "interaction"].map((k) => m.effects[k]);
  if (m.F != null && m.df1 != null)
    return [{ name: "Between groups", df: m.df1, dfError: m.df2, F: m.F, p: m.p, ms: m.msBetween }];
  return [];
}

function renderStats() {
  const out = $("#stats-out");
  if (!state.panels.length) {
    out.replaceChildren(el("div", { class: "card" },
      el("p", { class: "empty" }, "Choose a measurement on the Figure step first.")));
    return;
  }
  out.replaceChildren(...state.panels.map((p, i) => {
    const a = p.analysis;
    const letter = String.fromCharCode(65 + i);
    const card = el("div", { class: "card" });
    card.append(el("div", { class: "draft-head" },
      el("h3", {}, `${letter}. ${A.panelTitle(p.sel)}`),
      el("span", { class: "note" }, a.ok ? a.nText : "")));
    if (!a.ok) { card.append(el("p", { class: "note" }, a.reason)); return card; }

    card.append(el("div", { class: "panel-note" },
      el("strong", {}, "Why this test: "), a.designNote));

    const rows = effectRows(a.model).map((e) => el("tr", { class: e.p < 0.05 ? "sig" : "" },
      el("td", {}, e.name),
      el("td", { class: "num" }, `${e.df}, ${e.dfError}`),
      el("td", { class: "num" }, e.F.toFixed(2)),
      el("td", { class: "num" }, pCell(e.p)),
      el("td", {}, el("span", { class: `stars ${e.p < 0.05 ? "" : "ns"}` }, S.stars(e.p)))));

    if (a.kind === "two-group") {
      const m = a.model;
      card.append(el("dl", { class: "kv", style: "margin:14px 0 0" },
        el("dt", {}, "Test"), el("dd", { style: "font-family:var(--sans)" }, m.test),
        el("dt", {}, "t (df)"), el("dd", {}, `${m.t.toFixed(2)} (${m.df.toFixed(1)})`),
        el("dt", {}, "p"), el("dd", {}, pCell(m.p)),
        el("dt", {}, "Mean difference"), el("dd", {}, m.meanDiff.toFixed(3)),
        el("dt", {}, "Cohen's d"), el("dd", {}, m.cohensD.toFixed(2))));
    } else {
      card.append(el("h4", { style: "margin:16px 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-3)" },
        a.model.test));
      card.append(el("div", { class: "scroll" }, el("table", {},
        el("thead", {}, el("tr", {}, ["Source", "df", "F", "p", ""].map((h, i) =>
          el("th", { style: i > 0 && i < 4 ? "text-align:right" : "" }, h)))),
        el("tbody", {}, rows))));
    }

    if (a.posthoc.length) {
      card.append(el("h4", { style: "margin:18px 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-3)" },
        `Šídák's multiple comparisons vs ${a.control}`));
      card.append(el("div", { class: "scroll" }, el("table", {},
        el("thead", {}, el("tr", {}, ["Comparison", "Difference", "t", "Adjusted p", ""].map((h, i) =>
          el("th", { style: i > 0 && i < 4 ? "text-align:right" : "" }, h)))),
        el("tbody", {}, a.posthoc.map((c) => el("tr", { class: c.p < 0.05 ? "sig" : "" },
          el("td", {}, c.label),
          el("td", { class: "num" }, c.diff.toFixed(3)),
          el("td", { class: "num" }, c.t.toFixed(2)),
          el("td", { class: "num" }, pCell(c.p)),
          el("td", {}, el("span", { class: `stars ${c.p < 0.05 ? "" : "ns"}` }, c.stars))))))));
    }

    if (a.outliers.length) {
      card.append(el("div", { class: "panel-note", style: "margin-top:14px" },
        el("strong", {}, "Possible outlier: "),
        a.outliers.map((o) => `animal ${o.subject} in ${o.group}${o.x != null ? ` at ${o.x}` : ""} ` +
          `(value ${o.value}, Grubbs' G = ${o.G.toFixed(2)} vs critical ${o.Gcrit.toFixed(2)})`).join("; ") +
        ". It is kept in the analysis — say in the text that you noticed it."));
    }
    if (a.dropped.length) {
      card.append(el("div", { class: "panel-note", style: "margin-top:10px" },
        el("strong", {}, "Animals left out: "),
        `${[...new Set(a.dropped)].join(", ")} — not measured in every selected group, so they cannot enter a repeated-measures test.`));
    }
    return card;
  }));
}

/* ---------- step 5 ---------- */

function draftBlock(title, hint, text, key) {
  const ta = el("textarea", { class: "draft", id: `draft-${key}`, spellcheck: "true" });
  ta.value = state.edits[key] ?? text;
  ta.addEventListener("input", () => { state.edits[key] = ta.value; });
  const words = el("span", { class: "note" });
  const count = () => { words.textContent = `${ta.value.trim().split(/\s+/).filter(Boolean).length} words`; };
  ta.addEventListener("input", count); count();
  return el("div", { class: "card" },
    el("div", { class: "draft-head" }, el("h3", {}, title),
      el("div", { style: "display:flex;gap:10px;align-items:baseline" }, words,
        el("button", {
          class: "icon-btn",
          onclick: async () => {
            try { await navigator.clipboard.writeText(ta.value); toast("Copied"); }
            catch { ta.select(); toast("Press ⌘C / Ctrl+C to copy"); }
          }
        }, "Copy"))),
    el("p", { class: "note", style: "margin:0 0 10px" }, hint),
    ta);
}

function renderDraft() {
  const out = $("#draft-out");
  if (!state.panels.length) {
    out.replaceChildren(el("div", { class: "card" },
      el("p", { class: "empty" }, "Build a figure first and the draft will follow from it.")));
    return;
  }
  const n = state.figNumber;
  out.replaceChildren(
    draftBlock(`Figure ${n} legend`,
      "Names the finding in each panel, then the test, the n, and what the asterisks mean.",
      A.draftLegend(state.panels, n), `legend-${n}`),
    draftBlock("Results paragraph",
      "Says what was done, what the data show, where to look in the figure, and the statistics — in that order.",
      A.draftResults(state.panels, n), `results-${n}`),
    el("div", { class: "card" },
      el("h3", { style: "font-size:15px;margin-bottom:10px" }, "Statistics, written out"),
      el("p", { class: "note", style: "margin:0 0 12px" },
        "Report the overall test before any multiple comparisons, and give the degrees of freedom with every F or t."),
      el("div", { class: "stack" }, state.panels.map((p, i) => p.analysis.ok
        ? el("div", { class: "panel-note" },
            el("strong", {}, `(${String.fromCharCode(65 + i)}) `), A.statsSentence(p.analysis))
        : null).filter(Boolean))));
}

/* ---------- step 6 ---------- */

function renderList() {
  const out = $("#list-out");
  const saved = (() => { try { return JSON.parse(localStorage.getItem("lrw-checks") || "{}"); } catch { return {}; } })();
  out.replaceChildren(...CHECKLIST.map((group) => el("div", { class: "card" },
    el("h3", { style: "font-size:15px;margin-bottom:4px" }, group.title),
    el("p", { class: "note", style: "margin:0 0 8px" }, group.note),
    ...group.items.map((item, i) => {
      const id = `${slug(group.title)}-${i}`;
      const box = el("input", { type: "checkbox", id, checked: !!saved[id] });
      box.addEventListener("change", () => {
        saved[id] = box.checked;
        try { localStorage.setItem("lrw-checks", JSON.stringify(saved)); } catch {}
      });
      return el("div", { class: "check" }, box,
        el("div", {}, el("label", { for: id }, item.do), el("p", {}, item.why)));
    }))));
}

/* ---------- start ---------- */

renderSteps();
go("load");
