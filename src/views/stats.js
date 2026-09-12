/* stats.js — the full statistical output for every panel in the figure. */

import { el, emptyState, setChildren } from "../dom.js";
import { state, figureNumber } from "../state.js";
import { seriesNames, panelName, panelHint } from "../labels.js";
import { fmtP, stars } from "../lib/stats.js";
import { saveStatsCsv } from "../exports.js";
import { t } from "../i18n/index.js";

/** A p-value as a bare table cell: "0.0023", "<0.0001". */
const pCell = (p) => fmtP(p).replace(/^p\s*=?\s*/, "");

const sectionLabel = (text) => el("h4", { class: "section-label" }, text);

function effectRows(model) {
  if (model.effects) return ["between", "within", "interaction"].map((k) => model.effects[k]);
  if (model.F !== undefined && model.df1 !== undefined)
    return [{ name: t("effect.betweenGroups"), df: model.df1, dfError: model.df2, F: model.F, p: model.p }];
  return [];
}

function anovaTable(model) {
  return el("div", { class: "table-wrap" }, el("table", {},
    el("thead", {}, el("tr", {},
      el("th", {}, t("stats.source")),
      ...["stats.df", "stats.f", "stats.p"].map((k) => el("th", { class: "num" }, t(k))),
      el("th", {}, ""))),
    el("tbody", {}, ...effectRows(model).map((e) => el("tr", {
      class: e.p < 0.05 ? "is-sig" : ""
    },
      el("td", {}, e.name),
      el("td", { class: "num" }, `${e.df}, ${e.dfError}`),
      el("td", { class: "num" }, e.F.toFixed(2)),
      el("td", { class: "num" }, pCell(e.p)),
      el("td", {}, el("span", {
        class: `stars${e.p < 0.05 ? "" : " stars--ns"}`
      }, stars(e.p))))))));
}

function tTestBlock(model) {
  return el("dl", { class: "kv", style: "margin-top:14px" },
    el("dt", {}, t("stats.test")), el("dd", { style: "font-family:var(--sans)" }, model.test),
    el("dt", {}, t("stats.tdf")), el("dd", {}, `${model.t.toFixed(2)} (${model.df.toFixed(1)})`),
    el("dt", {}, t("stats.p")), el("dd", {}, pCell(model.p)),
    el("dt", {}, t("stats.meanDiff")), el("dd", {}, model.meanDiff.toFixed(3)),
    el("dt", {}, t("stats.cohensD")), el("dd", {}, model.cohensD.toFixed(2)));
}

function posthocTable(analysis) {
  return el("div", { class: "table-wrap" }, el("table", {},
    el("thead", {}, el("tr", {},
      el("th", {}, t("stats.comparison")),
      ...["stats.difference", "stats.t", "stats.adjustedP"].map((k) => el("th", { class: "num" }, t(k))),
      el("th", {}, ""))),
    el("tbody", {}, ...analysis.posthoc.map((c) => el("tr", {
      class: c.p < 0.05 ? "is-sig" : ""
    },
      el("td", {}, c.label),
      el("td", { class: "num" }, c.diff.toFixed(3)),
      el("td", { class: "num" }, c.t.toFixed(2)),
      el("td", { class: "num" }, pCell(c.p)),
      el("td", {}, el("span", {
        class: `stars${c.p < 0.05 ? "" : " stars--ns"}`
      }, c.stars)))))));
}

function summaryTable(analysis, sel) {
  const timed = sel.hasTime && sel.levels.length > 1;
  return el("div", { class: "table-wrap" }, el("table", {},
    el("thead", {}, el("tr", {},
      el("th", {}, t("stats.group")),
      timed ? el("th", { class: "num" }, t(sel.xUnit === "min" ? "stats.timeMin" : "stats.time")) : null,
      ...["stats.n", "stats.mean", "stats.sd", "stats.sem"].map((k) => el("th", { class: "num" }, t(k))))),
    el("tbody", {}, ...analysis.summary.flatMap((s) => s.points
      .filter((p) => p.n)
      .map((p) => el("tr", {},
        el("td", {}, s.group),
        timed ? el("td", { class: "num" }, p.x) : null,
        el("td", { class: "num" }, p.n),
        el("td", { class: "num" }, p.mean.toPrecision(4)),
        el("td", { class: "num" }, isFinite(p.sd) ? p.sd.toPrecision(3) : "—"),
        el("td", { class: "num" }, isFinite(p.sem) ? p.sem.toPrecision(3) : "—")))))));
}

function panelCard(panel, index, names) {
  const { sel, analysis } = panel;
  const letter = String.fromCharCode(65 + index);
  const hint = panelHint(panel, names);
  const card = el("div", { class: "card" });

  card.append(el("div", { class: "card-head" },
    el("div", { class: "stat-title" },
      el("span", { class: "panel-letter" }, letter),
      el("h3", {}, panelName(panel, names)),
      hint ? el("span", { class: "note" }, hint) : null),
    el("span", { class: "note" }, analysis?.ok ? analysis.nText : t("stats.notTested"))));

  if (!analysis?.ok) {
    card.append(el("div", { class: "callout callout--warn" }, analysis?.reason || t("chart.noAnalysis")));
    return card;
  }

  card.append(el("div", { class: "callout" },
    el("strong", {}, t("stats.why")), analysis.designNote));

  if (analysis.kind === "two-group") {
    card.append(tTestBlock(analysis.model));
  } else {
    card.append(sectionLabel(analysis.model.test), anovaTable(analysis.model));
  }

  if (analysis.posthoc.length)
    card.append(sectionLabel(t("stats.posthocVs", { control: analysis.control })),
                posthocTable(analysis));

  card.append(sectionLabel(t("stats.summary")), summaryTable(analysis, sel));

  if (analysis.outliers.length)
    card.append(el("div", { class: "callout", style: "margin-top:14px" },
      el("strong", {}, t("stats.outlier")),
      analysis.outliers.map((o) => t("stats.outlierOne", {
        subject: o.subject, group: o.group, at: o.x != null ? ` (${o.x})` : "",
        value: o.value, g: o.G.toFixed(3), crit: o.Gcrit.toFixed(3)
      })).join(t("join.clause")) + t("stats.outlierKept")));

  if (analysis.dropped.length)
    card.append(el("div", { class: "callout", style: "margin-top:10px" },
      el("strong", {}, t("stats.dropped")),
      t("stats.droppedWhy", { list: [...new Set(analysis.dropped)].join(t("join.clause")) })));

  return card;
}

export const view = {
  id: "stats",
  render(root, { go }) {
    if (!state.panels.length) {
      setChildren(root, 
        el("div", { class: "view-head" }, el("h2", {}, t("stats.heading"))),
        el("div", { class: "card" },
          emptyState(t("stats.noPanels"), t("stats.choosePanel"))));
      return;
    }
    const names = seriesNames();
    setChildren(root, 
      el("div", { class: "view-head" },
        el("h2", {}, state.figures.length > 1
          ? t("stats.headingFor", { n: figureNumber() })
          : t("stats.heading")),
        el("p", {}, t("stats.lede")),
        state.figures.length > 1
          ? el("p", { class: "note", style: "margin-top:8px" },
              t("stats.switchHint", { n: state.figures.length }))
          : null),
      el("div", { class: "stack" },
        ...state.panels.map((p, i) => panelCard(p, i, names)),
        el("div", { class: "btn-group" },
          el("button", { type: "button", class: "btn btn--ghost", onclick: saveStatsCsv },
            t("stats.downloadCsv")),
          el("button", { type: "button", class: "btn", onclick: () => go("draft") },
            t("stats.toDraft"))))
    );
  }
};
