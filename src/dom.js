/* dom.js — the small helpers every view uses. No application state lives here. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/**
 * el("div", { class: "card", onclick: fn }, ...children)
 * Attributes starting with "on" bind listeners; `html` sets innerHTML;
 * null and false attributes are skipped, so conditionals stay inline.
 */
export function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === false || v === undefined) continue;
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  append(node, kids);
  return node;
}

export function append(node, kids) {
  for (const kid of kids.flat(3)) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.append(kid.nodeType ? kid : String(kid));
  }
  return node;
}

export const frag = (...kids) => append(document.createDocumentFragment(), kids);

export const slug = (s) => String(s).toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

/* ---------- transient messages ---------- */

let toastTimer;
export function toast(message, { duration = 2600 } = {}) {
  const node = $("#toast");
  if (!node) return;
  node.textContent = message;
  node.classList.add("is-shown");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("is-shown"), duration);
}

/* ---------- small shared pieces ---------- */

export const emptyState = (heading, detail) =>
  el("div", { class: "empty" }, el("strong", {}, heading), detail);

export function copyButton(getText, label = "Copy") {
  return el("button", {
    type: "button", class: "btn btn--icon",
    onclick: async (e) => {
      const text = getText();
      try {
        await navigator.clipboard.writeText(text);
        toast("Copied to the clipboard");
      } catch {
        const ta = e.target.closest(".card")?.querySelector("textarea");
        if (ta) { ta.select(); toast("Press ⌘C or Ctrl+C to copy"); }
        else toast("This browser blocked the copy");
      }
    }
  }, label);
}

/** localStorage that never throws — private windows and blocked storage included. */
export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  }
};
