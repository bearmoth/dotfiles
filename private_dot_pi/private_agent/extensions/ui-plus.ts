/**
 * ui-plus: UX improvements
 *
 * 1. Full custom footer (hybrid layout):
 *      ~/dev/herdr main · ctx ███▌       31% of 1M · $0.42 · copilot 2027cr resets 09-01
 *      ● Edit                                          claude-fable-5 · thinking high
 *    - line 1: location + usage data, grouped with dim separators
 *    - line 2: mode (from `modes` extension status) left, model+thinking right
 * 2. Copilot credit usage (provider-dynamic; only shown on github-copilot).
 * 3. First-line message icons on user/assistant/thinking blocks (display-only).
 * 4. Compaction nudge at 50% context (thresholds: green <30%, yellow 30-60%, red >60%).
 * 5. Double-escape clears the editor when idle with text (Claude Code style);
 *    other escape behavior (abort, autocomplete cancel, double-escape tree
 *    on empty editor) intact.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { nerdFontEnabled } from "./modes/fence.ts";

const BAR_WIDTH = 10;

function formatWindow(tokens: number): string {
	if (tokens >= 1_000_000) {
		const m = tokens / 1_000_000;
		return `${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
	}
	return `${Math.round(tokens / 1000)}k`;
}

function shortenPath(cwd: string): string {
	const home = homedir();
	return cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
}

interface CopilotQuota {
	creditsUsed: number;
	percentRemaining: number;
	unlimited: boolean;
	resetDate: string;
}

async function fetchCopilotQuota(): Promise<CopilotQuota | undefined> {
	try {
		const auth = JSON.parse(readFileSync(join(homedir(), ".pi", "agent", "auth.json"), "utf8"));
		const token = auth["github-copilot"]?.refresh;
		if (!token) return undefined;
		const res = await fetch("https://api.github.com/copilot_internal/user", {
			headers: { Authorization: `token ${token}`, "User-Agent": "pi-ui-plus", Accept: "application/json" },
		});
		if (!res.ok) return undefined;
		const d = (await res.json()) as any;
		const q = d?.quota_snapshots?.premium_interactions;
		if (!q) return undefined;
		return {
			creditsUsed: q.credits_used ?? 0,
			percentRemaining: q.percent_remaining ?? 100,
			unlimited: q.unlimited ?? false,
			resetDate: d.quota_reset_date ?? "?",
		};
	} catch {
		return undefined;
	}
}

export default function (pi: ExtensionAPI) {
	let quota: CopilotQuota | undefined;
	let lastFetch = 0;
	let compactNudged = false;

	const refreshQuota = (ctx: ExtensionContext, force = false) => {
		if (ctx.model?.provider !== "github-copilot") return;
		const now = Date.now();
		if (!force && now - lastFetch < 60_000) return;
		lastFetch = now;
		void fetchCopilotQuota().then((q) => {
			if (q) quota = q;
		});
	};

	const checkCompactNudge = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		const pct = ctx.getContextUsage()?.percent;
		if (pct != null && pct >= 50 && !compactNudged) {
			compactNudged = true;
			ctx.ui.notify(
				`Context at ${pct.toFixed(0)}% — consider /compact to reduce hallucination risk and token spend`,
				"warning",
			);
		} else if (pct != null && pct < 30) {
			compactNudged = false; // re-arm after compaction
		}
	};

	const installPromptEditor = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		const uiTheme = ctx.ui.theme;
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			class PromptEditor extends CustomEditor {
				private lastEscape = 0;

				handleInput(data: string): void {
					// Double-escape clears input when idle (Claude Code style)
					if (
						matchesKey(data, "escape") &&
						!this.isShowingAutocomplete() &&
						ctx.isIdle() &&
						this.getText().length > 0
					) {
						const now = Date.now();
						if (now - this.lastEscape < 500) {
							this.lastEscape = 0;
							this.setText("");
						} else {
							this.lastEscape = now;
						}
						return;
					}
					super.handleInput(data);
				}

				render(width: number): string[] {
					// Gutter: Nerd Font keyboard glyph + two spaces. Empirically
					// confirmed: this terminal renders the PUA glyph single-width
					// (1 cell), so display width is 3 (glyph 1 + spaces 2).
					const gutter = "\uF11C  ";
					const gutterWidth = 3;
					if (this.getPaddingX() < gutterWidth) this.setPaddingX(gutterWidth);
					const lines = super.render(width);
					// lines[0] is the top border; lines[1] is the first content line,
					// which starts with paddingX spaces — overwrite gutterWidth of them.
					if (lines.length > 1 && lines[1]!.startsWith(" ".repeat(gutterWidth))) {
						lines[1] = uiTheme.fg("accent", gutter) + lines[1]!.slice(gutterWidth);
					}
					return lines;
				}
			}
			return new PromptEditor(tui, theme, keybindings);
		});
	};

	const installFooter = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsub = footerData.onBranchChange(() => tui.requestRender());
			const sep = theme.fg("dim", " · ");

			return {
				dispose: unsub,
				invalidate() {},
				render(width: number): string[] {
					// ---- line 1: usage data left, path+branch right ----
					const parts: string[] = [];

					// context bar
					const usage = ctx.getContextUsage();
					const windowSize = usage?.contextWindow ?? ctx.model?.contextWindow;
					if (usage && usage.percent !== null) {
						const pct = Math.min(100, Math.max(0, usage.percent));
						const halves = Math.round((pct / 100) * BAR_WIDTH * 2);
						const full = Math.floor(halves / 2);
						const hasHalf = halves % 2 === 1;
						const color = pct > 60 ? "error" : pct > 30 ? "warning" : "success";
						let bar = theme.fg(color, "█".repeat(full));
						if (hasHalf) bar += theme.bg("selectedBg", theme.fg(color, "▌"));
						const rest = BAR_WIDTH - full - (hasHalf ? 1 : 0);
						if (rest > 0) bar += theme.bg("selectedBg", " ".repeat(rest));
						const ofStr = windowSize ? theme.fg("dim", ` of ${formatWindow(windowSize)}`) : "";
						parts.push(`${theme.fg("dim", "ctx ")}${bar} ${pct.toFixed(0)}%${ofStr}`);
					} else if (windowSize) {
						parts.push(theme.fg("dim", `ctx ?% of ${formatWindow(windowSize)}`));
					}

					// session cost
					let cost = 0;
					for (const e of ctx.sessionManager.getEntries()) {
						if (e.type === "message" && e.message.role === "assistant") {
							cost += (e.message as any).usage?.cost?.total ?? 0;
						} else if (
							e.type === "message" &&
							e.message.role === "toolResult" &&
							(e.message as any).toolName === "dispatch_task"
						) {
							cost += (e.message as any).details?.usage?.cost ?? 0;
						}
					}
					if (cost > 0) parts.push(theme.fg("dim", `$${cost.toFixed(2)}`));

					// provider-dynamic quota slot
					if (ctx.model?.provider === "github-copilot" && quota) {
						const cap = quota.unlimited
							? `${quota.creditsUsed}cr`
							: `${quota.percentRemaining.toFixed(0)}% left`;
						parts.push(
							`${theme.fg("dim", "copilot ")}${cap}${theme.fg("dim", ` resets ${quota.resetDate.slice(5)}`)}`,
						);
					}

					const line1Left = ` ${parts.join(sep)}`;

					// path + branch on the right; truncate path from the front (keep tail) if tight
					const branch = footerData.getGitBranch();
					const branchWidth = branch ? visibleWidth(branch) + 1 : 0;
					const plainPath = shortenPath(ctx.sessionManager.getCwd());
					const avail = width - visibleWidth(line1Left) - 2 - branchWidth - 1;
					let pathStr = plainPath;
					if (pathStr.length > avail) {
						pathStr = avail > 1 ? `…${plainPath.slice(plainPath.length - (avail - 1))}` : "";
					}
					const loc =
						theme.fg("dim", pathStr) + (branch ? ` ${theme.fg("accent", branch)}` : "") + " ";
					const pad1 = Math.max(1, width - visibleWidth(line1Left) - visibleWidth(loc));
					const line1 = truncateToWidth(line1Left + " ".repeat(pad1) + loc, width);

					// ---- line 2: mode left, model + thinking right ----
					const modeStatus = footerData.getExtensionStatuses().get("mode") ?? "";
					const left = ` ${modeStatus}`;

					let right = theme.fg("dim", ctx.model?.id ?? "no-model");
					if (ctx.model?.reasoning) {
						const lvl = ctx.thinkingLevel ?? "off";
						right += sep + theme.fg("dim", lvl === "off" ? "thinking off" : `thinking ${lvl}`);
					}
					right += " ";

					const pad = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
					const line2 = truncateToWidth(left + " ".repeat(pad) + right, width);

					return [line1, line2];
				},
			};
		});
	};

	pi.on("session_start", async (_e, ctx) => {
		installFooter(ctx);
		installPromptEditor(ctx);
		refreshQuota(ctx, true);
	});

	pi.on("turn_end", async (_e, ctx) => {
		checkCompactNudge(ctx);
		refreshQuota(ctx);
	});

	pi.on("model_select", async (_e, ctx) => refreshQuota(ctx, true));

	pi.registerCommand("quota", {
		description: "Show Copilot quota details",
		handler: async (_args, ctx) => {
			const q = await fetchCopilotQuota();
			if (!q) {
				ctx.ui.notify("Could not fetch Copilot quota", "error");
				return;
			}
			quota = q;
			lastFetch = Date.now();
			ctx.ui.notify(
				`Copilot premium interactions: ${q.creditsUsed} credits used, ` +
					`${q.unlimited ? "unlimited plan" : `${q.percentRemaining.toFixed(1)}% remaining`}, resets ${q.resetDate}`,
				"info",
			);
		},
	});

	// First-line message icons (display-only). PUA glyphs render single-width
	// in this terminal (empirically confirmed) and get two trailing spaces. Terminal-wrap continuation lines are
	// untouched: transformers run pre-wrap, so hanging indent is impossible
	// there — but hard newlines in the source can be indented (user messages).
	const nf = nerdFontEnabled();
	const MESSAGE_ICONS: Record<string, string> = {
		user: nf ? "\uED35  " : "› ",
		assistant: nf ? "\uEE0D  " : "● ",
		"assistant-thinking": nf ? "\uE28C  " : "○ ",
	};
	pi.registerMarkdownTransformer((markdown, { messageType, availableWidth }) => {
		const rawIcon = MESSAGE_ICONS[messageType];
		const icon = rawIcon && messageType === "user" ? `\x1b[32m${rawIcon}\x1b[39m` : rawIcon;
		let prefixed = icon ? icon + markdown : markdown;
		if (messageType !== "user") return prefixed;
		// Indent source lines after the first by the icon's display width
		// (empirically confirmed: NF PUA glyphs render single-width here, so
		// glyph 1 + 2 spaces = 3 cols; fallback "› " = 2 cols) so multi-line
		// user input starts in the same column. Bonus: 3-space indent also
		// avoids markdown's 4-space code-block interpretation.
		if (icon) {
			const indent = " ".repeat(nf ? 3 : 2);
			prefixed = prefixed.split("\n").map((l, i) => (i === 0 ? l : indent + l)).join("\n");
		}
		// Dashed rules above/below user messages. "╌" is not a markdown
		// thematic-break char, but the leading ANSI dim escape also guards
		// against any block-level reinterpretation by the parser.
		const ruleWidth = Math.max(1, availableWidth ?? 80);
		const rule = `\x1b[32m${"╌".repeat(ruleWidth)}\x1b[39m`;
		// Blank lines keep the rules as standalone blocks; without them the
		// bottom rule lazily continues the last (indented) paragraph and
		// inherits its indent, overflowing the line.
		return `${rule}\n\n${prefixed}\n\n${rule}`;
	});
}
