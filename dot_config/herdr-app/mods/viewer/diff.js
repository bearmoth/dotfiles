// Pure diff parsing for the viewer: no herdr imports, so `node --test mods/viewer` covers it.

// Marks a section header line (Staged / Not staged). A diff line can't hold a NUL byte.
export const SECTION = "\u0000§";
export const countLines = (text) => text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;

// Text draws a tab as nothing: pad each to the next 4-column stop.
export const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));

// Numbers each diff line once, so a frame only draws the rows on screen. Each section's
// header is a "#" row; rows below it carry staged: true/false and restart the numbering.
export function diffRows(lines) {
  let old = 0, next = 0, staged = false, conflict = false;
  const rows = lines.map((line) => {
    if (line.startsWith(SECTION)) { old = 0; next = 0; const text = line.slice(SECTION.length); staged = text.startsWith("Staged"); conflict = text.startsWith("Conflicted"); return { kind: "#", staged, text }; }
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { old = +match[1]; next = +match[2]; return { kind: "@", staged, conflict, text: line }; }
    const kind = line[0];
    if (kind === "-") return { kind, staged, number: old++, text: untab(line.slice(1)) || " " };
    if (kind === "+") return { kind, staged, number: next++, text: untab(line.slice(1)) || " " };
    if (kind === " ") { old++; return { kind, staged, number: next++, text: untab(line.slice(1)) || " " }; }
    // Conflict view (conflictLines): ours, theirs, base, marker; numbered by working-file line.
    if (kind === "<" || kind === ">" || kind === "|" || kind === "!") return { kind, staged, number: next++, text: untab(line.slice(1)) || " " };
    return { kind: "", staged, text: line };
  });
  labelMarkers(rows);
  return rows;
}

// Conflict marker rows ("!") get { side, name }: <<<<<<< opens ours, ||||||| the base,
// ======= theirs (named after the >>>>>>> that closes it), and >>>>>>> ends the block.
function labelMarkers(rows) {
  const side = { "<": "ours", "|": "base", "=": "theirs", ">": "end" };
  rows.forEach((r, i) => {
    if (r.kind !== "!") return;
    const s = side[r.text[0]];
    let name = s === "end" ? "" : r.text.slice(7).trim();
    if (s === "theirs") { const close = rows.slice(i + 1).find(x => x.kind === "!" && x.text[0] === ">"); name = close ? close.text.slice(7).trim() : ""; }
    r.label = { side: s, name };
  });
}

// The section header a row sits under (for the pinned header), or null outside any section.
export function sectionAt(rows, index) {
  for (let i = Math.min(index, rows.length - 1); i >= 0; i--) if (rows[i].kind === "#") return rows[i];
  return null;
}

const MARKER = /^(?:<{7}|\|{7}|={7}|>{7})(?: |$)/;

// A conflicted working file as one "Conflicted" section: each conflict block with 3 lines of
// context, "@@ -N +N @@" between blocks. Prefixes: "<" ours, "|" base, ">" theirs, "!" marker.
export function conflictLines(text, context = 3) {
  const file = text.replace(/\n$/, "").split("\n"), marks = [];
  let side = " ";
  for (const line of file) {
    if (MARKER.test(line)) { marks.push("!"); side = { "<": "<", "|": "|", "=": ">", ">": " " }[line[0]]; }
    else marks.push(side);
  }
  const head = [SECTION + "Conflicted"];
  if (!marks.includes("!")) return [...head, "No conflict markers left · tick the box to mark resolved"];
  // Ranges [from, to] around each conflicted line, merged where they touch.
  const ranges = [];
  marks.forEach((m, i) => {
    if (m === " ") return;
    const from = Math.max(0, i - context), to = Math.min(file.length - 1, i + context), last = ranges[ranges.length - 1];
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to); else ranges.push([from, to]);
  });
  const out = [...head];
  for (const [from, to] of ranges) {
    out.push(`@@ -${from + 1} +${from + 1} @@`);
    for (let i = from; i <= to; i++) out.push(marks[i] + file[i]);
  }
  return out;
}

// At most `max` lines, then one row saying how many more there were.
export const capLines = (lines, max) => lines.length > max ? [...lines.slice(0, max), `… ${lines.length - max} more lines`] : lines;
