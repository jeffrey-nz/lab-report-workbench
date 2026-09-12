/* analyse.js — choose the right model for a selection, run it, and draft the
   prose that has to accompany it. The design of the selection decides the
   model, so the app never silently applies an independent-groups test to
   animals that were measured repeatedly. */

import * as S from "./stats.js";
import { groupMeta } from "./parse.js";

export const seriesKey = (r) => `${r.sheet}|${r.tissue || ""}|${r.analyte}`;

/** Chow before HFD, then HFD by duration, then any age-matched chow control. */
export function orderGroups(labels, records) {
  const meta = groupMeta(records);
  return [...labels].sort((a, b) => {
    const A = meta(a), B = meta(b);
    const wa = A.weeks ?? 0, wb = B.weeks ?? 0;
    if (wa !== wb) return wa - wb;
    const da = A.diet === "NCD" ? 1 : 0, db = B.diet === "NCD" ? 1 : 0;
    if (da !== db) return da - db;
    return String(a).localeCompare(String(b));
  });
}

export function pickControl(groups, records) {
  const meta = groupMeta(records);
  const chow = groups.filter((g) => meta(g).diet === "NCD");
  if (chow.length) return chow.sort((a, b) => (meta(a).weeks ?? 0) - (meta(b).weeks ?? 0))[0];
  return groups[0];
}

/* ---------- assemble a selection ---------- */

/**
 * The widest group selection that still forms a design a test can handle.
 * Tries everything first, then a within-diet time course, then control vs the
 * longest-fed group — so the app opens on something real rather than an error.
 */
export function defaultGroups(records, key) {
  const all = orderGroups([...new Set(records
    .filter((r) => seriesKey(r) === key && !r.excluded).map((r) => r.groupLabel))], records);
  if (all.length < 2) return all;
  const works = (gs) => gs.length > 1 && analyse(buildSelection(records, key, gs)).ok;
  if (works(all)) return all;

  const dietOf = new Map();
  for (const r of records) if (!dietOf.has(r.groupLabel)) dietOf.set(r.groupLabel, r.diet);
  const byDiet = new Map();
  for (const g of all) {
    const d = dietOf.get(g) || "other";
    byDiet.set(d, [...(byDiet.get(d) || []), g]);
  }
  for (const list of [...byDiet.values()].sort((x, y) => y.length - x.length))
    if (works(list)) return list;

  const ctrl = pickControl(all, records);
  const last = [...all].reverse().find((g) => g !== ctrl);
  const pair = orderGroups([ctrl, last], records);
  return works(pair) ? pair : all;
}

export function buildSelection(records, key, selectedGroups) {
  const rows = records.filter((r) => seriesKey(r) === key && !r.excluded &&
                                     selectedGroups.includes(r.groupLabel));
  const hasTime = rows.some((r) => r.x != null);
  const levels = hasTime ? [...new Set(rows.map((r) => r.x))].sort((a, b) => a - b) : [null];
  const groups = orderGroups([...new Set(rows.map((r) => r.groupLabel))], records);
  const xUnit = rows.find((r) => r.xUnit)?.xUnit || null;

  const cell = new Map();               // group|subject|level -> value
  for (const r of rows) cell.set(`${r.groupLabel}|${r.subject}|${r.x}`, r.value);

  const subjectsBy = new Map();
  for (const g of groups) subjectsBy.set(g, [...new Set(rows.filter((r) => r.groupLabel === g).map((r) => r.subject))].sort((a, b) => a - b));

  const counts = new Map();
  for (const g of groups) for (const s of subjectsBy.get(g)) counts.set(s, (counts.get(s) || 0) + 1);
  const repeatedAcrossGroups = [...counts.values()].some((c) => c > 1);

  const sample = rows[0] || {};
  return { key, rows, groups, levels, hasTime, xUnit, cell, subjectsBy, counts,
           repeatedAcrossGroups,
           analyte: sample.analyte, tissue: sample.tissue, unit: sample.unit,
           sheet: sample.sheet };
}

