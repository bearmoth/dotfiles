/**
 * Advisory repo map (ORCHESTRATE-V2-SPEC.md "Repo map").
 *
 * A generic pi/agent configuration registry at ~/.pi/agent/repos.json — an
 * advisory list of repositories available on this machine (canonical path,
 * mandatory description, worktree root, hints like direct_to_main /
 * requires_pr). Guidance, not a permission gate: a missing entry never makes
 * a repo unavailable. Deliberately separate from the eos registry
 * (.chezmoidata/contexts.yaml) — no context/exposure/permission semantics.
 *
 * The file is per-machine, distributed via chezmoi templating (isWork decides
 * which advisory entries render).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface RepoEntry {
	name: string;
	path: string;
	description: string; // mandatory: what the repo is for
	worktreeRoot?: string;
	hints?: {
		direct_to_main?: boolean;
		requires_pr?: boolean;
	};
}

export function defaultRepoMapPath(): string {
	return path.join(os.homedir(), ".pi", "agent", "repos.json");
}

/**
 * Tolerant loader: missing file → [], invalid JSON → [], invalid entries
 * skipped. The map is advisory; it must never fail a session.
 */
export function loadRepoMap(file?: string): RepoEntry[] {
	try {
		const raw = JSON.parse(fs.readFileSync(file ?? defaultRepoMapPath(), "utf8")) as { repos?: unknown[] };
		if (!Array.isArray(raw.repos)) return [];
		return raw.repos.filter((r): r is RepoEntry => {
			const e = r as RepoEntry;
			return !!r && typeof r === "object" && typeof e.name === "string" && typeof e.path === "string" && typeof e.description === "string";
		});
	} catch {
		return [];
	}
}

/**
 * One short advisory block for the orchestrator's context. Guidance, not a
 * gate: unregistered repos remain available (conservative default: use a
 * worktree and ask the user).
 */
export function renderRepoMapAdvisory(repos: RepoEntry[]): string {
	if (repos.length === 0) return "";
	const lines = ["Advisory repo map (guidance, not a permission gate; unregistered repos: use a worktree and ask):"];
	for (const r of repos) {
		const hints: string[] = [];
		if (r.hints?.direct_to_main) hints.push("direct_to_main");
		if (r.hints?.requires_pr) hints.push("requires_pr");
		if (r.worktreeRoot) hints.push(`worktrees: ${r.worktreeRoot}`);
		lines.push(`- ${r.name} (${r.path}): ${r.description}${hints.length ? ` [${hints.join(", ")}]` : ""}`);
	}
	return lines.join("\n");
}
