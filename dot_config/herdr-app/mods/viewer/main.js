// Viewer: a herdr pane showing one file, or one file's uncommitted diff (read-only).
// Files and Changes open it through ./open.js; the pane's props hold only an id (vid), and what
// it shows lives in shared "viewer.items"[vid], so the same pane can be pointed at a new file.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, Scrollbar, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { props, shared, exec, readTextFile, writeTextFile, watchFolder, theme, settings, nextCommand, checking } from "herdr";
import { SECTION, countLines, diffRows, sectionAt, conflictLines, capLines, resolveBlock, splitPatch, hunkPatch } from "./diff.js";
import { stageState, wantStage, stageArgs, isConflict, hasMarkers } from "./staging.js";

// A theme colour at a given alpha ("30" hex): works for #rrggbb and #rrggbbaa alike.
const tint = (color, alpha) => /^#[0-9a-f]{6}$/i.test(color) ? color + alpha : /^#[0-9a-f]{8}$/i.test(color) ? color.slice(0, 7) + alpha : color;

// Lines per diff section; a cut section ends with "… N more lines".
const SECTION_LINES = 20000;

const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };

// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const wideGlyph = /[\p{Ideographic}\p{Emoji_Presentation}\p{Extended_Pictographic}\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\ufe10-\ufe19\ufe30-\ufe6f\uff01-\uff60\uffe0-\uffe6]/gu;

// Keep room for spacing marks and give wide glyphs at least two columns.
function displayColumns(text) {
  let columns = text.length;
  for (const glyph of text.match(wideGlyph) ?? []) {
    if (glyph.length === 1) columns++;
  }
  return columns;
}

// The diff was laid out for 11px text: 20px rows, 7px characters.
const rowHeight = size => Math.ceil(size * 1.8), charWidth = size => size * 0.64;


export default class Viewer extends View {
  init(_props, cx) {
    this.vid = props()?.vid ?? null; this.id = null; this.code = null; this.text = null;
    this.rows = []; this.lines = null; this.longest = 0; this.gutterChars = 4; this.msg = null;
    // Keyboard: focusable (mod.json), so cmd-h/l (pane.go) sends "focus". A file hands it to the
    // editor (a text cursor, arrow keys); a diff keeps it here and moves a line cursor (j/k, arrows).
    // Enter in Files/Changes opens with focus: true, and the content takes the keyboard once loaded.
    this.handle = cx.focus_handle(); this.dscroll = VirtualListScrollHandle.new(); this.dline = 0; this.wantFocus = false;
    if (!checking()) cx.spawn(async cx => {
      for (;;) { if (await nextCommand() === "focus") this.takeKeys(); cx.notify(); }
    });
  }

  // Give the keyboard to what's shown; if it's still loading, take it when it arrives.
  takeKeys() {
    const it = this.item();
    if (it?.kind === "file" && this.code) { this.wantFocus = false; this.code.focus(); }
    else if (it?.kind === "diff" && this.lines) { this.wantFocus = false; this.handle.focus(); }
    else this.wantFocus = true;
  }

  // Diff keys: j/k and arrows move the line cursor, page up/down a screen, home/end the ends.
  key(e, cx) {
    if (this.item()?.kind !== "diff" || !this.rows.length) return;
    const k = e.keystroke, page = Math.max(1, Math.floor((this.dscroll.viewport_size().height || 600) / rowHeight(settings().font_size)) - 1);
    const step = { j: 1, down: 1, k: -1, up: -1, pagedown: page, pageup: -page, home: -Infinity, end: Infinity }[k];
    if (step === undefined) return;
    this.dline = Math.max(0, Math.min(this.rows.length - 1, this.dline + step));
    // Moving up brings the row to the top edge: keep one row clear for the pinned section header.
    this.dscroll.scroll_to_item(step < 0 && sectionAt(this.rows, this.dline) ? Math.max(0, this.dline - 1) : this.dline);
    this.repaintAfterScroll(cx);
    cx.stop_propagation(); cx.notify();
  }

