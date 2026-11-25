// Kept identical in mods/changes-view and mods/viewer (mods cannot import across folders).
// Pure helpers for staging: no herdr imports, so `node --test mods/changes-view` covers them.

const unstagedSide = (c) => c === " " || c === "?";
const conflict = (xy) => xy.includes("U") || xy === "AA" || xy === "DD";

// git status --porcelain XY → whole file staged, nothing staged, or some of each.
// A conflict counts as not staged: staging it is how git marks it resolved.
export function stageState(xy) {
  if (conflict(xy) || unstagedSide(xy[0])) return "unstaged";
  return xy[1] === " " ? "staged" : "partial";
}

// A folder's state from the states of everything under it.
export function combine(states) {
  if (!states.length) return "unstaged";
  return states.every((s) => s === states[0]) ? states[0] : "partial";
}

// The checkbox rule: ticked unstages; empty or part-staged stages everything under it.
export const wantStage = (state) => state !== "staged";

// git arguments for one stage or unstage write. A repo with no commits has no HEAD to restore from.
export function stageArgs(paths, stage, hasHead) {
  if (stage) return ["add", "-A", "--", ...paths];
  return hasHead ? ["restore", "--staged", "--", ...paths] : ["rm", "--cached", "-r", "-q", "--", ...paths];
}

// Files a commit would take something from.
export const stagedCount = (files) => files.filter((f) => !conflict(f.xy) && !unstagedSide(f.xy[0])).length;
