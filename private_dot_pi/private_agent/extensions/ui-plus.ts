/**
 * ui-plus: UX improvements
 *
 * 1. Full custom footer (hybrid layout):
 *      ~/dev/herdr main · ctx ▮▮▮░░░░░░░ 31% of 1M · $0.42 · copilot 2027cr resets 09-01
 *      ● Edit                                          claude-fable-5 · thinking high
 *    - line 1: location + usage data, grouped with dim separators
 *    - line 2: mode (from `modes` extension status) left, model+thinking right
 * 2. Copilot credit usage (provider-dynamic; only shown on github-copilot).
 * 3. Claude-style "> " gutter on user prompts (display-only).
 * 4. Compaction nudge at 50% context (thresholds: green <30%, yellow 30-60%, red >60%).
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

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
				render(width: number): string[] {
					// Ensure enough left padding to host the "> " gutter
					if (this.getPaddingX() < 2) this.setPaddingX(2);
					const lines = super.render(width);
					// lines[0] is the top border; lines[1] is the first content line,
					// which starts with paddingX spaces — overwrite two of them.
					if (lines.length > 1 && lines[1]!.startsWith("  ")) {
						lines[1] = uiTheme.fg("accent", "> ") + lines[1]!.slice(2);
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
						const filled = Math.round((pct / 100) * BAR_WIDTH);
						const bar = "▮".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
						const color = pct > 60 ? "error" : pct > 30 ? "warning" : "success";
						const ofStr = windowSize ? theme.fg("dim", ` of ${formatWindow(windowSize)}`) : "";
						parts.push(`${theme.fg("dim", "ctx ")}${theme.fg(color, bar)} ${pct.toFixed(0)}%${ofStr}`);
					} else if (windowSize) {
						parts.push(theme.fg("dim", `ctx ?% of ${formatWindow(windowSize)}`));
					}

					// session cost
					let cost = 0;
					for (const e of ctx.sessionManager.getEntries()) {
						if (e.type === "message" && e.message.role === "assistant") {
							cost += (e.message as any).usage?.cost?.total ?? 0;
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

	// Claude-style prompt gutter: "> first line / indented continuation" (display-only)
	pi.registerMarkdownTransformer((markdown, { messageType }) => {
		if (messageType !== "user") return markdown;
		return markdown
			.split("\n")
			.map((line, i) => (i === 0 ? `» ${line}` : `  ${line}`))
			.join("\n");
	});
}
