// Pure diff parsing for the viewer: no herdr imports, so `node --test mods/viewer` covers it.

// Marks a section header line (Staged / Not staged). A diff line can't hold a NUL byte.
export const SECTION = "\u0000§";
export const countLines = (text) => text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;

// Text draws a tab as nothing: pad each to the next 4-column stop.
export const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));

// Numbers each diff line once, so a frame only draws the rows on screen. Each section's
// header is a "#" row; rows below it carry staged: true/false and restart the numbering.
export function diffRows(lines) {
  let old = 0, next = 0, staged = false;
  return lines.map((line) => {
    if (line.startsWith(SECTION)) { old = 0; next = 0; staged = line.slice(SECTION.length).startsWith("Staged"); return { kind: "#", staged, text: line.slice(SECTION.length) }; }
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { old = +match[1]; next = +match[2]; return { kind: "@", staged, text: line }; }
    const kind = line[0];
    if (kind === "-") return { kind, staged, number: old++, text: untab(line.slice(1)) || " " };
    if (kind === "+") return { kind, staged, number: next++, text: untab(line.slice(1)) || " " };
    if (kind === " ") { old++; return { kind, staged, number: next++, text: untab(line.slice(1)) || " " }; }
    return { kind: "", staged, text: line };
  });
}

// The section header a row sits under (for the pinned header), or null outside any section.
export function sectionAt(rows, index) {
  for (let i = Math.min(index, rows.length - 1); i >= 0; i--) if (rows[i].kind === "#") return rows[i];
  return null;
}
