/**
 * Workstream lifecycle core (Orchestrate v2 — see ORCHESTRATE-V2-SPEC.md,
 * ADR 0007). A workstream is a machine-local artifact directory:
 *
 *   <root>/<slug>/
 *   ├── manifest        # durable JSON index (source of truth for cleanup/resume)
 *   └── artifacts/<seq>-<step>-<title-slug>/*.md
 *                       # saved by the worker-side save_artifact tool (ADR 0008);
 *                       # seq assigned at dispatch spawn — never worker-chosen paths
 *
 * User-invoked control plane only: /workstream new|done call into this module;
 * the model has no tool path here. Pure, injectable (root + GitRunner) so it's
 * unit-testable without touching real git state.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface WorktreeEntry {
	path: string;
	branch: string;
}

/** Per-dispatch artifact directory, allocated at spawn (ADR 0008). */
export interface ArtifactDirEntry {
	seq: number;
	step: string;
	dir: string;
	allocatedAt: string; // ISO
}

/** One saved artifact file, appended at dispatch settle. */
export interface ArtifactEntry {
	path: string;
	step: string;
	seq: number;
	savedAt: string; // ISO
}

/**
 * Per-dispatch metrics, recorded orchestrator-side at settle (same RMW path
 * as artifact recording; single-writer while dispatch is synchronous — see
 * FUTURES "Manifest concurrency"). All fields are mechanical derivations
 * from the settle; nothing here is model judgment.
 */
export interface DispatchMetric {
	seq?: number; // artifact-dir seq when one was allocated
	step?: string;
	profile?: string;
	status: string; // ok|error|timeout|killed
	durationMs: number;
	turns: number;
	tokens: number;
	cost: number;
	questions: number; // ## Questions item count (brief-quality proxy)
	rework: boolean;
	settledAt?: string; // ISO, stamped on record
}

/**
 * Workstream metrics block. `dispatches` is mechanical; the judgment fields
 * (firstPassVerified, trustViolationsCaught) are set ONLY via explicit user
 * invocation (/workstream metric) — never model-inferred silently.
 */
export interface WorkstreamMetrics {
	dispatches: DispatchMetric[];
	firstPassVerified?: boolean; // explicit override of the derived value
	trustViolationsCaught?: number; // user/orchestrator judgment, explicit only
}

export interface Manifest {
	slug: string;
	createdAt: string; // ISO
	planningStrategy?: string; // recorded for A/B measurement
	worktrees: WorktreeEntry[];
	sessionDirs: string[]; // dispatch session dirs/files (removed on cleanup)
	artifactDirs: ArtifactDirEntry[]; // per-dispatch dirs, seq order
	artifacts: ArtifactEntry[]; // saved files (durable index; "current plan" = latest plan-step entry)
	metrics?: WorkstreamMetrics; // per-workstream success metrics (v2 spec)
	notes?: string;
}

export interface WsOptions {
	root?: string;
}

/** Default machine-local workstream root. */
export function defaultWorkstreamRoot(): string {
	return path.join(os.homedir(), ".pi", "agent", "orchestrator-workstreams");
}

