/* draft.js — the text that has to accompany the figure, pre-filled with the
   real numbers. Edits are kept in state so switching steps does not lose them. */

import { el, copyButton, emptyState, setChildren } from "../dom.js";
import { state, update, figureNumber, setSpecies, allFigures } from "../state.js";
import { draftLegend, draftResults, statsSentence, draftTitle } from "../lib/analyse.js";
import { saveDrafts } from "../exports.js";
import { t } from "../i18n/index.js";

const countWords = (s) => s.trim().split(/\s+/).filter(Boolean).length;

function draftCard(title, hint, fallback, key, { bare = false } = {}) {
  const value = state.edits[key] ?? fallback;
  const counter = el("span", { class: "note" });

  const area = el("textarea", {
    class: "draft", id: `draft-${key}`, spellcheck: "true",
    "aria-label": title,
    oninput: (e) => {
      state.edits[key] = e.target.value;
      setCount(e.target.value);
    }
  });
  area.value = value;

  function setCount(text) {
    counter.textContent = t("draft.words", { n: countWords(text) });
  }
  setCount(value);

  return el(bare ? "div" : "div", { class: bare ? "" : "card" },
    el("div", { class: "card-head" },
      el(bare ? "h4" : "h3", {}, title),
      el("div", { class: "draft-meta" }, counter, copyButton(() => area.value))),
    el("p", { class: "note", style: "margin-bottom:10px" }, hint),
    area,
    state.edits[key] !== undefined
      ? el("button", {
          type: "button", class: "btn btn--quiet", style: "margin-top:8px",
          onclick: () => {
            delete state.edits[key];
            area.value = fallback;
            setCount(fallback);
            update({}, "draft-reset");
          }
        }, t("draft.reset"))
      : null);
}

/** The title is drafted from every figure in the report, not just this one. */
function titleDraft() {
  const suggested = draftTitle(allFigures());
  if (!suggested) return el("p", { class: "note" }, t("draft.titlePending"));
  return draftCard(t("draft.titleSuggested"), t("draft.titleSuggestedHint"),
    suggested, "title:report", { bare: true });
}

export const view = {
  id: "draft",
  render(root, { go }) {
    if (!state.panels.length) {
      setChildren(root, 
        el("div", { class: "view-head" }, el("h2", {}, t("draft.heading"))),
        el("div", { class: "card" },
          emptyState(t("draft.nothing"), t("draft.buildFirst"))));
      return;
    }
    const n = figureNumber();
    const titleCard = el("div", { class: "card" },
      el("div", { class: "card-head" },
        el("h3", {}, t("draft.titleCard")),
        el("span", { class: "note" }, t("draft.titleScope"))),
      el("p", { class: "note", style: "margin-bottom:12px" }, t("draft.titleHint")),
      el("div", { class: "field", style: "margin-bottom:14px;max-width:340px" },
        el("label", { class: "field-label", for: "species" }, t("draft.species")),
        el("input", {
          type: "text", id: "species", value: state.species,
          placeholder: t("draft.speciesPlaceholder"), "data-focus-key": "species",
          oninput: (e) => setSpecies(e.target.value)
        })),
      titleDraft());
    setChildren(root, 
      el("div", { class: "view-head" },
        el("h2", {}, state.figures.length > 1
          ? t("draft.headingFor", { n }) : t("draft.heading")),
        el("p", {}, t("draft.lede")),
        state.figures.length > 1
          ? el("p", { class: "note", style: "margin-top:8px" },
              t("draft.perFigure", { n: state.figures.length }))
          : null),
      el("div", { class: "stack" },
        titleCard,
        draftCard(t("draft.legendCard", { n }), t("draft.legendHint"),
          draftLegend(state.panels, n), `legend:${state.activeId}`),
        draftCard(t("draft.resultsCard"), t("draft.resultsHint"),
          draftResults(state.panels, n), `results:${state.activeId}`),
        el("div", { class: "card" },
          el("div", { class: "card-head" }, el("h3", {}, t("draft.statsCard"))),
          el("p", { class: "note", style: "margin-bottom:12px" },
            t("draft.statsHint")),
          el("div", { class: "stack" }, ...state.panels.map((p, i) => p.analysis?.ok
            ? el("div", { class: "callout" },
                el("strong", {}, `(${String.fromCharCode(65 + i)}) `),
                statsSentence(p.analysis))
            : null).filter(Boolean))),
        el("div", { class: "btn-group" },
          el("button", { type: "button", class: "btn btn--ghost", onclick: saveDrafts },
            t("draft.download")),
          el("button", { type: "button", class: "btn", onclick: () => go("submit") },
            t("draft.toSubmit"))))
    );
  }
};
