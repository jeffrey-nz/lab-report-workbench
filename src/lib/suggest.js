/* suggest.js — propose whole figures from what the workbook contains.
   A report is usually one figure per tissue or per assay, not one per
   measurement, and assembling those by hand is the repetitive part. */

import { t, list as listWords } from "../i18n/index.js";

const MAX_PANELS = 6;

/* Names the tool generated are translated; names read from the sheet — WAT,
   IL-1β — are what the literature uses in any language and stay as they are. */
const named = (prefix, name) => {
  const shown = t(`${prefix}.${name}`);
  return shown.startsWith("\u27e6") ? name : shown;
};
const localName = (name) => named("analyte", name);
const localTissue = (name) => named("tissue", name);
const localAssay = (unit) => {
  const kind = assay(unit);
  return kind ? named("assay", kind) : "";
};

const assay = (unit) => {
  if (!unit) return "";
  if (/fold/i.test(unit)) return "mRNA";
  if (/\bng\b|\bpg\b|per\s*mg/i.test(unit)) return "protein";
  return unit;
};

/** Protein before mRNA, then a stable cytokine order, then by name. */
const ANALYTE_ORDER = ["IL-1β", "TNF-α", "IL-6", "CD68"];
function rank(s) {
  const a = ANALYTE_ORDER.indexOf(s.analyte);
  return [assay(s.unit) === "mRNA" ? 1 : 0, a < 0 ? ANALYTE_ORDER.length : a, s.analyte];
}
function bySensibleOrder(x, y) {
  const [ax, bx, cx] = rank(x), [ay, by, cy] = rank(y);
  return ax - ay || bx - by || String(cx).localeCompare(String(cy));
}

const columnsFor = (n) => (n <= 1 ? 1 : n <= 4 ? 2 : 3);

/** A title begins with a capital where the language has them; Japanese is
    unaffected, since the rule only touches an ASCII lower-case first letter. */
const asTitle = (s) => (/^[a-z]/.test(s) ? s[0].toUpperCase() + s.slice(1) : s);

/** `panels` are {key, groups}; groups null means "whatever the figure uses". */
const figure = (kind, title, panels, detail) => ({
  kind,
  title: asTitle(title),
  detail: detail || t("figure.panelCount", { n: panels.length }),
  panels,
  cols: columnsFor(panels.length)
});
const plain = (list) => list.map((s) => ({ key: s.key, groups: null }));

/**
 * A tolerance test answers two questions that need two panels: does the diet
 * change the response, and does the change depend on how long they were fed?
 * The first compares control with the longest-fed group; the second follows one
 * diet across its durations. Returns null unless the data supports both.
 */
function tolerancePair(series, meta) {
  const groups = series.groups.map((g) => ({ label: g, ...meta(g) }));
  const chow = groups.filter((g) => g.diet === "NCD").sort((a, b) => (a.weeks ?? 0) - (b.weeks ?? 0));
  const fat = groups.filter((g) => g.diet === "HFD").sort((a, b) => (a.weeks ?? 0) - (b.weeks ?? 0));
  if (!chow.length || fat.length < 2) return null;
  const longest = fat[fat.length - 1];
  return [
    { key: series.key, groups: [chow[0].label, longest.label] },
    { key: series.key, groups: fat.map((g) => g.label) }
  ];
}

/**
 * The same tissue assay can appear on two sheets — a cytokine panel that also
 * has its own sheet, say. Suggest it once, from wherever it is most complete.
 * Only tissue measurements are merged: two sheets both reporting blood glucose
 * are two different experiments, not one repeated.
 */
function dedupe(series) {
  const best = new Map();
  const out = [];
  for (const s of series) {
    if (!s.tissue) { out.push(s); continue; }
    const key = `${s.tissue}|${s.analyte}|${assay(s.unit)}`;
    const held = best.get(key);
    if (!held || s.n > held.n) best.set(key, s);
  }
  return [...out, ...best.values()];
}

/**
 * A measurement recorded alongside another test — body weight taken at a
 * glucose tolerance test — is a covariate, not a result. It stays available to
 * pick by hand, but it does not deserve a figure of its own.
 */
