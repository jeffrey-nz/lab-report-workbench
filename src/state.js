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

/** Recompute every panel and redraw the figure. */
export function rebuild() {
  state.panels = state.chosen.map((key) => {
    const sel = A.buildSelection(state.records, key, state.groups);
    const analysis = A.analyse(sel, { control: state.control });
    return { key, sel, analysis, labels: { x: A.xAxisLabel(sel), y: A.axisLabel(sel) } };
  });
  const cols = Math.max(1, Math.min(state.cols, state.panels.length || 1));
  const wide = cols >= 3;
  state.svg = state.panels.length
    ? renderFigure(state.panels, {
        cols, records: state.records,
        panelW: wide ? 330 : 360,
        panelH: wide ? 270 : 290
      })
    : "";
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

/** True when every chosen panel produced a usable analysis. */
export const panelsValid = () => state.panels.every((p) => p.analysis?.ok);
