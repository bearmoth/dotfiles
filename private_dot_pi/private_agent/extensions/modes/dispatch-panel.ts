/**
 * Dispatch UI surfaces for Orchestrate mode (design settled in the dispatch-UI
 * grilling session; see FUTURES.md "Dispatch log groundwork"):
 *
 * - Widget strip: one dim line above the editor summarizing the DispatchLog.
 * - Sidebar: list of dispatches. Two mountings share the component:
 *     overlay  — right-anchored overlay (documented API; works in both TUI modes)
 *     split    — fullscreen mode only: wraps the app's layout root in an
 *                HStack so the transcript genuinely reflows (nvim-style).
 *                Uses the undocumented ViewportTUI.setLayoutRoot + a private
 *                layoutRoot read; guarded, falls back to overlay.
 * - Detail pane: centered overlay showing one dispatch's report (Markdown),
 *   in both mountings.
 *
 * Keys (see attach(): the toggle uses ctx.ui.onTerminalInput, which runs
 * before focus dispatch — extension shortcuts only fire when the *editor*
 * has focus, so a registerShortcut toggle could never close a focused pane):
 *   ctrl+d (global, any focus; raw listener — see attach())
 *                   closed → open+focus · unfocused → focus · focused list → close
 *                   (detail pane keeps ctrl+d as nvim page-down; esc/ctrl+c close)
 *   sidebar         ↑↓/jk cursor · enter open detail+focus · esc close · ctrl+l focus detail
 *   detail          ↑↓/jk line · pgup/pgdn + ctrl+u/d page · esc close → sidebar · ctrl+h focus sidebar
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { Component, OverlayHandle, TUI } from "@earendil-works/pi-tui";
import { HStack, isKeyRelease, isKeyRepeat, Key, Markdown, matchesKey, parseKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatDuration } from "./dispatch-helpers.ts";
import { type DispatchRecord, getDispatchRecords, onDispatchLogChange } from "./dispatch-log.ts";

const SIDEBAR_COLS = 38;

interface StatusGlyph {
	glyph: string;
	color: string;
}
function statusGlyph(status: DispatchRecord["status"], tick: number): StatusGlyph {
	switch (status) {
		case "running":
			return { glyph: tick % 2 === 0 ? "◐" : "◓", color: "accent" };
		case "ok":
			return { glyph: "✓", color: "success" };
		case "killed":
			return { glyph: "◼", color: "dim" };
		default:
			return { glyph: "✗", color: "error" };
	}
}

type ThemeLike = { fg: (color: never, text: string) => string; bold: (text: string) => string };

/** Sidebar: dispatch list with cursor. */
class DispatchListPane implements Component {
	cursor = 0;
	tick = 0;
	onEnter?: (record: DispatchRecord) => void;
	onClose?: () => void;
	onFocusDetail?: () => void;

	constructor(private theme: ThemeLike) {}

	private selected(): DispatchRecord | undefined {
		return getDispatchRecords()[this.cursor];
	}

	handleInput(data: string): void {
		try {
			this.handleInputInner(data);
		} catch {
			this.onClose?.(); // never wedge the input loop
		}
	}

	private handleInputInner(data: string): void {
		const records = getDispatchRecords();
		if (matchesKey(data, Key.ctrl("c")) || matchesKey(data, Key.ctrl("d")) || matchesKey(data, Key.ctrl("q"))) {
			// Never trap interrupt-ish keys: close so the next press reaches the app.
			this.onClose?.();
			return;
		}
		if (matchesKey(data, Key.up) || data === "k") {
			this.cursor = Math.max(0, this.cursor - 1);
		} else if (matchesKey(data, Key.down) || data === "j") {
			this.cursor = Math.min(Math.max(0, records.length - 1), this.cursor + 1);
		} else if (matchesKey(data, Key.enter)) {
			const r = this.selected();
			if (r) this.onEnter?.(r);
		} else if (matchesKey(data, Key.escape) || data === "q") {
			this.onClose?.();
		} else if (matchesKey(data, Key.ctrl("l"))) {
			this.onFocusDetail?.();
		}
	}

