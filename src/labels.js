/* labels.js — how a measurement is named in the interface.
   One source of truth, so the chip, the panel list, the statistics heading and
   the exported files all call the same thing by the same name. */

import { state } from "./state.js";
import { panelTitle } from "./lib/analyse.js";

export function assayOf(unit) {
  if (!unit) return "";
  if (/fold/i.test(unit)) return "mRNA";
  if (/\bng\b|\bpg\b|per\s*mg/i.test(unit)) return "protein";
  return unit;
}

/**
 * A display name per series key, plus a hint that only appears when it is
 * needed to tell two otherwise identical measurements apart.
 */
export function seriesNames() {
  const base = (s) => [s.tissue, s.analyte].filter(Boolean).join(" ");
  const label = (s) => `${base(s)}|${assayOf(s.unit)}`;
  const counts = new Map();
  for (const s of state.series) counts.set(label(s), (counts.get(label(s)) || 0) + 1);

  return new Map(state.series.map((s) => [s.key, {
    name: base(s),
    sheet: s.sheet,
    // name the assay; fall back to the sheet only when that is still ambiguous
    hint: counts.get(label(s)) > 1
      ? s.sheet.replace(/\s*(data|levels)\s*$/i, "").trim()
      : assayOf(s.unit)
  }]));
}

export function panelName(panel, names = seriesNames()) {
  return panelTitle(panel.sel) || names.get(panel.key)?.name || "This measurement";
}

/** The hint, only when it adds something the name does not already say. */
export function panelHint(panel, names = seriesNames()) {
  const hint = names.get(panel.key)?.hint;
  return hint && hint !== panelName(panel, names) ? hint : null;
}

/** "Blood glucose (Glucose Tolerance)" — for headings and file contents. */
export function panelFullName(panel, names = seriesNames()) {
  const hint = panelHint(panel, names);
  return hint ? `${panelName(panel, names)} (${hint})` : panelName(panel, names);
}
