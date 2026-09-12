import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CATALOGUES, LANGUAGES, detectLanguage, setLanguage, getLanguage, t, list }
  from "../src/i18n/index.js";
import { parseWorkbook } from "../src/lib/parse.js";
import { loadRecords, suggestions, buildReport, allFigures, setSpecies, state }
  from "../src/state.js";
import { draftLegend, draftResults, statsSentence, draftTitle, axisLabel, xAxisLabel }
  from "../src/lib/analyse.js";
import { draftBundle, statsRows, csv } from "../src/exports.js";
import { allSheets } from "./fixtures.js";

const CODES = Object.keys(CATALOGUES);
const MISSING = /⟦[^⟧]+⟧/;

/** Plausible values for every parameter the catalogues interpolate. */
const PARAMS = {
  parts: ["one", "two"], values: 1234, series: 12, errors: 2, flagged: 3,
  n: 3, total: 4, chosen: 2, all: 9, done: 1, needle: "IL",
  name: "WAT IL-6", cols: 2, size: "compact", mm: 170, broken: 1,
  w: 190, h: 160, share: "half a page", control: "NCD 0W",
  subject: 12, group: "HFD 8W", at: " (30)", value: 4.2, g: "2.16", crit: "2.13",
  list: "14, 22", lo: 5, hi: 8, spread: "SEM", tests: "ANOVA", stats: "F(1, 2) = 3",
  reason: "not enough groups", f: "F(1, 2) = 3.0", p: "p = 0.01", t: "t(11) = 2.0",
  test: "ANOVA", within: "Time", between: "Diet", interaction: "Time × Diet",
  verb: "alters", species: "mice", what: "IL-6", where: "liver",
  from: 18, unit: " days", x: 30, direction: "rose", when: "week 6",
  differed: "differed", letter: "A", text: "a finding", sentence: "a sentence",
  clauses: "changes in IL-6", specific: true, tissue: "Liver", analyte: "IL-6",
  sheets: "Glucose Tolerance", base: "WAT IL-6", label: "0W", key: "k",
  title: "High-fat feeding alters IL-6."
};

describe("the catalogues", () => {
  test("both languages are offered", () => {
    assert.deepEqual(LANGUAGES.map((l) => l.code).sort(), CODES.sort());
    for (const l of LANGUAGES) assert.ok(l.label && l.short, `${l.code} needs a label`);
  });

  test("every key exists in every language", () => {
    const reference = Object.keys(CATALOGUES.en);
    for (const code of CODES) {
      const keys = Object.keys(CATALOGUES[code]);
      const missing = reference.filter((k) => !(k in CATALOGUES[code]));
      const extra = keys.filter((k) => !(k in CATALOGUES.en));
      assert.deepEqual(missing, [], `${code} is missing keys`);
      assert.deepEqual(extra, [], `${code} has keys English does not`);
    }
  });

  test("a key is a plain string in every language, or a function in every language", () => {
    for (const key of Object.keys(CATALOGUES.en))
      for (const code of CODES)
        assert.equal(typeof CATALOGUES[code][key], typeof CATALOGUES.en[key],
          `${key} is a ${typeof CATALOGUES[code][key]} in ${code}`);
  });

  test("no entry is left empty", () => {
    for (const code of CODES)
      for (const [key, value] of Object.entries(CATALOGUES[code]))
        if (typeof value === "string" && key !== "join.sentence" && key !== "tissue.lowercaseUnknown")
          assert.ok(value.trim().length, `${code}:${key} is empty`);
  });

  test("every template renders without leaving a hole", () => {
    for (const code of CODES) {
      for (const [key, value] of Object.entries(CATALOGUES[code])) {
        if (typeof value !== "function") continue;
        let out;
        assert.doesNotThrow(() => { out = value(PARAMS); }, `${code}:${key} threw`);
        assert.equal(typeof out, "string", `${code}:${key} did not return a string`);
        assert.doesNotMatch(out, /undefined|NaN|\[object Object\]/, `${code}:${key} → ${out}`);
      }
    }
  });

  test("the Japanese catalogue is actually Japanese", () => {
    const prose = ["load.heading", "check.heading", "figure.heading", "stats.lede", "submit.lede"];
    for (const key of prose)
      assert.match(CATALOGUES.ja[key], /[ぁ-んァ-ヶ一-龥]/, `${key} was never translated`);
  });
});

