/**
 * save_artifact — worker-side, path-confined artifact tool (ADR 0008).
 *
 * A dispatched planner/researcher/plan-critique worker persists durable
 * outputs (plans, research notes, critique findings) here instead of via
 * general write access. The worker supplies content only; the filesystem
 * path is determined by {workstream, dispatch seq, step}: dispatch_task
 * allocates <ws>/artifacts/<seq>-<step>-<title-slug>/ at spawn and passes it
 * via PI_ARTIFACT_DIR. The worker never touches the workstream manifest —
 * the orchestrator records saved files at dispatch settle (workstream.ts
 * recordArtifactSaves), so this tool holds no authority beyond its own dir.
 *
 * Fail-closed posture (mirrors the ADR 0006 grant):
 * - active only in mode-locked worker processes (--op-mode) with a valid
 *   PI_ARTIFACT_DIR; inert in interactive sessions and in dispatches
 *   without an active workstream (env absent);
 * - the dir must realpath-resolve to <workstream-root>/<slug>/artifacts/<dir>
 *   exactly (symlink escapes and forged env paths are rejected);
 * - names are flat kebab-case .md only (no traversal), exclusive-create
 *   (no overwrites), nothing edited in place.
 *
 * This is a deliberate, narrow exception to the write fence — it does not
 * widen the general fence, and index.ts still applies the fence to every
 * other tool.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { defaultWorkstreamRoot } from "./workstream.ts";

export interface SaveArtifactEnv {
	/** PI_ARTIFACT_DIR: the per-dispatch dir allocated at spawn. */
	artifactDir: string | undefined;
	/** Is this process a mode-locked dispatched worker (--op-mode)? */
	modeLocked: boolean;
	/** Workstream root the dir must live under (test-injectable). */
	workstreamRoot?: string;
}

export type SaveResult = { ok: true; path: string } | { ok: false; error: string };

// Flat kebab-ish markdown name: no directories, no dot-prefix, no upper case.
const NAME_RE = /^[a-z0-9](?:[a-z0-9_-]|\.(?!\.))*\.md$/;

function realpathOrNull(p: string): string | null {
	try {
		return fs.realpathSync(p);
	} catch {
		return null;
	}
}

/** Pure core: validate the env + name, then exclusive-create the file. */
export function saveArtifactFile(env: SaveArtifactEnv, name: string, content: string): SaveResult {
	if (!env.modeLocked) {
		return { ok: false, error: "save_artifact is only available to dispatched workers (mode-locked processes)." };
	}
	const dirRaw = env.artifactDir?.trim();
	if (!dirRaw) {
		return { ok: false, error: "save_artifact is unavailable: this dispatch has no active workstream artifact directory." };
	}
	if (!NAME_RE.test(name)) {
		return { ok: false, error: `Invalid artifact name "${name}": use a flat lower-case markdown filename (e.g. plan.md).` };
	}
	// Confinement: the dir itself must be a real (non-symlinked) directory
	// exactly one level under <workstream-root>/<slug>/artifacts/.
	const root = realpathOrNull(env.workstreamRoot ?? defaultWorkstreamRoot());
	const real = realpathOrNull(dirRaw);
	if (!root || !real) {
		return { ok: false, error: "save_artifact is unavailable: artifact directory does not exist (fail closed; not created here)." };
	}
	const rel = path.relative(root, real);
	const parts = rel.split(path.sep);
	// Symlink escapes are caught here: a symlinked dir realpaths outside the
	// root (or to the wrong depth) and fails these shape checks.
	if (rel.startsWith("..") || path.isAbsolute(rel) || parts.length !== 3 || parts[1] !== "artifacts") {
		return { ok: false, error: "save_artifact is unavailable: artifact directory is not a per-dispatch dir under the workstream root (fail closed)." };
	}
	const file = path.join(real, name);
	try {
		fs.writeFileSync(file, content, { flag: "wx" }); // exclusive create
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "EEXIST") {
			return { ok: false, error: `Artifact "${name}" already exists — nothing is edited in place. Save under a new name; a revision is normally a new dispatch.` };
		}
		return { ok: false, error: `save_artifact failed: ${err instanceof Error ? err.message : String(err)}` };
	}
	return { ok: true, path: file };
}
