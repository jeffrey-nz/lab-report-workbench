/* state.js — one store, one way to change it. Views read `state` and call
   `update()`; anything that needs to redraw subscribes. */

import { seriesIndex } from "./lib/parse.js";
import * as A from "./lib/analyse.js";
import { renderFigure } from "./lib/charts.js";

export const state = {
  /* data */
  records: [], issues: [], series: [], tables: [],
  loaded: false, fileName: "", loading: false,

  /* figure */
  chosen: [],            // series keys, in panel order
  groups: [],            // group labels in the comparison
  availableGroups: [],
  control: null,
  cols: 2,
  figNumber: 1,
  size: "comfortable",     // compact | comfortable | large
  errorBars: "sem",        // sem | sd
  showPoints: true,

  /* derived */
  panels: [], svg: "",

  /* view */
  step: "load",
  edits: {}
};

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(reason) {
  for (const fn of listeners) fn(state, reason);
}

export function update(patch, reason = "state") {
  Object.assign(state, patch);
  emit(reason);
}

/* ---------- loading ---------- */

export function loadRecords({ records, issues, tables }, fileName) {
  Object.assign(state, {
    records, issues, tables, series: seriesIndex(records),
    loaded: true, fileName, loading: false,
    chosen: [], groups: [], control: null, panels: [], svg: "", edits: {}
  });
  const first = state.series[0];
  state.chosen = [first.key];
  syncGroups();
  rebuild();
  emit("load");
}

/* ---------- figure selection ---------- */

/**
 * Keep the group selection consistent with the chosen measurements. Adding a
 * measurement whose groups are named differently must not silently leave its
 * panel with nothing to compare, so any panel left short gets its own defaults
 * folded into the selection.
 */
export function syncGroups() {
  const groupsOf = new Map(state.series.map((s) => [s.key, s.groups]));
  const available = new Set(state.chosen.flatMap((key) => groupsOf.get(key) || []));

  state.availableGroups = A.orderGroups([...available], state.records);
  const picked = new Set(state.groups.filter((g) => available.has(g)));

  for (const key of state.chosen) {
    const mine = groupsOf.get(key) || [];
    if (mine.filter((g) => picked.has(g)).length >= 2) continue;
    for (const g of A.defaultGroups(state.records, key)) picked.add(g);
  }

  state.groups = A.orderGroups([...picked], state.records);
  if (!state.groups.length) state.groups = [...state.availableGroups];
  if (!state.groups.includes(state.control))
    state.control = A.pickControl(state.groups, state.records);
}

/** Panel geometry per size setting, in CSS pixels at 96 dpi. */
export const SIZES = {
  compact:     { w: 300, h: 240, label: "Compact" },
  comfortable: { w: 360, h: 290, label: "Comfortable" },
  large:       { w: 430, h: 340, label: "Large" }
};

/** Recompute every panel and redraw the figure. */
export function rebuild() {
  state.panels = state.chosen.map((key) => {
    const sel = A.buildSelection(state.records, key, state.groups);
    const analysis = A.analyse(sel, { control: state.control, errorBars: state.errorBars });
    return { key, sel, analysis, labels: { x: A.xAxisLabel(sel), y: A.axisLabel(sel) } };
  });
  const cols = Math.max(1, Math.min(state.cols, state.panels.length || 1));
  const size = SIZES[state.size] || SIZES.comfortable;
  state.svg = state.panels.length
    ? renderFigure(state.panels, {
        cols, records: state.records,
        panelW: size.w, panelH: size.h,
        showPoints: state.showPoints
      })
    : "";
}

/** Usable text width on A4 with 20 mm margins. */
export const A4_TEXT_MM = 170;

const mmOf = (px) => px / 96 * 25.4;

/**
 * The widest layout that still fits an A4 text column, preferring to keep the
 * columns the reader chose and only then shrinking the panels. Returns null
 * when nothing fits, so the caller can say so rather than offer a dead end.
 */
export function layoutThatFits() {
  const panels = state.panels.length || 1;
  for (let cols = Math.min(state.cols, panels); cols >= 1; cols--) {
    for (const size of ["large", "comfortable", "compact"]) {
      if (mmOf(cols * SIZES[size].w) <= A4_TEXT_MM)
        return { cols, size, mmWide: Math.round(mmOf(cols * SIZES[size].w)) };
    }
  }
  return null;
}

/** The printed width of the figure, so the page budget is visible up front. */
export function figureExtent() {
  if (!state.svg) return null;
  const m = state.svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!m) return null;
  const [w, h] = [Number(m[1]), Number(m[2])];
  return { w, h, mmWide: Math.round(w / 96 * 25.4), mmTall: Math.round(h / 96 * 25.4) };
}

export function setSeries(keys) {
  state.chosen = keys;
  syncGroups();
  rebuild();
  emit("series");
}

export function toggleSeries(key, on) {
  setSeries(on ? [...state.chosen, key] : state.chosen.filter((k) => k !== key));
}

export function movePanel(key, delta) {
  const i = state.chosen.indexOf(key);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= state.chosen.length) return;
  const next = [...state.chosen];
  [next[i], next[j]] = [next[j], next[i]];
  state.chosen = next;
  rebuild();
  emit("panels");
}

export function setGroups(groups) {
  state.groups = A.orderGroups(groups, state.records);
  if (!state.groups.includes(state.control))
    state.control = A.pickControl(state.groups, state.records);
  rebuild();
  emit("groups");
}

export function setFigureOption(patch) {
  Object.assign(state, patch);
  rebuild();
  emit("figure");
}