describe("choosing a language", () => {
  test("takes the first language the browser asks for that the tool speaks", () => {
    assert.equal(detectLanguage({ languages: ["ja-JP", "en-US"] }), "ja");
    assert.equal(detectLanguage({ languages: ["en-GB"] }), "en");
    assert.equal(detectLanguage({ languages: ["fr-FR", "ja"] }), "ja",
      "an unspoken language should be skipped, not fallen back on");
  });

  test("falls back to English rather than to a half-translated page", () => {
    assert.equal(detectLanguage({ languages: ["de-DE", "es"] }), "en");
    assert.equal(detectLanguage({}), "en");
    assert.equal(detectLanguage(undefined), "en");
  });

  test("reads the single-language field when there is no list", () => {
    assert.equal(detectLanguage({ language: "ja" }), "ja");
  });
});

describe("looking a message up", () => {
  test("an unknown key is returned visibly, not silently blank", () => {
    assert.match(t("no.such.key"), MISSING);
  });

  test("a list joins the way the language does", () => {
    setLanguage("en");
    assert.equal(list(["a", "b", "c"]), "a, b and c");
    assert.equal(list(["a"]), "a");
    assert.equal(list([]), "");
    setLanguage("ja");
    assert.equal(list(["a", "b", "c"]), "a、b、c");
    setLanguage("en");
  });
});

describe("everything the tool writes, in both languages", () => {
  const parsed = parseWorkbook(allSheets);

  for (const code of CODES) {
    test(`${code}: no missing key reaches the drafted output`, () => {
      setLanguage(code);
      loadRecords(parsed, "fixtures.xlsx");
      setSpecies(code === "ja" ? "マウス" : "mice");
      buildReport(suggestions().filter((s) => s.kind !== "across"));
      const figures = allFigures();

      const texts = [draftTitle(figures), draftBundle(), csv(statsRows())];
      for (const { panels, number } of figures) {
        texts.push(draftLegend(panels, number), draftResults(panels, number));
        for (const p of panels) {
          texts.push(axisLabel(p.sel), xAxisLabel(p.sel));
          if (p.analysis.ok) texts.push(statsSentence(p.analysis), p.analysis.designNote);
          else texts.push(p.analysis.reason);
        }
      }
      for (const text of texts) {
        assert.doesNotMatch(text, MISSING, `untranslated key in ${code}: ${text.slice(0, 90)}`);
        assert.doesNotMatch(text, /\bundefined\b|\bNaN\b/, `bad value in ${code}: ${text.slice(0, 90)}`);
      }
    });

    test(`${code}: the figure is drawn with translated labels`, () => {
      setLanguage(code);
      loadRecords(parsed, "fixtures.xlsx");
      buildReport(suggestions().filter((s) => s.kind !== "across"));
      for (const { svg, number } of allFigures()) {
        assert.doesNotMatch(svg, MISSING, `untranslated key in figure ${number}`);
        assert.doesNotMatch(svg, /NaN|undefined/, `bad value in figure ${number}`);
      }
    });
  }

  test("the same data reads differently in each language", () => {
    const legendIn = (code) => {
      setLanguage(code);
      loadRecords(parsed, "fixtures.xlsx");
      // the species is the reader's own text, so it is set per language here
      setSpecies(code === "ja" ? "マウス" : "mice");
      buildReport(suggestions().filter((s) => s.kind !== "across"));
      const { panels, number } = allFigures()[0];
      return draftLegend(panels, number);
    };
    const english = legendIn("en");
    const japanese = legendIn("ja");
    assert.notEqual(english, japanese);
    assert.match(japanese, /[ぁ-んァ-ヶ一-龥]/, "the Japanese legend is not in Japanese");
    assert.doesNotMatch(english, /[ぁ-んァ-ヶ一-龥]/, "Japanese leaked into the English legend");
    setLanguage("en");
  });

  test("the numbers are the same whichever language reads them", () => {
    const fRun = (code) => {
      setLanguage(code);
      loadRecords(parsed, "fixtures.xlsx");
      buildReport(suggestions().filter((s) => s.kind !== "across"));
      return allFigures().flatMap(({ panels }) => panels
        .filter((p) => p.analysis.ok)
        .map((p) => {
          const m = p.analysis.model;
          const value = m.F ?? m.t ?? m.effects?.within?.F;
          return Number(value).toFixed(6);
        }));
    };
    assert.deepEqual(fRun("ja"), fRun("en"), "translation must not touch the statistics");
    setLanguage("en");
  });
});
