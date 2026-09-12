/* state.js — one store, one way to change it. Views read `state` and call
   `update()`; anything that needs to redraw subscribes. */

import { seriesIndex } from "./lib/parse.js";
import { suggestFigures } from "./lib/suggest.js";
import * as A from "./lib/analyse.js";
import { renderFigure } from "./lib/charts.js";

export const state = {
  /* data */
  records: [], issues: [], series: [], tables: [],
  loaded: false, fileName: "", loading: false,

  /* the report is a set of figures; these fields are the one being worked on */
  figures: [],           // [{ id, chosen, groups, control, cols, size, errorBars, showPoints }]
  activeId: null,

  chosen: [],            // series keys, in panel order
  groups: [],            // group labels in the comparison
  availableGroups: [],
  control: null,
  cols: 2,
  size: "comfortable",   // compact | comfortable | large
  errorBars: "sem",      // sem | sd
  showPoints: true,

  /* derived */
  panels: [], svg: "",

  /* view */
  step: "load",
  edits: {}              // drafted text, keyed by figure id
};

/* ---------- the set of figures ---------- */

const FIGURE_FIELDS = ["chosen", "groups", "control", "cols", "size", "errorBars", "showPoints"];
let nextId = 1;

export const activeFigure = () => state.figures.find((f) => f.id === state.activeId) || null;

/** Where a figure sits in the report is its number; nothing to keep in sync. */
export const figureNumber = (id = state.activeId) =>
  state.figures.findIndex((f) => f.id === id) + 1;

/** Copy the working fields into the figure being worked on. */
function snapshot() {
  const fig = activeFigure();
  if (fig) for (const k of FIGURE_FIELDS) fig[k] = state[k];
}

function restore(fig) {
  for (const k of FIGURE_FIELDS) state[k] = fig[k];
  state.activeId = fig.id;
  syncGroups();
  rebuild();
}

function blankFigure(seed = {}) {
  return {
    id: nextId++,
    chosen: [], groups: [], control: null,
    cols: 2, size: "comfortable", errorBars: "sem", showPoints: true,
    ...seed
  };
}

export function addFigure(seed) {
  snapshot();
  const fig = blankFigure(seed);
  if (!fig.chosen.length && state.series.length) fig.chosen = [state.series[0].key];
  state.figures.push(fig);
  restore(fig);
  emit("figures");
  return fig;
}

export function switchFigure(id) {
  if (id === state.activeId) return;
  snapshot();
  const fig = state.figures.find((f) => f.id === id);
  if (!fig) return;
  restore(fig);
  emit("figures");
}

export function duplicateFigure() {
  snapshot();
  const fig = activeFigure();
  if (!fig) return;
  const copy = blankFigure({ ...fig, chosen: [...fig.chosen], groups: [...fig.groups] });
  state.figures.splice(state.figures.indexOf(fig) + 1, 0, copy);
  restore(copy);
  emit("figures");
}

export function removeFigure(id) {
  const i = state.figures.findIndex((f) => f.id === id);
  if (i < 0 || state.figures.length < 2) return;
  delete state.edits[`legend:${id}`];
  delete state.edits[`results:${id}`];
  state.figures.splice(i, 1);
  restore(state.figures[Math.min(i, state.figures.length - 1)]);
  emit("figures");
}

export function moveFigure(id, delta) {
  const i = state.figures.findIndex((f) => f.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= state.figures.length) return;
  const [fig] = state.figures.splice(i, 1);
  state.figures.splice(j, 0, fig);
  emit("figures");
}

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
  nextId = 1;
  Object.assign(state, {
    records, issues, tables, series: seriesIndex(records),
    loaded: true, fileName, loading: false,
    figures: [], activeId: null,
    chosen: [], groups: [], control: null, panels: [], svg: "", edits: {}
  });
  const fig = blankFigure({ chosen: [state.series[0].key] });
  state.figures.push(fig);
  restore(fig);
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

/** Panels and SVG for any figure record, without touching what is on screen. */
export function computeFigure(fig) {
  const panels = fig.chosen.map((key) => {
    const sel = A.buildSelection(state.records, key, fig.groups);
    const analysis = A.analyse(sel, { control: fig.control, errorBars: fig.errorBars });
    return { key, sel, analysis, labels: { x: A.xAxisLabel(sel), y: A.axisLabel(sel) } };
  });
  const cols = Math.max(1, Math.min(fig.cols, panels.length || 1));
  const size = SIZES[fig.size] || SIZES.comfortable;
  const svg = panels.length
    ? renderFigure(panels, {
        cols, records: state.records,
        panelW: size.w, panelH: size.h,
        showPoints: fig.showPoints
      })
    : "";
  return { panels, svg };
}

/** Recompute the figure being worked on and redraw it. */
export function rebuild() {
  snapshot();
  const fig = activeFigure();
  const { panels, svg } = computeFigure(fig || { ...state, chosen: state.chosen });
  state.panels = panels;
  state.svg = svg;
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

/* ---------- suggestions ---------- */

export const suggestions = () => (state.loaded ? suggestFigures(state.series) : []);

/** Point the figure being worked on at a suggested set of panels. */
export function applySuggestion(suggestion) {
  state.chosen = suggestion.keys.filter((k) => state.series.some((s) => s.key === k));
  state.cols = suggestion.cols;
  state.groups = [];                       // let the defaults follow the new panels
  syncGroups();
  rebuild();
  emit("suggestion");
}

/** Build a figure for each suggestion at once — the whole results section. */
export function buildReport(list) {
  if (!list.length) return;
  snapshot();
  state.figures = [];
  state.activeId = null;
  for (const suggestion of list) {
    const fig = blankFigure({ chosen: suggestion.keys, cols: suggestion.cols });
    state.figures.push(fig);
  }
  restore(state.figures[0]);
  // each figure needs its own sensible groups, not the first one's
  for (const fig of state.figures) {
    const saved = state.activeId;
    state.activeId = fig.id;
    for (const k of FIGURE_FIELDS) state[k] = fig[k];
    state.groups = [];
    syncGroups();
    for (const k of FIGURE_FIELDS) fig[k] = state[k];
    state.activeId = saved;
  }
  restore(state.figures[0]);
  emit("figures");
}

/** Every figure in the report, computed. */
export function allFigures() {
  snapshot();
  return state.figures.map((fig, i) => ({ fig, number: i + 1, ...computeFigure(fig) }));
}
