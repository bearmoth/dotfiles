/**
 * Write fence + worktree-root resolution for dispatched workers.
 *
 * Self-contained (node:fs, node:path, node:os only) so it's unit-testable.
 * A fenced worker (spawned via dispatch_task with --op-mode and PI_WRITE_FENCE)
 * may mutate only under its fence roots plus a small always-allowed list.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Roots that are always writable even when fenced (scratch/cache dirs). */
export function alwaysAllowedRoots(): string[] {
	const home = os.homedir();
	const roots = [os.tmpdir(), path.join(home, ".npm"), path.join(home, ".cache")];
	if (process.env.TMPDIR) roots.push(process.env.TMPDIR);
	return roots.map((r) => {
		try {
			return fs.realpathSync(path.resolve(r));
		} catch {
			return path.resolve(r);
		}
	});
}

/** Parse the PI_WRITE_FENCE env value (colon-separated absolute paths). */
export function parseFenceEnv(value: string | undefined): string[] {
	if (!value) return [];
	return value
		.split(":")
		.map((p) => p.trim())
		.filter(Boolean)
		.map((p) => path.resolve(p));
}

function isUnder(abs: string, root: string): boolean {
	return abs === root || abs.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

/**
 * Collapse macOS firmlink aliases: /System/Volumes/Data/<x> is the same file
 * as /<x>, but realpath does NOT normalize it (firmlinks aren't symlinks).
 * Verified by dev/ino comparison when both sides exist; otherwise collapsed
 * textually (fail closed: the alias must never dodge a prefix check).
 */
const FIRMLINK_PREFIX = "/System/Volumes/Data";
function collapseFirmlink(abs: string): string {
	if (abs !== FIRMLINK_PREFIX && !abs.startsWith(FIRMLINK_PREFIX + path.sep)) return abs;
	const stripped = abs.slice(FIRMLINK_PREFIX.length) || "/";
	try {
		const a = fs.statSync(abs);
		const b = fs.statSync(stripped);
		if (a.dev !== b.dev || a.ino !== b.ino) return abs; // genuinely different files
	} catch {
		// one side missing → still collapse, so nonexistent-yet paths can't dodge checks
	}
	return stripped;
}

/**
 * Resolve `p` against `cwd`, then realpath the deepest existing ancestor so
 * symlink escapes (a link under the fence pointing outside) are defeated.
 * macOS firmlink aliases (/System/Volumes/Data/...) are collapsed.
 */
export function resolveRealPath(p: string, cwd: string): string {
	const abs = collapseFirmlink(path.resolve(cwd, p));
	// Find the deepest existing ancestor (the path itself may not exist yet).
	let existing = abs;
	let tail = "";
	while (!fs.existsSync(existing)) {
		tail = path.join(path.basename(existing), tail);
		const parent = path.dirname(existing);
		if (parent === existing) break; // hit filesystem root
		existing = parent;
	}
	let real: string;
	try {
		real = fs.realpathSync(existing);
	} catch {
		real = existing; // fail closed elsewhere; keep resolved path
	}
	return collapseFirmlink(tail ? path.join(real, tail) : real);
}

/** Is a write/edit to `p` (relative to `cwd`) allowed under the fence? */
export function checkPathAgainstFence(
	p: string,
	cwd: string,
	fenceRoots: string[],
): { ok: boolean; reason?: string } {
	const real = resolveRealPath(p, cwd);
	const allowed = [...fenceRoots.map((r) => resolveRealPath(r, cwd)), ...alwaysAllowedRoots()];
	if (allowed.some((root) => isUnder(real, root))) return { ok: true };
	return {
		ok: false,
		reason: `Write fence: ${p} resolves to ${real}, outside the worker's allowed roots (${fenceRoots.join(", ")}).`,
	};
}

/**
 * Best-effort bash fence: block obvious escapes only. Anything not matching
 * these patterns passes through to the normal mode classifier.
 */
export function checkBashAgainstFence(
	command: string,
	fenceRoots: string[],
	cwd: string,
): { ok: boolean; reason?: string } {
	const roots = [...fenceRoots.map((r) => resolveRealPath(r, cwd)), ...alwaysAllowedRoots()];
	const outside = (p: string): boolean => {
		const real = resolveRealPath(p, cwd);
		return !roots.some((root) => isUnder(real, root));
	};

	// (a) cd/pushd (relative targets resolve against cwd; best-effort — chained
	// cds each resolve against the original cwd, no shell simulation)
	const cdRe = /(?:^|&&|\|\||;|\|)\s*(?:cd|pushd)\s+("[^"]+"|'[^']+'|\S+)/g;
	// (c) redirection: >, >>, N>, N>>, &>, &>> to an absolute path outside.
	// fd duplication (2>&1, >&2) is excluded via the negative lookahead.
	const redirRe = /(?:\d|&)?>{1,2}\s*(?!&\d)("[^"]+"|'[^']+'|\S+)/g;

	const unquote = (s: string) => s.replace(/^['"]|['"]$/g, "");
	const expandTilde = (s: string) =>
		s === "~" ? os.homedir() : s.startsWith("~/") ? path.join(os.homedir(), s.slice(2)) : s;

	// (b) git -C / --git-dir / --work-tree: scan ALL path options anywhere
	// after `git` (options like --no-pager / -c may precede them).
	const gitIdx = command.search(/\bgit\b/);
	if (gitIdx !== -1) {
		const gitOptRe = /(?:^|\s)(?:-C|--git-dir(?:=|\s+)|--work-tree(?:=|\s+))\s*("[^"]+"|'[^']+'|\S+)/g;
		const seg = command.slice(gitIdx);
		let gm: RegExpExecArray | null;
		while ((gm = gitOptRe.exec(seg)) !== null) {
			const target = expandTilde(unquote(gm[1]));
			if (!path.isAbsolute(target)) continue;
			if (outside(target)) {
				return {
					ok: false,
					reason: `Write fence: git path option target ${target} is outside the worker's allowed roots.`,
				};
			}
		}
	}

	for (const [re, what, allowRelative] of [
		[cdRe, "cd/pushd", false],
		[redirRe, "redirect", true],
	] as const) {
		let m: RegExpExecArray | null;
		while ((m = re.exec(command)) !== null) {
			const target = expandTilde(unquote(m[1]));
			if (target === "/dev/null") continue;
			if (allowRelative && !path.isAbsolute(target)) continue;
			if (outside(target)) {
				return {
					ok: false,
					reason: `Write fence: ${what} target ${target} is outside the worker's allowed roots.`,
				};
			}
		}
	}
	return { ok: true };
}

/**
 * Nerd Font availability: `nerdFont: true` in ~/.pi/agent/settings.json.
 * Absent/false/invalid → false (callers fall back to Unicode-safe glyphs).
 * Same read pattern as resolveWorktreeRoot; settingsPath overridable for tests.
 */
export function nerdFontEnabled(settingsPath?: string): boolean {
	try {
		const file = settingsPath ?? path.join(os.homedir(), ".pi", "agent", "settings.json");
		const settings = JSON.parse(fs.readFileSync(file, "utf8"));
		return settings.nerdFont === true;
	} catch {
		return false;
	}
}

/**
 * One-shot protected-path grant for a dispatched worker (fail closed).
 * The grant is honored only when a non-trivial token is present in the
 * worker's env AND the process mode is locked (--op-mode) — never in
 * interactive sessions. Token content is not verified beyond shape: only the
 * dispatching orchestrator can set the env of the spawned process.
 */
export function protectedGrantActive(envToken: string | undefined, modeLocked: boolean): boolean {
	if (!modeLocked) return false;
	if (typeof envToken !== "string") return false;
	// Require a plausibly random token (dispatch.ts generates 32 hex chars).
	return /^[0-9a-f]{32,}$/i.test(envToken.trim());
}

/**
 * Worktree root for new worktrees: PI_WORKTREE_ROOT env var, else the
 * `worktreeRoot` key in ~/.pi/agent/settings.json, else ~/worktrees.
 */
export function resolveWorktreeRoot(settingsPath?: string): string {
	const env = process.env.PI_WORKTREE_ROOT;
	if (env && env.trim()) return path.resolve(env.trim());
	try {
		const file = settingsPath ?? path.join(os.homedir(), ".pi", "agent", "settings.json");
		const settings = JSON.parse(fs.readFileSync(file, "utf8"));
		if (typeof settings.worktreeRoot === "string" && settings.worktreeRoot.trim()) {
			return path.resolve(settings.worktreeRoot.trim());
		}
	} catch {
		// missing/invalid settings → default
	}
	return path.join(os.homedir(), "worktrees");
}
