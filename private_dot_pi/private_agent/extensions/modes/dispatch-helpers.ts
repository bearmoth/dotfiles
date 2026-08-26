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
