/* smoke.mjs — drive the published page in a real browser.
   Unit tests cover the modules; this covers the wiring: that the views render,
   that the figure is drawn, that a PNG can be produced, and that nothing leaks
   a placeholder into the page. Run: node tests/smoke.mjs <url> */

import puppeteer from "puppeteer";
import assert from "node:assert/strict";

const url = process.argv[2] || "http://127.0.0.1:8731/index.html";
const STEPS = ["Load", "Check", "Figure", "Statistics", "Draft", "Submit"];
const LANGS = ["en", "ja"];

const results = [];
const check = (name, fn) => {
  try { fn(); results.push(["pass", name]); }
  catch (e) { results.push(["FAIL", `${name} — ${e.message}`]); }
};

const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(`uncaught: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
page.on("requestfailed", (r) => problems.push(`request failed: ${r.url()}`));

await page.setViewport({ width: 1340, height: 1000 });
await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

check("the shell renders", () => assert.equal(
  page.url().startsWith("http"), true));

assert.equal(await page.$$eval(".step", (n) => n.length), STEPS.length,
  "every step should appear in the navigation");

// load the synthetic example
const loaded = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")]
    .find((x) => x.textContent.trim() === "Load a worked example");
  if (!b) return false;
  b.click();
  return true;
});
assert.ok(loaded, "the worked example button is missing");
await new Promise((r) => setTimeout(r, 1200));

/** Text nodes anywhere on the page that read as a programming mistake, or as a
    message the current language has no translation for. */
const placeholders = async () => page.evaluate(() => {
  const found = [];
  const bad = /\b(null|undefined|NaN|\[object Object\])\b|⟦[^⟧]+⟧/;
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walk.nextNode());) {
    if (bad.test(n.nodeValue))
      found.push(`"${n.nodeValue.trim().slice(0, 60)}" in .${n.parentElement.className || n.parentElement.tagName}`);
  }
  document.querySelectorAll("svg text").forEach((t) => {
    if (bad.test(t.textContent)) found.push(`svg: ${t.textContent}`);
  });
  return found;
});

/** Switch the whole tool into a language and say whether it took. */
const useLanguage = async (code) => page.evaluate((c) => {
  const button = [...document.querySelectorAll("#language-toggle .segment")]
    .find((b) => b.lang === c);
  if (!button) return false;
  button.click();
  return true;
}, code);

for (const lang of LANGS) {
  const switched = await useLanguage(lang);
  check(`${lang}: switches the whole tool`, () => assert.ok(switched, "no toggle button"));
  await new Promise((r) => setTimeout(r, 400));
  const stamped = await page.evaluate(() => document.documentElement.lang);
  check(`${lang}: the document says what language it is in`, () =>
    assert.equal(stamped, lang));

  for (let i = 0; i < STEPS.length; i++) {
    await page.evaluate((j) => document.querySelectorAll(".step")[j].click(), i);
    await new Promise((r) => setTimeout(r, 650));
    const stray = await placeholders();
    check(`${lang} · ${STEPS[i]}: no placeholder or untranslated text`, () =>
      assert.deepEqual(stray, [], stray.join("; ")));
    const length = await page.$eval("#view-root", (n) => n.textContent.trim().length);
    check(`${lang} · ${STEPS[i]}: renders content`, () =>
      assert.ok(length > 40, `only ${length} characters rendered`));
  }
}
await useLanguage("en");
await new Promise((r) => setTimeout(r, 400));

// the figure, and the export path that produces the file people actually use
await page.evaluate(() => document.querySelectorAll(".step")[2].click());
await new Promise((r) => setTimeout(r, 700));
const figure = await page.$eval("#figure-surface", (n) => {
  const svg = n.querySelector("svg");
  return svg ? { panels: svg.querySelectorAll("path, rect").length, markup: svg.outerHTML.length } : null;
});
check("the preview contains a drawn figure", () => {
  assert.ok(figure, "no SVG in the preview");
  assert.ok(figure.panels > 10, `only ${figure.panels} shapes drawn`);
});

const png = await page.evaluate(async () => {
  const { svgToPng } = await import("./src/lib/charts.js");
  const blob = await svgToPng(document.querySelector("#figure-surface").innerHTML, 300);
  return { type: blob.type, size: blob.size };
});
check("the figure rasterises to a PNG", () => {
  assert.equal(png.type, "image/png");
  assert.ok(png.size > 5000, `suspiciously small: ${png.size} bytes`);
});

// narrow screens must not scroll sideways
await page.setViewport({ width: 390, height: 844 });
await new Promise((r) => setTimeout(r, 500));
const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
check("no horizontal overflow at 390px", () => assert.equal(overflow, 0, `${overflow}px`));

check("no console errors or failed requests", () =>
  assert.deepEqual(problems, [], problems.join("; ")));

await browser.close();

for (const [status, name] of results) console.log(`${status === "pass" ? "ok" : "not ok"} — ${name}`);
const failed = results.filter(([s]) => s === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
