/**
 * Tests for the workstream lifecycle core (ADR 0007: user-invoked
 * control-plane). Run with:
 *   node --experimental-strip-types --test workstream.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	allocateArtifactDir,
	checkCleanupSafety,
	cleanupWorkstream,
	createWorkstream,
	loadManifest,
	recordArtifactSaves,
	recordDispatchSession,
	recordWorktree,
	renderManifest,
	type GitRunner,
	type Manifest,
} from "./workstream.ts";

function tmpRoot(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "ws-test-"));
}

test("createWorkstream scaffolds dir, manifest, artifacts/ (ADR 0008 layout)", () => {
	const root = tmpRoot();
	const m = createWorkstream("fix-login-flow", { root });
	assert.equal(m.slug, "fix-login-flow");
	const dir = path.join(root, "fix-login-flow");
	assert.ok(fs.existsSync(path.join(dir, "manifest")));
	assert.ok(fs.statSync(path.join(dir, "artifacts")).isDirectory());
	const loaded = loadManifest("fix-login-flow", { root });
	assert.equal(loaded?.slug, "fix-login-flow");
	assert.deepEqual(loaded?.worktrees, []);
	assert.deepEqual(loaded?.sessionDirs, []);
});

test("createWorkstream refuses an existing slug", () => {
	const root = tmpRoot();
	createWorkstream("dup", { root });
	assert.throws(() => createWorkstream("dup", { root }), /exists/);
});

test("createWorkstream validates slugs (kebab-case, no traversal)", () => {
	const root = tmpRoot();
	assert.throws(() => createWorkstream("../escape", { root }), /slug/i);
	assert.throws(() => createWorkstream("has space", { root }), /slug/i);
	assert.throws(() => createWorkstream("", { root }), /slug/i);
	createWorkstream("ok-slug-2", { root }); // does not throw
});

test("recordWorktree and recordDispatchSession persist to the manifest", () => {
	const root = tmpRoot();
	createWorkstream("ws", { root });
	recordWorktree("ws", { path: "/tmp/wt/a", branch: "feat/a" }, { root });
	recordWorktree("ws", { path: "/tmp/wt/a", branch: "feat/a" }, { root }); // dedup
	recordDispatchSession("ws", "/tmp/sessions/implementor-x/s.jsonl", { root });
	const m = loadManifest("ws", { root })!;
	assert.deepEqual(m.worktrees, [{ path: "/tmp/wt/a", branch: "feat/a" }]);
	assert.deepEqual(m.sessionDirs, ["/tmp/sessions/implementor-x/s.jsonl"]);
});

test("loadManifest returns undefined for a missing workstream", () => {
	assert.equal(loadManifest("nope", { root: tmpRoot() }), undefined);
});

test("renderManifest prints worktrees, sessions, and artifact paths", () => {
	const root = tmpRoot();
	createWorkstream("render-me", { root });
	recordWorktree("render-me", { path: "/tmp/wt/x", branch: "feat/x" }, { root });
	const out = renderManifest(loadManifest("render-me", { root })!, { root });
	assert.match(out, /render-me/);
	assert.match(out, /\/tmp\/wt\/x/);
	assert.match(out, /feat\/x/);
	assert.match(out, /Artifacts:/);
});

test("allocateArtifactDir assigns monotonic seqs and records dirs in the manifest", () => {
	const root = tmpRoot();
	createWorkstream("alloc", { root });
	const a = allocateArtifactDir("alloc", "plan", "Master plan for login", { root });
	const b = allocateArtifactDir("alloc", "research", "Auth Layers!! survey", { root });
	assert.equal(a.seq, 1);
	assert.equal(b.seq, 2);
	assert.equal(path.basename(a.dir), "001-plan-master-plan-for-login");
	assert.equal(path.basename(b.dir), "002-research-auth-layers-survey");
	assert.ok(fs.statSync(a.dir).isDirectory());
	const m = loadManifest("alloc", { root })!;
	assert.equal(m.artifactDirs.length, 2);
	assert.equal(m.artifactDirs[0].step, "plan");
	assert.equal(m.artifactDirs[0].dir, a.dir);
});

test("allocateArtifactDir survives an out-of-band dir with a higher seq", () => {
	const root = tmpRoot();
	createWorkstream("gap", { root });
	fs.mkdirSync(path.join(root, "gap", "artifacts", "007-plan-manual"));
	const a = allocateArtifactDir("gap", "plan", "next", { root });
	assert.equal(a.seq, 8); // never collides with an existing dir
});

test("recordArtifactSaves appends artifact entries (orchestrator-side, at settle)", () => {
	const root = tmpRoot();
	createWorkstream("arts", { root });
	const a = allocateArtifactDir("arts", "plan", "master plan", { root });
	fs.writeFileSync(path.join(a.dir, "plan.md"), "# plan");
	recordArtifactSaves("arts", a.seq, [path.join(a.dir, "plan.md")], { root });
	recordArtifactSaves("arts", a.seq, [path.join(a.dir, "plan.md")], { root }); // dedupe
	const m = loadManifest("arts", { root })!;
	assert.equal(m.artifacts.length, 1);
	assert.equal(m.artifacts[0].seq, 1);
	assert.equal(m.artifacts[0].step, "plan");
	assert.equal(m.artifacts[0].path, path.join(a.dir, "plan.md"));
	assert.ok(m.artifacts[0].savedAt);
	const out = renderManifest(m, { root });
	assert.match(out, /plan\.md/);
});

function fakeGit(state: Record<string, { dirty?: boolean; unpushed?: boolean; merged?: boolean; missing?: boolean }>): GitRunner {
	return {
		isDirty: (p) => !!state[p]?.dirty,
		hasUnpushedOrUnmerged: (p) => !!state[p]?.unpushed,
		exists: (p) => !state[p]?.missing,
		removeWorktree: () => {},
		deleteBranch: () => {},
	};
}

test("checkCleanupSafety flags dirty worktrees and unpushed branches", () => {
	const root = tmpRoot();
	createWorkstream("safety", { root });
	recordWorktree("safety", { path: "/wt/dirty", branch: "feat/d" }, { root });
	const m = loadManifest("safety", { root })!;
	const verdicts = checkCleanupSafety(m, fakeGit({ "/wt/dirty": { dirty: true, unpushed: true } }));
	assert.equal(verdicts.length, 1);
	assert.equal(verdicts[0].safe, false);
	assert.match(verdicts[0].reasons.join(" "), /dirty/);
});

test("checkCleanupSafety passes clean, pushed worktrees", () => {
	const root = tmpRoot();
	createWorkstream("clean", { root });
	recordWorktree("clean", { path: "/wt/clean", branch: "feat/c" }, { root });
	const m = loadManifest("clean", { root })!;
	const verdicts = checkCleanupSafety(m, fakeGit({ "/wt/clean": {} }));
	assert.equal(verdicts[0].safe, true);
});

test("cleanupWorkstream refuses unsafe cleanup without force", () => {
	const root = tmpRoot();
	createWorkstream("guarded", { root });
	recordWorktree("guarded", { path: "/wt/dirty", branch: "feat/g" }, { root });
	const m = loadManifest("guarded", { root })!;
	const res = cleanupWorkstream(m, { root, force: false, git: fakeGit({ "/wt/dirty": { dirty: true } }) });
	assert.equal(res.ok, false);
	// Manifest must survive a refused cleanup.
	assert.ok(fs.existsSync(path.join(root, "guarded", "manifest")));
});

test("cleanupWorkstream removes worktrees, sessions, and the artifact dir", () => {
	const root = tmpRoot();
	createWorkstream("done-ws", { root });
	const wt = fs.mkdtempSync(path.join(os.tmpdir(), "wt-"));
	const sess = fs.mkdtempSync(path.join(os.tmpdir(), "sess-"));
	fs.writeFileSync(path.join(sess, "s.jsonl"), "{}");
	recordWorktree("done-ws", { path: wt, branch: "feat/z" }, { root });
	recordDispatchSession("done-ws", sess, { root });
	const removed: string[] = [];
	const git: GitRunner = {
		isDirty: () => false,
		hasUnpushedOrUnmerged: () => false,
		exists: () => true,
		removeWorktree: (p) => removed.push(p),
		deleteBranch: () => {},
	};
	const m = loadManifest("done-ws", { root })!;
	const res = cleanupWorkstream(m, { root, force: false, git });
	assert.equal(res.ok, true);
	assert.deepEqual(removed, [wt]);
	assert.ok(!fs.existsSync(sess), "session dir removed");
	assert.ok(!fs.existsSync(path.join(root, "done-ws")), "artifact dir removed last");
});

test("cleanupWorkstream with force proceeds past unsafe worktrees", () => {
	const root = tmpRoot();
	createWorkstream("forced", { root });
	recordWorktree("forced", { path: "/wt/dirty", branch: "feat/f" }, { root });
	const removed: string[] = [];
	const git: GitRunner = {
		isDirty: () => true,
		hasUnpushedOrUnmerged: () => true,
		exists: () => true,
		removeWorktree: (p) => removed.push(p),
		deleteBranch: () => {},
	};
	const m = loadManifest("forced", { root })!;
	const res = cleanupWorkstream(m, { root, force: true, git });
	assert.equal(res.ok, true);
	assert.deepEqual(removed, ["/wt/dirty"]);
});

test("cleanupWorkstream deletes merged branches only when asked", () => {
	const root = tmpRoot();
	createWorkstream("branches", { root });
	recordWorktree("branches", { path: "/wt/b", branch: "feat/merged" }, { root });
	const deleted: string[] = [];
	const git: GitRunner = {
		isDirty: () => false,
		hasUnpushedOrUnmerged: () => false,
		exists: () => true,
		removeWorktree: () => {},
		deleteBranch: (b) => deleted.push(b),
	};
	let m = loadManifest("branches", { root })!;
	cleanupWorkstream(m, { root, force: false, git, deleteMergedBranches: false });
	assert.deepEqual(deleted, []);
	// Re-create since the dir was cleaned.
	createWorkstream("branches", { root });
	recordWorktree("branches", { path: "/wt/b", branch: "feat/merged" }, { root });
	m = loadManifest("branches", { root })!;
	cleanupWorkstream(m, { root, force: false, git, deleteMergedBranches: true });
	assert.deepEqual(deleted, ["feat/merged"]);
});
