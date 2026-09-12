/* figure.js — the builder. Controls on the left, a live figure on the right.
   Only the parts that changed are redrawn, so a checkbox keeps focus. */

import { el, $, emptyState, setChildren } from "../dom.js";
import * as St from "../state.js";
import { state, SIZES, figureExtent, layoutThatFits, A4_TEXT_MM,
         figureNumber, suggestions, hasKey, panelGroups } from "../state.js";
import { groupColors } from "../lib/charts.js";
import { seriesNames, panelName, panelHint } from "../labels.js";
import { saveFigurePng, copyFigure, saveFigureSvg, saveEverything } from "../exports.js";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** One tab per figure in the report; the letters inside each are its panels. */
function figureTabs() {
  return el("div", { class: "fig-tabs", role: "tablist", "aria-label": "Figures in this report" },
    ...state.figures.map((fig, i) => {
      const active = fig.id === state.activeId;
      return el("div", { class: `fig-tab${active ? " is-on" : ""}` },
        el("button", {
          type: "button", role: "tab", "aria-selected": String(active),
          "data-focus-key": `fig:${fig.id}`,
          onclick: () => St.switchFigure(fig.id)
        }, `Figure ${i + 1}`,
          el("span", { class: "fig-tab-count" }, String(fig.chosen.length))),
        active && state.figures.length > 1
          ? el("button", {
              type: "button", class: "fig-tab-close",
              "aria-label": `Remove figure ${i + 1}`, title: "Remove this figure",
              onclick: () => St.removeFigure(fig.id)
            }, "×")
          : null);
    }),
    el("button", {
      type: "button", class: "fig-tab-add", "data-focus-key": "fig:add",
      title: "Add an empty figure", onclick: () => St.addFigure()
    }, "+ Add"),
    state.figures.length > 1
      ? el("button", {
          type: "button", class: "btn btn--quiet", style: "margin-left:auto",
          onclick: () => St.duplicateFigure()
        }, "Duplicate")
      : null);
}

/** Whole figures the workbook suggests, so a results section is a few clicks. */
function suggestionPanel() {
  const all = suggestions();
  if (!all.length) return null;
  const primary = all.filter((s) => s.kind !== "across");
  const across = all.filter((s) => s.kind === "across");

  const button = (sug) => el("button", {
    type: "button", class: "suggestion",
    onclick: () => St.applySuggestion(sug)
  }, el("span", { class: "suggestion-title" }, sug.title),
     el("span", { class: "suggestion-detail" }, sug.detail));

  // Wide open on a fresh workbook, folded away once a report has been built
  const fresh = state.figures.length === 1 && state.chosen.length <= 1;
  return el("details", { class: "suggest-block", open: fresh },
    el("summary", {},
      el("span", { class: "legend" }, "Suggested figures"),
      el("span", { class: "note" }, `${primary.length} ready to use`)),
    el("p", { class: "note", style: "margin:8px 0 10px" },
      "Each one fills the figure you are on."),
    el("div", { class: "suggestions" }, ...primary.map(button)),
    across.length
      ? el("details", { class: "more-suggestions" },
          el("summary", {}, `Compare one measurement across tissues (${across.length})`),
          el("div", { class: "suggestions" }, ...across.map(button)))
      : null,
    primary.length > 1
      ? el("button", {
          type: "button", class: "btn btn--ghost", style: "margin-top:12px;width:100%",
          onclick: () => St.buildReport(primary)
        }, `Build all ${primary.length} as a results section`)
      : null);
}

/* ---------- pickers ---------- */

let filter = "";

