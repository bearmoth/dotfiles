/**
 * Tests for the advisory repo map loader (Orchestrate v2 "Repo map").
 * Run with: node --experimental-strip-types --test repo-map.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadRepoMap, renderRepoMapAdvisory } from "./repo-map.ts";

function writeMap(content: unknown): string {
	const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "repomap-")), "repos.json");
	fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
	return file;
}

test("loads valid entries", () => {
	const file = writeMap({
		repos: [
			{ name: "chezmoi", path: "~/.local/share/chezmoi", description: "dotfiles source", hints: { direct_to_main: true } },
			{ name: "svc", path: "/repos/svc", description: "a service", worktreeRoot: "/wt", hints: { requires_pr: true } },
		],
	});
	const repos = loadRepoMap(file);
	assert.equal(repos.length, 2);
	assert.equal(repos[0].name, "chezmoi");
	assert.equal(repos[0].hints?.direct_to_main, true);
	assert.equal(repos[1].hints?.requires_pr, true);
});

test("missing file is not an error — empty advisory list", () => {
	assert.deepEqual(loadRepoMap("/nonexistent/repos.json"), []);
});

test("invalid JSON and invalid entries are skipped, not fatal", () => {
	assert.deepEqual(loadRepoMap(writeMap("{not json")), []);
	const repos = loadRepoMap(
		writeMap({
			repos: [
				{ name: "ok", path: "/p", description: "fine" },
				{ name: "no-description", path: "/p2" }, // description is mandatory
				{ path: "/p3", description: "no name" },
				"garbage",
			],
		}),
	);
	assert.equal(repos.length, 1);
	assert.equal(repos[0].name, "ok");
});

test("advisory rendering includes descriptions and hints, guidance not gate", () => {
	const file = writeMap({
		repos: [{ name: "chezmoi", path: "~/.local/share/chezmoi", description: "dotfiles source", hints: { direct_to_main: true } }],
	});
	const out = renderRepoMapAdvisory(loadRepoMap(file));
	assert.match(out, /chezmoi/);
	assert.match(out, /dotfiles source/);
	assert.match(out, /direct_to_main/);
	assert.match(out, /advisory/i);
});

test("advisory rendering of an empty map is empty", () => {
	assert.equal(renderRepoMapAdvisory([]), "");
});