	render(width: number): string[] {
		try {
			return this.renderInner(width);
		} catch (err) {
			return [truncateToWidth(`sidebar error: ${err instanceof Error ? err.message : String(err)}`, width)];
		}
	}

	private renderInner(width: number): string[] {
		const t = this.theme;
		const records = getDispatchRecords();
		this.cursor = Math.min(this.cursor, Math.max(0, records.length - 1));
		const lines: string[] = [];
		lines.push(truncateToWidth(t.fg("accent" as never, t.bold(" Dispatches")), width));
		lines.push(t.fg("dim" as never, "─".repeat(Math.max(0, width))));
		if (records.length === 0) {
			lines.push(t.fg("dim" as never, " (no dispatches this session)"));
		}
		records.forEach((r, i) => {
			const sel = i === this.cursor;
			const { glyph, color } = statusGlyph(r.status, this.tick);
			const dur = r.status === "running" ? formatDuration(Date.now() - r.startedAt) : r.durationMs !== undefined ? formatDuration(r.durationMs) : "";
			const meta: string[] = [];
			if (dur) meta.push(dur);
			if (r.turns !== undefined) meta.push(`${r.turns}t`);
			if (r.cost !== undefined && r.cost > 0) meta.push(`$${r.cost.toFixed(2)}`);
			const prefix = sel ? "› " : "  ";
			const head = truncateToWidth(`${prefix}${glyph} ${r.role} · ${r.title}`, width);
			// Re-color: glyph in status color, rest per selection.
			const body = `${r.role} · ${r.title}`;
			const headText =
				(sel ? t.fg("accent" as never, prefix) : prefix) +
				t.fg(color as never, glyph) +
				" " +
				(sel ? t.fg("accent" as never, truncateToWidth(body, Math.max(1, width - visibleWidth(head) + visibleWidth(body)))) : truncateToWidth(body, Math.max(1, width - 5)));
			lines.push(truncateToWidth(headText, width));
			if (meta.length) lines.push(truncateToWidth(t.fg("dim" as never, `      ${meta.join(" · ")}`), width));
		});
		lines.push("");
		lines.push(truncateToWidth(t.fg("dim" as never, " ↑↓/jk · ⏎ detail · esc close"), width));
		return lines;
	}

	invalidate(): void {}
}

/** Detail pane: one dispatch's report, scrollable. */
class DispatchDetailPane implements Component {
	private offset = 0;
	private lastHeight = 20;
	onClose?: () => void;
	onFocusList?: () => void;

	constructor(
		private theme: ThemeLike,
		private record: DispatchRecord,
	) {}

	setRecord(record: DispatchRecord): void {
		this.record = record;
		this.offset = 0;
	}

	handleInput(data: string): void {
		try {
			this.handleInputInner(data);
		} catch {
			this.onClose?.();
		}
	}

