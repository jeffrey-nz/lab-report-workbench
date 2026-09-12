/* figure.js — the builder. Controls on the left, a live figure on the right.
   Only the parts that changed are redrawn, so a checkbox keeps focus. */

import { el, $, emptyState, setChildren } from "../dom.js";
import * as St from "../state.js";
import { state, SIZES, figureExtent, layoutThatFits, A4_TEXT_MM,
         figureNumber, suggestions, hasKey, panelGroups } from "../state.js";
import { groupColors } from "../lib/charts.js";
import { seriesNames, panelName, panelHint } from "../labels.js";
import { saveFigurePng, copyFigure, saveFigureSvg, saveEverything } from "../exports.js";
import { t } from "../i18n/index.js";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** One tab per figure in the report; the letters inside each are its panels. */
function figureTabs() {
  return el("div", { class: "fig-tabs", role: "tablist", "aria-label": t("figure.figures") },
    ...state.figures.map((fig, i) => {
      const active = fig.id === state.activeId;
      return el("div", { class: `fig-tab${active ? " is-on" : ""}` },
        el("button", {
          type: "button", role: "tab", "aria-selected": String(active),
          "data-focus-key": `fig:${fig.id}`,
          onclick: () => St.switchFigure(fig.id)
        }, t("figure.nth", { n: i + 1 }),
          el("span", { class: "fig-tab-count" }, String(fig.chosen.length))),
        active && state.figures.length > 1
          ? el("button", {
              type: "button", class: "fig-tab-close",
              "aria-label": t("figure.removeFigure", { n: i + 1 }), title: t("figure.removeFigureTitle"),
              onclick: () => St.removeFigure(fig.id)
            }, "×")
          : null);
    }),
    el("button", {
      type: "button", class: "fig-tab-add", "data-focus-key": "fig:add",
      title: t("figure.addTitle"), onclick: () => St.addFigure()
    }, t("figure.add")),
    state.figures.length > 1
      ? el("button", {
          type: "button", class: "btn btn--quiet", style: "margin-left:auto",
          onclick: () => St.duplicateFigure()
        }, t("figure.duplicate"))
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
      el("span", { class: "legend" }, t("figure.suggested")),
      el("span", { class: "note" }, t("figure.suggestedReady", { n: primary.length }))),
    el("p", { class: "note", style: "margin:8px 0 10px" },
      t("figure.suggestedHint")),
    el("div", { class: "suggestions" }, ...primary.map(button)),
    across.length
      ? el("details", { class: "more-suggestions" },
          el("summary", {}, t("figure.suggestedAcross", { n: across.length })),
          el("div", { class: "suggestions" }, ...across.map(button)))
      : null,
    primary.length > 1
      ? el("button", {
          type: "button", class: "btn btn--ghost", style: "margin-top:12px;width:100%",
          onclick: () => St.buildReport(primary)
        }, t("figure.buildAll", { n: primary.length }))
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
      el("span", {}, t("figure.panels", { chosen: state.chosen.length, all: all.length }))),
    el("input", {
      type: "search", class: "filter", id: "series-filter", value: filter,
      placeholder: t("figure.filter"), "aria-label": t("figure.filter"),
      "data-focus-key": "series:filter",
      oninput: (e) => { filter = e.target.value; St.update({}, "filter"); }
    }),
    el("div", { id: "series-chips", class: "chip-groups scroll-y" },
      bySheet.size
        ? [...bySheet].map(([sheet, list]) => el("div", { class: "chip-group" },
            el("p", { class: "chip-group-label" }, sheet),
            el("div", { class: "chips" }, ...list.map(chip))))
        : el("p", { class: "note" }, t("figure.filterNone", { needle: filter }))),
    hidden.length
      ? el("p", { class: "note filter-note" },
          t("figure.filterHiding", { n: hidden.length }),
          el("button", {
            type: "button", class: "btn btn--quiet",
            onclick: () => { filter = ""; St.update({}, "filter"); }
          }, t("figure.clearFilter")))
      : null,
    el("div", { class: "btn-group", style: "margin-top:10px" },
      el("button", {
        type: "button", class: "btn btn--quiet",
        onclick: () => St.setSeries(allOn ? [all[0]] : all)
      }, t(allOn ? "figure.selectFirst" : "figure.selectAll")),
      state.chosen.length > 1
        ? el("button", {
            type: "button", class: "btn btn--quiet",
            onclick: () => St.setSeries([state.chosen[0]])
          }, t("figure.clearRest"))
        : null));
}

