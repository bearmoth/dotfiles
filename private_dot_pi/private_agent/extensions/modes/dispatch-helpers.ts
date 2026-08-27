/**
 * Pure helpers for dispatch.ts, kept dependency-free so they are
 * unit-testable (dispatch.ts imports pi packages that node --test can't
 * resolve standalone).
 */

/**
 * UI fallback when no title param was given: first non-empty brief line,
 * stripped of leading markdown markers, truncated.
 */
export function titleFromBrief(brief: string | undefined): string {
	const line = (brief ?? "").split("\n").find((l) => l.trim()) ?? "";
	const cleaned = line.replace(/^[#*\s]+/, "").trim();
	return cleaned.length > 60 ? `${cleaned.slice(0, 60)}…` : cleaned;
}

/**
 * Steps whose dispatches get a per-dispatch artifact dir + the save_artifact
 * tool (ADR 0008). Deliberately excludes review: reviewer findings report
 * inline per v1; only research/plan/plan-critique persist durable artifacts.
 */
export function isArtifactStep(step: string | undefined): step is "research" | "plan" | "plan-critique" {
	return step === "research" || step === "plan" || step === "plan-critique";
}

/**
 * Count real items under "## Questions" in a worker report (metrics: the
 * v2 spec's brief-quality proxy). Mechanical only: list/numbered items, or a
 * single bare prose line; "none"-style placeholders count as zero.
 */
export function countQuestions(finalMessage: string | null | undefined): number {
	if (!finalMessage) return 0;
	const m = /^##\s*Questions\s*$/im.exec(finalMessage);
	if (!m) return 0;
	const after = finalMessage.slice(m.index + m[0].length);
	const next = after.search(/^##\s/m);
	const body = next === -1 ? after : after.slice(0, next);
	const lines = body
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	const isNone = (s: string) => /^[-*\d.)\s]*\(?(none|n\/a|no questions)\.?\)?$/i.test(s);
	const items = lines.filter((l) => /^([-*]|\d+[.)])\s/.test(l));
	if (items.length > 0) return items.filter((l) => !isNone(l)).length;
	// No list markers: a bare prose section counts as one question unless it's a placeholder.
	return lines.length > 0 && !lines.every(isNone) ? 1 : 0;
}

/** "3m 12s" / "42s" duration formatting shared by dispatch renderers. */
export function formatDuration(ms: number): string {
	const s = Math.round(ms / 1000);
	return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

/**
 * Collapsed-result preview: first sentences under "## Result" (fallback:
 * first non-empty lines), at most `maxLines` lines / `maxChars` chars.
 */
export function reportPreview(finalMessage: string | null, maxLines = 3, maxChars = 200): string {
	if (!finalMessage) return "";
	let body = finalMessage;
	const m = /^##\s*Result\s*$/im.exec(finalMessage);
	if (m) {
		const after = finalMessage.slice(m.index + m[0].length);
		const next = after.search(/^##\s/m);
		body = next === -1 ? after : after.slice(0, next);
	}
	const lines = body
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean)
		.slice(0, maxLines);
	let out = lines.join("\n");
	if (out.length > maxChars) out = `${out.slice(0, maxChars - 1).trimEnd()}…`;
	return out;
}

/**
 * Parse `git worktree list --porcelain` output into {path, branch} entries.
 * Detached/bare entries get branch "(detached)"/"(bare)".
 */
export function parseWorktreeList(porcelain: string): Array<{ path: string; branch: string }> {
	const entries: Array<{ path: string; branch: string }> = [];
	let current: { path?: string; branch?: string } = {};
	const flush = () => {
		if (current.path) entries.push({ path: current.path, branch: current.branch ?? "(detached)" });
		current = {};
	};
	for (const line of porcelain.split("\n")) {
		if (line.startsWith("worktree ")) {
			flush();
			current.path = line.slice("worktree ".length).trim();
		} else if (line.startsWith("branch ")) {
			current.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
		} else if (line.trim() === "bare") {
			current.branch = "(bare)";
		} else if (line.trim() === "detached") {
			current.branch ??= "(detached)";
		}
	}
	flush();
	return entries;
}

/**
 * Worktrees present in `after` but not in `before` (by path): the ones a
 * dispatch *created*. Observation-based — never trusts worker self-report.
 */
export function newWorktrees(
	before: Array<{ path: string; branch: string }>,
	after: Array<{ path: string; branch: string }>,
): Array<{ path: string; branch: string }> {
	const seen = new Set(before.map((w) => w.path));
	return after.filter((w) => !seen.has(w.path));
}

/**
 * Step for a dispatch that gave neither `step` nor a profile step.
 * Roles without a cheap role-default model (implementor/reviewer) route to
 * their natural pipeline step so they resolve via step-config tuples instead
 * of silently inheriting the orchestrator's (possibly heavyweight) model.
 * Roles with a role-default model (researcher) keep it: return undefined.
 */
export function defaultStepForRole(role: string, hasRoleDefaultModel: boolean): string | undefined {
	if (hasRoleDefaultModel) return undefined;
	if (role === "implementor") return "implement";
	if (role === "reviewer") return "review";
	return undefined;
}
