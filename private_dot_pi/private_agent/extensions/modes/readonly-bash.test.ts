/**
 * Tests for the read-only bash classifier (the EXPLORE/ORCHESTRATE security
 * boundary). Run with:  node --experimental-strip-types --test readonly-bash.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyBashCommand } from "./readonly-bash.ts";

const ro = (cmd: string, opts?: { reviewerGh?: boolean }) =>
	assert.equal(classifyBashCommand(cmd, opts).readonly, true, `expected read-only: ${cmd}`);
const no = (cmd: string, opts?: { reviewerGh?: boolean }) =>
	assert.equal(classifyBashCommand(cmd, opts).readonly, false, `expected blocked: ${cmd}`);

test("plain read-only commands pass", () => {
	ro("ls -la");
	ro("cat foo.txt | grep bar");
	ro("git status && git diff");
	ro("rg 'pattern' src/");
});

test("pi model listing is allowed but other pi invocations are blocked", () => {
	ro("pi --list-models");
	no("pi");
	no("pi --help");
	no("pi --list-models --json");
	no("pi -p 'show me the files'");
});

test("path-prefixed pi model listing is allowed", () => {
	ro("/usr/local/bin/pi --list-models");
});

test("command-prefixed pi model listing is allowed", () => {
	ro("command pi --list-models");
});

test("mutation and unknown commands are blocked", () => {
	no("rm -rf /tmp/x");
	no("touch foo");
	no("git commit -m x");
	no("npm install");
	no("some-unknown-tool");
});

test("shell syntax fails closed", () => {
	no("echo hi > file");
	no("echo $(rm -rf x)");
	no("cat `whoami`");
	no("eval ls");
	no("ls & ");
});

test("quoted metacharacters do not trip the classifier", () => {
	ro('grep "a > b" file.txt');
});

test("safe redirects to /dev/null pass", () => {
	ro("git status 2>/dev/null");
});

test("git subcommand extras", () => {
	ro("git stash list");
	no("git stash");
	no("git branch -D foo");
	ro("git branch -a");
	no("git config user.name x");
});

test("git global pre-subcommand options are skipped", () => {
	ro("git -C /x status");
	ro("git -C /x diff");
	no("git -C /x commit -m x");
	no("git -C /x push");
	ro("git --git-dir=/x/.git log");
	no("git -C /x");
	no("git -c a=b status");
	no("git -c core.fsmonitor=x status");
	ro("git --no-pager log");
	no("git -C");
});

test("find/fd exec actions blocked", () => {
	no("find . -name '*.ts' -delete");
	no("find . -exec rm {} +");
	ro("find . -name '*.ts'");
	no("xargs rm");
});

test("curl/wget/sed restrictions", () => {
	ro("curl https://example.com");
	no("curl -X POST https://example.com");
	no("curl -o out.html https://example.com");
	no("wget https://example.com");
	ro("wget -O - https://example.com");
	no("sed -i 's/a/b/' file");
	ro("sed 's/a/b/' file");
});

test("gh read-only pairs pass; others blocked by default", () => {
	ro("gh pr view 123");
	ro("gh issue list");
	no("gh pr merge 123");
	no("gh pr review 123 --approve");
	no("gh issue comment 1 -b hi");
	no("gh repo delete foo");
});

test("reviewer gh pairs only with reviewerGh option", () => {
	ro("gh pr review 123 --approve", { reviewerGh: true });
	ro("gh pr comment 123 -b 'note'", { reviewerGh: true });
	ro("gh issue comment 1 -b hi", { reviewerGh: true });
	no("gh pr merge 123", { reviewerGh: true });
	no("gh repo delete foo", { reviewerGh: true });
	ro("gh pr view 123", { reviewerGh: true });
});
