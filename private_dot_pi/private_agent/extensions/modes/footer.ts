/**
 * Padded footer: replica of pi's built-in footer (cwd/branch line, stats line,
 * extension status line) with a 2-space left indent.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";

const PAD = "  ";

function formatTokens(count: number): string {
	if (count < 1000) return `${count}`;
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function formatCwd(cwd: string): string {
	const home = homedir();
	const rel = relative(resolve(home), resolve(cwd));
	const inside = rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
	if (!inside) return cwd;
	return rel === "" ? "~" : `~${sep}${rel}`;
}

export function installPaddedFooter(ctx: ExtensionContext): void {
	if (ctx.mode !== "tui") return;

	ctx.ui.setFooter((tui, theme, footerData) => {
		const unsub = footerData.onBranchChange(() => tui.requestRender());
		return {
			dispose: unsub,
			invalidate() {},
			render(width: number): string[] {
				const inner = Math.max(10, width - PAD.length * 2);

				// Line 1: cwd (branch) • session name
				let pwd = formatCwd(ctx.cwd);
				const branch = footerData.getGitBranch();
				if (branch) pwd += ` (${branch})`;
				const sessionName = ctx.sessionManager.getSessionName?.();
				if (sessionName) pwd += ` • ${sessionName}`;

				// Line 2: usage stats left, model right
				let input = 0;
				let output = 0;
				let cacheRead = 0;
				let cost = 0;
				for (const entry of ctx.sessionManager.getEntries()) {
					if (entry.type === "message" && entry.message.role === "assistant") {
						const u = entry.message.usage;
						input += u.input;
						output += u.output;
						cacheRead += u.cacheRead ?? 0;
						cost += u.cost?.total ?? 0;
					}
				}
				const parts: string[] = [];
				if (input) parts.push(`↑${formatTokens(input)}`);
				if (output) parts.push(`↓${formatTokens(output)}`);
				if (cacheRead) parts.push(`R${formatTokens(cacheRead)}`);
				if (cost) parts.push(`$${cost.toFixed(3)}`);

				const usage = ctx.getContextUsage();
				if (usage) {
					const pct = usage.percent != null ? `${usage.percent.toFixed(1)}%` : "?";
					const display = `${pct}/${formatTokens(usage.contextWindow)}`;
					if ((usage.percent ?? 0) > 90) parts.push(theme.fg("error", display));
					else if ((usage.percent ?? 0) > 70) parts.push(theme.fg("warning", display));
					else parts.push(display);
				}

				let left = parts.join(" ");
				let right = ctx.model ? ctx.model.id : "no-model";
				if (ctx.model?.reasoning) right += ` • ${ctx.thinkingLevel ?? "off"}`;

				if (visibleWidth(left) > inner) left = truncateToWidth(left, inner, "...");
				const gap = inner - visibleWidth(left) - visibleWidth(right);
				const statsLine =
					gap >= 2
						? theme.fg("dim", left) + " ".repeat(gap) + theme.fg("dim", right)
						: theme.fg("dim", left);

				const lines = [
					PAD + truncateToWidth(theme.fg("dim", pwd), inner, theme.fg("dim", "...")),
					PAD + statsLine,
				];

				// Line 3: extension statuses (includes our mode indicator)
				const statuses = footerData.getExtensionStatuses();
				if (statuses.size > 0) {
					const line = Array.from(statuses.entries())
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([, text]) => text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim())
						.join(" ");
					lines.push(PAD + truncateToWidth(line, inner, theme.fg("dim", "...")));
				}

				return lines;
			},
		};
	});
}
