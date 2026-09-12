/* app.js — the shell: theme, step navigation, and handing control to a view.
   Everything else lives in src/views and src/lib. */

import { el, $, store, setChildren } from "./dom.js";
import { state, subscribe, update } from "./state.js";
import { view as loadView } from "./views/load.js";
import { view as checkView } from "./views/check.js";
import { view as figureView } from "./views/figure.js";
import { view as statsView } from "./views/stats.js";
import { view as draftView } from "./views/draft.js";
import { view as submitView } from "./views/submit.js";
import { initLanguage, getLanguage, setLanguage, LANGUAGES, t } from "./i18n/index.js";

const VIEWS = [
  { ...loadView, labelKey: "nav.load", needsData: false },
  { ...checkView, labelKey: "nav.check", needsData: true },
  { ...figureView, labelKey: "nav.figure", needsData: true },
  { ...statsView, labelKey: "nav.stats", needsData: true },
  { ...draftView, labelKey: "nav.draft", needsData: true },
  { ...submitView, labelKey: "nav.submit", needsData: false }
];

const root = $("#view-root");
const nav = $("#steps");

/* ---------- navigation ---------- */

function go(id) {
  const target = VIEWS.find((v) => v.id === id);
  if (!target || (target.needsData && !state.loaded)) return;
  update({ step: id }, "navigate");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderNav() {
  setChildren(nav, ...VIEWS.map((v, i) => {
    const active = state.step === v.id;
    const reached = state.loaded && VIEWS.findIndex((x) => x.id === state.step) > i;
    return el("button", {
      type: "button",
      class: `step${reached ? " step-done" : ""}`,
      "aria-current": String(active),
      disabled: v.needsData && !state.loaded,
      onclick: () => go(v.id),
      onkeydown: (e) => {
        const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        const usable = VIEWS.filter((x) => !x.needsData || state.loaded);
        const at = usable.findIndex((x) => x.id === state.step);
        const next = usable[Math.min(usable.length - 1, Math.max(0, at + dir))];
        if (next) { go(next.id); nav.querySelector('[aria-current="true"]')?.focus(); }
      }
    }, el("span", { class: "step-n" }, String(i + 1)), t(v.labelKey));
  }));
}

/**
 * Redraw the active view, putting keyboard focus back where it was. Controls
 * that survive a redraw carry a data-focus-key, so tabbing through the figure
 * builder is not reset by every tick.
 */
function renderView() {
  const active = VIEWS.find((v) => v.id === state.step) || VIEWS[0];
  const focused = document.activeElement;
  const key = focused?.dataset?.focusKey;
  // a text field also has a caret, which must not jump to the end mid-word
  const caret = key && typeof focused.selectionStart === "number"
    ? [focused.selectionStart, focused.selectionEnd]
    : null;
  const scroll = window.scrollY;

  root.setAttribute("aria-label", t(active.labelKey));
  active.render(root, { go });

  if (!key) return;
  const restored = root.querySelector(`[data-focus-key="${CSS.escape(key)}"]`);
  if (!restored) return;
  restored.focus({ preventScroll: true });
  if (caret && typeof restored.setSelectionRange === "function") {
    try { restored.setSelectionRange(caret[0], caret[1]); } catch { /* not a text field */ }
  }
  window.scrollTo({ top: scroll });
}

/* ---------- language ---------- */

/** A plain two-way switch: the tool speaks two languages, so a toggle will do. */
function renderLanguage() {
  const box = $("#language-toggle");
  setChildren(box, ...LANGUAGES.map((lang) => el("button", {
    type: "button",
    class: `segment${lang.code === getLanguage() ? " is-on" : ""}`,
    lang: lang.code,
    "aria-pressed": String(lang.code === getLanguage()),
    title: t("app.languageTitle"),
    onclick: () => { setLanguage(lang.code); renderAll(); }
  }, lang.short)));
  box.setAttribute("aria-label", t("app.language"));
}

function renderAll() {
  renderLanguage();
  renderNav();
  renderView();
  const brand = $("#brand-name");
  const tagline = $("#brand-tagline");
  const skip = $("#skip-link");
  const theme = $("#theme-toggle");
  if (brand) brand.textContent = t("app.title");
  if (tagline) tagline.textContent = t("app.tagline");
  if (skip) skip.textContent = t("app.skip");
  if (theme) {
    theme.textContent = t("app.theme");
    theme.title = t("app.themeTitle");
    theme.setAttribute("aria-label", t("app.themeTitle"));
  }
  document.title = t("app.title");
  $("#steps").setAttribute("aria-label", t("app.stages"));
}

/* ---------- theme ---------- */

function initTheme() {
  const saved = store.get("lrw-theme");
  if (saved) document.documentElement.dataset.theme = saved;

  $("#theme-toggle").addEventListener("click", () => {
    const current = document.documentElement.dataset.theme;
    const isDark = current
      ? current === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = isDark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set("lrw-theme", next);
  });
}

/* ---------- start ---------- */

subscribe(() => {
  renderNav();
  renderView();
});

initLanguage();
initTheme();
renderAll();

// jump straight to a step with the number keys when nothing else has focus
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  const n = Number(e.key);
  if (n >= 1 && n <= VIEWS.length) go(VIEWS[n - 1].id);
});