function seriesPicker() {
  const names = seriesNames();
  const all = state.series.map((s) => s.key);
  const allOn = new Set(state.chosen.map((p) => p.key)).size === all.length;
  const needle = filter.trim().toLowerCase();
  const matches = (s) => !needle ||
    `${names.get(s.key).name} ${names.get(s.key).hint} ${s.sheet}`.toLowerCase().includes(needle);
  // a panel the filter hides is still in the figure, so say so
  const hidden = state.series.filter((s) => hasKey(s.key) && !matches(s));

  // grouped by the sheet they came from: a flat list of thirty is a wall
  const bySheet = new Map();
  for (const s of state.series) {
    if (!matches(s)) continue;
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
      el("span", {}, `Panels (${state.chosen.length} of ${all.length})`)),
    el("input", {
      type: "search", class: "filter", id: "series-filter", value: filter,
      placeholder: "Filter measurements…", "aria-label": "Filter measurements",
      "data-focus-key": "series:filter",
      oninput: (e) => { filter = e.target.value; St.update({}, "filter"); }
    }),
    el("div", { id: "series-chips", class: "chip-groups scroll-y" },
      bySheet.size
        ? [...bySheet].map(([sheet, list]) => el("div", { class: "chip-group" },
            el("p", { class: "chip-group-label" }, sheet),
            el("div", { class: "chips" }, ...list.map(chip))))
        : el("p", { class: "note" }, `Nothing matches "${filter}".`)),
    hidden.length
      ? el("p", { class: "note filter-note" },
          `${hidden.length} chosen panel${hidden.length > 1 ? "s are" : " is"} hidden by this filter. `,
          el("button", {
            type: "button", class: "btn btn--quiet",
            onclick: () => { filter = ""; St.update({}, "filter"); }
          }, "Clear the filter"))
      : null,
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

/**
 * The panels of this figure in order — the letters the report text refers to.
 * A panel can carry a group selection of its own, which is how one measurement
 * appears twice in a figure answering two different questions.
 */
let openPanel = null;

function panelRow(p, i, names) {
  const own = !!p.groups;
  const groups = panelGroups(p);
  const expanded = openPanel === p.id;
  const colors = groupColors(state.availableGroups, state.records);
  const hint = panelHint(p, names);

  const summary = el("button", {
    type: "button", class: `panel-groups${own ? " is-own" : ""}`,
    "aria-expanded": String(expanded), "data-focus-key": `pgroups:${p.id}`,
    title: own ? "This panel has groups of its own" : "Uses the figure's groups",
    onclick: () => { openPanel = expanded ? null : p.id; St.update({}, "panel-groups"); }
  }, own ? groups.join(", ") : "Figure groups", el("span", { class: "caret" }, expanded ? "▾" : "▸"));

  const editor = !expanded ? null : el("div", { class: "panel-group-editor" },
    el("div", { class: "chips" }, ...state.availableGroups.map((g) => el("label", { class: "chip" },
      el("input", {
        type: "checkbox", checked: groups.includes(g),
        "data-focus-key": `pg:${p.id}:${g}`,
        onchange: (e) => St.setPanelGroups(p.id, e.target.checked
          ? [...groups, g]
          : groups.filter((x) => x !== g))
      }),
      el("span", { class: "swatch", style: `background:${colors[g] || "var(--line-2)"}` }), g))),
    own
      ? el("button", {
          type: "button", class: "btn btn--quiet", style: "margin-top:8px",
          onclick: () => St.setPanelGroups(p.id, null)
        }, "Follow the figure's groups again")
      : null);

  return el("div", { class: `panel-item${p.analysis?.ok ? "" : " is-invalid"}${expanded ? " is-open" : ""}` },
    el("div", { class: "panel-row" },
      el("span", { class: "panel-letter" }, LETTERS[i]),
      el("span", { class: "panel-name" },
        panelName(p, names),
        p.analysis?.ok
          ? (hint ? el("small", {}, hint) : null)
          : el("small", {}, "no test fits this selection")),
      el("span", { class: "panel-actions" },
        el("button", {
          type: "button", class: "btn btn--icon", disabled: i === 0,
          title: "Move up", "aria-label": `Move ${panelName(p, names)} earlier`,
          "data-focus-key": `up:${p.id}`,
          onclick: () => St.movePanel(p.id, -1)
        }, "↑"),
        el("button", {
          type: "button", class: "btn btn--icon", disabled: i === state.panels.length - 1,
          title: "Move down", "aria-label": `Move ${panelName(p, names)} later`,
          "data-focus-key": `down:${p.id}`,
          onclick: () => St.movePanel(p.id, 1)
        }, "↓"),
        el("button", {
          type: "button", class: "btn btn--icon",
          title: "Show this measurement again with different groups",
          "aria-label": `Add another panel of ${panelName(p, names)}`,
          "data-focus-key": `dup:${p.id}`,
          onclick: () => { openPanel = null; St.duplicatePanel(p.id); }
        }, "⧉"),
        el("button", {
          type: "button", class: "btn btn--icon",
          title: "Remove this panel", "aria-label": `Remove ${panelName(p, names)}`,
          "data-focus-key": `rm:${p.id}`,
          onclick: () => St.removePanel(p.id)
        }, "×"))),
    summary,
    editor);
}

function panelList() {
  if (!state.panels.length) return null;
  const names = seriesNames();
  return el("fieldset", {},
    el("legend", { class: "legend" }, "Panels in this figure"),
    el("div", { class: "panel-list scroll-y" },
      ...state.panels.map((p, i) => panelRow(p, i, names))),
    el("p", { class: "note", style: "margin-top:10px" },
      "⧉ adds the same measurement again, so one figure can answer two questions about it."));
}

/** A row of mutually exclusive choices, as buttons rather than a dropdown. */
function choice(label, value, options, onPick, keyPrefix) {
  return el("div", { class: "field" },
    el("span", { class: "field-label" }, label),
    el("div", { class: "segmented", role: "radiogroup", "aria-label": label },
      ...options.map(([v, text]) => el("button", {
        type: "button",
        class: `segment${v === value ? " is-on" : ""}`,
        role: "radio",
        "aria-checked": String(v === value),
        "data-focus-key": `${keyPrefix}:${v}`,
        onclick: () => onPick(v)
      }, text))));
}

function options() {
  return el("div", { class: "option-grid" },
    choice("Layout", state.cols,
      [1, 2, 3, 4].map((n) => [n, String(n)]),
      (v) => St.setFigureOption({ cols: v }), "cols"),

    choice("Panel size", state.size,
      Object.entries(SIZES).map(([k, s]) => [k, s.label]),
      (v) => St.setFigureOption({ size: v }), "size"),

    el("div", { class: "field" },
      choice("Error bars", state.errorBars,
        [["sem", "± SEM"], ["sd", "± SD"]],
        (v) => St.setFigureOption({ errorBars: v }), "err"),
      el("p", { class: "note", style: "margin-top:6px" },
        state.errorBars === "sem"
          ? "How precisely the mean is known. If your instructions ask you to show variability within the population, that is SD."
          : "How much the animals themselves vary — the spread of the population.")),

    choice("Individual animals", state.showPoints,
      [[true, "Shown"], [false, "Hidden"]],
      (v) => St.setFigureOption({ showPoints: v }), "pts"),

    el("div", { class: "field" },
      el("label", { class: "field-label", for: "opt-control" }, "Compared against"),
      el("select", {
        id: "opt-control", "data-focus-key": "opt:control",
        onchange: (e) => St.setFigureOption({ control: e.target.value })
      }, ...state.groups.map((g) =>
        el("option", { value: g, selected: g === state.control }, g)))),

    el("div", { class: "field" },
      el("span", { class: "field-label" }, "Position in the report"),
      el("div", { class: "btn-group" },
        el("button", {
          type: "button", class: "btn btn--icon", "data-focus-key": "fig:up",
          disabled: figureNumber() <= 1, "aria-label": "Move this figure earlier",
          onclick: () => St.moveFigure(state.activeId, -1)
        }, "↑"),
        el("button", {
          type: "button", class: "btn btn--icon", "data-focus-key": "fig:down",
          disabled: figureNumber() >= state.figures.length,
          "aria-label": "Move this figure later",
          onclick: () => St.moveFigure(state.activeId, 1)
        }, "↓"),
        el("span", { class: "note" }, `Figure ${figureNumber()} of ${state.figures.length}`))));
}

/* ---------- preview ---------- */

function preview() {
  const broken = state.panels.filter((p) => !p.analysis?.ok);
  const extent = figureExtent();
  const fits = layoutThatFits();
  const surface = el("div", { class: "figure-surface", id: "figure-surface" });
  surface.innerHTML = state.svg ||
    `<p class="empty"><strong>Nothing to draw yet</strong>Tick a measurement to add the first panel.</p>`;

  return el("div", { class: "card builder-main" },
    el("div", { class: "card-head" },
      el("h3", {}, `Figure ${figureNumber()}`),
      el("span", { class: "note" }, extent
        ? `${extent.mmWide} × ${extent.mmTall} mm — ${extent.shareText}`
        : "Drawn on white for pasting into your report")),
    extent && !extent.leavesRoomForLegend
      ? el("p", { class: "note", style: "margin:-6px 0 12px" },
          `Taller than half a page, so its legend will start on the next one. `,
          fits
            ? el("button", {
                type: "button", class: "btn btn--quiet",
                onclick: () => St.setFigureOption({ cols: fits.cols, size: fits.size })
              }, `Fit to the page (${fits.cols} column${fits.cols > 1 ? "s" : ""}, ${SIZES[fits.size].label.toLowerCase()})`)
            : "Fewer panels in this figure would fit.")
      : extent && extent.mmWide > A4_TEXT_MM
        ? el("p", { class: "note", style: "margin:-6px 0 12px" },
            `Wider than an A4 text column (${A4_TEXT_MM} mm), so Word will scale it down and the type with it. `,
            fits
              ? el("button", {
                  type: "button", class: "btn btn--quiet",
                  onclick: () => St.setFigureOption({ cols: fits.cols, size: fits.size })
                }, `Fit to the page (${fits.cols} column${fits.cols > 1 ? "s" : ""}, ${SIZES[fits.size].label.toLowerCase()})`)
              : "Fewer panels in this figure would fit.")
        : null,
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
      state.figures.length > 1
        ? `Save everything writes all ${state.figures.length} figures, one statistics file, the drafted text and a Prism table — your browser will ask to allow several downloads.`
        : "Save everything writes the figure, the statistics, the drafted text and a Prism table."));
}

export const view = {
  id: "figure",
  render(root, { go }) {
    if (!state.loaded) {
      setChildren(root, emptyState("No workbook yet", "Load a file on the first step."));
      return;
    }
    setChildren(root, 
      el("div", { class: "view-head" },
        el("h2", {}, "Build the figure"),
        el("p", {}, "Tick the measurements to become panels and the groups to compare. Panels are drawn into one image, lettered A, B, C, so a multi-panel figure exports as a single file.")),
      figureTabs(),
      el("div", { class: "builder" },
        el("div", { class: "builder-side" },
          el("div", { class: "card" }, suggestionPanel()),
          el("div", { class: "card" }, seriesPicker()),
          el("div", { class: "card" }, groupPicker()),
          state.panels.length ? el("div", { class: "card" }, panelList()) : null,
          el("div", { class: "card" },
            el("p", { class: "legend", style: "margin-bottom:12px" }, "Figure options"),
            options())),
        preview())
    );
  }
};
