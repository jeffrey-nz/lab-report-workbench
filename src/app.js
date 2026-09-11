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

const VIEWS = [
  { ...loadView, label: "Load", needsData: false },
  { ...checkView, label: "Check", needsData: true },
  { ...figureView, label: "Figure", needsData: true },
  { ...statsView, label: "Statistics", needsData: true },
  { ...draftView, label: "Draft", needsData: true },
  { ...submitView, label: "Submit", needsData: false }
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
    }, el("span", { class: "step-n" }, String(i + 1)), v.label);
  }));
}

/**
 * Redraw the active view, putting keyboard focus back where it was. Controls
 * that survive a redraw carry a data-focus-key, so tabbing through the figure
 * builder is not reset by every tick.
 */
function renderView() {
  const active = VIEWS.find((v) => v.id === state.step) || VIEWS[0];
  const key = document.activeElement?.dataset?.focusKey;
  const scroll = window.scrollY;

  root.setAttribute("aria-label", active.label);
  active.render(root, { go });

  if (!key) return;
  const restored = root.querySelector(`[data-focus-key="${CSS.escape(key)}"]`);
  if (restored) {
    restored.focus({ preventScroll: true });
    window.scrollTo({ top: scroll });
  }
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

initTheme();
renderNav();
renderView();

// jump straight to a step with the number keys when nothing else has focus
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  const n = Number(e.key);
  if (n >= 1 && n <= VIEWS.length) go(VIEWS[n - 1].id);
});
