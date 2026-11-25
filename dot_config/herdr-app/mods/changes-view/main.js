import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, ScrollHandle } from "gpui-base";
import { openInViewer } from "./open.js";
import { stageState, combine, wantStage, stageArgs, stagedCount, hasMarkers, writePaths } from "./staging.js";
// Stock Changes, but picking a file opens its diff in the tab's viewer pane (mods/viewer)
// instead of inside this panel. Nothing opens until you pick a file. The files show as a tree
// (folders expanded by default; a folder holding only one folder shares its row: "a/b").
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, run, shared, nextCommand, checking } from "herdr";

// While a mod pane (the viewer) is focused, keep showing the repo we were in.
let last = null;
function location() {
  const space = spaces().find((s) => s.active), f = focused();
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
// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];

// Changed files as nested folders: { dirs: Map(name -> node), files: [{ name, file }] }.
function tree(files) {
  const top = { dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let n = top;
    for (const p of parts.slice(0, -1)) {
      if (!n.dirs.has(p)) n.dirs.set(p, { dirs: new Map(), files: [] });
      n = n.dirs.get(p);
    }
    n.files.push({ name: parts[parts.length - 1], file: f });
  }
  // Each folder's checkbox: the combined state of every file under it.
  const fill = (n) => { const all = [...n.files.map(x => x.file.stage), ...[...n.dirs.values()].map(fill)]; return (n.stage = combine(all)); };
  fill(top);
  return top;
}
const byName = (a, b) => a[0].localeCompare(b[0]);
export default class Changes extends View {
  init(_props, cx) {
    this.files = []; this.tree = tree([]); this.collapsed = new Set(); this.order = []; this.message = ""; this.handle = cx.focus_handle(); this.scroll = ScrollHandle.new(); this.cursor = null;
    // Keyboard: pane.go (cmd-h/j/k/l) or cmd-g (via tabbar, a shared timestamp) gives this view
    // the keyboard. keys.json "mod:changes-view" routes cmd-h/j/k/l here so leaving repaints at once.
    this.asked = shared("changes-view.focus") ?? 0;
    if (!checking() && Date.now() - this.asked < 2000) this.later(cx);
    if (!checking()) cx.spawn(async cx => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.take();
        // Tab / shift-tab (keys.json mod:changes-view): between the tree and the commit message.
        else if (c === "cycle-focus") this.typing ? this.take() : this.input.focus();
        else if (c === "go-left") { const pane = focused()?.pane; pane ? run("pane.focus", { pane }) : run("pane.go", { direction: "left" }); }
        else if (c.startsWith("go-")) run("pane.go", { direction: c.slice(3) });
        cx.notify();
      }
    });
    this.input = InputState.new({ placeholder: "Commit message" });
    this.input.on("change", (_e, cx) => {
      const hadMessage = Boolean(this.message.trim());
      this.message = this.input.value();
      if (hadMessage !== Boolean(this.message.trim())) cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.commit(cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          resolveRoot(location(), cx, true);
          if (this.watched === root) this.refresh(cx);
        }
      } catch { this.watched = null; }
    });
  }

  // One visit to a folder: results from an earlier visit to the same folder are stale too.
  current(context) {
    return this.context === context && (key() ?? context.key) === context.key;
  }

  refresh(cx) {
    resolveRoot(location(), cx);
    const next = key();
    if (next === null) return; // root still being looked up
    const { root: cwd, on } = JSON.parse(next); // "cwd" below is the panel's root
    if (next !== this.context?.key) {
      this.context = { key: next }; this.root = null; this.files = []; this.tree = tree([]); this.collapsed = new Set(); this.open = null;
      this.message = ""; this.input.set_value(""); this.error = null; this.note = null; this.watched = null; this.limited = false;
      this.loading = false;
    }
    // A load left behind in another folder (a slow git, a read that never ends) must not hold this one.
    if (!cwd || this.loading || this.busy) return;
    const context = this.context;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        if (!this.current(context)) return;
        if (top.code !== 0) { this.root = null; this.files = []; this.tree = tree([]); this.open = null; this.error = "Not a git repository"; return; }
        const root = top.stdout.trim(), git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
        const status = await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]);
        if (status.code !== 0) throw new Error(status.stderr);
        const head = await git(["rev-parse", "--verify", "HEAD"]);
        const stats = {};
        const results = head.code === 0 ? [await git(["diff", "HEAD", "--numstat", "-z", "--no-renames"])] : [await git(["diff", "--cached", "--numstat", "-z", "--no-renames"]), await git(["diff", "--numstat", "-z", "--no-renames"])];
        for (const result of results) {
          if (result.code !== 0) throw new Error(result.stderr);
          for (const entry of result.stdout.split("\0")) {
            const [a, d, ...parts] = entry.split("\t");
            if (!parts.length) continue;
            const path = parts.join("\t"), old = stats[path] ?? { add: 0, del: 0 };
            stats[path] = { add: old.add + (Number(a) || 0), del: old.del + (Number(d) || 0), binary: a === "-" };
          }
        }
        const files = [];
        const entries = status.stdout.split("\0").filter(Boolean);
        for (const entry of entries.slice(0, 1000)) {
          const xy = entry.slice(0, 2), path = entry.slice(3), fresh = xy === "??";
          const conflict = xy.includes("U") || xy === "AA" || xy === "DD";
          const s = conflict ? "U" : fresh ? "?" : xy.includes("D") ? "D" : xy.includes("A") ? "A" : "M";
          const stat = stats[path] ?? { add: 0, del: 0 };
          files.push({ path, status: s, fresh, xy, stage: stageState(xy), ...stat });
        }
        if (!this.current(context)) return;
        this.root = root; this.on = on; this.hasHead = head.code === 0; this.files = files; this.tree = tree(files); this.limited = entries.length > 1000; this.error = null;
        this.watch(root, cx);
        if (this.open && !files.some((f) => f.path === this.open)) this.open = null;
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) { this.loading = false; if (this.again) { this.again = false; this.refresh(cx); } } cx.notify(); }
    });
  }

  // Take the keyboard from a timer callback: focus() is refused while rendering.
  later(cx) { cx.timer.after(0, cx => { this.take(); cx.notify(); }); }

  // Cursor lands on the open diff's file if it's a visible row, else stays, else the first row.
  // this.order is the rows of the last render (folders and files, top to bottom).
  take() {
    this.handle.focus();
    const has = (p) => this.order.some(r => r.path === p);
    if (this.open && has(this.open)) this.cursor = this.open;
    else if (!this.cursor || !has(this.cursor)) this.cursor = this.order[0]?.path ?? null;
    this.reveal();
  }

  reveal() { const i = this.order.findIndex(r => r.path === this.cursor); if (i >= 0) this.scroll.scroll_to_item(i); }

  toggle(path) { this.collapsed.has(path) ? this.collapsed.delete(path) : this.collapsed.add(path); }

  // j/k move the cursor without opening anything. Enter opens a file's diff or toggles a folder;
  // l expands a collapsed folder; h collapses an open one, else moves to the parent folder's row.
  key(e, cx) {
    if (this.typing) return;
    const k = e.keystroke, i = this.order.findIndex(r => r.path === this.cursor), r = this.order[i];
    if (k === "j" || k === "down" || k === "k" || k === "up") {
      const next = Math.max(0, Math.min(this.order.length - 1, i < 0 ? 0 : i + (k === "j" || k === "down" ? 1 : -1)));
      this.cursor = this.order[next]?.path ?? null; this.reveal();
    } else if (k === "l") {
      if (r?.dir && this.collapsed.has(r.path)) this.toggle(r.path);
    } else if (k === "h") {
      if (!r) return;
      if (r.dir && !this.collapsed.has(r.path)) this.toggle(r.path);
      else if (r.parent) { this.cursor = r.parent; this.reveal(); }
    } else if (k === "space") {
      if (r) this.toggleRow(r, cx);
    } else if (k === "enter") {
      if (!r) return;
      r.dir ? this.toggle(r.path) : this.pick(r.path, cx);
    } else return;
    cx.stop_propagation(); cx.notify();
  }

  checkbox(id, state, t, onToggle) {
    const icon = { staged: "on", partial: "part", conflict: "conflict" }[state] ?? "off";
    return div().id(id).flex_none().cursor_pointer().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); onToggle(cx); })
      .child(svg(`mods/changes-view/check-${icon}.svg`).size(14).text_color(state === "conflict" ? t.ansi1 : state === "unstaged" ? t.dim : t.accent));
  }

  // Rows for one folder's contents: folders first, then files, each by name. A folder holding
  // only one folder shares its row ("a/b"), so deep paths don't push every change far right.
  rows(node, prefix, depth, parent, out, t, focusedNow) {
    for (const [name, d] of [...node.dirs].sort(byName)) {
      let label = name, path = prefix ? `${prefix}/${name}` : name, n = d;
      while (!n.files.length && n.dirs.size === 1) { const [[c, cd]] = n.dirs; label += `/${c}`; path += `/${c}`; n = cd; }
      const open = !this.collapsed.has(path), cur = focusedNow && this.cursor === path;
      this.order.push({ path, dir: true, parent }); this.dirStates.set(path, n.stage);
      out.push(h_flex().id(`change-dir-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer()
        .border_1().border_color(cur ? t.accent : "#00000000").hover(s => s.bg(t.hover))
        .on_click((_e, cx) => { this.cursor = path; this.toggle(path); cx.notify(); })
        .child(this.checkbox(`check-dir-${path}`, n.stage, t, cx => this.toggleRow({ path, dir: true }, cx)))
        .child(svg(`mods/changes-view/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim))
        .child(svg("mods/changes-view/folder.svg").size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(label)));
      if (open) this.rows(n, path, depth + 1, path, out, t, focusedNow);
    }
    for (const { name, file: f } of [...node.files].sort((a, b) => a.name.localeCompare(b.name))) {
      const shown = this.open === f.path, cur = focusedNow && this.cursor === f.path;
      this.order.push({ path: f.path, dir: false, parent });
      out.push(h_flex().id(`change-${f.path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer()
        .border_1().border_color(cur ? t.accent : "#00000000").when(shown, (e) => e.bg(t.selected)).hover((s) => s.bg(shown ? t.selected : t.hover))
        .on_click((_e, cx) => this.pick(f.path, cx))
        .child(this.checkbox(`check-${f.path}`, f.stage, t, cx => this.toggleRow({ path: f.path, dir: false }, cx)))
        .child(div().w(12).flex_none())
        .child(div().flex_1().min_w(0).truncate().child(name))
        .when(f.add > 0, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${f.add}`)))
        .when(f.del > 0, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`−${f.del}`)))
        .child(div().w(12).flex_none().text_right().text_size(11).text_color(f.status === "A" || f.status === "?" ? t.ansi2 : f.status === "D" || f.status === "U" ? t.ansi1 : t.blocked).child(f.status)));
    }
    return out;
  }

  // Show a file's diff in the viewer pane (the row stays highlighted) and hand it the keyboard.
  pick(path, cx) {
    this.open = path; this.cursor = path; this.note = null;
    openInViewer({ kind: "diff", abs: `${this.root}/${path}`, rel: path, root: this.root, on: this.on }, cx, cx => cx.timer.after(200, cx => cx.notify()), true);
    cx.notify();
  }

  // One stage or unstage write, then a refresh (the folder watch would bring one too).
  // Writes run one at a time (git holds .git/index.lock while writing); a commit waits for them.
  stage(paths, stage, cx) {
    if (!this.root || !paths.length || this.busy) return;
    const root = this.root, on = this.on, context = this.context, args = stageArgs(paths, stage, this.hasHead);
    const before = this.writes; let done; this.writes = new Promise((r) => (done = r));
    this.note = null;
    cx.spawn(async (cx) => {
      try {
        await before;
        const r = await exec("git", args, { cwd: root, on });
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
      } catch (e) { if (this.current(context)) this.note = `${stage ? "Stage" : "Unstage"} failed: ${String(e).replace(/^Error: /, "")}`; }
      finally { done(); if (this.loading) this.again = true; else this.refresh(cx); cx.notify(); }
    });
  }

  // Conflicted files under a folder ("" = the whole repo).
  conflictsUnder(dir) { return this.files.filter(f => f.stage === "conflict" && (!dir || f.path.startsWith(dir + "/"))).map(f => f.path); }

  // A row's checkbox (click or space): ticked unstages, empty or part-staged stages everything
  // under it, conflicts left out. A conflicted file's box marks it resolved, once it has no markers.
  toggleRow(r, cx) {
    const state = r.dir ? this.dirStates.get(r.path) : this.files.find(f => f.path === r.path)?.stage;
    if (!state) return;
    if (state === "conflict") {
      if (r.dir) { this.note = "Only conflicted files here: resolve each one on its own"; cx.notify(); return; }
      return this.resolve(r.path, cx);
    }
    this.stage(r.dir ? writePaths(this.files, r.path) : [r.path], wantStage(state), cx);
  }

  // Mark a conflicted file resolved (stage it), unless it still has conflict markers.
  resolve(path, cx) {
    const root = this.root, on = this.on, context = this.context;
    cx.spawn(async (cx) => {
      const text = await readTextFile(`${root}/${path}`, { on }).catch(() => null);
      if (!this.current(context)) return;
      if (text !== null && hasMarkers(text)) { this.note = `${path}: still has conflict markers`; cx.notify(); return; }
      this.stage([path], true, cx);
    });
  }

  // Header button: stage every change, or unstage all when everything is already staged.
  // Conflicted files are always left out.
  stageAll(cx) { if (this.files.length && this.tree.stage !== "conflict") this.stage(writePaths(this.files, ""), this.tree.stage !== "staged", cx); }

  commit(cx) {
    if (!this.message.trim() || !this.root || this.busy || this.loading || !stagedCount(this.files) || this.context?.key !== (key() ?? this.context?.key)) return;
    const root = this.root, on = this.on, context = this.context, message = this.message.trim();
    this.busy = true; this.note = null;
    cx.spawn(async (cx) => {
      try {
        // Only what's staged: nothing is added here, so a part-staged file commits only its staged part.
        await this.writes;
        const r = await exec("git", ["commit", "-m", message], { cwd: root, on });
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        if (this.current(context)) { this.message = ""; this.input.set_value(""); }
      } catch (e) { if (this.current(context)) this.note = `Commit failed: ${e}`; }
      finally { this.busy = false; this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  }

  render(cx) {
    resolveRoot(location(), cx);
    const k = key();
    if (k !== null && k !== this.context?.key) this.refresh(cx);
    // cmd-g (tabbar) asks for the keyboard through a shared timestamp: this view may have been hidden.
    const asked = shared("changes-view.focus") ?? 0;
    if (asked !== this.asked) { this.asked = asked; this.later(cx); }
    const focusedNow = this.handle.is_focused();
    if (focusedNow && !this.wasFocused) resolveRoot(location(), cx, true); // just gained the keyboard
    this.wasFocused = focusedNow; this.order = []; this.dirStates = new Map();
    const t = theme(), add = this.files.reduce((n, f) => n + f.add, 0), del = this.files.reduce((n, f) => n + f.del, 0);
    const conflicts = this.conflictsUnder("").length, staged = stagedCount(this.files), enabled = Boolean(this.message.trim() && staged && this.root && !this.busy && !this.loading);
    const header = () => h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border);
    const list = v_flex().id("changes-list-col").size_full().min_h(0)
      .child(header()
        .child(div().font_semibold().child("Changes"))
        .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(`${this.files.length} files`))
        .child(div().flex_1()).child(div().text_size(11).text_color(t.ansi2).child(`+${add}`)).child(div().text_size(11).text_color(t.ansi1).child(`−${del}`))
        .when(this.files.length > 0 && this.tree.stage !== "conflict", el => el.child(div().id("stage-all").px(8).py(2).rounded(6).border_1().border_color(t.border).text_size(11).text_color(t.muted).cursor_pointer().hover(s => s.bg(t.hover))
          .on_click((_e, cx) => this.stageAll(cx)).child((this.tree.stage === "staged" ? "Unstage all" : "Stage all") + (conflicts ? ` (${conflicts} conflict${conflicts === 1 ? "" : "s"} skipped)` : "")))))
      // overflow_y_scrollbar() wraps the list, so its flex sizing never reached the panel's layout.
      .child(div().flex_1().min_h(44).relative()
        .child(v_flex().id("changes-list").absolute().inset_0().overflow_y_scroll().track_scroll(this.scroll).p(6).children(this.rows(this.tree, "", 0, null, [], t, focusedNow)).when(!this.files.length, (e) => e.child(div().p(8).text_color(t.dim).child(this.error || (this.loading ? "Loading changes…" : this.root ? "No uncommitted changes" : "No folder")))))
        .child(Scrollbar.vertical("changes-list").absolute().inset_0()))
      .when(this.limited, el => el.child(div().px(12).py(4).text_size(11).text_color(t.dim).child("Showing the first 1,000 changed files")))
      .when(Boolean(this.note), (e) => e.child(div().px(10).py(6).text_size(11).text_color(t.ansi1).child(this.note)))
      .child(h_flex().flex_none().p(10).gap(8).border_t(1).border_color(t.border)
        .child(div().id("commit-message").flex_1().min_w(0).h(32).px(10).flex().items_center().rounded(8).border_1().border_color(this.typing ? t.accent : t.border).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))
        .child(div().id("commit").h(32).px(14).flex().items_center().rounded(8).bg(enabled ? t.solid : t.raised).text_color(enabled ? t.solid_foreground : t.dim).text_size(12).when(enabled, (e) => e.cursor_pointer()).on_click((_e, cx) => this.commit(cx)).child(this.busy ? "Committing…" : staged ? `Commit ${staged} file${staged === 1 ? "" : "s"}` : "Commit")));
    // Arrived before the tree had rows (e.g. the panel was just shown): place the cursor now.
    if (focusedNow && !this.order.some(r => r.path === this.cursor)) this.cursor = this.order[0]?.path ?? null;
    return v_flex().id("changes").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && this.typing) { this.typing = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); return; }
        this.key(e, cx);
      })
      .child(list);
  }
}
