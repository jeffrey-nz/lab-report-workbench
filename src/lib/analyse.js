/* analyse.js — choose the right model for a selection, run it, and draft the
   prose that has to accompany it. The design of the selection decides the
   model, so the app never silently applies an independent-groups test to
   animals that were measured repeatedly. */

import * as S from "./stats.js";
import { groupMeta } from "./parse.js";
import { t as msg, list as listWordsFor } from "../i18n/index.js";

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
  if (sel.groups.length < 2) return { ok: false, reason: msg("reason.twoGroups") };
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
    if (groups.some((g) => g.subjects.length < 2)) return { ok: false, reason: msg("reason.tooFew") };
    const r = S.twoWayRmAnova(groups, levelLabels,
      { betweenName: msg("effect.diet"), withinName: timeName(sel) });
    return finishTime(sel, r, ctrl, errorBars, dropped,
      msg("design.nPerGroup", { parts: groups.map((g) => msg("design.nGroup", { group: g.label, n: g.subjects.length })) }),
      msg("design.mixed"));
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

  if (complete.length < 3) return { ok: false, reason: msg("reason.mixedDesign") };
  const r = S.twoWayFullRmAnova(matrixFor(sel, sel.groups, complete), sel.groups, levelLabels,
    { aName: msg("effect.weeksOnDiet"), bName: timeName(sel) });
  const restricted = { ...sel, subjectsBy: new Map(sel.groups.map((g) => [g, complete])) };
  return finishTime(restricted, r, ctrl, errorBars, dropped, msg("design.nComplete", { n: complete.length }),
    msg("design.bothWithin"));
}

function timeName(sel) {
  if (sel.xUnit === "min") return msg("effect.timeAfterBolus");
  if (sel.xUnit === "day" || sel.xUnit === "week") return msg("effect.timeOnDiet");
  return msg("effect.time");
}

