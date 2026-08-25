/**
 * Tests for per-step {model, effort} tuple resolution (Orchestrate v2).
 * Run with: node --experimental-strip-types --test step-config.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTuple, STEP_CONFIG, type StepName } from "./step-config.ts";

const allAvailable = () => true;
const none = () => false;

test("step table matches the v2 spec (strategy 1 defaults)", () => {
	assert.deepEqual(STEP_CONFIG.research.default, { model: "gpt-5.6-luna", effort: "max" });
	assert.deepEqual(STEP_CONFIG.plan.default, { model: "claude-opus-5", effort: "xhigh" });
	assert.deepEqual(STEP_CONFIG["plan-critique"].default, { model: "gpt-5.6-luna", effort: "max" });
	assert.deepEqual(STEP_CONFIG.implement.default, { model: "gpt-5.6-luna", effort: "max" });
	assert.deepEqual(STEP_CONFIG["verify-run"].default, { model: "gpt-5.6-luna", effort: "max" });
	assert.deepEqual(STEP_CONFIG.review.default, { model: "claude-fable-5", effort: "xhigh" });
	assert.deepEqual(STEP_CONFIG.review.fallback, [{ model: "claude-opus-5", effort: "xhigh" }]);
	assert.deepEqual(STEP_CONFIG.review.downgradeAllowed, [{ model: "gpt-5.6-luna", effort: "max" }]);
	assert.deepEqual(STEP_CONFIG.diagnose.default, { model: "gpt-5.6-luna", effort: "max" });
});

test("default resolution when the model is available", () => {
	const r = resolveTuple("implement", { isAvailable: allAvailable });
	assert.equal(r.ok, true);
	if (r.ok) {
		assert.deepEqual({ model: r.model, effort: r.effort }, { model: "gpt-5.6-luna", effort: "max" });
		assert.equal(r.source, "default");
	}
});

test("fallback chain is tried only on unavailability, each with its own effort", () => {
	const r = resolveTuple("review", { isAvailable: (m) => m !== "claude-fable-5" });
	assert.equal(r.ok, true);
	if (r.ok) {
		assert.equal(r.model, "claude-opus-5");
		assert.equal(r.effort, "xhigh"); // fallback tuple's own effort, never inherited
		assert.equal(r.source, "fallback");
		assert.deepEqual(r.defaultTuple, { model: "claude-fable-5", effort: "xhigh" });
	}
});

test("exhausted fallback chain stops and asks — never invents a model", () => {
	const r = resolveTuple("review", { isAvailable: none });
	assert.equal(r.ok, false);
	if (!r.ok) assert.match(r.error, /ask the user/i);
});

test("a step with no fallback stops immediately when unavailable", () => {
	const r = resolveTuple("implement", { isAvailable: none });
	assert.equal(r.ok, false);
	if (!r.ok) assert.match(r.error, /unavailable/i);
});

test("unavailability never authorizes a downgrade", () => {
	// review's downgrade list has an available model, but the default+fallback
	// being unavailable must NOT auto-route there.
	const r = resolveTuple("review", { isAvailable: (m) => m === "gpt-5.6-luna" });
	assert.equal(r.ok, false);
});

test("explicit downgrade resolves from downgradeAllowed and is flagged", () => {
	const r = resolveTuple("review", { isAvailable: allAvailable, downgrade: true });
	assert.equal(r.ok, true);
	if (r.ok) {
		assert.deepEqual({ model: r.model, effort: r.effort }, { model: "gpt-5.6-luna", effort: "max" });
		assert.equal(r.source, "downgrade");
		assert.deepEqual(r.defaultTuple, { model: "claude-fable-5", effort: "xhigh" });
	}
});

test("downgrade on a step without a downgrade list is an error", () => {
	const r = resolveTuple("implement", { isAvailable: allAvailable, downgrade: true });
	assert.equal(r.ok, false);
	if (!r.ok) assert.match(r.error, /downgrade/i);
});

test("override requires its own effort — effort never crosses a model swap", () => {
	const bad = resolveTuple("implement", { isAvailable: allAvailable, overrideModel: "claude-opus-5" });
	assert.equal(bad.ok, false);
	if (!bad.ok) assert.match(bad.error, /effort/i);
	const good = resolveTuple("implement", { isAvailable: allAvailable, overrideModel: "claude-opus-5", overrideEffort: "xhigh" });
	assert.equal(good.ok, true);
	if (good.ok) {
		assert.equal(good.model, "claude-opus-5");
		assert.equal(good.effort, "xhigh");
		assert.equal(good.source, "override");
	}
});

test("override of an unavailable model is an error, not a fallback trigger", () => {
	const r = resolveTuple("implement", { isAvailable: none, overrideModel: "x", overrideEffort: "high" });
	assert.equal(r.ok, false);
});

test("unknown step name is an error", () => {
	const r = resolveTuple("nonsense" as StepName, { isAvailable: allAvailable });
	assert.equal(r.ok, false);
});
