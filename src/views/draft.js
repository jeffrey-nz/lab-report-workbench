/* draft.js — the text that has to accompany the figure, pre-filled with the
   real numbers. Edits are kept in state so switching steps does not lose them. */

import { el, copyButton, emptyState, setChildren } from "../dom.js";
import { state, update, figureNumber, setSpecies, allFigures } from "../state.js";
import { draftLegend, draftResults, statsSentence, draftTitle } from "../lib/analyse.js";
import { saveDrafts } from "../exports.js";

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
    counter.textContent = `${countWords(text)} words`;
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
        }, "Reset to the drafted version")
      : null);
}

/** The title is drafted from every figure in the report, not just this one. */
function titleDraft() {
  const suggested = draftTitle(allFigures());
  if (!suggested) return el("p", { class: "note" }, "Build a figure and a title will follow from it.");
  return draftCard("Suggested title",
    "Built from the findings your figures actually show.",
    suggested, "title:report", { bare: true });
}

export const view = {
  id: "draft",
  render(root, { go }) {
    if (!state.panels.length) {
      setChildren(root, 
        el("div", { class: "view-head" }, el("h2", {}, "Drafted text")),
        el("div", { class: "card" },
          emptyState("Nothing to draft yet", "Build a figure and the text follows from it.")));
      return;
    }
    const n = figureNumber();
    const titleCard = el("div", { class: "card" },
      el("div", { class: "card-head" },
        el("h3", {}, "Report title"),
        el("span", { class: "note" }, "for the whole report, not this figure")),
      el("p", { class: "note", style: "margin-bottom:12px" },
        "A title is marked on naming the aim, the outcome and the species. Name the animals and they will be written in."),
      el("div", { class: "field", style: "margin-bottom:14px;max-width:340px" },
        el("label", { class: "field-label", for: "species" }, "Species or model"),
        el("input", {
          type: "text", id: "species", value: state.species,
          placeholder: "e.g. male C57BL/6J mice", "data-focus-key": "species",
          oninput: (e) => setSpecies(e.target.value)
        })),
      titleDraft());
    setChildren(root, 
      el("div", { class: "view-head" },
        el("h2", {}, state.figures.length > 1
          ? `Drafted text for Figure ${n}`
          : "Drafted text"),
        el("p", {}, "A starting point carrying the real numbers, in the structure a figure legend and a results paragraph are marked on. Edit it into your own words before submitting."),
        state.figures.length > 1
          ? el("p", { class: "note", style: "margin-top:8px" },
              `Your edits are kept per figure; the download covers all ${state.figures.length}.`)
          : null),
      el("div", { class: "stack" },
        titleCard,
        draftCard(`Figure ${n} legend`,
          "Names the finding in each panel, then the test, the n, and what the asterisks mean.",
          draftLegend(state.panels, n), `legend:${state.activeId}`),
        draftCard("Results paragraph",
          "Says what was done, what the data show, where to look in the figure, and the statistics — in that order.",
          draftResults(state.panels, n), `results:${state.activeId}`),
        el("div", { class: "card" },
          el("div", { class: "card-head" }, el("h3", {}, "Statistics, written out")),
          el("p", { class: "note", style: "margin-bottom:12px" },
            "Report the overall test before any multiple comparisons, and give the degrees of freedom with every F or t."),
          el("div", { class: "stack" }, ...state.panels.map((p, i) => p.analysis?.ok
            ? el("div", { class: "callout" },
                el("strong", {}, `(${String.fromCharCode(65 + i)}) `),
                statsSentence(p.analysis))
            : null).filter(Boolean))),
        el("div", { class: "btn-group" },
          el("button", { type: "button", class: "btn btn--ghost", onclick: saveDrafts },
            "Download the draft (Markdown)"),
          el("button", { type: "button", class: "btn", onclick: () => go("submit") },
            "Check before submitting")))
    );
  }
};
