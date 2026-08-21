import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	alwaysAllowedRoots,
	checkBashAgainstFence,
	checkPathAgainstFence,
	parseFenceEnv,
	bashMentionsProtected,
	resolveRealPath,
	resolveWorktreeRoot,
} from "./fence.ts";

function mkTmp(): string {
	return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "fence-test-"));
}

// Fence dir OUTSIDE tmpdir, so allowed-root fallthrough doesn't mask results.
function mkFence(): string {
	const dir = fs.mkdtempSync(path.join(os.homedir(), ".fence-test-"));
	return fs.realpathSync(dir);
}

test("path under fence is allowed", () => {
	const fence = mkFence();
	try {
		const r = checkPathAgainstFence(path.join(fence, "src", "a.ts"), fence, [fence]);
		assert.equal(r.ok, true);
	} finally {
		fs.rmSync(fence, { recursive: true, force: true });
	}
});

test("path outside fence is blocked", () => {
	const fence = mkFence();
	try {
		const r = checkPathAgainstFence("/etc/hosts", fence, [fence]);
		assert.equal(r.ok, false);
		assert.match(r.reason ?? "", /Write fence/);
	} finally {
		fs.rmSync(fence, { recursive: true, force: true });
	}
});

test("symlink under fence pointing outside is blocked", () => {
	const fence = mkFence();
	const outside = fs.mkdtempSync(path.join(os.homedir(), ".fence-outside-"));
	try {
		const link = path.join(fence, "escape");
		fs.symlinkSync(outside, link);
		const r = checkPathAgainstFence(path.join(link, "file.txt"), fence, [fence]);
		assert.equal(r.ok, false);
	} finally {
		fs.rmSync(fence, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	}
});

test("macOS firmlink alias /System/Volumes/Data/<x> collapses to /<x>", () => {
	const home = os.homedir();
	if (process.platform !== "darwin" || !fs.existsSync("/System/Volumes/Data" + home)) return;
	// Existing path: alias collapses to canonical.
	assert.equal(resolveRealPath("/System/Volumes/Data" + home, "/"), fs.realpathSync(home));
	// Nonexistent path: still collapses (fail closed), so the alias can't dodge
	// protected-path/containment prefix checks.
	const ghost = "/System/Volumes/Data" + path.join(home, "no-such-dir-xyz", "f.md");
	assert.equal(resolveRealPath(ghost, "/"), path.join(fs.realpathSync(home), "no-such-dir-xyz", "f.md"));
	// Fence check: alias of an outside path is blocked.
	const fence = mkFence();
	try {
		const target = "/System/Volumes/Data" + path.join(home, ".fence-test-outside.md");
		assert.equal(checkPathAgainstFence(target, "/", [fence]).ok, false);
	} finally {
		fs.rmSync(fence, { recursive: true, force: true });
	}
});

test("tmpdir and cache paths are always allowed", () => {
	const fence = mkFence();
	try {
		const tmp = path.join(fs.realpathSync(os.tmpdir()), "scratch.txt");
		assert.equal(checkPathAgainstFence(tmp, fence, [fence]).ok, true);
		const cache = path.join(os.homedir(), ".cache", "x");
		assert.equal(checkPathAgainstFence(cache, fence, [fence]).ok, true);
		const npm = path.join(os.homedir(), ".npm", "y");
		assert.equal(checkPathAgainstFence(npm, fence, [fence]).ok, true);
	} finally {
		fs.rmSync(fence, { recursive: true, force: true });
	}
});

test("worktree root: env var wins over settings over default", () => {
	const tmp = mkTmp();
	try {
		const settingsFile = path.join(tmp, "settings.json");
		fs.writeFileSync(settingsFile, JSON.stringify({ worktreeRoot: "/from/settings" }));

		const saved = process.env.PI_WORKTREE_ROOT;
		try {
			process.env.PI_WORKTREE_ROOT = "/from/env";
			assert.equal(resolveWorktreeRoot(settingsFile), "/from/env");

			delete process.env.PI_WORKTREE_ROOT;
			assert.equal(resolveWorktreeRoot(settingsFile), "/from/settings");

			assert.equal(resolveWorktreeRoot(path.join(tmp, "missing.json")), path.join(os.homedir(), "worktrees"));
		} finally {
			if (saved === undefined) delete process.env.PI_WORKTREE_ROOT;
			else process.env.PI_WORKTREE_ROOT = saved;
		}
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});

test("checkBashAgainstFence blocks obvious escapes", () => {
	const fence = mkFence();
	try {
		assert.equal(checkBashAgainstFence("cd /etc && x", [fence], fence).ok, false);
		assert.equal(checkBashAgainstFence("git -C /outside status", [fence], fence).ok, false);
		assert.equal(checkBashAgainstFence("echo x > /outside/f", [fence], fence).ok, false);
	} finally {
		fs.rmSync(fence, { recursive: true, force: true });
	}
});

test("checkBashAgainstFence blocks git --git-dir/--work-tree escapes", () => {
	const fence = mkFence();
	try {
		assert.equal(checkBashAgainstFence("git --git-dir=/outside/.git commit", [fence], fence).ok, false);
		assert.equal(checkBashAgainstFence("git --git-dir /outside/.git commit", [fence], fence).ok, false);
		assert.equal(checkBashAgainstFence("git --work-tree=/outside checkout -- .", [fence], fence).ok, false);
		assert.equal(checkBashAgainstFence("git --work-tree /outside checkout -- .", [fence], fence).ok, false);
		assert.equal(checkBashAgainstFence("git --git-dir=.git status", [fence], fence).ok, true);
	} finally {
		fs.rmSync(fence, { recursive: true, force: true });
	}
});

test("checkBashAgainstFence blocks fd-numbered and &> redirects outside", () => {
	const fence = mkFence();
	try {
		assert.equal(checkBashAgainstFence("cmd 2>/outside/f", [fence], fence).ok, false);
		assert.equal(checkBashAgainstFence("cmd 2>> /outside/f", [fence], fence).ok, false);
		assert.equal(checkBashAgainstFence("cmd &>/outside/f", [fence], fence).ok, false);
		assert.equal(checkBashAgainstFence("cmd &>> /outside/f", [fence], fence).ok, false);
		// fd duplication is fine
		assert.equal(checkBashAgainstFence("cmd 2>&1", [fence], fence).ok, true);
		assert.equal(checkBashAgainstFence("echo x >&2", [fence], fence).ok, true);
		// /dev/null, relative, inside-fence are fine
		assert.equal(checkBashAgainstFence("cmd 2>/dev/null", [fence], fence).ok, true);
		assert.equal(checkBashAgainstFence("cmd &>/dev/null", [fence], fence).ok, true);
		assert.equal(checkBashAgainstFence("cmd 2> err.log", [fence], fence).ok, true);
		assert.equal(checkBashAgainstFence(`cmd 2> ${fence}/err.log`, [fence], fence).ok, true);
	} finally {
		fs.rmSync(fence, { recursive: true, force: true });
	}
});

test("checkBashAgainstFence resolves relative cd against cwd", () => {
	const fence = mkFence();
	try {
		const sub = path.join(fence, "sub");
		fs.mkdirSync(sub);
		assert.equal(checkBashAgainstFence("cd .. && ls", [fence], sub).ok, true); // .. of sub = fence
		assert.equal(checkBashAgainstFence("cd .. && ls", [fence], fence).ok, false); // escapes fence
		assert.equal(checkBashAgainstFence("cd ../.. && ls", [fence], sub).ok, false);
		assert.equal(checkBashAgainstFence("cd sub && ls", [fence], fence).ok, true);
		assert.equal(checkBashAgainstFence("pushd ../../etc", [fence], sub).ok, false);
	} finally {
		fs.rmSync(fence, { recursive: true, force: true });
	}
});

test("checkBashAgainstFence allows normal commands", () => {
	const fence = mkFence();
	try {
		assert.equal(checkBashAgainstFence("git status", [fence], fence).ok, true);
		assert.equal(checkBashAgainstFence("npm test", [fence], fence).ok, true);
		assert.equal(checkBashAgainstFence("echo x > out.txt", [fence], fence).ok, true);
		assert.equal(checkBashAgainstFence("echo x >> logs/build.log", [fence], fence).ok, true);
		assert.equal(checkBashAgainstFence(`cd ${fence}/sub && ls`, [fence], fence).ok, true);
		assert.equal(checkBashAgainstFence(`git -C ${fence} status`, [fence], fence).ok, true);
	} finally {
		fs.rmSync(fence, { recursive: true, force: true });
	}
});

test("symlinked fence root: inside targets are allowed", () => {
	const fence = mkFence();
	const linkDir = fs.mkdtempSync(path.join(os.homedir(), ".fence-link-"));
	const link = path.join(linkDir, "fence-link");
	fs.symlinkSync(fence, link);
	try {
		assert.equal(checkBashAgainstFence(`echo x > ${link}/out.txt`, [link], link).ok, true);
		assert.equal(checkBashAgainstFence(`cd ${link}/sub && ls`, [link], link).ok, true);
	} finally {
		fs.rmSync(linkDir, { recursive: true, force: true });
		fs.rmSync(fence, { recursive: true, force: true });
	}
});

test("git path options are found anywhere after git, all occurrences", () => {
	const fence = mkFence();
	try {
		assert.equal(checkBashAgainstFence("git --no-pager -C /outside push", [fence], fence).ok, false);
		assert.equal(checkBashAgainstFence("git -c x=y -C /outside push", [fence], fence).ok, false);
		assert.equal(checkBashAgainstFence(`git -C ${fence} -C /outside push`, [fence], fence).ok, false);
		assert.equal(checkBashAgainstFence(`git --no-pager -C ${fence} status`, [fence], fence).ok, true);
	} finally {
		fs.rmSync(fence, { recursive: true, force: true });
	}
});

test("tilde targets in cd/pushd are expanded and fenced", () => {
	const fence = mkFence();
	try {
		assert.equal(checkBashAgainstFence("cd ~ && ls", [fence], fence).ok, false);
		assert.equal(checkBashAgainstFence("cd ~/x && ls", [fence], fence).ok, false);
		assert.equal(checkBashAgainstFence("echo x > ~/out.txt", [fence], fence).ok, false);
		const rel = path.relative(os.homedir(), fence);
		assert.equal(checkBashAgainstFence(`cd ~/${rel} && ls`, [fence], fence).ok, true);
	} finally {
		fs.rmSync(fence, { recursive: true, force: true });
	}
});

test("parseFenceEnv and alwaysAllowedRoots basics", () => {
	assert.deepEqual(parseFenceEnv(undefined), []);
	assert.deepEqual(parseFenceEnv("/a:/b"), ["/a", "/b"]);
	assert.ok(alwaysAllowedRoots().length >= 3);
});

test("protectedGrantActive fails closed", async () => {
	const { protectedGrantActive } = await import("./fence.ts");
	const token = "a".repeat(32);
	// Valid token + modeLocked → active.
	assert.equal(protectedGrantActive(token, true), true);
	// Never in interactive (non-locked) sessions.
	assert.equal(protectedGrantActive(token, false), false);
	// Missing/empty/short/non-hex tokens → inactive.
	assert.equal(protectedGrantActive(undefined, true), false);
	assert.equal(protectedGrantActive("", true), false);
	assert.equal(protectedGrantActive("1", true), false);
	assert.equal(protectedGrantActive("true", true), false);
	assert.equal(protectedGrantActive("z".repeat(32), true), false);
});

test("nerdFontEnabled reads the settings flag, fails closed", async () => {
	const { nerdFontEnabled } = await import("./fence.ts");
	const dir = mkTmp();
	try {
		const file = path.join(dir, "settings.json");
		fs.writeFileSync(file, JSON.stringify({ nerdFont: true }));
		assert.equal(nerdFontEnabled(file), true);
		fs.writeFileSync(file, JSON.stringify({ nerdFont: false }));
		assert.equal(nerdFontEnabled(file), false);
		fs.writeFileSync(file, JSON.stringify({}));
		assert.equal(nerdFontEnabled(file), false);
		fs.writeFileSync(file, "not json");
		assert.equal(nerdFontEnabled(file), false);
		assert.equal(nerdFontEnabled(path.join(dir, "missing.json")), false);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("bashMentionsProtected detects guardrail paths in commands", () => {
	const prot = mkFence(); // stand-in protected root
	try {
		const inside = path.join(prot, "index.ts");
		// Plain absolute path token.
		assert.equal(bashMentionsProtected(`cp evil.ts ${inside}`, [prot], os.homedir()), inside);
		// Quoted token.
		assert.equal(bashMentionsProtected(`tee "${inside}" < x`, [prot], os.homedir()), inside);
		// --opt=path shape.
		assert.ok(bashMentionsProtected(`git --git-dir=${prot}/.git commit`, [prot], os.homedir()));
		// Redirect glued to fd number: 2>path.
		assert.ok(bashMentionsProtected(`cmd 2>${inside}`, [prot], os.homedir()));
		// Tilde expansion.
		const rel = path.relative(os.homedir(), inside);
		assert.ok(bashMentionsProtected(`echo x > ~/${rel}`, [prot], "/"));
		// Relative path resolving into the protected root.
		assert.ok(bashMentionsProtected(`cp a.ts ./sub/../index.ts`, [prot], prot));
		// Symlink spelling of a protected path.
		const linkDir = fs.mkdtempSync(path.join(os.homedir(), ".fence-link-"));
		const link = path.join(linkDir, "alias");
		fs.symlinkSync(prot, link);
		try {
			assert.ok(bashMentionsProtected(`cp evil.ts ${link}/index.ts`, [prot], os.homedir()));
		} finally {
			fs.rmSync(linkDir, { recursive: true, force: true });
		}
		// Clean commands: no hit.
		assert.equal(bashMentionsProtected("npm test", [prot], os.homedir()), null);
		assert.equal(bashMentionsProtected("cp a.ts b.ts", [prot], os.homedir()), null);
		// Non-path words that merely mention the basename: no hit.
		assert.equal(bashMentionsProtected("echo index.ts", [prot], os.homedir()), null);
	} finally {
		fs.rmSync(prot, { recursive: true, force: true });
	}
});

test("reportPreview extracts Result section sentences", async () => {
	const { reportPreview } = await import("./dispatch-helpers.ts");
	const msg = "preamble\n\n## Result\nAll tests pass.\nRefactored the fence.\nMore detail here.\nFourth line dropped.\n\n## Changes\n- a.ts";
	assert.equal(reportPreview(msg), "All tests pass.\nRefactored the fence.\nMore detail here.");
	// Fallback: no ## Result → first non-empty lines.
	assert.equal(reportPreview("first\n\nsecond"), "first\nsecond");
	// Null → empty.
	assert.equal(reportPreview(null), "");
	// Truncation.
	const long = "## Result\n" + "x".repeat(500);
	const p = reportPreview(long);
	assert.ok(p.length <= 200 && p.endsWith("…"));
});
