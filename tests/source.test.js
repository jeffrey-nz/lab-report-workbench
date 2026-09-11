/* Structural guards. These do not test behaviour; they stop the codebase
   drifting back to the shapes that caused real bugs. */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith(".js")) out.push(path);
  }
  return out;
}

const sources = walk(join(ROOT, "src")).map((path) => ({
  path: relative(ROOT, path),
  code: readFileSync(path, "utf8")
}));
const html = readFileSync(join(ROOT, "index.html"), "utf8");

describe("markup, styles and behaviour stay separate", () => {
  test("index.html carries no inline stylesheet", () => {
    assert.doesNotMatch(html, /<style[\s>]/i, "styles belong in styles/");
  });

  test("index.html carries no inline script body", () => {
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      assert.match(m[1], /\bsrc=/i, "every script must be a src reference");
      assert.equal(m[2].trim(), "", "no inline script body");
    }
  });

  test("index.html carries no inline event handlers", () => {
    assert.doesNotMatch(html, /\son[a-z]+\s*=\s*"/i, "handlers belong in src/");
  });

  test("every stylesheet index.html links actually exists", () => {
    const links = [...html.matchAll(/<link[^>]+href="(\.\/[^"]+)"/g)].map((m) => m[1]);
    assert.ok(links.length >= 4, "expected the layered stylesheets");
    for (const href of links)
      assert.doesNotThrow(() => statSync(join(ROOT, href)), `missing ${href}`);
  });

  test("the module entry point exists", () => {
    const m = html.match(/<script[^>]+type="module"[^>]+src="(\.\/[^"]+)"/);
    assert.ok(m, "index.html must load a module entry point");
    assert.doesNotThrow(() => statSync(join(ROOT, m[1])));
  });
});

describe("the drawing and analysis code stays free of the DOM", () => {
  const pure = sources.filter((s) => s.path.startsWith("src/lib/"));

  test("src/lib does not reach for a document at module scope", () => {
    for (const { path, code } of pure) {
      // svgToPng needs a canvas, but only inside the function body
      const topLevel = code.replace(/export function svgToPng[\s\S]*?\n}\n/, "");
      assert.doesNotMatch(topLevel, /^\s*(const|let|var)[^\n]*\bdocument\b/m,
        `${path} touches document while loading`);
    }
  });

  test("src/lib imports nothing from the view layer", () => {
    for (const { path, code } of pure)
      for (const m of code.matchAll(/from\s+"([^"]+)"/g))
        assert.ok(!/\.\.\/(views|state|dom|exports|labels)/.test(m[1]),
          `${path} imports ${m[1]} — lib must not depend on the app`);
  });
});

describe("guards against bugs already fixed once", () => {
  test("views set children through setChildren, never replaceChildren", () => {
    for (const { path, code } of sources) {
      if (path === "src/dom.js") continue;
      assert.doesNotMatch(code, /\.replaceChildren\(/,
        `${path} calls replaceChildren directly — a null child renders as the text "null"`);
    }
  });

  test("no debugging output is left in the shipped code", () => {
    for (const { path, code } of sources)
      assert.doesNotMatch(code, /console\.(log|debug|trace)\(/, `${path} logs to the console`);
  });

  test("every module the sources import resolves to a file", () => {
    for (const { path, code } of sources) {
      for (const m of code.matchAll(/from\s+"(\.[^"]+)"/g)) {
        const target = join(ROOT, dirname(path), m[1]);
        assert.doesNotThrow(() => statSync(target), `${path} imports missing ${m[1]}`);
      }
    }
  });

  test("nothing in the repository looks like study data", () => {
    const strays = readdirSync(ROOT).filter((n) => /\.(xlsx|xls|docx|csv)$/i.test(n));
    assert.deepEqual(strays, [], `data files must not be committed: ${strays}`);
  });
});
