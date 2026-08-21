/**
 * Pure helpers for dispatch.ts, kept dependency-free so they are
 * unit-testable (dispatch.ts imports pi packages that node --test can't
 * resolve standalone).
 */

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
