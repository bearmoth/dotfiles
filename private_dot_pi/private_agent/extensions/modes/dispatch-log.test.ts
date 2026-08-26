/**
 * Tests for DispatchLog routing observability (v2). Run with:
 *   node --experimental-strip-types --test dispatch-log.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { getDispatchRecords, logDispatchSettle, logDispatchStart, rebuildDispatchLog } from "./dispatch-log.ts";

test("routing is recorded at start and preserved through settle", () => {
	rebuildDispatchLog([]);
	const routing = { model: "claude-opus-5", effort: "xhigh", source: "fallback" as const, defaultModel: "claude-fable-5", defaultEffort: "xhigh" };
	logDispatchStart("id1", "reviewer", "review the diff", "/wt/a", routing);
	assert.deepEqual(getDispatchRecords()[0].routing, routing);
	logDispatchSettle("id1", { status: "ok", exitCode: 0, finalMessage: "done", sessionFile: "/s", durationMs: 5, routing });
	assert.deepEqual(getDispatchRecords()[0].routing, routing);
});

test("rebuild restores routing from result details", () => {
	const routing = { model: "gpt-5.6-luna", effort: "max", source: "downgrade" as const, defaultModel: "claude-fable-5", defaultEffort: "xhigh" };
	rebuildDispatchLog([
		{
			type: "message",
			message: {
				role: "assistant",
				content: [{ type: "toolCall", name: "dispatch_task", id: "tc1", arguments: { role: "reviewer", title: "trivial diff review", workdir: "/wt" } }],
			},
		},
		{
			type: "message",
			message: {
				role: "toolResult",
				toolName: "dispatch_task",
				toolCallId: "tc1",
				details: { status: "ok", exitCode: 0, finalMessage: "ok", sessionFile: "/s", durationMs: 1, routing },
			},
		},
	]);
	const rec = getDispatchRecords()[0];
	assert.equal(rec.id, "tc1");
	assert.deepEqual(rec.routing, routing);
});

test("profile is recorded at start and preserved through settle (v2 pass 2)", () => {
	rebuildDispatchLog([]);
	logDispatchStart("id2", "reviewer", "security review", "/wt/a", undefined, "reviewer:security");
	assert.equal(getDispatchRecords()[0].profile, "reviewer:security");
	logDispatchSettle("id2", { status: "ok", exitCode: 0, finalMessage: "done", sessionFile: "/s", durationMs: 5, profile: "reviewer:security" });
	assert.equal(getDispatchRecords()[0].profile, "reviewer:security");
});

test("rebuild restores profile and resolves role from a profile-only call", () => {
	rebuildDispatchLog([
		{
			type: "message",
			message: {
				role: "assistant",
				content: [{ type: "toolCall", name: "dispatch_task", id: "tc2", arguments: { profile: "planner", title: "plan the workstream", workdir: "/wt" } }],
			},
		},
		{
			type: "message",
			message: {
				role: "toolResult",
				toolName: "dispatch_task",
				toolCallId: "tc2",
				details: { status: "ok", exitCode: 0, finalMessage: "ok", sessionFile: "/s", durationMs: 1, profile: "planner" },
			},
		},
	]);
	const rec = getDispatchRecords()[0];
	assert.equal(rec.profile, "planner");
	assert.equal(rec.role, "researcher");
});

test("artifacts are preserved through settle and rebuild (v2 pass 3)", () => {
	rebuildDispatchLog([]);
	const artifacts = ["/ws/artifacts/001-plan-x/plan.md"];
	logDispatchStart("id3", "researcher", "plan it", "/wt");
	logDispatchSettle("id3", { status: "ok", exitCode: 0, finalMessage: "ok", sessionFile: "/s", durationMs: 1, artifacts });
	assert.deepEqual(getDispatchRecords()[0].artifacts, artifacts);
	rebuildDispatchLog([
		{ type: "message", message: { role: "assistant", content: [{ type: "toolCall", name: "dispatch_task", id: "tc3", arguments: { profile: "planner", title: "t", workdir: "/wt" } }] } },
		{ type: "message", message: { role: "toolResult", toolName: "dispatch_task", toolCallId: "tc3", details: { status: "ok", exitCode: 0, finalMessage: "ok", sessionFile: "/s", durationMs: 1, artifacts } } },
	]);
	assert.deepEqual(getDispatchRecords()[0].artifacts, artifacts);
});