function rootOf(opts?: WsOptions): string {
	return opts?.root ?? defaultWorkstreamRoot();
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function wsDir(slug: string, opts?: WsOptions): string {
	return path.join(rootOf(opts), slug);
}

function manifestPath(slug: string, opts?: WsOptions): string {
	return path.join(wsDir(slug, opts), "manifest");
}

function saveManifest(m: Manifest, opts?: WsOptions): void {
	fs.writeFileSync(manifestPath(m.slug, opts), JSON.stringify(m, null, 2) + "\n");
}

/** Create the artifact scaffolding and manifest. Throws on bad/duplicate slug. */
export function createWorkstream(slug: string, opts?: WsOptions & { planningStrategy?: string }): Manifest {
	if (!SLUG_RE.test(slug)) {
		throw new Error(`Invalid workstream slug "${slug}": use kebab-case (a-z, 0-9, hyphens).`);
	}
	const dir = wsDir(slug, opts);
	if (fs.existsSync(dir)) throw new Error(`Workstream "${slug}" already exists at ${dir}.`);
	// ADR 0008 layout: artifacts/<seq>-<step>-<title-slug>/ per dispatch.
	fs.mkdirSync(path.join(dir, "artifacts"), { recursive: true });
	const m: Manifest = {
		slug,
		createdAt: new Date().toISOString(),
		...(opts?.planningStrategy ? { planningStrategy: opts.planningStrategy } : {}),
		worktrees: [],
		sessionDirs: [],
		artifactDirs: [],
		artifacts: [],
	};
	saveManifest(m, opts);
	return m;
}

/** Load a workstream's manifest, or undefined if it doesn't exist / is invalid. */
export function loadManifest(slug: string, opts?: WsOptions): Manifest | undefined {
	try {
		const m = JSON.parse(fs.readFileSync(manifestPath(slug, opts), "utf8")) as Manifest;
		if (typeof m.slug !== "string") return undefined;
		m.worktrees ??= [];
		m.sessionDirs ??= [];
		m.artifactDirs ??= [];
		m.artifacts ??= [];
		return m;
	} catch {
		return undefined;
	}
}

/** List slugs of existing workstreams (manifest present). */
export function listWorkstreams(opts?: WsOptions): string[] {
	try {
		return fs
			.readdirSync(rootOf(opts))
			.filter((d) => fs.existsSync(manifestPath(d, opts)))
			.sort();
	} catch {
		return [];
	}
}

/** Record a worktree (path+branch) in the manifest; dedupes by path. */
export function recordWorktree(slug: string, wt: WorktreeEntry, opts?: WsOptions): void {
	const m = loadManifest(slug, opts);
	if (!m) throw new Error(`No manifest for workstream "${slug}".`);
	if (!m.worktrees.some((w) => w.path === wt.path)) m.worktrees.push(wt);
	saveManifest(m, opts);
}

/** Record a dispatch session dir/file in the manifest; dedupes. */
export function recordDispatchSession(slug: string, sessionPath: string, opts?: WsOptions): void {
	const m = loadManifest(slug, opts);
	if (!m) throw new Error(`No manifest for workstream "${slug}".`);
	if (!m.sessionDirs.includes(sessionPath)) m.sessionDirs.push(sessionPath);
	saveManifest(m, opts);
}

/** Kebab-case a free-form dispatch title for the artifact dir name. */
function titleSlug(title: string): string {
	const s = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40)
		.replace(/-+$/, "");
	return s || "untitled";
}

/**
 * Allocate the next per-dispatch artifact dir at spawn time (ADR 0008):
 * <ws>/artifacts/<seq>-<step>-<title-slug>/. Seq is assigned here, never by
 * the worker; collisions are impossible by construction (exclusive mkdir,
 * seq above both the manifest record and any on-disk dir).
 */
export function allocateArtifactDir(
	slug: string,
	step: string,
	title: string,
	opts?: WsOptions,
): { seq: number; dir: string } {
	const m = loadManifest(slug, opts);
	if (!m) throw new Error(`No manifest for workstream "${slug}".`);
	const artifactsRoot = path.join(wsDir(slug, opts), "artifacts");
	fs.mkdirSync(artifactsRoot, { recursive: true });
	let maxSeq = m.artifactDirs.reduce((acc, d) => Math.max(acc, d.seq), 0);
	for (const d of fs.readdirSync(artifactsRoot)) {
		const n = Number.parseInt(d, 10);
		if (Number.isFinite(n)) maxSeq = Math.max(maxSeq, n);
	}
	const seq = maxSeq + 1;
	const dir = path.join(artifactsRoot, `${String(seq).padStart(3, "0")}-${step}-${titleSlug(title)}`);
	fs.mkdirSync(dir); // exclusive: throws if it somehow exists
	m.artifactDirs.push({ seq, step, dir, allocatedAt: new Date().toISOString() });
	saveManifest(m, opts);
	return { seq, dir };
}

/**
 * Append saved-artifact entries for a dispatch (orchestrator-side, at
 * settle). The worker never touches the manifest — save_artifact writes only
 * files inside its dir; this records them. Dedupes by path.
 */
export function recordArtifactSaves(slug: string, seq: number, files: string[], opts?: WsOptions): void {
	const m = loadManifest(slug, opts);
	if (!m) throw new Error(`No manifest for workstream "${slug}".`);
	const step = m.artifactDirs.find((d) => d.seq === seq)?.step ?? "?";
	for (const f of files) {
		if (m.artifacts.some((a) => a.path === f)) continue;
		let savedAt = new Date().toISOString();
		try {
			savedAt = fs.statSync(f).mtime.toISOString();
		} catch {
			// keep the settle timestamp
		}
		m.artifacts.push({ path: f, step, seq, savedAt });
	}
	saveManifest(m, opts);
}

/** Append a settled dispatch's mechanical metrics (orchestrator-side RMW). */
export function recordDispatchMetric(slug: string, metric: DispatchMetric, opts?: WsOptions): void {
	const m = loadManifest(slug, opts);
	if (!m) throw new Error(`No manifest for workstream "${slug}".`);
	m.metrics ??= { dispatches: [] };
	m.metrics.dispatches.push({ ...metric, settledAt: metric.settledAt ?? new Date().toISOString() });
	saveManifest(m, opts);
}

