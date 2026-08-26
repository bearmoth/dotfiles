/**
 * Tests for the worker-side save_artifact core (ADR 0008). Run with:
 *   node --experimental-strip-types --test save-artifact.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { saveArtifactFile } from "./save-artifact.ts";

function scaffold(): { root: string; dir: string } {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "sa-root-"));
	const dir = path.join(root, "my-ws", "artifacts", "001-plan-master-plan");
	fs.mkdirSync(dir, { recursive: true });
	return { root, dir };
}

function env(root: string, dir: string | undefined, modeLocked = true) {
	return { artifactDir: dir, modeLocked, workstreamRoot: root };
}

test("saves a markdown file inside the per-dispatch dir", () => {
	const { root, dir } = scaffold();
	const res = saveArtifactFile(env(root, dir), "plan.md", "# Plan\n");
	assert.ok(res.ok);
	assert.equal(fs.readFileSync(path.join(dir, "plan.md"), "utf8"), "# Plan\n");
	if (res.ok) assert.equal(res.path, fs.realpathSync(path.join(dir, "plan.md")));
});

test("inert without a mode-locked process (interactive session)", () => {
	const { root, dir } = scaffold();
	const res = saveArtifactFile(env(root, dir, false), "plan.md", "x");
	assert.ok(!res.ok);
	if (!res.ok) assert.match(res.error, /dispatched worker/i);
});

test("inert without an artifact dir (dispatch with no active workstream)", () => {
	const { root } = scaffold();
	for (const v of [undefined, "", "   "]) {
		const res = saveArtifactFile(env(root, v), "plan.md", "x");
		assert.ok(!res.ok);
		if (!res.ok) assert.match(res.error, /workstream/i);
	}
});

test("rejects traversal and malformed names", () => {
	const { root, dir } = scaffold();
	for (const name of ["../escape.md", "a/b.md", "..\\x.md", ".hidden.md", "UPPER.md", "plan.txt", "plan", "a..b.md", ""]) {
		const res = saveArtifactFile(env(root, dir), name, "x");
		assert.ok(!res.ok, `expected rejection: "${name}"`);
	}
});

test("rejects overwrite (exclusive create)", () => {
	const { root, dir } = scaffold();
	assert.ok(saveArtifactFile(env(root, dir), "plan.md", "one").ok);
	const res = saveArtifactFile(env(root, dir), "plan.md", "two");
	assert.ok(!res.ok);
	if (!res.ok) assert.match(res.error, /exists/i);
	assert.equal(fs.readFileSync(path.join(dir, "plan.md"), "utf8"), "one");
});

test("rejects a symlinked artifact dir escaping the workstream root", () => {
	const { root } = scaffold();
	const outside = fs.mkdtempSync(path.join(os.tmpdir(), "sa-outside-"));
	const link = path.join(root, "my-ws", "artifacts", "002-plan-evil");
	fs.symlinkSync(outside, link);
	const res = saveArtifactFile(env(root, link), "plan.md", "x");
	assert.ok(!res.ok);
	assert.equal(fs.readdirSync(outside).length, 0);
});

test("rejects dirs outside the workstream root or at the wrong depth", () => {
	const { root, dir } = scaffold();
	const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "sa-else-"));
	for (const d of [elsewhere, path.join(root, "my-ws"), path.join(root, "my-ws", "artifacts"), root]) {
		const res = saveArtifactFile(env(root, d), "plan.md", "x");
		assert.ok(!res.ok, `expected rejection: ${d}`);
	}
	// sanity: the correct depth still works
	assert.ok(saveArtifactFile(env(root, dir), "ok.md", "x").ok);
});

test("rejects a missing artifact dir (fail closed, no mkdir)", () => {
	const { root } = scaffold();
	const res = saveArtifactFile(env(root, path.join(root, "my-ws", "artifacts", "009-plan-nope")), "plan.md", "x");
	assert.ok(!res.ok);
});
