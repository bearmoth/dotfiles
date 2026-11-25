// node --test mods/changes-view  (pure helpers only; the mod itself runs inside herdr-app)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stageState, combine, wantStage, stageArgs, stagedCount, isConflict, hasMarkers, writePaths } from "./staging.js";

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

test("stageArgs: literal paths, always after --", () => {
  assert.deepEqual(stageArgs(["a b", "-x"], true, true), ["add", "-A", "--", ":(literal)a b", ":(literal)-x"]);
  assert.deepEqual(stageArgs(["d"], false, true), ["restore", "--staged", "--", ":(literal)d"]);
  // -f: with --cached it only drops the index copy, even one that differs from the working file.
  assert.deepEqual(stageArgs(["d"], false, false), ["rm", "--cached", "-r", "-f", "-q", "--", ":(literal)d"]);
});

// git add -A stages unmerged paths even when :(exclude) names them (git 2.56), so a bulk
// write that would reach a conflict lists the other files instead.
test("writePaths: the folder itself unless a conflict is under it", () => {
  const files = [{ path: "src/a.js", stage: "unstaged" }, { path: "src/ui/c.js", stage: "conflict" }, { path: "src/ui/d.js", stage: "staged" }, { path: "docs/e.md", stage: "unstaged" }];
  assert.deepEqual(writePaths(files, "docs"), ["docs"]);
  assert.deepEqual(writePaths(files, "src"), ["src/a.js", "src/ui/d.js"]);
  assert.deepEqual(writePaths(files, "src/ui"), ["src/ui/d.js"]);
  assert.deepEqual(writePaths(files, ""), ["src/a.js", "src/ui/d.js", "docs/e.md"]);
  assert.deepEqual(writePaths(files.filter(f => f.stage !== "conflict"), ""), ["."]);
  assert.deepEqual(writePaths([{ path: "x", stage: "conflict" }], ""), []);
  assert.deepEqual(writePaths(files, "sr"), ["sr"]); // a prefix is not a parent folder
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
