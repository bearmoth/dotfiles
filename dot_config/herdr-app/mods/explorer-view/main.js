// A lazy file browser for the focused pane's folder. Opening a file shows it in the tab's
// viewer pane (mods/viewer), split off to the right of the terminal the first time.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle, Scrollbar } from "gpui-base";
import { openInViewer } from "./open.js";
import { spaces, panes, focused, exec, watchFolder, theme, window, run, shared, nextCommand, checking } from "herdr";

// While a mod pane (the viewer) is focused, keep browsing the folder we were in.
let last = null;
function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  if (pane?.mod && last?.space === space?.id) return last;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return (last = { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id });
}
// The panel's root: the git project root when the folder is inside a repo, else the folder
// itself, so moving around inside a repo doesn't reset the panel. Looked up once per folder;
// until the answer arrives, key() is null and the panel keeps what it shows. Checked again in
// the background (keeping the cached answer meanwhile) when the panel gains the keyboard or its
// folder watch fires, so a `git init` or a removed .git is picked up without polling.
const roots = new Map(), resolving = new Set();
const rootId = (l) => `${l.on ?? ""}|${l.cwd}`;
function resolveRoot(l, cx, again = false) {
  const id = rootId(l);
  if (!l.cwd || resolving.has(id) || (roots.has(id) && !again)) return;
  resolving.add(id);
  cx.spawn(async cx => {
    let root = l.cwd;
    try {
      const r = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: l.cwd, on: l.on });
      if (r.code === 0 && r.stdout.trim()) root = r.stdout.trim();
    } catch { /* not a repo, or git missing: the folder itself */ }
    const changed = roots.get(id) !== root;
    roots.set(id, root); resolving.delete(id);
    if (changed) cx.notify();
  });
}
function key() {
  const l = location(), root = l.cwd ? roots.get(rootId(l)) : null;
  return root === undefined ? null : JSON.stringify({ root, on: l.on, space: l.space });
}
const PER_FOLDER = 500, TOTAL = 5000;

