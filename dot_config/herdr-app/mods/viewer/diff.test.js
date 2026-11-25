// node --test mods/viewer  (pure diff parsing; the mod itself runs inside herdr-app)
import { test } from "node:test";
import assert from "node:assert/strict";
import { SECTION, diffRows, sectionAt, conflictLines, capLines } from "./diff.js";

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

const conflicted = ["a", "b", "c", "d", "<<<<<<< HEAD", "mine", "=======", "theirs", ">>>>>>> feature", "e", "f", "g", "h", "i", "j", "k", "l",
  "<<<<<<< HEAD", "m2", "||||||| base", "b2", "=======", "t2", ">>>>>>> feature", "z"].join("\n") + "\n";

test("conflictLines shows each block with context, numbered by file line", () => {
  const rows = diffRows(conflictLines(conflicted));
  assert.equal(rows[0].kind, "#"); assert.equal(rows[0].text, "Conflicted");
  const kinds = rows.map(r => r.kind).join("");
  assert.equal(kinds, "#@   !<!>!   @   !<!|!>! ");
  const mine = rows.find(r => r.text === "mine"), base = rows.find(r => r.text === "b2"), z = rows.find(r => r.text === "z");
  assert.equal(mine.number, 6); assert.equal(base.number, 21); assert.equal(z.number, 25);
});

test("conflictLines with no markers left says so", () => {
  const lines = conflictLines("all fixed\n");
  assert.equal(lines[0], SECTION + "Conflicted");
  assert.match(lines[1], /No conflict markers left/);
});

test("capLines keeps max lines and says how many were cut", () => {
  assert.deepEqual(capLines(["1", "2", "3", "4", "5"], 3), ["1", "2", "3", "… 2 more lines"]);
  assert.deepEqual(capLines(["1"], 3), ["1"]);
});

test("conflict rows get labels from their markers", () => {
  const rows = diffRows(conflictLines(conflicted));
  const marks = rows.filter(r => r.kind === "!").map(r => r.label);
  assert.deepEqual(marks.slice(0, 3), [{ side: "ours", name: "HEAD", block: 0 }, { side: "theirs", name: "feature" }, { side: "end", name: "" }]);
  assert.deepEqual(marks.slice(3), [{ side: "ours", name: "HEAD", block: 1 }, { side: "base", name: "base" }, { side: "theirs", name: "feature" }, { side: "end", name: "" }]);
  assert.ok(rows.filter(r => r.kind === "@").every(r => r.conflict === true));
  assert.equal(diffRows(["@@ -1,2 +1,2 @@"])[0].conflict, false);
});

import { resolveBlock } from "./diff.js";

test("resolveBlock rewrites one conflict block and leaves the rest", () => {
  const ours = resolveBlock(conflicted, 0, "ours");
  assert.ok(ours.includes("d\nmine\ne\n")); assert.ok(!ours.includes("theirs\n>>>")); assert.ok(ours.includes("<<<<<<< HEAD\nm2")); // block 2 untouched
  const theirs = resolveBlock(conflicted, 1, "theirs");
  assert.ok(theirs.includes("l\nt2\nz\n")); assert.ok(theirs.includes("<<<<<<< HEAD\nmine"));
  const both = resolveBlock(conflicted, 1, "both");
  assert.ok(both.includes("l\nm2\nt2\nz\n")); // base dropped
  assert.equal(resolveBlock(resolveBlock(conflicted, 0, "ours"), 0, "ours").includes("<<<<<<<"), false);
  assert.equal(resolveBlock(conflicted, 5, "ours"), null);
});

test("CRLF files: markers still found, line endings kept", () => {
  const crlf = conflicted.replace(/\n/g, "\r\n");
  const rows = diffRows(conflictLines(crlf));
  assert.ok(rows.some(r => r.kind === "!"));
  assert.ok(resolveBlock(crlf, 0, "ours").includes("d\r\nmine\r\ne\r\n"));
});

test("opening marker rows carry their block number", () => {
  const rows = diffRows(conflictLines(conflicted));
  assert.deepEqual(rows.filter(r => r.label?.side === "ours").map(r => r.label.block), [0, 1]);
});