  // offset() holds the last layout's value: repaint once more after the scroll lands so the
  // pinned header matches what's on screen (one deferred frame, not polling).
  repaintAfterScroll(cx) { cx.timer.after(0, cx => cx.notify()); }

  item() { return (shared("viewer.items") ?? {})[this.vid] ?? null; }

  // Called from render: (re)load when the item this pane should show changed.
  sync(cx) {
    const it = this.item(), id = it ? `${it.kind}|${it.on ?? ""}|${it.abs}|${it.n ?? 0}` : null;
    if (id === this.id) return;
    this.id = id; this.code?.release(); this.code = null; this.text = null; this.lines = null; this.setLines([]); this.msg = null; this.dline = 0; this.stage = null; this.stageError = null; this.raw = null;
    if (!it) return;
    // Only a fresh open: the item is saved, and a restart must not take the keyboard.
    if (it.focus && Date.now() - (it.n ?? 0) < 3000) this.wantFocus = true;
    this.load(it, id, cx);
    this.watch(it, id, cx);
  }

  // Reload when anything under the item's folder changes (local folders only; others refresh
  // when reopened). Unchanged content is left alone, so the scroll position survives.
  watch(it, id, cx) {
    if (it.on) return;
    cx.spawn(async cx => {
      try { while (this.id === id) { await watchFolder(it.root); if (this.id === id) this.load(it, id, cx); } }
      catch { /* watch reclaimed or folder gone: content stays as last loaded */ }
    });
  }

