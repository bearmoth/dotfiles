// node --test mods/changes-view  (pure helpers only; the mod itself runs inside herdr-app)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stageState, combine, wantStage, stageArgs, stagedCount } from "./staging.js";

test("stageState reads git's XY pair", () => {
  const cases = { "M ": "staged", " M": "unstaged", "MM": "partial", "??": "unstaged", "A ": "staged",
    "AM": "partial", " D": "unstaged", "D ": "staged", "UU": "unstaged", "AA": "unstaged", "DD": "unstaged" };
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
  assert.deepEqual(stageArgs(["a b", "-x"], true, true), ["--literal-pathspecs", "add", "-A", "--", "a b", "-x"]);
  assert.deepEqual(stageArgs(["d"], false, true), ["--literal-pathspecs", "restore", "--staged", "--", "d"]);
  // -f: with --cached it only drops the index copy, even one that differs from the working file.
  assert.deepEqual(stageArgs(["d"], false, false), ["--literal-pathspecs", "rm", "--cached", "-r", "-f", "-q", "--", "d"]);
});

test("stagedCount counts files with anything staged", () => {
  assert.equal(stagedCount([{ xy: "M " }, { xy: "MM" }, { xy: " M" }, { xy: "??" }]), 2);
});

test("viewer's copy is identical", () => {
  const url = (p) => new URL(p, import.meta.url);
  assert.equal(readFileSync(url("./staging.js"), "utf8"), readFileSync(url("../viewer/staging.js"), "utf8"));
});