/**
 * Mean with its spread per group per level, plus the raw values for the figure.
 * `err` is whichever of SEM or SD the figure is drawing, so the drawing code
 * never has to know which was chosen.
 */
export function summarise(sel, errorBars = "sem") {
  return sel.groups.map((g) => ({
    group: g,
    points: sel.levels.map((lv) => {
      const vals = sel.subjectsBy.get(g)
        .map((s) => sel.cell.get(`${g}|${s}|${lv}`))
        .filter((v) => typeof v === "number");
      const d = vals.length ? S.describe(vals) : { n: 0, mean: NaN, sd: NaN, sem: NaN };
      return { x: lv, values: vals, ...d, err: errorBars === "sd" ? d.sd : d.sem };
    })
  }));
}

/* ---------- model choice ---------- */

export function analyse(sel, { control, errorBars = "sem" } = {}) {
  if (sel.groups.length < 2) return { ok: false, reason: "Select at least two groups to compare." };
  // a figure-wide control need not appear in every panel's own groups
  const ctrl = control && sel.groups.includes(control)
    ? control
    : pickControl(sel.groups, sel.rows);

  return sel.hasTime && sel.levels.length > 1
    ? timeCourse(sel, ctrl, errorBars)
    : singleTimePoint(sel, ctrl, errorBars);
}

function matrixFor(sel, groups, subjects) {
  return subjects.map((s) => ({
    id: s,
    cells: groups.map((g) => sel.levels.map((lv) => sel.cell.get(`${g}|${s}|${lv}`)))
  }));
}

function timeCourse(sel, ctrl, errorBars) {
  const levelLabels = sel.levels.map(String);
  const dropped = [];

  if (!sel.repeatedAcrossGroups) {
    // each animal sits in exactly one group: mixed design
    const groups = sel.groups.map((g) => ({
      label: g,
      subjects: sel.subjectsBy.get(g).map((s) => ({
        id: s, values: sel.levels.map((lv) => sel.cell.get(`${g}|${s}|${lv}`))
      })).filter((sub) => sub.values.every((v) => typeof v === "number"))
    }));
    for (const g of groups) {
      const all = sel.subjectsBy.get(g.label);
      const kept = new Set(g.subjects.map((s) => s.id));
      all.filter((s) => !kept.has(s)).forEach((s) => dropped.push(`${s} (${g.label})`));
    }
    if (groups.some((g) => g.subjects.length < 2)) return { ok: false, reason: "Too few complete animals per group." };
    const r = S.twoWayRmAnova(groups, levelLabels,
      { betweenName: "Diet", withinName: timeName(sel) });
    return finishTime(sel, r, ctrl, errorBars, dropped,
      `${groups.map((g) => `${g.label} n=${g.subjects.length}`).join(", ")}`,
      "Animals were measured at every time point, so time is a within-subject factor and diet a between-subject factor.");
  }

  // the same animals appear in more than one selected group: matched on both
  let inter = null;
  for (const g of sel.groups) {
    const s = new Set(sel.subjectsBy.get(g));
    inter = inter == null ? s : new Set([...inter].filter((x) => s.has(x)));
  }
  const complete = [...inter].filter((s) =>
    sel.groups.every((g) => sel.levels.every((lv) => typeof sel.cell.get(`${g}|${s}|${lv}`) === "number")))
    .sort((a, b) => a - b);
  const allSubjects = new Set(sel.groups.flatMap((g) => sel.subjectsBy.get(g)));
  [...allSubjects].filter((s) => !complete.includes(s)).sort((a, b) => a - b)
    .forEach((s) => dropped.push(String(s)));

  if (complete.length < 3) return { ok: false, reason:
    "These groups mix animals that were re-tested over time with a separate group of control animals, " +
    "so no single test fits them. Compare either two diets at one duration, or several durations within one diet." };
  const r = S.twoWayFullRmAnova(matrixFor(sel, sel.groups, complete), sel.groups, levelLabels,
    { aName: "Weeks on diet", bName: timeName(sel) });
  const restricted = { ...sel, subjectsBy: new Map(sel.groups.map((g) => [g, complete])) };
  return finishTime(restricted, r, ctrl, errorBars, dropped, `n = ${complete.length} animals tested in every group`,
    "The same animals appear in more than one selected group, so both factors are within-subject (repeated measures on both).");
}

