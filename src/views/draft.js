/* draft.js — the text that has to accompany the figure, pre-filled with the
   real numbers. Edits are kept in state so switching steps does not lose them. */

import { el, copyButton, emptyState, setChildren } from "../dom.js";
import { state, update } from "../state.js";
import { draftLegend, draftResults, statsSentence } from "../lib/analyse.js";
import { saveDrafts } from "../exports.js";

const countWords = (s) => s.trim().split(/\s+/).filter(Boolean).length;

function draftCard(title, hint, fallback, key, { limit } = {}) {
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
    const n = countWords(text);
    counter.textContent = limit ? `${n} of about ${limit} words` : `${n} words`;
    counter.style.color = limit && n > limit * 1.15 ? "var(--warn)" : "";
  }
  setCount(value);

  return el("div", { class: "card" },
    el("div", { class: "card-head" },
      el("h3", {}, title),
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
    const n = state.figNumber;
    setChildren(root, 
      el("div", { class: "view-head" },
        el("h2", {}, "Drafted text"),
        el("p", {}, "A starting point carrying the real numbers, in the structure a figure legend and a results paragraph are marked on. Edit it into your own words before submitting.")),
      el("div", { class: "stack" },
        draftCard(`Figure ${n} legend`,
          "Names the finding in each panel, then the test, the n, and what the asterisks mean.",
          draftLegend(state.panels, n), `legend-${n}`),
        draftCard("Results paragraph",
          "Says what was done, what the data show, where to look in the figure, and the statistics — in that order.",
          draftResults(state.panels, n), `results-${n}`),
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