  load(it, id, cx) {
    cx.spawn(async cx => {
      try {
        if (it.kind === "file") {
          const text = await readTextFile(it.abs, { on: it.on });
          if (this.id !== id || text === this.text) return;
          this.text = text; this.code?.release(); this.code = null; this.msg = null;
          if (text === null) { this.msg = "This file is no longer available"; return; }
          if (text.includes("\0")) { this.msg = "Binary file · no text preview"; return; }
          const t = theme(), ext = it.abs.includes(".") ? it.abs.split(".").pop() : "txt";
          this.code = EditorState.new({ language: LANG[ext] ?? ext, readonly: true,
            value: text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text,
            syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
        } else {
          const { lines, stage, hasHead, raw, patches } = await this.diffLines(it);
          if (this.id !== id) return;
          this.patches = patches ?? {}; this.stage = stage; this.hasHead = hasHead; this.raw = raw ?? null; this.ready = this.raw !== null && !hasMarkers(this.raw);
          if (this.lines && lines.join("\n") === this.lines.join("\n")) return;
          this.lines = lines; this.setLines(lines.map(l => l.length > 4000 ? l.slice(0, 4000) + "… (line truncated)" : l));
        }
      } catch (e) { if (this.id === id) this.msg = `Cannot show this ${it.kind === "diff" ? "diff" : "file"} (binary, too large, or unreadable)`; }
      finally { if (this.id === id) { if (this.wantFocus) this.takeKeys(); cx.notify(); } }
    });
  }

  // A diff in up to two sections, each its own git diff: "Staged" (last commit -> index) and
  // "Not staged" (index -> working file). Untracked shows as all added, not staged.
  // Also returns the file's stage state for the header checkbox.
  async diffLines(it) {
    const git = (args) => exec("git", [...READ, ...args], { cwd: it.root, on: it.on });
    const hasHead = (await git(["rev-parse", "--verify", "HEAD"])).code === 0;
    const st = await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all", "--", it.rel]);
    const patches = {};
    const done = (lines, xy, raw) => ({ lines, stage: xy ? stageState(xy) : null, hasHead, raw, patches });
    const part = async (args, name) => {
      const r = await git(["diff", ...args, "--no-ext-diff", "--no-textconv", "--no-color", "--", it.rel]);
      if (r.code !== 0) throw new Error(r.stderr);
      if (name) patches[name] = splitPatch(r.stdout);
      const all = r.stdout.replace(/\n$/, "").split("\n"), first = all.findIndex(l => l.startsWith("@@"));
      return first < 0 ? (r.stdout ? ["No text diff available"] : ["(no text changes)"]) : capLines(all.slice(first), SECTION_LINES);
    };
    if (!st.stdout) return done(["No changes"]);
    const xy = st.stdout.slice(0, 2), x = xy[0], y = xy[1];
    if (isConflict(xy)) {
      const text = await readTextFile(it.abs, { on: it.on }).catch(() => null);
      if (text === null) return done(["Conflicted · the working file is gone or unreadable (deleted on one side?)"], xy);
      const whole = hasHead ? [SECTION + "Compared with last commit", ...await part(["HEAD"])] : [];
      return done([...capLines(conflictLines(text.slice(0, 400000)), SECTION_LINES + 1), ...whole], xy, text);
    }
    if (x === "?") {
      const text = await readTextFile(it.abs, { on: it.on }).catch(() => null);
      if (text === null) return done(["Cannot preview this file (binary, too large, or unreadable)"], xy);
      if (text.includes("\0")) return done(["Binary file · no text diff"], xy);
      return done([SECTION + "Not staged · new file", `@@ -0,0 +1,${countLines(text)} @@`, ...capLines(text.slice(0, 400000).replace(/\n$/, "").split("\n").map(l => `+${l}`), SECTION_LINES)], xy);
    }
    const out = [];
    if (x !== " ") out.push(SECTION + "Staged", ...await part(["--cached"], "staged"));
    if (y !== " ") out.push(SECTION + "Not staged", ...await part([], "unstaged"));
    return done(out.length ? out : ["No changes"], xy);
  }

  // The header checkbox: ticked unstages the file, empty or part-staged stages all of it.
  // The repo watch (here and in Changes) reloads both once git has written the index.
  // A conflicted file's box marks it resolved (stages it), once it has no conflict markers.
  toggleStage(it, cx) {
    if (!this.stage || this.staging) return;
    const id = this.id, stage = wantStage(this.stage), args = stageArgs([it.rel], stage, this.hasHead), resolving = this.stage === "conflict";
    this.staging = true; this.stageError = null;
    cx.spawn(async cx => {
      try {
        if (resolving && hasMarkers(await readTextFile(it.abs, { on: it.on }).catch(() => "") ?? "")) throw new Error("still has conflict markers");
        const r = await exec("git", args, { cwd: it.root, on: it.on });
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
      } catch (e) { if (this.id === id) this.stageError = `${stage ? "Stage" : "Unstage"} failed: ${String(e).replace(/^Error: /, "")}`; }
      finally { this.staging = false; if (it.on && this.id === id) this.load(it, id, cx); cx.notify(); }
    });
  }

  // Resolve one conflict block with one side (or both). Writes only if the file still holds what
  // is shown (writeTextFile's expected text), so an edit made elsewhere is never overwritten.
  useBlock(it, block, choice, cx) {
    const next = this.raw === null ? null : resolveBlock(this.raw, block, choice);
    if (next === null || it.on) return;
    const id = this.id;
    this.stageError = null;
    cx.spawn(async cx => {
      try { await writeTextFile(it.abs, next, this.raw); }
      catch { if (this.id === id) { this.stageError = "File changed since it was shown · reloaded"; this.load(it, id, cx); } }
      cx.notify();
    });
  }

  // One hunk: stage it (Not staged), unstage it (Staged), or discard it from the working file
  // (Not staged, after a second click). git apply refuses if the file moved on since it was shown.
  applyHunk(it, row, action, cx) {
    const patch = hunkPatch(this.patches?.[row.staged ? "staged" : "unstaged"] ?? { header: [], hunks: [] }, row.hunk);
    if (!patch || this.staging) return;
    const key = `${row.staged}-${row.hunk}`;
    if (action === "discard" && this.confirm !== key) {
      this.confirm = key;
      cx.timer.after(4000, cx => { if (this.confirm === key) { this.confirm = null; cx.notify(); } });
      return cx.notify();
    }
    this.confirm = null;
    const flags = { stage: ["--cached"], unstage: ["--cached", "-R"], discard: ["-R"] }[action], id = this.id;
    this.staging = true; this.stageError = null;
    cx.spawn(async cx => {
      try {
        const r = await exec("sh", ["-c", `printf %s "$1" | git apply ${flags.join(" ")} -`, "sh", patch], { cwd: it.root, on: it.on });
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").pop());
      } catch (e) { if (this.id === id) { this.stageError = `${action[0].toUpperCase() + action.slice(1)} failed: ${String(e).replace(/^Error: /, "")} · reloaded`; this.load(it, id, cx); } }
      finally { this.staging = false; if (it.on && this.id === id) this.load(it, id, cx); cx.notify(); }
    });
  }

  // Replace the whole working file with one side (git checkout --ours / --theirs). It stays
  // conflicted until its box is ticked.
  takeSide(it, side, cx) {
    const id = this.id;
    this.stageError = null;
    cx.spawn(async cx => {
      try {
        const r = await exec("git", ["checkout", `--${side}`, "--", `:(literal)${it.rel}`], { cwd: it.root, on: it.on });
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
      } catch (e) { if (this.id === id) this.stageError = `Take ${side} failed: ${String(e).replace(/^Error: /, "")}`; }
      finally { if (it.on && this.id === id) this.load(it, id, cx); cx.notify(); }
    });
  }

  setLines(lines) {
    this.rows = diffRows(lines);
    this.longest = Math.max(0, ...this.rows.map(row => displayColumns(row.text)));
    this.gutterChars = Math.max(4, String(Math.max(0, ...this.rows.map(row => row.number ?? 0))).length);
  }

  gutter(size) { return Math.ceil(this.gutterChars * charWidth(size)) + 2; }

  // One row; if building it throws, a red row says why rather than the whole list going blank.
  safeRow(row, t, size, cur) {
    try { return this.diffRow(row, t, size, cur); }
    catch (e) { return div().w_full().px(12).h(rowHeight(size)).flex_none().truncate().text_color(t.ansi1).child(`row error: ${String(e)}`); }
  }

  diffRow({ kind, number, text, staged, conflict, label }, t, size, cur) {
    const height = rowHeight(size);
    // A section header (Staged / Not staged / Conflicted); also drawn pinned at the top while its section scrolls.
    if (kind === "#") return div().w_full().px(12).h(height).flex_none().flex().items_center().bg(cur ? t.selected : t.raised).border_b(1).border_color(t.border)
      .text_color(text.startsWith("Conflicted") ? t.ansi1 : text.startsWith("Compared") ? t.muted : staged ? t.ansi2 : t.ansi3).child(text);
    if (kind === "@") return div().w_full().px(12).h(height).flex_none().truncate().bg(cur ? t.selected : t.raised).text_color(t.dim)
      .child(conflict ? `line ${/\+(\d+)/.exec(text)?.[1] ?? ""}` : text);
    // Conflict view: each side has a coloured bar down its left edge; marker lines become labels.
    const side = { "<": t.ansi4, ">": t.ansi5, "|": t.dim }[kind];
    if (kind === "!") {
      // The marker line itself, in its side's colour: <<<<<<< ours (blue), ||||||| base (dim),
      // ======= the split (both colours), >>>>>>> theirs (magenta).
      const c = { ours: t.ansi4, base: t.dim, theirs: t.ansi5, end: t.ansi5 }[label?.side] ?? t.muted;
      const tag = { ours: "current", base: "original", end: "incoming" }[label?.side];
      const row = h_flex().w_full().h(height).flex_none().gap(10).items_center().bg(cur ? t.selected : tint(c, "30"))
        .child(div().w(3).h_full().flex_none().bg(label?.side === "theirs" ? t.ansi4 : c))
        .child(div().w(this.gutter(size) - 13).flex_none().text_right().text_color(t.dim).child(number === undefined ? "" : String(number)))
        .child(div().flex_none().font_semibold().text_color(c).child(text))
        .when(Boolean(tag), (e) => e.child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(tag)));
      return row;
    }
    const shade = { "+": t.ansi2, "-": t.ansi1 }[kind] ?? side ?? null;
    return h_flex().w_full().h(height).flex_none().gap(10).when(Boolean(shade), (e) => e.bg(tint(shade, side ? "1c" : "18"))).when(kind === "|", (e) => e.text_color(t.dim).italic()).when(cur, (e) => e.bg(t.selected))
      .when(Boolean(side), (e) => e.child(div().w(3).h_full().flex_none().bg(side)))
      .child(div().w(this.gutter(size) - (side ? 13 : 0)).flex_none().text_right().text_color(t.dim).child(number === undefined ? "" : String(number)))
      .child(div().flex_1().min_w(0).truncate().child(text));
  }

  // Use … buttons for each conflict block whose <<<<<<< row is on screen. Drawn over the list
  // (handlers can't be registered on virtual-list rows), lined up with their row.
  blockButtons(it, t, size) {
    if (this.raw === null || it?.on || this.stage !== "conflict") return [];
    const h = rowHeight(size), top = this.dscroll.offset().y, view = this.dscroll.viewport_size().height || 4000, out = [];
    for (let i = Math.max(0, Math.floor(top / h)); i < this.rows.length && i * h - top < view; i++) {
      const label = this.rows[i].label;
      if (label?.side !== "ours") continue;
      const y = i * h - top;
      if (y < h) continue; // under the pinned header
      const button = (id, text, choice) => div().id(`${id}-${label.block}`).px(6).rounded(4).border_1().border_color(t.border).bg(t.background).text_size(11).text_color(t.foreground).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => this.useBlock(it, label.block, choice, cx)).child(text);
      out.push(h_flex().absolute().top(y).right(14).h(h).gap(6).items_center()
        .child(button("use-ours", "Keep current", "ours"))
        .child(button("use-theirs", "Take incoming", "theirs"))
        .child(button("use-both", "Keep both", "both")));
    }
    return out;
  }