	private handleInputInner(data: string): void {
		const page = Math.max(1, this.lastHeight - 4);
		if (matchesKey(data, Key.ctrl("c")) || matchesKey(data, Key.ctrl("q"))) {
			// ctrl+d stays page-down here; ctrl+c/ctrl+q always escape the pane.
			this.onClose?.();
			return;
		}
		if (matchesKey(data, Key.up) || data === "k") this.offset = Math.max(0, this.offset - 1);
		else if (matchesKey(data, Key.down) || data === "j") this.offset += 1;
		else if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.ctrl("u"))) this.offset = Math.max(0, this.offset - page);
		else if (matchesKey(data, Key.pageDown) || matchesKey(data, Key.ctrl("d"))) this.offset += page;
		else if (matchesKey(data, Key.escape) || data === "q") this.onClose?.();
		else if (matchesKey(data, Key.ctrl("h"))) this.onFocusList?.();
	}

	render(width: number): string[] {
		try {
			return this.renderInner(width);
		} catch (err) {
			return [truncateToWidth(`detail error: ${err instanceof Error ? err.message : String(err)}`, width)];
		}
	}

	private renderInner(width: number): string[] {
		const t = this.theme;
		const r = this.record;
		const { glyph, color } = statusGlyph(r.status, 0);
		const header = ` ${glyph} ${r.role} · ${r.title}`;
		const lines: string[] = [];
		lines.push(truncateToWidth(t.fg(color as never, t.bold(header)), width));
		const meta: string[] = [];
		if (r.durationMs !== undefined) meta.push(formatDuration(r.durationMs));
		if (r.turns !== undefined) meta.push(`${r.turns} turns`);
		if (r.tokens !== undefined) meta.push(`${r.tokens} tokens`);
		if (r.cost !== undefined) meta.push(`$${r.cost.toFixed(4)}`);
		if (meta.length) lines.push(truncateToWidth(t.fg("dim" as never, ` ${meta.join(" · ")}`), width));
		if (r.sessionFile) lines.push(truncateToWidth(t.fg("dim" as never, ` session: ${r.sessionFile}`), width));
		lines.push(t.fg("dim" as never, "─".repeat(Math.max(0, width))));

		const report = r.finalMessage ?? (r.status === "running" ? "(running — no report yet)" : "(no report — the worker died before replying)");
		const md = new Markdown(report, 1, 0, getMarkdownTheme());
		const body = md.render(width);
		const maxOffset = Math.max(0, body.length - Math.max(1, this.lastHeight - lines.length - 2));
		this.offset = Math.min(this.offset, maxOffset);
		const visibleBody = body.slice(this.offset, this.offset + Math.max(1, this.lastHeight - lines.length - 2));
		lines.push(...visibleBody);
		const scrollHint = body.length > visibleBody.length ? ` ${this.offset + 1}–${this.offset + visibleBody.length}/${body.length} · ` : " ";
		lines.push(truncateToWidth(t.fg("dim" as never, `${scrollHint}jk/↑↓ · ctrl+u/d · esc back`), width));
		return lines;
	}

	/** Overlay maxHeight is enforced by the TUI; track a nominal height for paging. */
	setNominalHeight(rows: number): void {
		this.lastHeight = rows;
	}

	invalidate(): void {}
}

export type DispatchPresentation = "auto" | "overlay" | "split";

export class DispatchUi {
	private ctx?: ExtensionContext;
	private tui?: TUI;
	private isOrchestrate = () => false;
	private presentation: DispatchPresentation = "auto";

	private list?: DispatchListPane;
	private listHandle?: OverlayHandle; // overlay mounting
	private splitRestore?: () => void; // split mounting
	private detail?: DispatchDetailPane;
	private detailHandle?: OverlayHandle;
	private prevFocus: Component | null = null;
	private tickTimer?: ReturnType<typeof setInterval>;
	private unsubscribeLog?: () => void;
	private unsubscribeInput?: () => void;
	private captureNextKey = false;

	/** /dispatches key — one-shot diagnostic: report what the next keypress looks like to pi. */
	armKeyCapture(): void {
		this.captureNextKey = true;
		this.ctx?.ui.notify("Press the key you want to inspect (it will be swallowed)…", "info");
	}