function isSupporting(s, all) {
  if (s.tissue || s.hasTime) return false;
  return all.some((o) => o !== s && o.analyte === s.analyte && o.hasTime);
}

export function suggestFigures(series, meta = null) {
  // A measurement recorded in only one group has nothing to compare, so it can
  // never become a figure with a test behind it. It stays in the list to pick
  // by hand; it is not proposed.
  const comparable = series.filter((s) => s.groups.length >= 2);
  const pool = dedupe(comparable).filter((s, _, all) => !isSupporting(s, all));
  const used = new Set();
  const out = [];

  // 1. time courses of the same measurement, across sheets
  const byAnalyte = new Map();
  for (const s of pool) {
    if (s.tissue || !s.hasTime) continue;
    byAnalyte.set(s.analyte, [...(byAnalyte.get(s.analyte) || []), s]);
  }
  for (const [analyte, list] of byAnalyte) {
    list.forEach((s) => used.add(s.key));
    const sheets = list.map((s) => s.sheet.replace(/\s*data\s*$/i, ""));

    // where the data allows it, each test earns two panels rather than one
    const pairs = meta ? list.map((s) => tolerancePair(s, meta)) : [];
    if (meta && pairs.length && pairs.every(Boolean)) {
        out.push(figure("course", t("suggest.courseN", { analyte: localName(analyte) }), pairs.flat(),
        t("figure.panelsPaired", { n: pairs.length * 2 })));
      continue;
    }
    out.push(figure("course",
      t(list.length > 1 ? "suggest.courseN" : "suggest.course1", { analyte: localName(analyte) }),
      plain(list),
      list.length > 1 ? t("figure.panelsAcross", { n: list.length, sheets: sheets.join(", ") }) : null));
  }

  // 2. a figure per tissue: protein and mRNA together while they fit, split by
  //    assay when they do not, rather than sliced at an arbitrary sixth panel
  const byTissue = new Map();
  for (const s of pool) {
    if (!s.tissue || used.has(s.key)) continue;
    byTissue.set(s.tissue, [...(byTissue.get(s.tissue) || []), s]);
  }
  for (const [tissue, list] of byTissue) {
    const ordered = [...list].sort(bySensibleOrder);
    const assays = [...new Set(ordered.map((s) => assay(s.unit)).filter(Boolean))];
    const parts = ordered.length <= MAX_PANELS || assays.length < 2
      ? [ordered]
      : assays.map((a) => ordered.filter((s) => assay(s.unit) === a));

    for (const part of parts) {
      for (let i = 0; i < part.length; i += MAX_PANELS) {
        const slice = part.slice(i, i + MAX_PANELS);
        slice.forEach((s) => used.add(s.key));
        const names = [...new Set(slice.map((s) => localAssay(s.unit)).filter(Boolean))];
        out.push(figure("tissue",
          t("suggest.tissue", { tissue: localTissue(tissue), assays: listWords(names) }),
          plain(slice)));
      }
    }
  }

  // 3. one measurement compared across the tissues it was made in
  const acrossTissues = new Map();
  for (const s of pool) {
    if (!s.tissue) continue;
    const key = `${s.analyte}|${assay(s.unit)}`;
    acrossTissues.set(key, [...(acrossTissues.get(key) || []), s]);
  }
  for (const [key, group] of acrossTissues) {
    if (group.length < 3) continue;
    const [analyte, kind] = key.split("|");
    const shownKind = kind ? named("assay", kind) : "";
    out.push(figure("across",
      t("suggest.across", { what: `${localName(analyte)}${shownKind ? " " + shownKind : ""}` }),
      plain([...group].sort((a, b) => a.tissue.localeCompare(b.tissue)))));
  }

  // 4. anything still unplaced, offered on its own rather than dropped
  for (const s of pool) {
    if (used.has(s.key)) continue;
    out.push(figure("single", t("suggest.single", {
      name: [s.tissue && localTissue(s.tissue), localName(s.analyte)].filter(Boolean).join(" ")
    }), plain([s])));
  }

  return out;
}