function timeName(sel) {
  if (sel.xUnit === "min") return "Time after bolus";
  if (sel.xUnit === "day" || sel.xUnit === "week") return "Time on diet";
  return "Time";
}

function finishTime(sel, r, ctrl, errorBars, dropped, nText, designNote) {
  if (!r) return { ok: false, reason: "The selection is not a complete design — some group × time cells are empty." };
  const summary = summarise(sel, errorBars);
  // per-time-point comparison of every group against the control
  const comparisons = [];
  for (const lv of sel.levels) {
    for (const g of sel.groups) {
      if (g === ctrl) continue;
      const a = summary.find((s) => s.group === g).points.find((p) => p.x === lv);
      const b = summary.find((s) => s.group === ctrl).points.find((p) => p.x === lv);
      if (!a?.n || !b?.n) continue;
      comparisons.push({ label: `${g} vs ${ctrl} at ${lv}${sel.xUnit === "min" ? " min" : ""}`, x: lv, group: g,
                         a: { mean: a.mean, n: a.n }, b: { mean: b.mean, n: b.n } });
    }
  }
  const posthoc = S.sidakPairwise(comparisons, r.msError, r.dfError ?? r.dfWithinError);
  return { ok: true, kind: "time", model: r, summary, control: ctrl, posthoc, errorBars,
           dropped, nText, designNote, outliers: findOutliers(sel, summary) };
}

function singleTimePoint(sel, ctrl, errorBars) {
  const summary = summarise(sel, errorBars);
  const values = sel.groups.map((g) => summary.find((s) => s.group === g).points[0].values);
  if (values.some((v) => v.length < 2)) return { ok: false, reason: "Each group needs at least two animals." };

  if (sel.groups.length === 2) {
    const r = S.tTest(values[0], values[1]);
    return { ok: true, kind: "two-group", model: r, summary, control: ctrl, errorBars,
             posthoc: [], dropped: [],
             nText: sel.groups.map((g, i) => `${g} n=${values[i].length}`).join(", "),
             designNote: "Two independent groups of animals, so an unpaired t-test with Welch's correction for unequal variance.",
             outliers: findOutliers(sel, summary) };
  }
  const r = S.oneWayAnova(values);
  const comparisons = sel.groups.filter((g) => g !== ctrl).map((g) => {
    const a = summary.find((s) => s.group === g).points[0];
    const b = summary.find((s) => s.group === ctrl).points[0];
    return { label: `${g} vs ${ctrl}`, group: g, x: null,
             a: { mean: a.mean, n: a.n }, b: { mean: b.mean, n: b.n } };
  });
  const posthoc = S.sidakPairwise(comparisons, r.msWithin, r.df2);
  return { ok: true, kind: "one-way", model: r, summary, control: ctrl, posthoc, errorBars, dropped: [],
           nText: sel.groups.map((g, i) => `n=${values[i].length}`).join(", "),
           designNote: "A separate cohort of animals was killed at each time point, so the groups are independent.",
           outliers: findOutliers(sel, summary) };
}

function findOutliers(sel, summary) {
  const out = [];
  for (const s of summary) for (const p of s.points) {
    if (p.values.length < 3) continue;
    const g = S.grubbs(p.values);
    if (g?.isOutlier) {
      const subj = sel.subjectsBy.get(s.group).filter((id) =>
        sel.cell.get(`${s.group}|${id}|${p.x}`) === g.value)[0];
      out.push({ group: s.group, x: p.x, value: g.value, subject: subj,
                 G: g.G, Gcrit: g.Gcrit });
    }
  }
  return out;
}

/* ---------- drafting ---------- */

