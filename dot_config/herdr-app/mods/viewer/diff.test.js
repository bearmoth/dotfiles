// node --test mods/viewer  (pure diff parsing; the mod itself runs inside herdr-app)
import { test } from "node:test";
import assert from "node:assert/strict";
import { SECTION, diffRows, sectionAt } from "./diff.js";

const lines = [SECTION + "Staged", "@@ -3,2 +3,2 @@", "-a", "+b", " c", SECTION + "Not staged", "@@ -10,1 +10,1 @@", "-x", "+y"];

test("diffRows numbers lines and marks each row's section", () => {
  const rows = diffRows(lines);
  assert.deepEqual(rows.slice(0, 5).map(r => r.kind), ["#", "@", "-", "+", " "]);
  assert.deepEqual(rows.slice(2, 5).map(r => r.number), [3, 3, 4]);
  assert.ok(rows.slice(0, 5).every(r => r.staged === true));
  assert.equal(rows[0].text, "Staged");
});

test("a second section restarts numbering and is not staged", () => {
  const rows = diffRows(lines);
  assert.deepEqual(rows.slice(5).map(r => r.kind), ["#", "@", "-", "+"]);
  assert.deepEqual(rows.slice(7).map(r => r.number), [10, 10]);
  assert.ok(rows.slice(5).every(r => r.staged === false));
});

test("sectionAt finds the header a row sits under", () => {
  const rows = diffRows(lines);
  assert.equal(sectionAt(rows, 0), rows[0]);
  assert.equal(sectionAt(rows, 3), rows[0]);
  assert.equal(sectionAt(rows, rows.length - 1), rows[5]);
  assert.equal(sectionAt(rows, 99), rows[5]);
  assert.equal(sectionAt([], 0), null);
  assert.equal(sectionAt(diffRows(["No changes"]), 0), null);
});
