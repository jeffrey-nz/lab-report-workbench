/* load.js — the first screen: take a workbook, or show what the tool does. */

import { el, $, toast } from "../dom.js";
import { state, loadRecords, update } from "../state.js";
import { sheetsToGrids, parseWorkbook } from "../lib/parse.js";
import { demoWorkbook } from "../lib/demo.js";

const PITCH = [
  ["It checks the sheet first",
   `Every <code>Avg</code>, <code>StDev</code> and <code>StErr</code> the workbook states is
    recomputed from the animals above it. Disagreements, <code>#VALUE!</code> cells, rows marked
    <em>don't use</em> and inconsistent group labels are reported before you plot anything.`],
  ["The design picks the test",
   `Animals measured more than once become a repeated-measures analysis; separate cohorts become an
    independent-groups analysis. It says which it chose and why, and gives you
    <span class="m">F(df,&nbsp;df)</span>, <span class="m">p</span> and the multiple comparisons.`],
  ["One figure, one file",
   `Panels are drawn together and lettered A, B, C, with mean&nbsp;±&nbsp;SEM, every animal shown and
    significance marked. Exports as a single 300&nbsp;dpi PNG, or as vector SVG.`],
  ["It drafts the words",
   `A figure legend and a results paragraph carrying your real numbers, in the structure these are
    marked on. A starting point to rewrite &mdash; not something to submit.`]
];

function ingest(sheets, name) {
  const parsed = parseWorkbook(sheets);
  if (!parsed.records.length) {
    update({ loading: false });
    toast("No animal rows were found — does the sheet have an ID column?");
    return;
  }
  loadRecords(parsed, name);
}

function readFile(file) {
  update({ loading: true });
  const reader = new FileReader();
  reader.onerror = () => { update({ loading: false }); toast("That file could not be read."); };
  reader.onload = () => {
    try {
      const wb = XLSX.read(new Uint8Array(reader.result), { type: "array", cellDates: false });
      ingest(sheetsToGrids(wb, XLSX), file.name);
    } catch (err) {
      update({ loading: false });
      toast("That file is not a spreadsheet this tool can read.");
      console.error(err);
    }
  };
  reader.readAsArrayBuffer(file);
}

function dropzone() {
  const input = el("input", {
    type: "file", id: "file-input", accept: ".xlsx,.xls,.csv", hidden: true,
    onchange: (e) => e.target.files[0] && readFile(e.target.files[0])
  });

  const zone = el("div", { class: "dropzone", id: "dropzone" },
    el("h3", {}, "Drop an .xlsx or .xls file here"),
    el("p", {}, "The sheet layout is worked out from its shape, so the same workbook conventions parse again next semester."),
    el("div", { class: "btn-group" },
      el("button", {
        type: "button", class: "btn", disabled: state.loading,
        onclick: () => input.click()
      }, state.loading ? "Reading…" : "Choose a file"),
      el("button", {
        type: "button", class: "btn btn--ghost", disabled: state.loading,
        onclick: () => {
          ingest(demoWorkbook(), "worked example (synthetic data)");
          toast("Loaded a synthetic example — not real study data");
        }
      }, "Load a worked example")),
    input,
    el("p", { class: "privacy" }, "Your file stays on this device. There is no server."));

  const stop = (e) => { e.preventDefault(); };
  for (const type of ["dragenter", "dragover"])
    zone.addEventListener(type, (e) => { stop(e); zone.classList.add("is-over"); });
  for (const type of ["dragleave", "drop"])
    zone.addEventListener(type, (e) => { stop(e); zone.classList.remove("is-over"); });
  zone.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) readFile(file);
  });
  return zone;
}

function summary(go) {
  const errors = state.issues.filter((i) => i.severity === "error").length;
  const flagged = state.issues.length - errors;
  return el("div", { class: "card" },
    el("div", { class: "card-head" },
      el("h3", {}, state.fileName),
      el("span", { class: "note" },
        `${state.records.length.toLocaleString()} values · ${state.series.length} measurements`)),
    el("p", { class: "note" },
      errors
        ? `${errors} summary cell${errors > 1 ? "s" : ""} in the workbook disagree${errors > 1 ? "" : "s"} with the animal values${flagged ? `, and ${flagged} other thing${flagged > 1 ? "s were" : " was"} flagged` : ""}.`
        : flagged
          ? `No contradictions in the workbook's own summary rows; ${flagged} other note${flagged > 1 ? "s" : ""} to read.`
          : "No contradictions found in the workbook's own summary rows."),
    el("div", { class: "btn-group", style: "margin-top:14px" },
      el("button", { type: "button", class: "btn", onclick: () => go("check") },
        "Review the data checks")));
}

export const view = {
  id: "load",
  render(root, { go }) {
    root.replaceChildren(
      el("div", { class: "view-head" },
        el("h2", {}, "Load the data workbook"),
        el("p", {}, "Drop in the spreadsheet you were given. The workbook is read in your browser — nothing is uploaded anywhere.")),
      dropzone(),
      state.loaded ? el("div", { style: "margin-top:16px" }, summary(go)) : null,
      state.loaded ? null : el("div", { class: "pitch" },
        ...PITCH.map(([h, body]) => el("div", {},
          el("h3", {}, h), el("p", { html: body }))))
    );
  }
};