async function directory(path, on) {
  const windowsDirectory = async () => {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Links keep directory attributes even when dangling; check their target.
    // Other reparse points (OneDrive's folders) have no LinkType and are folders.
    // PowerShell reads curly single quotes as quotes too, so they're doubled like '.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

export default class Files extends View {
  init(_props, cx) {
    this.saved = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
    // Keyboard: pane.go (cmd-h/j/k/l) or cmd-e (via tabbar) gives this view the keyboard.
    this.handle = cx.focus_handle(); this.scroll = ScrollHandle.new(); this.cursor = null; this.order = [];
    // cmd-e (tabbar) asks for the keyboard by bumping a shared timestamp. Showing the panel may
    // create this copy fresh, so a request from the last moment counts on arrival too.
    this.asked = shared("explorer-view.focus") ?? 0;
    if (!checking() && Date.now() - this.asked < 2000) this.later(cx);
    if (!checking()) cx.spawn(async cx => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.take();
        // keys.json "mod:explorer-view" routes cmd-h/j/k/l here, so leaving repaints at once
        // (the cursor border only shows while this view has the keyboard). Left goes back to the
        // pane we came from: after a click herdr still counts that pane as focused, so a plain
        // pane.go would start from there and go nowhere.
        else if (c === "go-left") { const pane = focused()?.pane; pane ? run("pane.focus", { pane }) : run("pane.go", { direction: "left" }); }
        else if (c.startsWith("go-")) run("pane.go", { direction: c.slice(3) });
        cx.notify();
      }
    });
  }

  // Take the keyboard from a timer callback: focus() is refused while rendering, and a
  // cx.spawn started from render still runs its first step inside that render.
  later(cx) { cx.timer.after(0, cx => { this.take(); cx.notify(); }); }

  // Take the keyboard. The cursor lands on the previewed file if it's in the tree,
  // else stays where it was, else the first row.
  take() {
    this.handle.focus();
    const at = (p) => this.order.findIndex(r => r.path === p);
    if (this.file && at(this.file) >= 0) this.cursor = this.file;
    else if (!this.cursor || at(this.cursor) < 0) this.cursor = this.order[0]?.path ?? null;
    this.reveal();
  }

  reveal() { const i = this.order.findIndex(r => r.path === this.cursor); if (i >= 0) this.scroll.scroll_to_item(i); }

  // j/k move the cursor without opening anything; Enter opens/closes a folder or previews a file.
  // l opens a closed folder. h closes an open folder, otherwise moves to the parent folder
  // (never above the top level shown).
  key(e, cx) {
    const k = e.keystroke, i = this.order.findIndex(r => r.path === this.cursor);
    if (k === "j" || k === "down" || k === "k" || k === "up") {
      const next = Math.max(0, Math.min(this.order.length - 1, i < 0 ? 0 : i + (k === "j" || k === "down" ? 1 : -1)));
      this.cursor = this.order[next]?.path ?? null; this.reveal();
    } else if (k === "l") {
      const r = this.order[i];
      if (r?.dir && !this.folders.has(r.path)) this.toggle(r.path, cx);
    } else if (k === "h") {
      const r = this.order[i];
      if (!r) return;
      if (r.dir && this.folders.has(r.path)) this.toggle(r.path, cx);
      else if (r.path.includes("/")) { this.cursor = r.path.slice(0, r.path.lastIndexOf("/")); this.reveal(); }
    } else if (k === "enter") {
      const r = this.order[i];
      if (!r) return;
      r.dir ? this.toggle(r.path, cx) : this.open(r.path, cx);
    } else return;
    cx.stop_propagation(); cx.notify();
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); resolveRoot(location(), cx, true); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && (key() ?? context.key) === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    resolveRoot(location(), cx);
    const next = key();
    if (next === null) return; // root still being looked up
    const { root: cwd, on } = JSON.parse(next); // "cwd" below is the panel's root
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file, cursor: this.cursor });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.file = saved?.file ?? null; this.cursor = saved?.cursor ?? null; this.watched = null; this.error = null; this.limited = false;
      this.loading = false;
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${top.stdout.trim()}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  // Show a file in the viewer pane and hand it the keyboard (click or Enter).
  open(path, cx) {
    this.file = path; this.cursor = path;
    openInViewer({ kind: "file", abs: `${this.root}/${path}`, rel: path, root: this.root, on: this.on }, cx, cx => { cx.timer.after(200, cx => cx.notify()); cx.notify(); }, true);
    cx.notify();
  }

  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      const shown = !entry.dir && path === this.file, cur = this.focused && path === this.cursor;
      this.order.push({ path, dir: entry.dir });
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer()
        .border_1().border_color(cur ? t.accent : "#00000000").when(shown, el => el.bg(t.selected)).hover(s => s.bg(shown ? t.selected : t.hover))
        .on_click((_e, cx) => { this.cursor = path; entry.dir ? this.toggle(path, cx) : this.open(path, cx); })
        .child(entry.dir ? svg(`mods/explorer-view/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/explorer-view/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  render(cx) {
    resolveRoot(location(), cx);
    const k = key();
    if (k !== null && k !== this.context?.key) this.refresh(cx);
    const t = theme();
    // cmd-e (tabbar) asks for the keyboard through a shared timestamp: this view may have been hidden.
    const asked = shared("explorer-view.focus") ?? 0;
    if (asked !== this.asked) { this.asked = asked; this.later(cx); }
    const focusedNow = this.handle.is_focused();
    if (focusedNow && !this.focused) resolveRoot(location(), cx, true); // just gained the keyboard
    this.focused = focusedNow; this.order = [];
    const header = (children) => h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border).children(children);
    const tree = v_flex().id("files-tree-col").size_full().min_h(0)
      .child(header([div().font_semibold().child("Files"), div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.root?.split(/[\\/]/).pop() ?? "")]))
      .child(div().flex_1().min_h(0).relative()
        .child(v_flex().id("files-tree").absolute().inset_0().overflow_y_scroll().track_scroll(this.scroll).p(6).children(this.rows("", 0, [], t))
          .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
          .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total"))))
        .child(Scrollbar.vertical("files-tree").absolute().inset_0()));
    // Arrived before the tree had rows (e.g. the panel was just shown): place the cursor now.
    if (this.focused && !this.cursor && this.order.length) { this.cursor = this.order.some(r => r.path === this.file) ? this.file : this.order[0].path; this.reveal(); }
    return v_flex().id("files").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx)).size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(tree);
  }
}