/**
 * Set the judgment metric fields. User-invoked only (/workstream metric,
 * ADR 0007 carve-out) — the model has no tool path here and these values are
 * never inferred.
 */
export function setExplicitMetrics(
	slug: string,
	fields: { firstPassVerified?: boolean; trustViolationsCaught?: number },
	opts?: WsOptions,
): void {
	const m = loadManifest(slug, opts);
	if (!m) throw new Error(`No manifest for workstream "${slug}".`);
	m.metrics ??= { dispatches: [] };
	if (fields.firstPassVerified !== undefined) m.metrics.firstPassVerified = fields.firstPassVerified;
	if (fields.trustViolationsCaught !== undefined) m.metrics.trustViolationsCaught = fields.trustViolationsCaught;
	saveManifest(m, opts);
}

export interface MetricRollups {
	dispatchCount: number;
	totalCost: number;
	totalTokens: number;
	totalDurationMs: number;
	reworkCycles: number;
	questions: number;
	/** Explicit value when set; else derived from the FIRST verify-run settle; else undefined. */
	firstPassVerified?: boolean;
	trustViolationsCaught?: number;
}

/** Pure aggregation over the manifest's recorded metrics. */
export function computeMetricRollups(m: Manifest): MetricRollups {
	const ds = m.metrics?.dispatches ?? [];
	const firstVerify = ds.find((d) => d.step === "verify-run");
	return {
		dispatchCount: ds.length,
		totalCost: Math.round(ds.reduce((a, d) => a + d.cost, 0) * 10000) / 10000,
		totalTokens: ds.reduce((a, d) => a + d.tokens, 0),
		totalDurationMs: ds.reduce((a, d) => a + d.durationMs, 0),
		reworkCycles: ds.filter((d) => d.rework).length,
		questions: ds.reduce((a, d) => a + d.questions, 0),
		firstPassVerified: m.metrics?.firstPassVerified ?? (firstVerify ? firstVerify.status === "ok" : undefined),
		trustViolationsCaught: m.metrics?.trustViolationsCaught,
	};
}

/** Human-readable manifest printout (the /workstream done step-1 display). */
export function renderManifest(m: Manifest, opts?: WsOptions): string {
	const dir = wsDir(m.slug, opts);
	const lines: string[] = [
		`Workstream: ${m.slug}`,
		`Created:    ${m.createdAt}`,
		...(m.planningStrategy ? [`Strategy:   ${m.planningStrategy}`] : []),
		`Artifacts:  ${dir}`,
	];
	for (const d of m.artifactDirs) {
		const saved = m.artifacts.filter((a) => a.seq === d.seq);
		lines.push(`  ${path.relative(dir, d.dir)}${saved.length ? ` (${saved.map((a) => path.basename(a.path)).join(", ")})` : " (empty)"}`);
	}
	lines.push(`Worktrees:  ${m.worktrees.length === 0 ? "(none)" : ""}`);
	for (const w of m.worktrees) lines.push(`  ${w.path}  [${w.branch}]`);
	lines.push(`Sessions:   ${m.sessionDirs.length === 0 ? "(none)" : ""}`);
	for (const s of m.sessionDirs) lines.push(`  ${s}`);
	if (m.metrics?.dispatches.length || m.metrics?.firstPassVerified !== undefined || m.metrics?.trustViolationsCaught !== undefined) {
		const r = computeMetricRollups(m);
		lines.push(
			"Metrics:",
			`  dispatches: ${r.dispatchCount} · $${r.totalCost.toFixed(2)} · ${r.totalTokens} tokens · ${Math.round(r.totalDurationMs / 1000)}s`,
			`  rework cycles: ${r.reworkCycles} (target ≤1) · questions raised: ${r.questions}`,
			`  first-pass verification: ${r.firstPassVerified === undefined ? "(not recorded)" : r.firstPassVerified ? "pass" : "fail"}${m.metrics?.firstPassVerified !== undefined ? " [explicit]" : ""}`,
			`  trust violations caught: ${r.trustViolationsCaught ?? "(not recorded — set via /workstream metric)"}`,
		);
	}
	return lines.join("\n");
}

/** Injectable git operations (real implementation: realGitRunner). */
export interface GitRunner {
	isDirty(worktreePath: string): boolean;
	hasUnpushedOrUnmerged(worktreePath: string, branch: string): boolean;
	exists(worktreePath: string): boolean;
	removeWorktree(worktreePath: string): void;
	deleteBranch(branch: string, worktreePath: string): void;
}

export interface SafetyVerdict {
	worktree: WorktreeEntry;
	safe: boolean;
	reasons: string[];
}