	attach(ctx: ExtensionContext, isOrchestrate: () => boolean): void {
		this.ctx = ctx;
		this.isOrchestrate = isOrchestrate;
		this.unsubscribeLog?.();
		this.unsubscribeLog = onDispatchLogChange(() => {
			this.updateStrip();
			this.tui?.requestRender();
		});
		// Toggle via raw terminal input: runs before focus dispatch, so it works
		// while a pane is focused (extension shortcuts fire only in the editor).
		this.unsubscribeInput?.();
		if (ctx.hasUI && typeof (ctx.ui as { onTerminalInput?: unknown }).onTerminalInput === "function") {
			this.unsubscribeInput = ctx.ui.onTerminalInput((data: string) => {
				if (this.captureNextKey) {
					this.captureNextKey = false;
					const bytes = [...data].map((c) => (c.codePointAt(0)! < 32 || c === "\x7f" ? `\\x${c.codePointAt(0)!.toString(16).padStart(2, "0")}` : c)).join("");
					const parsed = parseKey(data) ?? "(unparsed)";
					this.ctx?.ui.notify(`key: ${parsed} · bytes: "${bytes}"`, "info");
					return { consume: true };
				}
				// ctrl+d, pinched from pi's exit-on-empty binding (user preference:
				// "ctrl+d doesn't quit nvim"). Context-aware: when the detail pane
				// is focused, pass it through — it stays nvim page-down there.
				if (parseKey(data) === "ctrl+d" && this.isOrchestrate()) {
					const focused = (this.tui as { getFocusedComponent?: () => Component | null } | undefined)?.getFocusedComponent?.();
					if (this.detail && focused === this.detail) return undefined;
					if (!isKeyRelease(data) && !isKeyRepeat(data)) this.toggle();
					return { consume: true };
				}
				return undefined;
			});
		}
		this.updateStrip();
	}

	setPresentation(p: DispatchPresentation): void {
		this.presentation = p;
	}
	getPresentation(): DispatchPresentation {
		return this.presentation;
	}

	/** Widget strip; also our capture point for the real TUI instance. */
	updateStrip(): void {
		const ctx = this.ctx;
		if (!ctx?.hasUI) return;
		if (!this.isOrchestrate()) {
			ctx.ui.setWidget("dispatch-strip", undefined);
			return;
		}
		ctx.ui.setWidget("dispatch-strip", (tui, theme) => {
			this.tui = tui as TUI;
			return {
				render: (width: number) => {
					const records = getDispatchRecords();
					if (records.length === 0) return [];
					const done = records.filter((r) => r.status === "ok").length;
					const failed = records.filter((r) => r.status === "error" || r.status === "timeout").length;
					const running = records.find((r) => r.status === "running");
					const parts: string[] = [];
					if (done) parts.push(`✓ ${done}`);
					if (failed) parts.push(`✗ ${failed}`);
					if (running) parts.push(`◐ ${running.role} ${formatDuration(Date.now() - running.startedAt)}`);
					const line = ` ⧈ ${parts.join(" · ")} · ctrl+d`;
					return [truncateToWidth(theme.fg("dim", line), width)];
				},
				invalidate: () => {},
			};
		});
	}

	get isOpen(): boolean {
		return !!(this.listHandle || this.splitRestore);
	}

	private get isFocused(): boolean {
		const focused = (this.tui as { getFocusedComponent?: () => Component | null } | undefined)?.getFocusedComponent?.();
		return !!focused && (focused === this.list || focused === this.detail);
	}

	/** Shortcut cycle: closed → open+focus · unfocused → focus · focused → close.
	 * /dispatches passes forceClose: when open, always close — a command must
	 * never leave the user trapped with a focused-but-unseen pane. */
	toggle(opts?: { forceClose?: boolean }): void {
		if (!this.ctx?.hasUI) return;
		if (!this.isOrchestrate()) {
			this.ctx.ui.notify("Dispatch sidebar is available in Orchestrate mode.", "info");
			return;
		}
		if (!this.tui) {
			// Strip factory not invoked yet (widget cleared); force it once.
			this.updateStrip();
			if (!this.tui) {
				this.ctx.ui.notify("Dispatch sidebar unavailable (no TUI handle yet).", "warning");
				return;
			}
		}
		if (!this.isOpen) this.open();
		else if (opts?.forceClose || this.isFocused) this.close();
		else this.focusList();
	}

	private theme(): ThemeLike {
		return this.ctx!.ui.theme as unknown as ThemeLike;
	}

