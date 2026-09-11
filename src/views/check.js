/* check.js — what the workbook actually contains, and what is wrong with it. */

import { el, emptyState } from "../dom.js";
import { state } from "../state.js";
import { saveTidyCsv, savePrismCsv } from "../exports.js";

const RANK = { error: 0, warn: 1, info: 2 };
const TAG = { error: "check", warn: "note", info: "fyi" };

function issueList() {
  if (!state.issues.length)
    return el("p", { class: "note" },
      "Nothing to flag: every summary cell agrees with the animal values above it, and every group label parsed cleanly.");

  const sorted = [...state.issues].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  return el("div", {}, ...sorted.map((issue) =>
    el("div", { class: `issue issue--${issue.severity}` },
      el("span", { class: "issue-tag" }, TAG[issue.severity]),
      el("div", {},
        el("span", { class: "issue-where" },
          `${issue.sheet}${issue.where ? " · " + issue.where : ""}`),
        el("p", {}, issue.detail)))));
}

function seriesTable() {
  return el("div", { class: "table-wrap" }, el("table", {},
    el("thead", {}, el("tr", {},
      ...["Tissue", "Measurement", "Unit", "Shape"].map((h) => el("th", {}, h)),
      ...["Groups", "Values"].map((h) => el("th", { class: "num" }, h)))),
    el("tbody", {}, ...state.series.map((s) => el("tr", {},
      el("td", {}, s.tissue || "—"),
      el("td", {}, s.analyte),
      el("td", { class: "mono" }, s.unit || "—"),
      el("td", {}, s.hasTime ? "time course" : "one value per animal"),
      el("td", { class: "num" }, s.groups.length),
      el("td", { class: "num" }, s.n))))));
}

export const view = {
  id: "check",
  render(root, { go }) {
    if (!state.loaded) {
      root.replaceChildren(emptyState("No workbook yet", "Load a file on the first step."));
      return;
    }
    const errors = state.issues.filter((i) => i.severity === "error").length;
    root.replaceChildren(
      el("div", { class: "view-head" },
        el("h2", {}, "What the workbook actually contains"),
        el("p", {}, "Everything below is recomputed from the individual animal values. Where the workbook's own Avg, StDev or StErr cells disagree with the animals above them, that is flagged here rather than carried into your figures.")),
      el("div", { class: "stack" },
        el("div", { class: "card" },
          el("div", { class: "card-head" },
            el("h3", {}, "Data checks"),
            el("span", { class: "note" },
              state.issues.length
                ? `${state.issues.length} item${state.issues.length > 1 ? "s" : ""}${errors ? `, ${errors} needing attention` : ""}`
                : "all clear")),
          issueList()),
        el("div", { class: "card" },
          el("div", { class: "card-head" },
            el("h3", {}, "Measurements found"),
            el("span", { class: "note" },
              `${state.records.length.toLocaleString()} animal-level values`)),
          seriesTable(),
          el("div", { class: "btn-group", style: "margin-top:14px" },
            el("button", { type: "button", class: "btn", onclick: () => go("figure") },
              "Build a figure"),
            el("button", { type: "button", class: "btn btn--ghost", onclick: saveTidyCsv },
              "Tidy data (CSV)"),
            el("button", { type: "button", class: "btn btn--ghost", onclick: savePrismCsv },
              "Prism-ready table (CSV)")),
          el("p", { class: "note", style: "margin-top:10px" },
            "Prism format: one column per group, one row per animal — paste it straight into a grouped table.")))
    );
  }
};