const A_Z = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** "Body weight" -> "body weight", but IL-6 and CD68 keep their capitals. */
function lower(s) {
  const t = String(s);
  return /^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t;
}

const unitWord = (u) => (u === "min" ? " min" : u === "day" ? " days" : u === "week" ? " weeks" : "");
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** Tissue names read as common nouns in prose, but WAT stays WAT. */
const tissueWord = (t) => (/^[A-Z0-9]{2,5}$/.test(t) ? t : t.toLowerCase());
/** Start of a sentence — leaving an acronym such as WAT or IL-6 alone. */
const sentence = (s) => (/^[A-Z0-9]{2,5}\b/.test(s) || /^IL-|^TNF-|^CD\d/.test(s) ? s : cap(s));

export function panelTitle(sel) {
  return [sel.tissue, sel.analyte].filter(Boolean).join(" ");
}

export function axisLabel(sel) {
  // the marker's note: never just "protein" — name the analyte and the unit
  const base = [sel.tissue, sel.analyte].filter(Boolean).join(" ");
  const unit = sel.unit ? ` (${sel.unit})` : "";
  if (/fold/i.test(sel.unit || "")) return `${base} mRNA (fold vs chow)`;
  if (/ng per mg/i.test(sel.unit || "")) return `${base} protein (ng/mg)`;
  return `${base}${unit}`;
}

export function timeUnitOf(sel) {
  if (sel.xUnit) return sel.xUnit;
  const sheet = (sel.sheet || "").toLowerCase();
  if (/glucose|insulin/.test(sheet)) return "min";
  if (/weight/.test(sheet)) return "day";
  return null;
}

export function xAxisLabel(sel) {
  if (!sel.hasTime) return "Weeks on diet";
  const unit = timeUnitOf(sel);
  if (unit === "min") return "Time after bolus (min)";
  if (unit === "day") return "Time on diet (days)";
  if (unit === "week") return "Time on diet (weeks)";
  return "Time";
}

/** The statistics sentence: ANOVA first, then the multiple comparisons. */
export function statsSentence(a) {
  if (!a?.ok) return "";
  const m = a.model;
  if (a.kind === "two-group")
    return `${m.test}, ${S.fmtT(m)}, ${S.fmtP(m.p)}.`;
  if (a.kind === "one-way")
    return `${m.test}, ${S.fmtF({ df: m.df1, dfError: m.df2, F: m.F })}, ${S.fmtP(m.p)}, followed by Šídák's multiple comparisons test.`;
  const e = m.effects;
  return `${m.test}: ${e.within.name} ${S.fmtF(e.within)}, ${S.fmtP(e.within.p)}; ` +
         `${e.between.name} ${S.fmtF(e.between)}, ${S.fmtP(e.between.p)}; ` +
         `interaction ${S.fmtF(e.interaction)}, ${S.fmtP(e.interaction.p)}. ` +
         `Followed by Šídák's multiple comparisons test.`;
}

/** Figure legend in the structure the marking form rewards. */
export function draftLegend(panels, figureNumber = 1) {
  if (!panels.length) return "";
  if (!panels.some((p) => p.analysis?.ok))
    return `Figure ${figureNumber}. No analysis could be run on this selection. ` +
           (panels[0].analysis?.reason || "");
  const letters = panels.map((p, i) => A_Z[i]);
  const title = figureTitle(panels);
  const findings = panels.map((p, i) => {
    const f = panelFinding(p.sel, p.analysis);
    return f ? `(${letters[i]}) ${sentence(f)}` : null;
  }).filter(Boolean);

  const ns = panels.map((p) => p.analysis?.ok ? p.analysis.summary.flatMap((s) => s.points.map((q) => q.n)) : [])
                   .flat().filter((n) => n > 0);
  const nLo = Math.min(...ns), nHi = Math.max(...ns);
  const nText = ns.length ? (nLo === nHi ? `n = ${nLo} animals per group`
                                         : `n = ${nLo}–${nHi} animals per group`) : "";

  const tests = [...new Set(panels.map((p) => p.analysis?.ok ? lower(p.analysis.model.test) : null).filter(Boolean))];
  const one = panels.length === 1;
  const stats = panels.map((p, i) => p.analysis?.ok
    ? (one ? inlineStats(p.analysis) : `(${letters[i]}) ${inlineStats(p.analysis)}`)
    : null).filter(Boolean).join("; ");

  const spread = panels.find((p) => p.analysis?.ok)?.analysis.errorBars === "sd" ? "SD" : "SEM";
  return [
    `Figure ${figureNumber}. ${title}`,
    findings.join(" "),
    `Data are mean ± ${spread}${nText ? ", " + nText : ""}.`,
    `Analysed by ${tests.join(" and ")} (${stats}).`,
    `*p < 0.05, **p < 0.01, ***p < 0.001, ****p < 0.0001 versus ${panels[0].analysis?.control || "control"}.`
  ].filter(Boolean).join(" ");
}