/** Per-worktree cleanup safety: dirty tree or unpushed/unmerged branch → unsafe. */
export function checkCleanupSafety(m: Manifest, git: GitRunner): SafetyVerdict[] {
	return m.worktrees.map((wt) => {
		const reasons: string[] = [];
		if (!git.exists(wt.path)) {
			// Already gone: safe to drop the record.
			return { worktree: wt, safe: true, reasons: ["worktree missing (already removed)"] };
		}
		if (git.isDirty(wt.path)) reasons.push("worktree is dirty (uncommitted changes)");
		if (git.hasUnpushedOrUnmerged(wt.path, wt.branch)) reasons.push(`branch ${wt.branch} has unpushed or unmerged commits`);
		return { worktree: wt, safe: reasons.length === 0, reasons };
	});
}

export interface CleanupResult {
	ok: boolean;
	removedWorktrees: string[];
	removedSessions: string[];
	deletedBranches: string[];
	refusals: string[]; // unsafe worktrees when !force
	errors: string[];
}

/**
 * Guarded cleanup (spec: /workstream done steps 3–5). Refuses unsafe worktrees
 * unless force; removes session logs and worktrees; optionally deletes merged
 * branches; deletes the artifact dir only after everything else succeeded.
 * A refused or failed cleanup leaves the manifest in place.
 */
export function cleanupWorkstream(
	m: Manifest,
	opts: WsOptions & { force: boolean; git: GitRunner; deleteMergedBranches?: boolean },
): CleanupResult {
	const res: CleanupResult = { ok: false, removedWorktrees: [], removedSessions: [], deletedBranches: [], refusals: [], errors: [] };
	const verdicts = checkCleanupSafety(m, opts.git);
	const unsafe = verdicts.filter((v) => !v.safe);
	if (unsafe.length > 0 && !opts.force) {
		res.refusals = unsafe.map((v) => `${v.worktree.path}: ${v.reasons.join("; ")}`);
		return res;
	}
	for (const v of verdicts) {
		const wt = v.worktree;
		if (!opts.git.exists(wt.path)) continue;
		try {
			opts.git.removeWorktree(wt.path);
			res.removedWorktrees.push(wt.path);
			if (opts.deleteMergedBranches && !opts.git.hasUnpushedOrUnmerged(wt.path, wt.branch)) {
				opts.git.deleteBranch(wt.branch, wt.path);
				res.deletedBranches.push(wt.branch);
			}
		} catch (err) {
			res.errors.push(`worktree ${wt.path}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	for (const s of m.sessionDirs) {
		try {
			if (fs.existsSync(s)) {
				fs.rmSync(s, { recursive: true, force: true });
				res.removedSessions.push(s);
			}
		} catch (err) {
			res.errors.push(`session ${s}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	if (res.errors.length > 0) return res; // keep the manifest for a later attempt
	// Artifact dir goes last (spec step 5).
	try {
		fs.rmSync(wsDir(m.slug, opts), { recursive: true, force: true });
		res.ok = true;
	} catch (err) {
		res.errors.push(`artifact dir: ${err instanceof Error ? err.message : String(err)}`);
	}
	return res;
}

/** Real GitRunner using git CLI (used by /workstream done). */
export function realGitRunner(): GitRunner {
	const git = (dir: string, ...args: string[]): string =>
		execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	return {
		exists: (p) => fs.existsSync(p),
		isDirty: (p) => {
			try {
				return git(p, "status", "--porcelain").trim().length > 0;
			} catch {
				return true; // fail closed: unreadable state counts as unsafe
			}
		},
		hasUnpushedOrUnmerged: (p, branch) => {
			try {
				// Unpushed: commits not on any remote-tracking ref of this branch.
				const upstream = git(p, "rev-parse", "--abbrev-ref", "--symbolic-full-name", `${branch}@{upstream}`).trim();
				const ahead = git(p, "rev-list", "--count", `${upstream}..${branch}`).trim();
				return ahead !== "0";
			} catch {
				// No upstream: unmerged unless the branch tip is reachable from HEAD
				// of the default branch — can't cheaply verify, fail closed.
				return true;
			}
		},
		removeWorktree: (p) => {
			// Run from the main checkout: git refuses to remove the worktree you're in.
			const commonDir = path.resolve(p, git(p, "rev-parse", "--git-common-dir").trim());
			const mainRepo = path.dirname(commonDir);
			git(mainRepo, "worktree", "remove", "--force", p);
		},
		deleteBranch: (branch, p) => {
			const commonDir = path.resolve(p, git(p, "rev-parse", "--git-common-dir").trim());
			git(path.dirname(commonDir), "branch", "-d", branch);
		},
	};
}
