// node --test mods/changes-view  (pure helpers only; the mod itself runs inside herdr-app)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stageState, combine, wantStage, stageArgs, stagedCount, isConflict, hasMarkers } from "./staging.js";

test("stageState reads git's XY pair", () => {
  const cases = { "M ": "staged", " M": "unstaged", "MM": "partial", "??": "unstaged", "A ": "staged",
    "AM": "partial", " D": "unstaged", "D ": "staged", "UU": "conflict", "AA": "conflict", "DD": "conflict", "AU": "conflict", "UD": "conflict" };
  for (const [xy, want] of Object.entries(cases)) assert.equal(stageState(xy), want, xy);
});

test("combine gives a folder's state", () => {
  assert.equal(combine(["staged", "staged"]), "staged");
  assert.equal(combine(["staged", "unstaged"]), "partial");
  assert.equal(combine(["partial"]), "partial");
  assert.equal(combine(["unstaged", "unstaged"]), "unstaged");
  assert.equal(combine([]), "unstaged");
});

test("wantStage: anything not fully staged gets staged", () => {
  assert.equal(wantStage("staged"), false);
  assert.equal(wantStage("partial"), true);
  assert.equal(wantStage("unstaged"), true);
});

test("stageArgs: literal paths after --, conflicts excluded", () => {
  assert.deepEqual(stageArgs(["a b", "-x"], true, true), ["add", "-A", "--", ":(literal)a b", ":(literal)-x"]);
  assert.deepEqual(stageArgs(["src"], true, true, ["src/c"]), ["add", "-A", "--", ":(literal)src", ":(exclude,literal)src/c"]);
  assert.deepEqual(stageArgs(["d"], false, true), ["restore", "--staged", "--", ":(literal)d"]);
  // -f: with --cached it only drops the index copy, even one that differs from the working file.
  assert.deepEqual(stageArgs(["d"], false, false, ["d/u"]), ["rm", "--cached", "-r", "-f", "-q", "--", ":(literal)d", ":(exclude,literal)d/u"]);
});

test("combine ignores conflicts; only conflicts gives conflict", () => {
  assert.equal(combine(["conflict", "staged"]), "staged");
  assert.equal(combine(["conflict", "staged", "unstaged"]), "partial");
  assert.equal(combine(["conflict"]), "conflict");
});

test("isConflict and hasMarkers", () => {
  assert.equal(isConflict("UU"), true); assert.equal(isConflict("MM"), false);
  for (const t of ["x\n<<<<<<< HEAD\ny", "=======", "a\n>>>>>>> feature", "|||||||  base"]) assert.equal(hasMarkers(t), true, t);
  for (const t of ["a <<<<<<< b", "========", "<<<<<<<<", "plain"]) assert.equal(hasMarkers(t), false, t);
});

test("stagedCount counts files with anything staged", () => {
  assert.equal(stagedCount([{ xy: "M " }, { xy: "MM" }, { xy: " M" }, { xy: "??" }, { xy: "UU" }]), 2);
});

test("viewer's copy is identical", () => {
  const url = (p) => new URL(p, import.meta.url);
  assert.equal(readFileSync(url("./staging.js"), "utf8"), readFileSync(url("../viewer/staging.js"), "utf8"));
});