function finishTime(sel, r, ctrl, errorBars, dropped, nText, designNote) {
  if (!r) return { ok: false, reason: msg("reason.incomplete") };
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
  if (values.some((v) => v.length < 2)) return { ok: false, reason: msg("reason.eachTwo") };

  if (sel.groups.length === 2) {
    const r = S.tTest(values[0], values[1]);
    return { ok: true, kind: "two-group", model: r, summary, control: ctrl, errorBars,
             posthoc: [], dropped: [],
             nText: msg("design.nPerGroup", { parts: sel.groups.map((g, i) => msg("design.nGroup", { group: g, n: values[i].length })) }),
             designNote: msg("design.twoGroup"),
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
           nText: msg("design.nPerGroup", { parts: sel.groups.map((g, i) => `n=${values[i].length}`) }),
           designNote: msg("design.independent"),
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

const unitWord = (u) => (u === "min" || u === "day" || u === "week" ? msg(`unit.${u}`) : "");
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * Measurement names this tool generated (rather than read from the sheet) can
 * be translated; names that came from the data — WAT, IL-1β — are left alone,
 * because those abbreviations are what the literature uses in any language.
 */
const analyteName = (name) => {
  const key = `analyte.${name}`;
  const shown = msg(key);
  return shown.startsWith("\u27e6") ? name : shown;
};

/** Sentences run together in Japanese and are spaced in English. */
const joinSentences = (parts) => parts.filter(Boolean).join(msg("join.sentence"));
/**
 * Tissue names in prose. Known ones are named in the reader's language; an
 * abbreviation the literature uses untranslated (WAT) stays as it is, and an
 * unknown name is only lower-cased where the language has case at all.
 */
const tissueWord = (name) => {
  const shown = msg(`tissue.${name}`);
  if (!shown.startsWith("\u27e6")) return shown;
  if (/^[A-Z0-9]{2,5}$/.test(name)) return name;
  return msg("tissue.lowercaseUnknown") ? name.toLowerCase() : name;
};
/** Start of a sentence — leaving an acronym such as WAT or IL-6 alone. */
const sentence = (s) => (/^[A-Z0-9]{2,5}\b/.test(s) || /^IL-|^TNF-|^CD\d/.test(s) ? s : cap(s));

export function panelTitle(sel) {
  return [sel.tissue, sel.analyte].filter(Boolean).join(" ");
}

export function axisLabel(sel) {
  // the marker's note: never just "protein" — name the analyte and the unit
  const base = [sel.tissue, analyteName(sel.analyte)].filter(Boolean).join(" ");
  const unit = sel.unit ? ` (${sel.unit})` : "";
  if (/fold/i.test(sel.unit || "")) return msg("chart.axisMrna", { base });
  if (/ng per mg/i.test(sel.unit || "")) return msg("chart.axisProtein", { base });
  return msg("chart.axisPlain", { base, unit: sel.unit || "" });
}

export function timeUnitOf(sel) {
  if (sel.xUnit) return sel.xUnit;
  const sheet = (sel.sheet || "").toLowerCase();
  if (/glucose|insulin/.test(sheet)) return "min";
  if (/weight/.test(sheet)) return "day";
  return null;
}

export function xAxisLabel(sel) {
  if (!sel.hasTime) return msg("chart.weeksOnDiet");
  const unit = timeUnitOf(sel);
  if (unit === "min") return msg("chart.timeAfterBolus");
  if (unit === "day") return msg("chart.timeOnDiet.day");
  if (unit === "week") return msg("chart.timeOnDiet.week");
  return msg("chart.time");
}

/** The statistics sentence: ANOVA first, then the multiple comparisons. */
export function statsSentence(a) {
  if (!a?.ok) return "";
  const m = a.model;
  if (a.kind === "two-group")
    return msg("stats.sentence.tTest", { test: m.test, t: S.fmtT(m), p: S.fmtP(m.p) });
  if (a.kind === "one-way")
    return msg("stats.sentence.oneWay", { test: m.test,
      f: S.fmtF({ df: m.df1, dfError: m.df2, F: m.F }), p: S.fmtP(m.p) });
  const e = m.effects;
  const line = (x) => msg("stats.effectLine", { name: x.name, f: S.fmtF(x), p: S.fmtP(x.p) });
  return msg("stats.sentence.rm", { test: m.test, within: line(e.within), between: line(e.between),
    interaction: msg("stats.interactionLine", { f: S.fmtF(e.interaction), p: S.fmtP(e.interaction.p) }) });
}

/**
 * What the animals were. Titles are marked on naming the species, but a tool
 * that assumes one has stopped being reusable, so it is supplied per report.
 */
let species = "";
export const setSpecies = (s) => { species = String(s || "").trim(); };
export const getSpecies = () => species;

/** Figure legend in the structure the marking form rewards. */
export function draftLegend(panels, figureNumber = 1) {
  if (!panels.length) return "";
  if (!panels.some((p) => p.analysis?.ok))
    return msg("legend.noAnalysis", { n: figureNumber, reason: panels[0].analysis?.reason || "" });
  const letters = panels.map((p, i) => A_Z[i]);
  const title = figureTitle(panels);
  const findings = panels.map((p, i) => {
    const f = panelFinding(p.sel, p.analysis);
    return f ? msg("legend.panel", { letter: letters[i], text: sentence(f) }) : null;
  }).filter(Boolean);

  const ns = panels.map((p) => p.analysis?.ok ? p.analysis.summary.flatMap((s) => s.points.map((q) => q.n)) : [])
                   .flat().filter((n) => n > 0);
  const nLo = Math.min(...ns), nHi = Math.max(...ns);
  const nText = ns.length ? msg("legend.nRange", { lo: nLo, hi: nHi }) : "";

  const tests = [...new Set(panels.map((p) => p.analysis?.ok ? lower(p.analysis.model.test) : null).filter(Boolean))];
  const one = panels.length === 1;
  const stats = panels.map((p, i) => p.analysis?.ok
    ? (one ? inlineStats(p.analysis) : `(${letters[i]}) ${inlineStats(p.analysis)}`)
    : null).filter(Boolean).join("; ");

  const spread = panels.find((p) => p.analysis?.ok)?.analysis.errorBars === "sd" ? "SD" : "SEM";
  return [
    msg("legend.figure", { n: figureNumber, title }),
    joinSentences(findings),
    msg("legend.spread", { spread, n: nText }),
    msg("legend.analysed", { tests: listWords(tests), stats }),
    msg("legend.stars", { control: panels[0].analysis?.control || "control" })
  ].filter(Boolean).join(msg("join.sentence")).trim();
}

function inlineStats(a) {
  const m = a.model;
  if (a.kind === "two-group") return `${S.fmtT(m)}, ${S.fmtP(m.p)}`;
  if (a.kind === "one-way") return `${S.fmtF({ df: m.df1, dfError: m.df2, F: m.F })}, ${S.fmtP(m.p)}`;
  return msg("legend.interaction", { f: S.fmtF(m.effects.interaction), p: S.fmtP(m.effects.interaction.p) });
}

function figureTitle(panels) {
  const tissues = [...new Set(panels.map((p) => p.sel.tissue).filter(Boolean))];
  const rawAnalytes = [...new Set(panels.map((p) => p.sel.analyte))];
  const analytes = rawAnalytes.map(analyteName);

  const sig = panels.some((p) => isSignificant(p.analysis));
  const subject = rawAnalytes.length === 1 && /glucose/i.test(rawAnalytes[0])
    ? msg("draft.glucoseHandling")
    : (tissues.length
        ? msg("draft.subjectIn", { what: listWords(analytes.map(lower)), where: listWords(tissues.map(tissueWord)) })
        : listWords(analytes.map(lower)));
  return msg("draft.figureTitle", {
    verb: msg(sig ? "draft.alters" : "draft.doesNotAlter"), subject, species
  });
}

/**
 * A title for the whole report: what was done, what came of it, and in what.
 * Built from the findings actually present, so it changes when they do.
 */
export function draftTitle(figures) {
  const panels = figures.flatMap((f) => f.panels).filter((p) => p.analysis?.ok);
  if (!panels.length) return "";

  const changed = panels.filter((p) => isSignificant(p.analysis));
  const tissues = [...new Set(changed.map((p) => p.sel.tissue).filter(Boolean))];
  const analytes = [...new Set(changed
    .filter((p) => !/glucose|weight/i.test(p.sel.analyte))
    .map((p) => analyteName(p.sel.analyte)))];
  const systemic = changed.some((p) => /glucose/i.test(p.sel.analyte));
  const weight = changed.some((p) => /weight/i.test(p.sel.analyte));

  const clauses = [];
  if (analytes.length)
    clauses.push(msg("title.changes", {
      specific: tissues.length > 1,
      what: listWords(analytes.map(lower)),
      where: tissues.length ? listWords(tissues.map(tissueWord)) : ""
    }));
  if (systemic) clauses.push(msg("title.glucose"));
  if (weight) clauses.push(msg("title.weight"));
  if (!clauses.length) return msg("title.fallback", { species });

  return cap(msg("title.sentence", { clauses: listWords(clauses), species }));
}

function isSignificant(a) {
  if (!a?.ok) return false;
  if (a.kind === "time") return a.model.effects.interaction.p < 0.05 || a.model.effects.between.p < 0.05;
  return a.model.p < 0.05;
}

/** One sentence per panel, stating the finding — not just what was plotted. */
export function panelFinding(sel, a) {
  if (!a?.ok) return null;
  const what = sel.tissue ? `${tissueWord(sel.tissue)} ${sel.analyte}` : lower(analyteName(sel.analyte));
  if (a.kind === "time") {
    const e = a.model.effects;
    const sig = a.posthoc.filter((c) => c.p < 0.05);
    if (!sig.length && e.interaction.p >= 0.05)
      return msg("finding.noDifference", { what, p: S.fmtP(e.interaction.p) });
    const run = trailingRun(a, sel);
    if (run) return msg("finding.diverged", { what, from: run.from,
      unit: unitWord(timeUnitOf(sel)), p: S.fmtP(run.p).replace("p = ", "p \u2264 ") });
    const worst = [...sig].sort((x, y) => x.p - y.p)[0];
    return msg("finding.clearest", { what, where: describeAt(worst, sel), p: S.fmtP(worst.p) });
  }
  const rising = trendDirection(a);
  const sig = a.posthoc.filter((c) => c.p < 0.05);
  if (a.kind === "one-way" && !sig.length)
    return msg("finding.unchanged", { what, p: S.fmtP(a.model.p) });
  if (a.kind === "one-way") {
    const others = a.summary.length - 1;
    const when = sig.length === others && others > 2
      ? msg("finding.everyDuration")
      : listWords(sig.map((c) => c.label.split(" vs ")[0]));
    return msg("finding.trend", { what, direction: rising, when });
  }
  return msg("finding.twoGroups", { what,
    differed: msg(a.model.p < 0.05 ? "finding.differed" : "finding.didNotDiffer"),
    p: S.fmtP(a.model.p) });
}

function describeAt(c, sel) {
  return c.x == null
    ? msg("finding.in", { group: c.group })
    : msg("finding.at", { group: c.group, x: c.x, unit: unitWord(timeUnitOf(sel)) });
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
  return msg(avg > means[ctrlIdx] ? "finding.rose" : "finding.fell");
}

/** The results-paragraph draft: method recap, trend, aberrant data, statistics. */
export function draftResults(panels, figureNumber = 1) {
  const lines = [];
  const first = panels[0];
  lines.push(methodRecap(first.sel));
  panels.forEach((p, i) => {
    const f = panelFinding(p.sel, p.analysis);
    if (f) lines.push(msg("results.panelRef", {
      text: sentence(f).replace(/[.。]$/, ""), n: figureNumber, letter: A_Z[i] }));
  });
  const stat = panels.map((p, i) => p.analysis?.ok
    ? (panels.length > 1
        ? msg("results.forPanel", { letter: A_Z[i], sentence: statsSentence(p.analysis) })
        : statsSentence(p.analysis))
    : null).filter(Boolean);
  lines.push(...stat);
  const odd = panels.flatMap((p) => p.analysis?.outliers || []);
  if (odd.length) {
    lines.push(msg("results.outlier", { subject: odd[0].subject, group: odd[0].group,
      g: odd[0].G.toFixed(3), crit: odd[0].Gcrit.toFixed(3) }));
  }
  const dropped = panels.flatMap((p) => p.analysis?.dropped || []);
  if (dropped.length) {
    lines.push(msg("results.dropped", { list: listWords([...new Set(dropped)]) }));
  }
  return joinSentences(lines);
}

function methodRecap(sel) {
  const s = (sel.sheet || "").toLowerCase();
  if (/glucose/.test(s)) return msg("method.glucose");
  if (/insulin/.test(s)) return msg("method.insulin");
  if (/weight/.test(s)) return msg("method.weight");
  if (/protein/.test(s)) return msg("method.protein", { tissue: sel.tissue, analyte: sel.analyte });
  if (/mrna|cd68/.test(s)) return msg("method.mrna", { tissue: sel.tissue, analyte: sel.analyte });
  return msg("method.generic");
}

const listWords = (a) => listWordsFor(a);
