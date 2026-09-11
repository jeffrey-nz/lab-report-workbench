/* figure.js — the builder. Controls on the left, a live figure on the right.
   Only the parts that changed are redrawn, so a checkbox keeps focus. */

import { el, $, emptyState } from "../dom.js";
import * as St from "../state.js";
import { state } from "../state.js";
import { groupColors } from "../lib/charts.js";
import { seriesNames, panelName, panelHint } from "../labels.js";
import { saveFigurePng, copyFigure, saveFigureSvg, saveEverything } from "../exports.js";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/* ---------- pickers ---------- */

function seriesPicker() {
  const names = seriesNames();
  const all = state.series.map((s) => s.key);
  const allOn = state.chosen.length === all.length;

  // grouped by the sheet they came from: a flat list of thirty is a wall
  const bySheet = new Map();
  for (const s of state.series) {
    if (!bySheet.has(s.sheet)) bySheet.set(s.sheet, []);
    bySheet.get(s.sheet).push(s);
  }

  const chip = (s) => {
    const { name, hint } = names.get(s.key);
    return el("label", { class: "chip" },
      el("input", {
        type: "checkbox", checked: state.chosen.includes(s.key),
        "data-focus-key": `series:${s.key}`,
        onchange: (e) => St.toggleSeries(s.key, e.target.checked)
      }),
      name,
      hint && hint !== s.sheet ? el("span", { class: "chip-hint" }, hint) : null);
  };

  return el("fieldset", {},
    el("legend", { class: "legend" },
      el("span", {}, `Panels (${state.chosen.length})`)),
    el("div", { id: "series-chips", class: "chip-groups" },
      ...[...bySheet].map(([sheet, list]) => el("div", { class: "chip-group" },
        el("p", { class: "chip-group-label" }, sheet),
        el("div", { class: "chips" }, ...list.map(chip))))),
    el("div", { class: "btn-group", style: "margin-top:10px" },
      el("button", {
        type: "button", class: "btn btn--quiet",
        onclick: () => St.setSeries(allOn ? [all[0]] : all)
      }, allOn ? "Select just the first" : "Select all"),
      state.chosen.length > 1
        ? el("button", {
            type: "button", class: "btn btn--quiet",
            onclick: () => St.setSeries([state.chosen[0]])
          }, "Clear the rest")
        : null));
}

function groupPicker() {
  const colors = groupColors(state.availableGroups, state.records);
  return el("fieldset", {},
    el("legend", { class: "legend" }, `Groups to compare (${state.groups.length})`),
    el("div", { class: "chips", id: "group-chips" }, ...state.availableGroups.map((g) => el("label", { class: "chip" },
      el("input", {
        type: "checkbox", checked: state.groups.includes(g),
        "data-focus-key": `group:${g}`,
        onchange: (e) => St.setGroups(e.target.checked
          ? [...state.groups, g]
          : state.groups.filter((x) => x !== g))
      }),
      el("span", { class: "swatch", style: `background:${colors[g] || "var(--line-2)"}` }),
      g))));
}

/** The panel order decides the letters your report text refers to. */
function panelList() {
  if (state.panels.length < 2) return null;
  const names = seriesNames();
  const nameOf = (p) => panelName(p, names);
  const hintOf = (p) => panelHint(p, names);
  return el("fieldset", {},
    el("legend", { class: "legend" }, "Panel order"),
    el("div", { class: "panel-list" }, ...state.panels.map((p, i) => el("div", {
      class: `panel-item${p.analysis?.ok ? "" : " is-invalid"}`
    },
      el("span", { class: "panel-letter" }, LETTERS[i]),
      el("span", { class: "panel-name" },
        nameOf(p),
        p.analysis?.ok
          ? (hintOf(p) ? el("small", {}, hintOf(p)) : null)
          : el("small", {}, "no test fits this selection")),
      el("span", { class: "panel-actions" },
        el("button", {
          type: "button", class: "btn btn--icon", disabled: i === 0,
          title: "Move up", "aria-label": `Move ${nameOf(p)} earlier`,
          "data-focus-key": `up:${p.key}`,
          onclick: () => St.movePanel(p.key, -1)
        }, "↑"),
        el("button", {
          type: "button", class: "btn btn--icon", disabled: i === state.panels.length - 1,
          title: "Move down", "aria-label": `Move ${nameOf(p)} later`,
          "data-focus-key": `down:${p.key}`,
          onclick: () => St.movePanel(p.key, 1)
        }, "↓"),
        el("button", {
          type: "button", class: "btn btn--icon",
          title: "Remove from the figure", "aria-label": `Remove ${nameOf(p)}`,
          onclick: () => St.toggleSeries(p.key, false)
        }, "×"))))));
}