function inlineStats(a) {
  const m = a.model;
  if (a.kind === "two-group") return `${S.fmtT(m)}, ${S.fmtP(m.p)}`;
  if (a.kind === "one-way") return `${S.fmtF({ df: m.df1, dfError: m.df2, F: m.F })}, ${S.fmtP(m.p)}`;
  const e = m.effects;
  return `interaction ${S.fmtF(e.interaction)}, ${S.fmtP(e.interaction.p)}`;
}

function figureTitle(panels) {
  const tissues = [...new Set(panels.map((p) => p.sel.tissue).filter(Boolean))];
  const analytes = [...new Set(panels.map((p) => p.sel.analyte))];
  const where = tissues.length ? ` in ${listWords(tissues.map(tissueWord))}` : "";
  const sig = panels.some((p) => isSignificant(p.analysis));
  const subject = analytes.length === 1 && /glucose/i.test(analytes[0])
    ? "glucose handling"
    : `${listWords(analytes.map(lower))}${where}`;
  const verb = sig ? "alters" : "does not alter";
  return `High-fat feeding ${verb} ${subject} in male C57BL/6J mice.`;
}

function isSignificant(a) {
  if (!a?.ok) return false;
  if (a.kind === "time") return a.model.effects.interaction.p < 0.05 || a.model.effects.between.p < 0.05;
  return a.model.p < 0.05;
}

/** One sentence per panel, stating the finding — not just what was plotted. */
export function panelFinding(sel, a) {
  if (!a?.ok) return null;
  const what = sel.tissue ? `${tissueWord(sel.tissue)} ${sel.analyte}` : lower(sel.analyte);
  if (a.kind === "time") {
    const e = a.model.effects;
    const sig = a.posthoc.filter((c) => c.p < 0.05);
    if (!sig.length && e.interaction.p >= 0.05)
      return `${what} did not differ between groups at any time point (${S.fmtP(e.interaction.p)} for the interaction).`;
    const run = trailingRun(a, sel);
    if (run) return `${what} diverged between groups from ${run.from}${unitWord(timeUnitOf(sel))} onwards ` +
      `(${S.fmtP(run.p).replace("p = ", "p \u2264 ")}).`;
    const worst = [...sig].sort((x, y) => x.p - y.p)[0];
    return `${what} differed between groups, most clearly ${describeAt(worst, sel)} (${S.fmtP(worst.p)}).`;
  }
  const rising = trendDirection(a);
  const sig = a.posthoc.filter((c) => c.p < 0.05);
  if (a.kind === "one-way" && !sig.length)
    return `${what} was unchanged by high-fat feeding (${S.fmtP(a.model.p)}).`;
  if (a.kind === "one-way") {
    const others = a.summary.length - 1;
    const when = sig.length === others && others > 2
      ? "every duration tested"
      : sig.map((c) => c.label.split(" vs ")[0]).join(", ");
    return `${what} ${rising} with high-fat feeding, reaching significance at ${when}.`;
  }
  return `${what} ${a.model.p < 0.05 ? "differed between the two groups" : "did not differ between the two groups"} (${S.fmtP(a.model.p)}).`;
}

