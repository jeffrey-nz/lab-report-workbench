/* load.js — the first screen: take a workbook, or show what the tool does. */

import { el, $, toast, setChildren } from "../dom.js";
import { state, loadRecords, update } from "../state.js";
import { sheetsToGrids, parseWorkbook } from "../lib/parse.js";
import { demoWorkbook } from "../lib/demo.js";
import { t } from "../i18n/index.js";

const PITCH = ["check", "test", "figure", "words"];

function ingest(sheets, name) {
  const parsed = parseWorkbook(sheets);
  if (!parsed.records.length) {
    update({ loading: false });
    toast(t("load.noRows"));
    return;
  }
  loadRecords(parsed, name);
}

function readFile(file) {
  update({ loading: true });
  const reader = new FileReader();
  reader.onerror = () => { update({ loading: false }); toast(t("load.unreadable")); };
  reader.onload = () => {
    try {
      const wb = XLSX.read(new Uint8Array(reader.result), { type: "array", cellDates: false });
      ingest(sheetsToGrids(wb, XLSX), file.name);
    } catch (err) {
      update({ loading: false });
      toast(t("load.notSpreadsheet"));
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
    el("h3", {}, t("load.drop")),
    el("p", {}, t("load.dropHint")),
    el("div", { class: "btn-group" },
      el("button", {
        type: "button", class: "btn", disabled: state.loading,
        onclick: () => input.click()
      }, t(state.loading ? "load.reading" : "load.choose")),
      el("button", {
        type: "button", class: "btn btn--ghost", disabled: state.loading,
        onclick: () => {
          ingest(demoWorkbook(), "worked example (synthetic data)");
          toast(t("load.exampleLoaded"));
        }
      }, t("load.example"))),
    input,
    el("p", { class: "privacy" }, t("load.privacy")));

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
        t("load.summary", { values: state.records.length, series: state.series.length }))),
    el("p", { class: "note" },
      errors ? t("load.errors", { errors, flagged })
             : flagged ? t("load.someFlags", { flagged }) : t("load.allClear")),
    el("div", { class: "btn-group", style: "margin-top:14px" },
      el("button", { type: "button", class: "btn", onclick: () => go("check") },
        t("load.continue"))));
}

export const view = {
  id: "load",
  render(root, { go }) {
    setChildren(root, 
      el("div", { class: "view-head" },
        el("h2", {}, t("load.heading")),
        el("p", {}, t("load.lede"))),
      dropzone(),
      state.loaded ? el("div", { style: "margin-top:16px" }, summary(go)) : null,
      state.loaded ? null : el("div", { class: "pitch" },
        ...PITCH.map((k) => el("div", {},
          el("h3", {}, t(`pitch.${k}.title`)),
          el("p", { html: t(`pitch.${k}.body`) }))))
    );
  }
};