function options() {
  return el("div", { class: "row", style: "align-items:flex-end" },
    el("div", { class: "field" },
      el("label", { for: "opt-cols" }, "Columns"),
      el("select", {
        id: "opt-cols",
        onchange: (e) => St.setFigureOption({ cols: +e.target.value })
      }, ...[1, 2, 3, 4].map((n) =>
        el("option", { value: n, selected: n === state.cols }, n)))),
    el("div", { class: "field" },
      el("label", { for: "opt-control" }, "Compared against"),
      el("select", {
        id: "opt-control",
        onchange: (e) => St.setFigureOption({ control: e.target.value })
      }, ...state.groups.map((g) =>
        el("option", { value: g, selected: g === state.control }, g)))),
    el("div", { class: "field" },
      el("label", { for: "opt-fignum" }, "Figure number"),
      el("input", {
        type: "number", id: "opt-fignum", min: 1, max: 40, value: state.figNumber,
        style: "width:78px",
        oninput: (e) => St.setFigureOption({ figNumber: +e.target.value || 1 })
      })));
}

/* ---------- preview ---------- */

function preview() {
  const broken = state.panels.filter((p) => !p.analysis?.ok);
  const surface = el("div", { class: "figure-surface", id: "figure-surface" });
  surface.innerHTML = state.svg ||
    `<p class="empty"><strong>Nothing to draw yet</strong>Tick a measurement to add the first panel.</p>`;

  return el("div", { class: "card builder-main" },
    el("div", { class: "card-head" },
      el("h3", {}, `Figure ${state.figNumber}`),
      el("span", { class: "note" }, "Drawn on white for pasting into your report")),
    broken.length
      ? el("div", { class: "callout callout--warn", style: "margin-bottom:12px" },
          el("strong", {}, broken.length === state.panels.length
            ? "This comparison has no valid test. "
            : `${broken.length} of ${state.panels.length} panels cannot be tested. `),
          broken[0].analysis?.reason || "")
      : null,
    surface,
    el("div", { class: "btn-group", style: "margin-top:14px" },
      el("button", { type: "button", class: "btn", onclick: saveFigurePng }, "Download PNG (300 dpi)"),
      el("button", { type: "button", class: "btn btn--ghost", onclick: copyFigure }, "Copy image"),
      el("button", { type: "button", class: "btn btn--ghost", onclick: saveFigureSvg }, "SVG"),
      el("button", { type: "button", class: "btn btn--ghost", onclick: saveEverything },
        "Save everything")),
    el("p", { class: "note", style: "margin-top:10px" },
      "Save everything writes the figure, the statistics, the drafted text and a Prism table."));
}

export const view = {
  id: "figure",
  render(root, { go }) {
    if (!state.loaded) {
      root.replaceChildren(emptyState("No workbook yet", "Load a file on the first step."));
      return;
    }
    root.replaceChildren(
      el("div", { class: "view-head" },
        el("h2", {}, "Build the figure"),
        el("p", {}, "Tick the measurements to become panels and the groups to compare. Panels are drawn into one image, lettered A, B, C, so a multi-panel figure exports as a single file.")),
      el("div", { class: "builder" },
        el("div", { class: "builder-side" },
          el("div", { class: "card" }, seriesPicker()),
          el("div", { class: "card" }, groupPicker()),
          panelList() ? el("div", { class: "card" }, panelList()) : null,
          el("div", { class: "card" }, options())),
        preview())
    );
  }
};
