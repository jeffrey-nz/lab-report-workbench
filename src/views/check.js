/* check.js — what the workbook actually contains, and what is wrong with it. */

import { el, emptyState, setChildren } from "../dom.js";
import { state } from "../state.js";
import { saveTidyCsv, savePrismCsv } from "../exports.js";
import { t } from "../i18n/index.js";

const RANK = { error: 0, warn: 1, info: 2 };
const TAG = { error: "tag.error", warn: "tag.warn", info: "tag.info" };

function issueList() {
  if (!state.issues.length)
    return el("p", { class: "note" }, t("check.clear"));

  const sorted = [...state.issues].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  return el("div", {}, ...sorted.map((issue) =>
    el("div", { class: `issue issue--${issue.severity}` },
      el("span", { class: "issue-tag" }, t(TAG[issue.severity])),
      el("div", {},
        el("span", { class: "issue-where" },
          `${issue.sheet}${issue.where ? " · " + issue.where : ""}`),
        el("p", {}, issue.detail)))));
}

function seriesTable() {
  return el("div", { class: "table-wrap" }, el("table", {},
    el("thead", {}, el("tr", {},
      ...["check.colTissue", "check.colMeasurement", "check.colUnit", "check.colShape"].map((k) => el("th", {}, t(k))),
      ...["check.colGroups", "check.colValues"].map((k) => el("th", { class: "num" }, t(k))))),
    el("tbody", {}, ...state.series.map((s) => el("tr", {},
      el("td", {}, s.tissue || "—"),
      el("td", {}, s.analyte),
      el("td", { class: "mono" }, s.unit || "—"),
      el("td", {}, t(s.hasTime ? "check.shapeTime" : "check.shapeSingle")),
      el("td", { class: "num" }, s.groups.length),
      el("td", { class: "num" }, s.n))))));
}

export const view = {
  id: "check",
  render(root, { go }) {
    if (!state.loaded) {
      setChildren(root, emptyState(t("check.noWorkbook"), t("check.loadFirst")));
      return;
    }
    const errors = state.issues.filter((i) => i.severity === "error").length;
    setChildren(root, 
      el("div", { class: "view-head" },
        el("h2", {}, t("check.heading")),
        el("p", {}, t("check.lede"))),
      el("div", { class: "stack" },
        el("div", { class: "card" },
          el("div", { class: "card-head" },
            el("h3", {}, t("check.checks")),
            el("span", { class: "note" }, state.issues.length
              ? t("check.itemCount", { n: state.issues.length, errors })
              : t("check.allClear"))),
          issueList()),
        el("div", { class: "card" },
          el("div", { class: "card-head" },
            el("h3", {}, t("check.found")),
            el("span", { class: "note" }, t("check.valueCount", { n: state.records.length }))),
          seriesTable(),
          el("div", { class: "btn-group", style: "margin-top:14px" },
            el("button", { type: "button", class: "btn", onclick: () => go("figure") },
              t("check.toFigure")),
            el("button", { type: "button", class: "btn btn--ghost", onclick: saveTidyCsv },
              t("check.tidyCsv")),
            el("button", { type: "button", class: "btn btn--ghost", onclick: savePrismCsv },
              t("check.prismCsv"))),
          el("p", { class: "note", style: "margin-top:10px" },
            t("check.prismHint"))))
    );
  }
};
