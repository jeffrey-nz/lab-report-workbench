/* dom.js is imported for its pure helpers; nothing here needs a real document,
   because el() and friends only reach for one when they are called. */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { setChildren, append, slug, store } from "../src/dom.js";

/** The smallest thing that behaves like the part of Node these helpers use. */
const fakeNode = () => ({
  nodeType: 1,
  children: [],
  replaceChildren(...kids) { this.children = kids; },
  append(...kids) { this.children.push(...kids); }
});

describe("setChildren", () => {
  test("drops nullish children instead of printing them", () => {
    const node = fakeNode();
    setChildren(node, "a", null, "b", undefined, false, "c");
    assert.deepEqual(node.children, ["a", "b", "c"]);
  });

  test("a view that renders nothing leaves an empty node, not the text 'null'", () => {
    const node = fakeNode();
    setChildren(node, null, undefined, false);
    assert.deepEqual(node.children, []);
  });

  test("flattens nested arrays, as views build them", () => {
    const node = fakeNode();
    setChildren(node, ["a", ["b", [null, "c"]]]);
    assert.deepEqual(node.children, ["a", "b", "c"]);
  });

  test("keeps elements as elements and coerces everything else to text", () => {
    const node = fakeNode();
    const child = fakeNode();
    setChildren(node, child, 42);
    assert.equal(node.children[0], child);
    assert.equal(node.children[1], "42");
  });

  test("zero is content, not emptiness", () => {
    const node = fakeNode();
    setChildren(node, 0, "");
    assert.deepEqual(node.children, ["0", ""]);
  });
});

describe("append", () => {
  test("skips nullish entries the same way", () => {
    const node = fakeNode();
    append(node, ["a", null, undefined, false, "b"]);
    assert.deepEqual(node.children, ["a", "b"]);
  });
});

describe("slug", () => {
  test("makes a label safe to use in an id", () => {
    assert.equal(slug("The figure"), "the-figure");
    assert.equal(slug("WAT IL-1β protein"), "wat-il-1-protein");
    assert.equal(slug("  --spaced--  "), "spaced");
  });

  test("stays within a sensible length", () => {
    assert.ok(slug("x".repeat(200)).length <= 48);
  });
});

describe("store", () => {
  test("returns the fallback when storage is unavailable or empty", () => {
    // node has no localStorage, so every access throws — the point of the wrapper
    assert.deepEqual(store.get("anything", { a: 1 }), { a: 1 });
    assert.equal(store.get("anything"), null);
  });

  test("writing without storage does not throw", () => {
    assert.doesNotThrow(() => store.set("anything", { a: 1 }));
  });
});
