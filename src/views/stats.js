/* stats.js — the full statistical output for every panel in the figure. */

import { el, emptyState, setChildren } from "../dom.js";
import { state } from "../state.js";
import { seriesNames, panelName, panelHint } from "../labels.js";
import { fmtP, stars } from "../lib/stats.js";
import { saveStatsCsv } from "../exports.js";

/** A p-value as a bare table cell: "0.0023", "<0.0001". */
const pCell = (p) => fmtP(p).replace(/^p\s*=?\s*/, "");

const sectionLabel = (text) => el("h4", { class: "section-label" }, text);

function effectRows(model) {
  if (model.effects) return ["between", "within", "interaction"].map((k) => model.effects[k]);
  if (model.F !== undefined && model.df1 !== undefined)
    return [{ name: "Between groups", df: model.df1, dfError: model.df2, F: model.F, p: model.p }];
  return [];
}

function anovaTable(model) {
  return el("div", { class: "table-wrap" }, el("table", {},
    el("thead", {}, el("tr", {},
      el("th", {}, "Source"),
      ...["df", "F", "p"].map((h) => el("th", { class: "num" }, h)),
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
    el("dt", {}, "Test"), el("dd", { style: "font-family:var(--sans)" }, model.test),
    el("dt", {}, "t (df)"), el("dd", {}, `${model.t.toFixed(2)} (${model.df.toFixed(1)})`),
    el("dt", {}, "p"), el("dd", {}, pCell(model.p)),
    el("dt", {}, "Mean difference"), el("dd", {}, model.meanDiff.toFixed(3)),
    el("dt", {}, "Cohen's d"), el("dd", {}, model.cohensD.toFixed(2)));
}

function posthocTable(analysis) {
  return el("div", { class: "table-wrap" }, el("table", {},
    el("thead", {}, el("tr", {},
      el("th", {}, "Comparison"),
      ...["Difference", "t", "Adjusted p"].map((h) => el("th", { class: "num" }, h)),
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
      el("th", {}, "Group"),
      timed ? el("th", { class: "num" }, sel.xUnit === "min" ? "Time (min)" : "Time") : null,
      ...["n", "Mean", "SD", "SEM"].map((h) => el("th", { class: "num" }, h)))),
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
    el("span", { class: "note" }, analysis?.ok ? analysis.nText : "not tested")));

  if (!analysis?.ok) {
    card.append(el("div", { class: "callout callout--warn" }, analysis?.reason || "No analysis."));
    return card;
  }

  card.append(el("div", { class: "callout" },
    el("strong", {}, "Why this test: "), analysis.designNote));

  if (analysis.kind === "two-group") {
    card.append(tTestBlock(analysis.model));
  } else {
    card.append(sectionLabel(analysis.model.test), anovaTable(analysis.model));
  }

  if (analysis.posthoc.length)
    card.append(sectionLabel(`Šídák's multiple comparisons vs ${analysis.control}`),
                posthocTable(analysis));

  card.append(sectionLabel("Group summary"), summaryTable(analysis, sel));

  if (analysis.outliers.length)
    card.append(el("div", { class: "callout", style: "margin-top:14px" },
      el("strong", {}, "Possible outlier: "),
      analysis.outliers.map((o) =>
        `animal ${o.subject} in ${o.group}${o.x != null ? ` at ${o.x}` : ""} ` +
        `(value ${o.value}, Grubbs' G = ${o.G.toFixed(3)} against a critical value of ${o.Gcrit.toFixed(3)})`
      ).join("; ") + ". It is kept in the analysis — say in your text that you noticed it."));

  if (analysis.dropped.length)
    card.append(el("div", { class: "callout", style: "margin-top:10px" },
      el("strong", {}, "Animals left out: "),
      `${[...new Set(analysis.dropped)].join(", ")} — not measured in every selected group, so they cannot enter a repeated-measures test.`));

  return card;
}

export const view = {
  id: "stats",
  render(root, { go }) {
    if (!state.panels.length) {
      setChildren(root, 
        el("div", { class: "view-head" }, el("h2", {}, "Statistics")),
        el("div", { class: "card" },
          emptyState("No panels yet", "Choose a measurement on the Figure step and the tests follow.")));
      return;
    }
    const names = seriesNames();
    setChildren(root, 
      el("div", { class: "view-head" },
        el("h2", {}, "Statistics"),
        el("p", {}, "The design of your selection chooses the test: animals measured more than once are treated as repeated measures rather than as independent samples. The overall test is reported first, the multiple comparisons after it.")),
      el("div", { class: "stack" },
        ...state.panels.map((p, i) => panelCard(p, i, names)),
        el("div", { class: "btn-group" },
          el("button", { type: "button", class: "btn btn--ghost", onclick: saveStatsCsv },
            "Download all statistics (CSV)"),
          el("button", { type: "button", class: "btn", onclick: () => go("draft") },
            "See the drafted text")))
    );
  }
};