function describeAt(c, sel) {
  if (c.x == null) return `in ${c.group}`;
  return `in ${c.group} at ${c.x}${unitWord(timeUnitOf(sel))}`;
}

/**
 * If every time point from some point on is significant, say so once rather
 * than listing them — the difference is sustained, not a single spike.
 */
function trailingRun(a, sel) {
  const bad = new Set(a.posthoc.filter((c) => c.p < 0.05).map((c) => c.x));
  const levels = sel.levels;
  let start = levels.length;
  while (start > 0 && bad.has(levels[start - 1])) start--;
  const covered = levels.length - start;
  if (covered < 3 || start === 0) return null;
  // the weakest of the significant comparisons in the run, so "p <= x" holds
  const ps = a.posthoc.filter((c) => c.x >= levels[start] && c.p < 0.05).map((c) => c.p);
  if (!ps.length) return null;
  return { from: levels[start], p: Math.max(...ps) };
}

function trendDirection(a) {
  const means = a.summary.map((s) => s.points[0].mean);
  const ctrlIdx = a.summary.findIndex((s) => s.group === a.control);
  const rest = means.filter((_, i) => i !== ctrlIdx);
  const avg = rest.reduce((x, y) => x + y, 0) / rest.length;
  return avg > means[ctrlIdx] ? "rose" : "fell";
}

/** The results-paragraph draft: method recap, trend, aberrant data, statistics. */
export function draftResults(panels, figureNumber = 1) {
  const lines = [];
  const first = panels[0];
  lines.push(methodRecap(first.sel));
  panels.forEach((p, i) => {
    const f = panelFinding(p.sel, p.analysis);
    if (f) lines.push(`${sentence(f).replace(/\.$/, "")} (Figure ${figureNumber}${A_Z[i]}).`);
  });
  const stat = panels.map((p, i) => p.analysis?.ok
    ? `${panels.length > 1 ? `For panel ${A_Z[i]}, ` : ""}` +
      (panels.length > 1
        ? statsSentence(p.analysis).replace(/^[A-Z]/, (c) => c.toLowerCase())
        : statsSentence(p.analysis))
    : null).filter(Boolean);
  lines.push(...stat);
  const odd = panels.flatMap((p) => p.analysis?.outliers || []);
  if (odd.length) {
    lines.push(`One value stood out from its group: animal ${odd[0].subject} in ${odd[0].group}` +
      ` (Grubbs' test G = ${odd[0].G.toFixed(3)} against a critical value of ${odd[0].Gcrit.toFixed(3)}), retained in the analysis and visible in the figure.`);
  }
  const dropped = panels.flatMap((p) => p.analysis?.dropped || []);
  if (dropped.length) {
    lines.push(`Animals not tested at every time point were excluded from this analysis (${[...new Set(dropped)].join(", ")}).`);
  }
  return lines.join(" ");
}

function methodRecap(sel) {
  const s = (sel.sheet || "").toLowerCase();
  if (/glucose/.test(s))
    return "Mice were fasted and given a glucose bolus, and tail blood glucose was measured over the following two hours.";
  if (/insulin/.test(s))
    return "Mice were given an insulin bolus and tail blood glucose was followed over the following two hours.";
  if (/weight/.test(s))
    return "Body weight was recorded twice weekly throughout the feeding period.";
  if (/protein/.test(s))
    return `${sel.tissue || "Tissue"} was collected at each time point and ${sel.analyte} protein measured by Bio-Plex cytokine assay, expressed per mg of tissue.`;
  if (/mrna|cd68/.test(s))
    return `RNA was extracted from ${sel.tissue || "tissue"} at each time point and ${sel.analyte} expression measured by RT-qPCR, normalised to 18S and expressed relative to chow-fed controls.`;
  return "Samples were collected at each time point and assayed as described in the Methods.";
}

function listWords(a) {
  if (a.length === 1) return a[0];
  if (a.length === 2) return `${a[0]} and ${a[1]}`;
  return `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;
}
