// Viewer: a herdr pane showing one file, or one file's uncommitted diff (read-only).
// Files and Changes open it through ./open.js; the pane's props hold only an id (vid), and what
// it shows lives in shared "viewer.items"[vid], so the same pane can be pointed at a new file.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, Scrollbar, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { props, shared, exec, readTextFile, watchFolder, theme, settings, nextCommand, checking } from "herdr";

const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };

// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const countLines = (text) => text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;
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

// Text draws a tab as nothing: pad each to the next 4-column stop.
const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));

// Numbers each diff line once, so a frame only draws the rows on screen.
function diffRows(lines) {
  let old = 0, next = 0;
  return lines.map((line) => {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { old = +match[1]; next = +match[2]; return { kind: "@", text: line }; }
    const kind = line[0];
    if (kind === "-") return { kind, number: old++, text: untab(line.slice(1)) || " " };
    if (kind === "+") return { kind, number: next++, text: untab(line.slice(1)) || " " };
    if (kind === " ") { old++; return { kind, number: next++, text: untab(line.slice(1)) || " " }; }
    return { kind: "", text: line };
  });
}


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
    this.dscroll.scroll_to_item(this.dline);
    cx.stop_propagation(); cx.notify();
  }

  item() { return (shared("viewer.items") ?? {})[this.vid] ?? null; }

  // Called from render: (re)load when the item this pane should show changed.
  sync(cx) {
    const it = this.item(), id = it ? `${it.kind}|${it.on ?? ""}|${it.abs}|${it.n ?? 0}` : null;
    if (id === this.id) return;
    this.id = id; this.code?.release(); this.code = null; this.text = null; this.lines = null; this.setLines([]); this.msg = null; this.dline = 0;
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
          const lines = await this.diffLines(it);
          if (this.id !== id || (this.lines && lines.join("\n") === this.lines.join("\n"))) return;
          this.lines = lines; this.setLines(lines.slice(0, 1500).map(l => l.length > 4000 ? l.slice(0, 4000) + "… (line truncated)" : l));
        }
      } catch (e) { if (this.id === id) this.msg = `Cannot show this ${it.kind === "diff" ? "diff" : "file"} (binary, too large, or unreadable)`; }
      finally { if (this.id === id) { if (this.wantFocus) this.takeKeys(); cx.notify(); } }
    });
  }

  // The file against the last commit; untracked (or no commits yet) shows as all added.
  async diffLines(it) {
    const git = (args) => exec("git", [...READ, ...args], { cwd: it.root, on: it.on });
    const head = (await git(["rev-parse", "--verify", "HEAD"])).code === 0;
    const st = await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all", "--", it.rel]);
    const xy = st.stdout.slice(0, 2);
    if (!st.stdout) return ["No changes"];
    if (xy === "??" || (!head && xy.includes("A"))) {
      const text = await readTextFile(it.abs, { on: it.on }).catch(() => null);
      if (text === null) return ["Cannot preview this file (binary, too large, or unreadable)"];
      if (text.includes("\0")) return ["Binary file · no text diff"];
      return [`@@ -0,0 +1,${countLines(text)} @@`, ...text.slice(0, 400000).replace(/\n$/, "").split("\n").slice(0, 1500).map(l => `+${l}`)];
    }
    const r = await git(["diff", ...(head ? ["HEAD"] : []), "--no-ext-diff", "--no-textconv", "--no-color", "--", it.rel]);
    if (r.code !== 0) throw new Error(r.stderr);
    const all = r.stdout.replace(/\n$/, "").split("\n"), first = all.findIndex(l => l.startsWith("@@"));
    return first < 0 ? ["No text diff available"] : all.slice(first);
  }

  setLines(lines) {
    this.rows = diffRows(lines);
    this.longest = Math.max(0, ...this.rows.map(row => displayColumns(row.text)));
    this.gutterChars = Math.max(4, String(Math.max(0, ...this.rows.map(row => row.number ?? 0))).length);
  }

  gutter(size) { return Math.ceil(this.gutterChars * charWidth(size)) + 2; }

  diffRow({ kind, number, text }, t, size, cur) {
    const height = rowHeight(size);
    if (kind === "@") return div().w_full().px(12).h(height).flex_none().truncate().bg(cur ? t.selected : t.raised).text_color(t.dim).child(text);
    return h_flex().w_full().h(height).flex_none().gap(10).when(kind === "+", (e) => e.bg(t.ansi2 + "18")).when(kind === "-", (e) => e.bg(t.ansi1 + "18")).when(cur, (e) => e.bg(t.selected))
      .child(div().w(this.gutter(size)).flex_none().text_right().text_color(t.dim).child(number === undefined ? "" : String(number)))
      .child(div().flex_1().min_w(0).truncate().child(text));
  }

  render(cx) {
    this.sync(cx);
    const t = theme(), it = this.item(), font = settings(), size = font.font_size, focused = this.handle.is_focused();
    const header = h_flex().h(30).flex_none().px(12).gap(6).items_center().border_b(1).border_color(t.border).text_size(12)
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(it ? it.rel : ""))
      .when(it?.kind === "diff", el => el.child(div().text_color(t.dim).child("changes")));
    const message = (m) => div().p(12).text_color(t.dim).child(m);
    let body;
    if (!it) body = message("Nothing to show · open a file from Files or Changes");
    else if (this.msg) body = message(this.msg);
    else if (it.kind === "file") body = this.code ? Editor.new(this.code).font_family(font.font_family).text_size(size).flex_1().min_h(0) : message("Loading file…");
    else body = !this.lines ? message("Loading changes…") : div().flex_1().min_h(0).relative().font_family(font.font_family ?? "JetBrains Mono").text_size(size)
      .child(div().id("viewer-diff-x").size_full().overflow_x_scrollbar()
        .child(div().w_full().min_w(Math.max(300, this.longest * charWidth(size) + this.gutter(size) + 20)).h_full().child(v_virtual_list("viewer-diff", this.rows.length, rowHeight(size), (i) => String(i),
          (range) => this.rows.slice(range.start, range.end).map((row, j) => this.diffRow(row, t, size, focused && range.start + j === this.dline))).track_scroll(this.dscroll).size_full())))
      .child(Scrollbar.vertical("viewer-diff").viewport_from_layout().absolute().inset_0());
    return v_flex().id("viewer").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx)).size_full().min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13).child(header).child(body);
  }
}
