/* e2e.mjs — the whole journey, in a real browser, as a student would take it:
   load a workbook, read the checks, build a results section, look at the
   statistics, read the drafts, and save the files. The files are captured to
   disk and opened, because "the button did not throw" is not the same as
   "the figure is a 300 dpi PNG and the statistics are in the CSV".

   Usage: node tests/e2e.mjs <url> [workbook.xlsx]
   With no workbook it drives the built-in synthetic example, so it can run
   anywhere — including CI, where no study data exists. */

import puppeteer from "puppeteer";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL = process.argv[2] || "http://127.0.0.1:8731/index.html";
const WORKBOOK = process.argv[3] && process.argv[3] !== "demo" ? process.argv[3] : null;
const source = WORKBOOK ? "the workbook" : "the worked example";

const results = [];
let group = "";
const section = (name) => { group = name; };
const check = async (name, fn) => {
  try { await fn(); results.push([true, `${group} · ${name}`]); }
  catch (e) { results.push([false, `${group} · ${name} — ${e.message.split("\n")[0]}`]); }
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const downloads = mkdtempSync(join(tmpdir(), "lrw-e2e-"));

const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(`uncaught: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
page.on("requestfailed", (r) => problems.push(`request failed: ${r.url()}`));
await page.setViewport({ width: 1440, height: 1000 });
await page._client().send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });

const step = (i) => page.evaluate((j) => document.querySelectorAll(".step")[j].click(), i);
const text = (sel) => page.$eval(sel, (n) => n.textContent.trim());
const count = (sel) => page.$$eval(sel, (n) => n.length);
const clickText = (sel, re) => page.evaluate((s, r) => {
  const el = [...document.querySelectorAll(s)].find((x) => new RegExp(r).test(x.textContent));
  if (!el) return false;
  el.click();
  return true;
}, sel, re.source ?? re);
/** Wait for a condition rather than for a guessed number of milliseconds. */
const until = async (label, fn, timeout = 15000) => {
  const started = Date.now();
  for (;;) {
    if (await page.evaluate(fn)) return;
    if (Date.now() - started > timeout) throw new Error(`timed out waiting: ${label}`);
    await wait(150);
  }
};
const onStep = (heading) => until(`the ${heading} step`, `document.querySelector(".view-head h2")?.textContent.includes(${JSON.stringify(heading)})`);
/** Click every match one at a time: the view redraws, detaching the rest. */
const clickEachChecked = async (sel) => {
  for (let guard = 0; guard < 60; guard++) {
    const more = await page.evaluate((s) => {
      const box = document.querySelector(s);
      if (!box) return false;
      box.click();
      return true;
    }, `${sel}:checked`);
    if (!more) return;
    await wait(350);
  }
};

/* ---------- 1. first run ---------- */
section("first run");
await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });

await check("opens on the load step", async () =>
  assert.match(await text(".view-head h2"), /Load the data workbook/));
await check("every stage is listed", async () =>
  assert.equal(await count(".step"), 6));
await check("stages beyond loading are not reachable yet", async () =>
  assert.equal(await page.$$eval(".step[disabled]", (n) => n.length), 4));
await check("explains itself before any data is loaded", async () =>
  assert.equal(await count(".pitch h3"), 4));
await check("offers both languages", async () =>
  assert.equal(await count("#language-toggle .segment"), 2));

/* ---------- 2. loading a real workbook ---------- */
section("loading");
/** Either the student's own file, or the synthetic example the app ships. */
const loadData = async () => {
  if (WORKBOOK) {
    const input = await page.$("#file-input");
    await input.uploadFile(WORKBOOK);
  } else {
    await clickText("button", /Load a worked example/);
  }
  await until(`${source} to be read`, 'document.querySelectorAll("#view-root .card").length > 0');
};
await loadData();

await check("summarises the workbook before moving on", async () => {
  const card = await text("#view-root .card");
  assert.match(card, /values/, "the summary should say how much data it read");
  assert.match(card, /summary cell|contradictions|flagged/,
    "the summary should say whether anything needs attention");
});
await check("offers the data checks", async () => {
  assert.ok(await clickText("button", /Review the data checks/), "no continue button");
  await onStep("What the workbook actually contains");
});
const issues = await page.$$eval(".issue", (n) => n.map((x) => x.textContent));
await check("reports the workbook's own broken summary cell", async () =>
  assert.ok(issues.some((i) => /Avg is wrong here/.test(i)), "no stat-mismatch reported"));
await check("reports the spreadsheet error cells", async () =>
  assert.ok(issues.some((i) => /#VALUE/.test(i)), "no #VALUE! reported"));
await check("reports the row the sheet marks unusable", async () =>
  assert.ok(issues.some((i) => /don.t use/i.test(i)), "no excluded animal reported"));
await check("reports the group label written without its diet", async () =>
  assert.ok(issues.some((i) => /group written as/.test(i)), "no label inference reported"));
await check("lists every measurement it found", async () =>
  assert.ok(await count("tbody tr") >= 8, "too few measurements"));

/* ---------- 3. building the report ---------- */
section("building the report");
await step(2);
await onStep("Build the figure");

const suggestionCount = await count(".suggestion");
await check("proposes whole figures", () => assert.ok(suggestionCount >= 4, `only ${suggestionCount}`));
await check("builds the results section in one action", async () => {
  assert.ok(await clickText("button", /Build all/), "no build-all button");
  await until("the figures to be built", 'document.querySelectorAll(".fig-tab").length >= 3');
  assert.ok(await count(".fig-tab") >= 3, "figures were not created");
});

const figureCount = await count(".fig-tab");
const figureReport = [];
for (let i = 0; i < figureCount; i++) {
  await page.evaluate((j) => document.querySelectorAll(".fig-tab button[role=tab]")[j].click(), i);
  await wait(700);
  figureReport.push(await page.evaluate(() => ({
    heading: document.querySelector(".builder-main .card-head h3").textContent,
    panels: document.querySelectorAll(".panel-item").length ||
            (document.querySelector("#figure-surface svg") ? 1 : 0),
    broken: document.querySelectorAll(".panel-item.is-invalid").length,
    svg: !!document.querySelector("#figure-surface svg"),
    letters: [...document.querySelectorAll("#figure-surface svg text")]
      .map((t) => t.textContent).filter((t) => /^[A-Z]$/.test(t)).join("")
  })));
}
await check("every figure is drawn", () =>
  assert.deepEqual(figureReport.filter((f) => !f.svg), [], "a figure has no SVG"));
await check("no panel is left without a usable test", () =>
  assert.deepEqual(figureReport.filter((f) => f.broken > 0).map((f) => f.heading), []));
await check("panels are lettered in order", () => {
  for (const f of figureReport) {
    const expected = "ABCDEFGH".slice(0, f.panels);
    assert.equal(f.letters, expected, `${f.heading}: lettered "${f.letters}"`);
  }
});

/* ---------- 4. the tolerance figure the instructions specify ---------- */
section("a measurement shown twice");
// find a figure that shows one measurement more than once: the same panel
// name appearing twice with different groups is the shape we are looking for
let repeated = null;
for (let i = 0; i < figureCount && !repeated; i++) {
  await page.evaluate((j) => document.querySelectorAll(".fig-tab button[role=tab]")[j].click(), i);
  await wait(600);
  const panels = await page.$$eval(".panel-item", (items) => items.map((el) => ({
    name: el.querySelector(".panel-name").textContent.replace(/\s+/g, " ").trim(),
    groups: el.querySelector(".panel-groups").textContent.replace(/[▸▾]/g, "").trim()
  })));
  const byName = new Map();
  for (const p of panels) byName.set(p.name, [...(byName.get(p.name) || []), p.groups]);
  const twice = [...byName.entries()].filter(([, groups]) => groups.length > 1);
  if (twice.length) repeated = { heading: await text(".builder-main .card-head h3"), twice };
}

await check("one measurement can be shown twice with different groups", () =>
  assert.ok(repeated, "no figure showed a measurement more than once"));
await check("the repeated panels ask two different questions", () => {
  assert.ok(repeated, "nothing to check");
  for (const [name, groups] of repeated.twice)
    assert.equal(new Set(groups).size, groups.length,
      `${name} appears ${groups.length} times but uses only ${new Set(groups).size} ` +
      "group selections, so a panel is drawn twice over");
});
await check("each test contributes the same pair of comparisons", () => {
  assert.ok(repeated, "nothing to check");
  const shapes = repeated.twice.map(([, groups]) => groups.join(" | "));
  assert.equal(new Set(shapes).size, 1,
    "every repeated measurement should be split the same way");
});

/* ---------- 5. statistics ---------- */
section("statistics");
await step(3);
await wait(900);
const stats = await page.evaluate(() => ({
  heading: document.querySelector(".view-head h2").textContent,
  cards: document.querySelectorAll(".card .stat-title").length,
  why: [...document.querySelectorAll(".callout")].filter((c) => /Why this test/.test(c.textContent)).length,
  anovaRows: document.querySelectorAll(".table-wrap tbody tr").length,
  dfCells: [...document.querySelectorAll("td.num")].map((t) => t.textContent)
    .filter((v) => /^\d+, \d+$/.test(v)).length
}));
await check("names the figure it is showing", () => assert.match(stats.heading, /Figure \d/));
await check("one block per panel", () => assert.ok(stats.cards >= 1));
await check("says why each test was chosen", () => assert.equal(stats.why, stats.cards));
await check("every F carries its degrees of freedom", () =>
  assert.ok(stats.dfCells >= stats.cards, `only ${stats.dfCells} df cells`));

/* ---------- 6. drafted text ---------- */
section("drafted text");
await step(4);
await wait(900);
await page.type("#species", "male C57BL/6J mice");
await wait(700);
const drafts = await page.$$eval(".draft", (n) => n.map((x) => x.value));
await check("drafts a title, a legend and a results paragraph", () =>
  assert.ok(drafts.length >= 3, `only ${drafts.length} drafts`));
await check("the title names the species just entered", () =>
  assert.match(drafts[0], /male C57BL\/6J mice/));
await check("the legend states the test, the n and the asterisks", () => {
  assert.match(drafts[1], /Figure \d\./);
  assert.match(drafts[1], /mean ± SEM/);
  assert.match(drafts[1], /n = /);
  assert.match(drafts[1], /\*p < 0\.05/);
});
await check("every F and t in the drafts carries its degrees of freedom", () => {
  for (const d of drafts)
    for (const m of d.matchAll(/\b([FT])\(([^)]*)\)/gi))
      assert.match(m[2], /^\s*\d+(\.\d+)?\s*(,\s*\d+\s*)?$/, `bad df in "${m[0]}"`);
});
await check("no placeholder reaches any draft", () => {
  for (const d of drafts)
    assert.doesNotMatch(d, /\bundefined\b|\bnull\b|\bNaN\b|⟦/, d.slice(0, 80));
});
await check("an edit is kept when you leave and come back", async () => {
  await page.evaluate(() => {
    const t = document.querySelectorAll(".draft")[1];
    t.value = "MY OWN WORDING FOR THIS FIGURE.";
    t.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await wait(400);
  await step(2); await wait(500);
  await step(4); await wait(700);
  const again = await page.$$eval(".draft", (n) => n.map((x) => x.value));
  assert.match(again[1], /MY OWN WORDING/);
});

/* ---------- 7. the files the student actually submits ---------- */
section("saving the work");
await step(2);
await wait(800);
await check("saves everything in one action", async () => {
  assert.ok(await clickText(".builder-main button", /Save everything/), "no save button");
  // one file per figure plus the statistics, the draft and the Prism table
  const expected = figureCount + 3;
  for (let i = 0; i < 60 && readdirSync(downloads)
      .filter((f) => !f.endsWith(".crdownload")).length < expected; i++) await wait(500);
  const written = readdirSync(downloads).filter((f) => !f.endsWith(".crdownload"));
  assert.equal(written.length, expected,
    `wrote ${written.length} of ${expected}: ${written.join(", ")}`);
});

const files = readdirSync(downloads).filter((f) => !f.endsWith(".crdownload"));
const pngs = files.filter((f) => /^figure-\d+\.png$/.test(f));
await check("writes one PNG per figure", () =>
  assert.equal(pngs.length, figureCount, `${pngs.length} PNGs for ${figureCount} figures`));
await check("each PNG is a real image of a sensible size", () => {
  for (const f of pngs) {
    const buf = readFileSync(join(downloads, f));
    assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], `${f} is not a PNG`);
    const width = buf.readUInt32BE(16), height = buf.readUInt32BE(20);
    assert.ok(width > 900 && height > 500, `${f} is only ${width}×${height}`);
    assert.ok(statSync(join(downloads, f)).size > 20000, `${f} is suspiciously small`);
  }
});
await check("writes one statistics file covering every figure", () => {
  const csv = readFileSync(join(downloads, "report-statistics.csv"), "utf8");
  const rows = csv.trim().split("\n");
  assert.match(rows[0], /^figure,panel,measurement,test,source/);
  const figures = new Set(rows.slice(1).map((r) => r.split(",")[0]));
  assert.equal(figures.size, figureCount, `statistics cover ${figures.size} of ${figureCount}`);
  assert.ok(rows.length > 60, `only ${rows.length} rows`);
  assert.doesNotMatch(csv, /undefined|NaN/);
});
await check("the statistics file reports the multiple comparisons after the test", () => {
  const rows = readFileSync(join(downloads, "report-statistics.csv"), "utf8").trim().split("\n");
  const overall = rows.findIndex((r) => /ANOVA|t-test/.test(r));
  const posthoc = rows.findIndex((r) => /multiple comparisons/.test(r));
  assert.ok(overall > 0 && posthoc > overall, "ordering does not match how it is reported");
});
await check("writes one draft covering every figure", () => {
  const md = readFileSync(join(downloads, "report-draft.md"), "utf8");
  for (let n = 1; n <= figureCount; n++)
    assert.match(md, new RegExp(`FIGURE ${n} LEGEND`), `figure ${n} missing from the draft`);
  assert.match(md, /MY OWN WORDING/, "the edited legend was not carried into the file");
  assert.match(md, /Rewrite this in your own words/);
});
await check("writes a Prism-ready table", () => {
  const csv = readFileSync(join(downloads, "prism-table.csv"), "utf8");
  assert.ok(csv.split("\n").length > 20, "the table is too short to be real");
  assert.doesNotMatch(csv, /undefined|NaN/);
});

/* ---------- 8. the tool in Japanese ---------- */
section("japanese");
await page.evaluate(() => [...document.querySelectorAll("#language-toggle .segment")]
  .find((b) => b.lang === "ja").click());
await wait(800);
await check("the document declares the language", async () =>
  assert.equal(await page.evaluate(() => document.documentElement.lang), "ja"));
await check("the figure is redrawn with Japanese labels", async () => {
  const labels = await page.$$eval("#figure-surface svg text", (n) =>
    n.map((t) => t.textContent).filter((t) => /[ぁ-んァ-ヶ一-龥]/.test(t)));
  assert.ok(labels.length >= 2, `only ${labels.length} Japanese labels`);
});
await check("the drafts are rewritten in Japanese", async () => {
  await step(4); await wait(900);
  // the legend on this figure was edited by hand earlier and rightly stays put,
  // so the results paragraph is what should have been rewritten
  const ja = await page.$$eval(".draft", (n) => n.map((x) => x.value));
  assert.match(ja[2], /[ぁ-んァ-ヶ一-龥]/, "the results paragraph is not in Japanese");
  assert.doesNotMatch(ja.join("\n"), /⟦/, "an untranslated key reached a draft");
});
await check("an edit made in one language survives the other", async () => {
  const ja = await page.$$eval(".draft", (n) => n.map((x) => x.value));
  assert.match(ja[1], /MY OWN WORDING/, "the hand-written legend was overwritten");
});
await check("the statistics are unchanged by the language", async () => {
  await step(3); await wait(900);
  const jaF = await page.$$eval("td.num", (n) => n.map((x) => x.textContent));
  assert.ok(jaF.some((v) => /^\d+\.\d\d$/.test(v)), "no F values found");
});
await page.evaluate(() => [...document.querySelectorAll("#language-toggle .segment")]
  .find((b) => b.lang === "en").click());
await wait(600);

/* ---------- 9. the checklist ---------- */
section("checklist");
await step(5);
await wait(700);
await check("lists every point", async () => assert.equal(await count(".check-item"), 21));
await check("ticking one is remembered across a reload", async () => {
  await page.evaluate(() => document.querySelector(".check-item input").click());
  await wait(400);
  const before = await text(".card-head .note");
  await page.reload({ waitUntil: "networkidle2" });
  await wait(900);
  await page.evaluate(() => document.querySelectorAll(".step")[5].click());
  await wait(700);
  assert.equal(await text(".card-head .note"), before, "the tick was forgotten");
});

/* ---------- 10. recovery and edge cases ---------- */
section("edge cases");
await check("a workbook can be loaded again after a reload", async () => {
  await step(0);
  await onStep("Load the data workbook");
  await loadData();
  assert.ok(await clickText("button", /Review the data checks/), "no continue button");
  await onStep("What the workbook actually contains");
});
await check("a file that is not a spreadsheet is refused, not crashed on", async () => {
  const junk = join(downloads, "not-a-workbook.txt");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(junk, "this is not a spreadsheet");
  await step(0);
  await onStep("Load the data workbook");
  const el = await page.$("#file-input");
  await el.uploadFile(junk);
  await until("the refusal to be announced",
    '/not a spreadsheet|could not be read|no animal rows/i.test(document.querySelector("#toast").textContent)');
  assert.ok(true);
});
await check("the app is still usable after a bad file", async () => {
  await loadData();
  await step(2);
  await onStep("Build the figure");
  assert.ok(await page.$eval("#figure-surface", (n) => !!n.querySelector("svg")));
});
await check("removing every panel leaves a message, not a broken page", async () => {
  await clickEachChecked("#series-chips input");
  const empty = await page.$eval("#figure-surface", (n) => n.textContent);
  assert.match(empty, /Nothing to draw|Tick a measurement/);
});

/* ---------- 11. the page itself ---------- */
section("the page");
await check("no horizontal scrolling on a phone", async () => {
  await page.setViewport({ width: 390, height: 844 });
  await wait(600);
  let worst = 0;
  for (let i = 0; i < 6; i++) {
    await step(i); await wait(420);
    worst = Math.max(worst, await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth));
  }
  assert.equal(worst, 0, `${worst}px of overflow`);
});
await check("nothing errored anywhere in the journey", () =>
  assert.deepEqual(problems, [], problems.slice(0, 3).join("; ")));

await browser.close();

/* ---------- report ---------- */
let last = "";
for (const [ok, name] of results) {
  const [g, rest] = name.split(" · ");
  if (g !== last) { console.log(`\n${g.toUpperCase()}`); last = g; }
  console.log(`  ${ok ? "ok  " : "FAIL"} ${rest}`);
}
const failed = results.filter(([ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
console.log(`files written to ${downloads}: ${readdirSync(downloads).join(", ")}`);
process.exit(failed.length ? 1 : 0);
