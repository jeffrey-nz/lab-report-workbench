/* state.js — one store, one way to change it. Views read `state` and call
   `update()`; anything that needs to redraw subscribes. */

import { seriesIndex, groupMeta } from "./lib/parse.js";
import { suggestFigures } from "./lib/suggest.js";
import { t } from "./i18n/index.js";
import * as A from "./lib/analyse.js";
import { renderFigure } from "./lib/charts.js";

export const state = {
  /* data */
  records: [], issues: [], series: [], tables: [],
  loaded: false, fileName: "", loading: false,

  /* the report is a set of figures; these fields are the one being worked on */
  figures: [],           // [{ id, chosen, groups, control, cols, size, errorBars, showPoints }]
  activeId: null,

  chosen: [],            // [{ id, key, groups }] in panel order; groups null = the figure's
  groups: [],            // group labels in the comparison
  availableGroups: [],
  control: null,
  cols: 2,
  size: "comfortable",   // compact | comfortable | large
  errorBars: "sem",      // sem | sd
  showPoints: true,

  /* derived */
  panels: [], svg: "",

  species: "",           // named once, used in every drafted title

  /* view */
  step: "load",
  edits: {}              // drafted text, keyed by figure id
};

/* ---------- the set of figures ---------- */

const FIGURE_FIELDS = ["chosen", "groups", "control", "cols", "size", "errorBars", "showPoints"];
let nextId = 1;
let nextPanelId = 1;

/** A panel is a measurement, optionally with a group selection of its own. */
export const makePanel = (key, groups = null) => ({ id: nextPanelId++, key, groups });

/** The groups a panel is actually drawn with. */
export const panelGroups = (panel, fig = state) => panel.groups || fig.groups;

