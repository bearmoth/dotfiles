// Kept identical in mods/explorer-view and mods/changes-view (mods cannot import across folders).
// Opens an item ({kind: "file" | "diff", abs, rel, root, on}) in the focused tab's viewer pane,
// splitting one off to the right of the focused pane if the tab has none. Used by Files/Changes.
// focus: true (Enter) moves the keyboard to the viewer; otherwise it stays where it was.
import { panes, focused, run, shared, setShared } from "herdr";

export function openInViewer(item, cx, after, focus = false) {
  const f = focused();
  if (!f?.tab) return;
  const tabs = { ...(shared("viewer.tabs") ?? {}) }, items = { ...(shared("viewer.items") ?? {}) };
  const all = panes().filter(p => p.mod === "viewer"), mine = all.find(p => p.tab === f.tab);
  // Forget viewers whose tab no longer has one (closed pane or tab).
  const live = new Set(all.map(p => p.tab));
  for (const tab of Object.keys(tabs)) if (!live.has(tab)) { delete items[tabs[tab]]; delete tabs[tab]; }
  const fresh = !(mine && tabs[f.tab]);
  const vid = fresh ? `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` : tabs[f.tab];
  items[vid] = { ...item, n: Date.now(), focus }; tabs[f.tab] = vid;
  setShared("viewer.items", items); setShared("viewer.tabs", tabs);
  const name = item.rel.split("/").pop() + (item.kind === "diff" ? " · changes" : "");
  if (!fresh) { run("pane.rename", { pane: mine.pane, name }); if (focus) run("pane.focus", { pane: mine.pane }); after?.(cx); return; }
  run("pane.split", { direction: "right", ...(f.pane ? { pane: f.pane } : {}), mod: "viewer", props: { vid } });
  // The new pane appears after this call returns: name it (and hand back the keyboard) shortly after.
  cx.timer.after(150, cx => {
    const p = panes().find(p => p.tab === f.tab && p.mod === "viewer");
    if (p) { run("pane.rename", { pane: p.pane, name }); if (focus) run("pane.focus", { pane: p.pane }); }
    after?.(cx);
  });
}