function groupPicker() {
  const colors = groupColors(state.availableGroups, state.records);
  return el("fieldset", {},
    el("legend", { class: "legend" }, t("figure.groups", { n: state.groups.length })),
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
    title: t(own ? "figure.ownGroups" : "figure.usesFigureGroups"),
    onclick: () => { openPanel = expanded ? null : p.id; St.update({}, "panel-groups"); }
  }, own ? groups.join(t("join.clause")) : t("figure.figureGroups"), el("span", { class: "caret" }, expanded ? "▾" : "▸"));

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
        }, t("figure.followFigure"))
      : null);

  return el("div", { class: `panel-item${p.analysis?.ok ? "" : " is-invalid"}${expanded ? " is-open" : ""}` },
    el("div", { class: "panel-row" },
      el("span", { class: "panel-letter" }, LETTERS[i]),
      el("span", { class: "panel-name" },
        panelName(p, names),
        p.analysis?.ok
          ? (hint ? el("small", {}, hint) : null)
          : el("small", {}, t("figure.noTest"))),
      el("span", { class: "panel-actions" },
        el("button", {
          type: "button", class: "btn btn--icon", disabled: i === 0,
          title: t("figure.moveUp"), "aria-label": t("figure.moveEarlier", { name: panelName(p, names) }),
          "data-focus-key": `up:${p.id}`,
          onclick: () => St.movePanel(p.id, -1)
        }, "↑"),
        el("button", {
          type: "button", class: "btn btn--icon", disabled: i === state.panels.length - 1,
          title: t("figure.moveDown"), "aria-label": t("figure.moveLater", { name: panelName(p, names) }),
          "data-focus-key": `down:${p.id}`,
          onclick: () => St.movePanel(p.id, 1)
        }, "↓"),
        el("button", {
          type: "button", class: "btn btn--icon",
          title: t("figure.duplicatePanel"),
          "aria-label": t("figure.duplicatePanelLabel", { name: panelName(p, names) }),
          "data-focus-key": `dup:${p.id}`,
          onclick: () => { openPanel = null; St.duplicatePanel(p.id); }
        }, "⧉"),
        el("button", {
          type: "button", class: "btn btn--icon",
          title: t("figure.removePanel"), "aria-label": t("figure.removePanelLabel", { name: panelName(p, names) }),
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
    el("legend", { class: "legend" }, t("figure.panelList")),
    el("div", { class: "panel-list scroll-y" },
      ...state.panels.map((p, i) => panelRow(p, i, names))),
    el("p", { class: "note", style: "margin-top:10px" },
      t("figure.panelListHint")));
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
    choice(t("figure.layout"), state.cols,
      [1, 2, 3, 4].map((n) => [n, String(n)]),
      (v) => St.setFigureOption({ cols: v }), "cols"),

    choice(t("figure.panelSize"), state.size,
      Object.keys(SIZES).map((k) => [k, t(`figure.size.${k}`)]),
      (v) => St.setFigureOption({ size: v }), "size"),

    el("div", { class: "field" },
      choice(t("figure.errorBars"), state.errorBars,
        [["sem", t("figure.sem")], ["sd", t("figure.sd")]],
        (v) => St.setFigureOption({ errorBars: v }), "err"),
      el("p", { class: "note", style: "margin-top:6px" },
        t(state.errorBars === "sem" ? "figure.semHint" : "figure.sdHint"))),

    choice(t("figure.points"), state.showPoints,
      [[true, t("figure.pointsShown")], [false, t("figure.pointsHidden")]],
      (v) => St.setFigureOption({ showPoints: v }), "pts"),

    el("div", { class: "field" },
      el("label", { class: "field-label", for: "opt-control" }, t("figure.control")),
      el("select", {
        id: "opt-control", "data-focus-key": "opt:control",
        onchange: (e) => St.setFigureOption({ control: e.target.value })
      }, ...state.groups.map((g) =>
        el("option", { value: g, selected: g === state.control }, g)))),

    el("div", { class: "field" },
      el("span", { class: "field-label" }, t("figure.position")),
      el("div", { class: "btn-group" },
        el("button", {
          type: "button", class: "btn btn--icon", "data-focus-key": "fig:up",
          disabled: figureNumber() <= 1, "aria-label": t("figure.moveFigureEarlier"),
          onclick: () => St.moveFigure(state.activeId, -1)
        }, "↑"),
        el("button", {
          type: "button", class: "btn btn--icon", "data-focus-key": "fig:down",
          disabled: figureNumber() >= state.figures.length,
          "aria-label": t("figure.moveFigureLater"),
          onclick: () => St.moveFigure(state.activeId, 1)
        }, "↓"),
        el("span", { class: "note" }, t("figure.positionOf", { n: figureNumber(), total: state.figures.length })))));
}

/* ---------- preview ---------- */

function preview() {
  const broken = state.panels.filter((p) => !p.analysis?.ok);
  const extent = figureExtent();
  const fits = layoutThatFits();
  const surface = el("div", { class: "figure-surface", id: "figure-surface" });
  surface.innerHTML = state.svg ||
    `<p class="empty"><strong>${t("figure.nothingDrawn")}</strong>${t("figure.tickOne")}</p>`;

  return el("div", { class: "card builder-main" },
    el("div", { class: "card-head" },
      el("h3", {}, t("figure.nth", { n: figureNumber() })),
      el("span", { class: "note" }, extent
        ? t("figure.extent", { w: extent.mmWide, h: extent.mmTall, share: extent.shareText })
        : t("figure.onWhite"))),
    extent && !extent.leavesRoomForLegend
      ? el("p", { class: "note", style: "margin:-6px 0 12px" },
          t("figure.tooTall"),
          fits
            ? el("button", {
                type: "button", class: "btn btn--quiet",
                onclick: () => St.setFigureOption({ cols: fits.cols, size: fits.size })
              }, t("figure.fitTo", { cols: fits.cols, size: t(`figure.size.${fits.size}`) }))
            : t("figure.fewerPanels"))
      : extent && extent.mmWide > A4_TEXT_MM
        ? el("p", { class: "note", style: "margin:-6px 0 12px" },
            t("figure.tooWide", { mm: A4_TEXT_MM }),
            fits
              ? el("button", {
                  type: "button", class: "btn btn--quiet",
                  onclick: () => St.setFigureOption({ cols: fits.cols, size: fits.size })
                }, t("figure.fitTo", { cols: fits.cols, size: t(`figure.size.${fits.size}`) }))
              : t("figure.fewerPanels"))
        : null,
    broken.length
      ? el("div", { class: "callout callout--warn", style: "margin-bottom:12px" },
          el("strong", {}, broken.length === state.panels.length
            ? t("figure.brokenAll")
            : t("figure.brokenSome", { broken: broken.length, total: state.panels.length })),
          broken[0].analysis?.reason || "")
      : null,
    surface,
    el("div", { class: "btn-group", style: "margin-top:14px" },
      el("button", { type: "button", class: "btn", onclick: saveFigurePng }, t("figure.downloadPng")),
      el("button", { type: "button", class: "btn btn--ghost", onclick: copyFigure }, t("figure.copy")),
      el("button", { type: "button", class: "btn btn--ghost", onclick: saveFigureSvg }, t("figure.svg")),
      el("button", { type: "button", class: "btn btn--ghost", onclick: saveEverything },
        t("figure.saveAll"))),
    el("p", { class: "note", style: "margin-top:10px" },
      state.figures.length > 1
        ? t("figure.saveAllHintMany", { n: state.figures.length })
        : t("figure.saveAllHintOne")));
}

export const view = {
  id: "figure",
  render(root, { go }) {
    if (!state.loaded) {
      setChildren(root, emptyState(t("check.noWorkbook"), t("check.loadFirst")));
      return;
    }
    setChildren(root, 
      el("div", { class: "view-head" },
        el("h2", {}, t("figure.heading")),
        el("p", {}, t("figure.lede"))),
      figureTabs(),
      el("div", { class: "builder" },
        el("div", { class: "builder-side" },
          el("div", { class: "card" }, suggestionPanel()),
          el("div", { class: "card" }, seriesPicker()),
          el("div", { class: "card" }, groupPicker()),
          state.panels.length ? el("div", { class: "card" }, panelList()) : null,
          el("div", { class: "card" },
            el("p", { class: "legend", style: "margin-bottom:12px" }, t("figure.options")),
            options())),
        preview())
    );
  }
};
