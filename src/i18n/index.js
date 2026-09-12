/* i18n — one language for the whole tool: the interface, the figure labels and
   the drafted text. A catalogue entry is either a string or a function of its
   parameters, because the two languages do not order a sentence the same way. */

import { en } from "./en.js";
import { ja } from "./ja.js";

export const CATALOGUES = { en, ja };
export const LANGUAGES = [
  { code: "en", label: "English", short: "EN" },
  { code: "ja", label: "日本語", short: "日本" }
];

const STORAGE_KEY = "lrw-lang";
let current = "en";
const listeners = new Set();

/**
 * The language the browser asks for, when the tool speaks it. Anything else
 * falls back to English rather than to a half-translated page.
 */
export function detectLanguage(navigatorLike = globalThis.navigator) {
  const asked = [
    ...(navigatorLike?.languages || []),
    navigatorLike?.language
  ].filter(Boolean);
  for (const tag of asked) {
    const base = String(tag).toLowerCase().split("-")[0];
    if (CATALOGUES[base]) return base;
  }
  return "en";
}

function stored() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

export function initLanguage(navigatorLike) {
  const saved = stored();
  current = CATALOGUES[saved] ? saved : detectLanguage(navigatorLike);
  applyToDocument();
  return current;
}

export const getLanguage = () => current;

export function setLanguage(code) {
  if (!CATALOGUES[code] || code === current) return;
  current = code;
  try { localStorage.setItem(STORAGE_KEY, code); } catch { /* ignore */ }
  applyToDocument();
  for (const fn of listeners) fn(code);
}

export function onLanguageChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function applyToDocument() {
  if (typeof document !== "undefined") document.documentElement.lang = current;
}

/**
 * Look a message up in the current language. A key with no entry is returned
 * bracketed rather than silently blank, so a gap is visible and testable.
 */
export function t(key, params = {}) {
  const entry = CATALOGUES[current]?.[key] ?? CATALOGUES.en[key];
  if (entry === undefined) return `⟦${key}⟧`;
  return typeof entry === "function" ? entry(params) : entry;
}

/** "a, b and c" — the separator and the final conjunction differ by language. */
export function list(items) {
  const parts = items.filter((x) => x !== null && x !== undefined && x !== "");
  if (!parts.length) return "";
  if (parts.length === 1) return String(parts[0]);
  return t("list.join", { parts });
}

/** Numbers that must read as a figure in running text (an n, a count). */
export const num = (n) => String(n);
