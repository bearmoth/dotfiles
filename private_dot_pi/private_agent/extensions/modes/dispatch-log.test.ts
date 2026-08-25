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