	private open(): void {
		const tui = this.tui!;
		this.list = new DispatchListPane(this.theme());
		this.list.onClose = () => this.close();
		this.list.onEnter = (r) => this.openDetail(r);
		this.list.onFocusDetail = () => {
			if (this.detail) tui.setFocus(this.detail);
		};
		this.prevFocus = (tui as { getFocusedComponent?: () => Component | null }).getFocusedComponent?.() ?? null;

		// Split is opt-in (/dispatches split): it rides undocumented internals.
		const wantSplit = this.presentation === "split";
		if (wantSplit && this.mountSplit(this.list)) {
			tui.setFocus(this.list);
		} else {
			this.listHandle = tui.showOverlay(this.list, {
				anchor: "top-right",
				width: SIDEBAR_COLS,
				maxHeight: "70%",
				margin: { top: 1, right: 1 },
				// No visible() predicate: hidden-but-focused = input lockout.
			});
			this.listHandle.focus();
		}
		this.startTicker();
		tui.requestRender();
	}

	/** Split mounting (fullscreen prototype): wrap the app's layout root. */
	private mountSplit(list: DispatchListPane): boolean {
		const tui = this.tui as TUI & { setLayoutRoot?: (c: Component | undefined) => void; layoutRoot?: Component };
		if (typeof tui.setLayoutRoot !== "function") return false; // not viewport TUI
		const originalRoot = tui.layoutRoot; // private read; undefined → bail
		if (!originalRoot) return false;
		const split = new HStack([
			// No visible() predicate: an invisible-but-focused pane is a lockout trap.
			{ component: list, basis: SIDEBAR_COLS, grow: 0, shrink: 0 },
			{ component: originalRoot, basis: 0, grow: 1, shrink: 1, minSize: 40 },
		]);
		tui.setLayoutRoot(split);
		this.splitRestore = () => tui.setLayoutRoot!(originalRoot);
		return true;
	}

	private openDetail(record: DispatchRecord): void {
		const tui = this.tui!;
		if (this.detail && this.detailHandle) {
			this.detail.setRecord(record);
		} else {
			this.detail = new DispatchDetailPane(this.theme(), record);
			this.detail.onClose = () => this.closeDetail();
			this.detail.onFocusList = () => this.focusList();
			this.detail.setNominalHeight(Math.floor((process.stdout.rows || 40) * 0.8));
			this.detailHandle = tui.showOverlay(this.detail, {
				anchor: "center",
				width: "80%",
				maxHeight: "80%",
			});
		}
		this.detailHandle?.focus();
		tui.requestRender();
	}

	private closeDetail(): void {
		this.detailHandle?.hide();
		this.detailHandle = undefined;
		this.detail = undefined;
		this.focusList();
		this.tui?.requestRender();
	}

	private focusList(): void {
		if (this.list) {
			if (this.listHandle) this.listHandle.focus();
			else this.tui?.setFocus(this.list);
		}
	}

	close(): void {
		this.detailHandle?.hide();
		this.detailHandle = undefined;
		this.detail = undefined;
		// handle.hide() restores focus to the overlay's preFocus itself. Only
		// re-set focus for the split mounting (no handle); never setFocus(null) —
		// a null-focused TUI drops all input (the round-2 lockout).
		const hadHandle = !!this.listHandle;
		this.listHandle?.hide();
		this.listHandle = undefined;
		this.splitRestore?.();
		this.splitRestore = undefined;
		this.list = undefined;
		this.stopTicker();
		if (!hadHandle && this.prevFocus) this.tui?.setFocus(this.prevFocus);
		this.prevFocus = null;
		this.tui?.requestRender();
	}

	/** 1s ticker while open: running-elapsed + pulse. */
	private startTicker(): void {
		if (this.tickTimer) return;
		this.tickTimer = setInterval(() => {
			if (!this.isOpen) return this.stopTicker();
			if (this.list) this.list.tick++;
			this.tui?.requestRender();
		}, 1000);
	}
	private stopTicker(): void {
		if (this.tickTimer) clearInterval(this.tickTimer);
		this.tickTimer = undefined;
	}
}