  hunkButtons(it, t, size) {
    if (!this.rows || this.stage === "conflict" || !this.patches) return [];
    const h = rowHeight(size), top = this.dscroll.offset().y, view = this.dscroll.viewport_size().height || 4000, out = [];
    for (let i = Math.max(0, Math.floor(top / h)); i < this.rows.length && i * h - top < view; i++) {
      const row = this.rows[i];
      if (row.kind !== "@" || row.hunk === undefined || !this.patches[row.staged ? "staged" : "unstaged"]?.hunks[row.hunk]) continue;
      const y = i * h - top;
      if (y < h) continue; // under the pinned header
      const button = (action, text, color) => div().id(`hunk-${action}-${row.staged}-${row.hunk}`).px(6).rounded(4).border_1().border_color(color ?? t.border).bg(t.background).text_size(11).text_color(color ?? t.foreground).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => this.applyHunk(it, row, action, cx)).child(text);
      const confirming = this.confirm === `${row.staged}-${row.hunk}`;
      out.push(h_flex().absolute().top(y).right(14).h(h).gap(6).items_center()
        .when(row.staged, e => e.child(button("unstage", "Unstage")))
        .when(!row.staged, e => e.child(button("stage", "Stage")).child(button("discard", confirming ? "Really discard?" : "Discard", confirming ? t.ansi1 : undefined))));
    }
    return out;
  }

  // The header of the section the top visible row is in.
  stickyHeader(size) { return sectionAt(this.rows, Math.floor(this.dscroll.offset().y / rowHeight(size))); }

  render(cx) {
    this.sync(cx);
    const t = theme(), it = this.item(), font = settings(), size = font.font_size, focused = this.handle.is_focused();
    const header = h_flex().h(30).flex_none().px(12).gap(6).items_center().border_b(1).border_color(t.border).text_size(12)
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(it ? it.rel : ""))
      .when(it?.kind === "diff" && this.stage === "conflict" && this.ready, el => el.child(div().id("mark-resolved").px(8).py(1).rounded(4).bg(t.solid).text_size(11).text_color(t.solid_foreground).cursor_pointer()
        .on_click((_e, cx) => this.toggleStage(it, cx)).child("Mark resolved")))
      .when(it?.kind === "diff" && this.stage === "conflict" && !this.ready, el => {
        const button = (id, text, side) => div().id(id).px(6).rounded(4).border_1().border_color(t.border).text_size(11).text_color(t.muted).cursor_pointer().hover(s => s.bg(t.hover))
          .on_click((_e, cx) => this.takeSide(it, side, cx)).child(text);
        return el.child(button("take-ours", "Keep all current", "ours")).child(button("take-theirs", "Take all incoming", "theirs"));
      })
      .when(Boolean(this.stageError), el => el.child(div().max_w(260).truncate().text_color(t.ansi1).child(this.stageError)))
      .when(it?.kind === "diff", el => el.child(div().text_color(t.dim).child("changes")))
      .when(it?.kind === "diff" && Boolean(this.stage), el => el.child(div().id("viewer-stage").flex_none().cursor_pointer().on_click((_e, cx) => this.toggleStage(it, cx))
        .child(svg(`mods/viewer/check-${this.stage === "conflict" && this.ready ? "ready" : { staged: "on", partial: "part", conflict: "conflict" }[this.stage] ?? "off"}.svg`).size(14).text_color(this.stage === "conflict" ? (this.ready ? t.ansi2 : t.ansi1) : this.stage === "unstaged" ? t.dim : t.accent))));
    const message = (m) => div().p(12).text_color(t.dim).child(m);
    let body;
    if (!it) body = message("Nothing to show · open a file from Files or Changes");
    else if (this.msg) body = message(this.msg);
    else if (it.kind === "file") body = this.code ? Editor.new(this.code).font_family(font.font_family).text_size(size).flex_1().min_h(0) : message("Loading file…");
    else body = !this.lines ? message("Loading changes…") : div().flex_1().min_h(0).relative().font_family(font.font_family ?? "JetBrains Mono").text_size(size)
      .child(div().id("viewer-diff-x").size_full().overflow_x_scrollbar()
        .child(div().w_full().min_w(Math.max(300, this.longest * charWidth(size) + this.gutter(size) + 20)).h_full().child(v_virtual_list("viewer-diff", this.rows.length, rowHeight(size), (i) => String(i),
          (range) => this.rows.slice(range.start, range.end).map((row, j) => this.safeRow(row, t, size, focused && range.start + j === this.dline))).track_scroll(this.dscroll).size_full())))
      .children(this.blockButtons(it, t, size))
      .children(this.hunkButtons(it, t, size))
      .when(this.stickyHeader(size), el => el.child(div().absolute().top_0().left_0().right_0().child(this.diffRow(this.stickyHeader(size), t, size, false))))
      .child(Scrollbar.vertical("viewer-diff").viewport_from_layout().absolute().inset_0())
      // Repaint the pinned header as the list moves: wheel/trackpad, or dragging the scrollbar.
      .on_scroll_wheel((_e, cx) => { cx.notify(); this.repaintAfterScroll(cx); })
      .on_mouse_move((e, cx) => { if (e.pressed_button === "left") cx.notify(); });
    return v_flex().id("viewer").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx)).size_full().min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13).child(header).child(body);
  }
}