export const chosenKeys = () => [...new Set(state.chosen.map((p) => p.key))];
export const hasKey = (key) => state.chosen.some((p) => p.key === key);

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
  if (!fig.chosen.length && state.series.length) fig.chosen = [makePanel(state.series[0].key)];
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
  const copy = blankFigure({ ...fig,
    chosen: fig.chosen.map((p) => makePanel(p.key, p.groups ? [...p.groups] : null)),
    groups: [...fig.groups] });
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
  const fig = blankFigure({ chosen: [makePanel(state.series[0].key)] });
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
  const available = new Set(chosenKeys().flatMap((key) => groupsOf.get(key) || []));

  state.availableGroups = A.orderGroups([...available], state.records);
  const picked = new Set(state.groups.filter((g) => available.has(g)));

  for (const panel of state.chosen) {
    // a panel with groups of its own does not need the figure's to suit it
    if (panel.groups) {
      panel.groups = panel.groups.filter((g) => available.has(g));
      if (panel.groups.length >= 2) continue;
      panel.groups = null;
    }
    const mine = groupsOf.get(panel.key) || [];
    if (mine.filter((g) => picked.has(g)).length >= 2) continue;
    for (const g of A.defaultGroups(state.records, panel.key)) picked.add(g);
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
  const panels = fig.chosen.map((panel) => {
    const sel = A.buildSelection(state.records, panel.key, panelGroups(panel, fig));
    const analysis = A.analyse(sel, { control: fig.control, errorBars: fig.errorBars });
    return { ...panel, sel, analysis, labels: { x: A.xAxisLabel(sel), y: A.axisLabel(sel) } };
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

/** Usable text area on A4 with 20 mm margins. */
export const A4_TEXT_MM = 170;
export const A4_TEXT_HEIGHT_MM = 250;

const mmOf = (px) => px / 96 * 25.4;

/**
 * The widest layout that still fits an A4 text column, preferring to keep the
 * columns the reader chose and only then shrinking the panels. Returns null
 * when nothing fits, so the caller can say so rather than offer a dead end.
 */
export function layoutThatFits() {
  const count = state.panels.length || 1;
  const candidates = [];
  for (let cols = 1; cols <= Math.min(4, count); cols++) {
    for (const size of ["large", "comfortable", "compact"]) {
      const rows = Math.ceil(count / cols);
      const mmWide = mmOf(cols * SIZES[size].w);
      const scale = Math.min(1, A4_TEXT_MM / mmWide);
      const share = (mmOf(rows * SIZES[size].h) * scale) / A4_TEXT_HEIGHT_MM;
      if (mmWide <= A4_TEXT_MM && share <= 0.58)
        candidates.push({ cols, size, mmWide: Math.round(mmWide), share });
    }
  }
  if (!candidates.length) return null;
  // the roomiest layout that still leaves the page a legend
  return candidates.sort((a, b) => b.share - a.share || b.cols - a.cols)[0];
}

/** The printed width of the figure, so the page budget is visible up front. */
/** How much of a page a figure will take once Word has scaled it to the text
    width — the marking criterion is a share of the page, not a size in mm. */
const PAGE_SHARE = [
  [0.30, "share.quarter"], [0.45, "share.third"], [0.58, "share.half"],
  [0.80, "share.twoThirds"], [Infinity, "share.most"]
];

export function figureExtent() {
  if (!state.svg) return null;
  const m = state.svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!m) return null;
  const [w, h] = [Number(m[1]), Number(m[2])];
  const mmWide = mmOf(w), mmTall = mmOf(h);
  const scale = Math.min(1, A4_TEXT_MM / mmWide);
  const share = (mmTall * scale) / A4_TEXT_HEIGHT_MM;
  return {
    w, h,
    mmWide: Math.round(mmWide),
    mmTall: Math.round(mmTall),
    share,
    shareText: t(PAGE_SHARE.find(([limit]) => share <= limit)[1]),
    // past this the legend is pushed onto the next page
    leavesRoomForLegend: share <= 0.58
  };
}

export function setSeries(keys) {
  state.chosen = keys.map((k) => (typeof k === "string" ? makePanel(k) : k));
  syncGroups();
  rebuild();
  emit("series");
}

/** Ticking a measurement adds one panel; unticking removes every panel of it. */
export function toggleSeries(key, on) {
  setSeries(on
    ? [...state.chosen, makePanel(key)]
    : state.chosen.filter((p) => p.key !== key));
}

/**
 * The same measurement can appear twice in a figure with different groups — a
 * tolerance test shown against its control and again across durations — so a
 * copy starts with the figure's current groups as its own.
 */
export function duplicatePanel(id) {
  const i = state.chosen.findIndex((p) => p.id === id);
  if (i < 0) return;
  const copy = makePanel(state.chosen[i].key, [...panelGroups(state.chosen[i])]);
  state.chosen = [...state.chosen.slice(0, i + 1), copy, ...state.chosen.slice(i + 1)];
  rebuild();
  emit("panels");
}

export function removePanel(id) {
  state.chosen = state.chosen.filter((p) => p.id !== id);
  syncGroups();
  rebuild();
  emit("panels");
}

/** Give one panel its own groups, or pass null to follow the figure again. */
export function setPanelGroups(id, groups) {
  const panel = state.chosen.find((p) => p.id === id);
  if (!panel) return;
  panel.groups = groups ? A.orderGroups(groups, state.records) : null;
  rebuild();
  emit("panels");
}

export function movePanel(id, delta) {
  const i = state.chosen.findIndex((p) => p.id === id);
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

export function setSpecies(value) {
  state.species = value;
  A.setSpecies(value);
  emit("species");
}

export function setFigureOption(patch) {
  Object.assign(state, patch);
  rebuild();
  emit("figure");
}

/* ---------- suggestions ---------- */

export const suggestions = () =>
  (state.loaded ? suggestFigures(state.series, groupMeta(state.records)) : []);

/** Point the figure being worked on at a suggested set of panels. */
export function applySuggestion(suggestion) {
  const known = (k) => state.series.some((s) => s.key === k);
  state.chosen = suggestion.panels
    .filter((p) => known(p.key))
    .map((p) => makePanel(p.key, p.groups ? [...p.groups] : null));
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
    const fig = blankFigure({
      chosen: suggestion.panels.map((p) => makePanel(p.key, p.groups ? [...p.groups] : null)),
      cols: suggestion.cols
    });
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
