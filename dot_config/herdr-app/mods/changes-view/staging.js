// Kept identical in mods/changes-view and mods/viewer (mods cannot import across folders).
// Pure helpers for staging: no herdr imports, so `node --test mods/changes-view` covers them.

const unstagedSide = (c) => c === " " || c === "?";
// Unmerged paths (git status: UU, AA, DD, AU, UA, DU, UD). Staging one marks it resolved,
// so it is never staged in bulk, only on its own once its markers are gone.
export const isConflict = (xy) => xy.includes("U") || xy === "AA" || xy === "DD";
const conflict = isConflict;

// git status --porcelain XY → whole file staged, nothing staged, some of each, or unmerged.
export function stageState(xy) {
  if (conflict(xy)) return "conflict";
  if (unstagedSide(xy[0])) return "unstaged";
  return xy[1] === " " ? "staged" : "partial";
}

// A folder's state from the states of everything under it. Conflicts don't count (bulk writes
// skip them); a folder holding only conflicts is itself "conflict".
export function combine(states) {
  const rest = states.filter((s) => s !== "conflict");
  if (!rest.length) return states.length ? "conflict" : "unstaged";
  return rest.every((s) => s === rest[0]) ? rest[0] : "partial";
}

// A line that is a git conflict marker: 7 of < | = > then a space or the end of the line.
export const hasMarkers = (text) => /^(?:<{7}|\|{7}|={7}|>{7})(?: |$)/m.test(text);

// The checkbox rule: ticked unstages; empty or part-staged stages everything under it.
export const wantStage = (state) => state !== "staged";

// git arguments for one stage or unstage write. Paths are literal (a "[1]" in a name is not a
// glob). A repo with no commits has no HEAD to restore from; there, rm --cached needs -f to drop
// an index copy that differs from the working file (it never touches the working file).
export function stageArgs(paths, stage, hasHead) {
  const write = stage ? ["add", "-A"] : hasHead ? ["restore", "--staged"] : ["rm", "--cached", "-r", "-f", "-q"];
  return [...write, "--", ...paths.map((p) => `:(literal)${p}`)];
}

// What a folder's (or, with dir "", the whole repo's) bulk write should name: the folder itself,
// or, when a conflicted file is under it, every other listed file under it. git add -A stages
// unmerged paths even when an :(exclude) pathspec names them, so exclusions can't be used.
export function writePaths(files, dir) {
  const under = files.filter((f) => !dir || f.path.startsWith(dir + "/"));
  if (!under.some((f) => f.stage === "conflict")) return [dir || "."];
  return under.filter((f) => f.stage !== "conflict").map((f) => f.path);
}

// Files a commit would take something from.
export const stagedCount = (files) => files.filter((f) => !conflict(f.xy) && !unstagedSide(f.xy[0])).length;
