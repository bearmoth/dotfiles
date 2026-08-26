/**
 * Tests for per-step {model, effort} tuple resolution (Orchestrate v2).
 * Run with: node --experimental-strip-types --test step-config.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { PLANNING_STRATEGIES, resolveTuple, STEP_CONFIG, type StepName } from "./step-config.ts";

const allAvailable = () => true;
const none = () => false;

test("step table matches the v2 spec (strategy 1 defaults)", () => {
	assert.deepEqual(STEP_CONFIG.research.default, { model: "gpt-5.6-luna", effort: "max" });
	assert.deepEqual(STEP_CONFIG.plan.default, { model: "claude-opus-5", effort: "xhigh" });
	assert.deepEqual(STEP_CONFIG["plan-critique"].default, { model: "gpt-5.6-luna", effort: "max" });
	assert.deepEqual(STEP_CONFIG.implement.default, { model: "gpt-5.6-luna", effort: "max" });
	assert.deepEqual(STEP_CONFIG["verify-run"].default, { model: "gpt-5.6-luna", effort: "max" });
	assert.deepEqual(STEP_CONFIG.review.default, { model: "claude-fable-5", effort: "xhigh" });
	assert.deepEqual(STEP_CONFIG.review.allowed, [
		{ model: "claude-opus-5", effort: "xhigh" },
		{ model: "gpt-5.6-luna", effort: "max" },
	]);
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

test("fallback walks the allowed list only on unavailability, each with its own effort", () => {
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

test("a step with no allowed list stops immediately when unavailable", () => {
	const r = resolveTuple("implement", { isAvailable: none });
	assert.equal(r.ok, false);
	if (!r.ok) assert.match(r.error, /unavailable/i);
});

test("fallback continues down the allowed list when earlier tuples are unavailable", () => {
	const r = resolveTuple("review", { isAvailable: (m) => m === "gpt-5.6-luna" });
	assert.equal(r.ok, true);
	if (r.ok) {
		assert.equal(r.model, "gpt-5.6-luna");
		assert.equal(r.effort, "max");
		assert.equal(r.source, "fallback");
	}
});

test("explicit pick of an allowed tuple resolves as a sanctioned alternative", () => {
	const r = resolveTuple("review", { isAvailable: allAvailable, overrideModel: "gpt-5.6-luna", overrideEffort: "max" });
	assert.equal(r.ok, true);
	if (r.ok) {
		assert.deepEqual({ model: r.model, effort: r.effort }, { model: "gpt-5.6-luna", effort: "max" });
		assert.equal(r.source, "alternative");
		assert.deepEqual(r.defaultTuple, { model: "claude-fable-5", effort: "xhigh" });
	}
});

test("allowed model at a non-listed effort is an override, not an alternative", () => {
	const r = resolveTuple("review", { isAvailable: allAvailable, overrideModel: "gpt-5.6-luna", overrideEffort: "high" });
	assert.equal(r.ok, true);
	if (r.ok) assert.equal(r.source, "override");
});

test("explicit pick equal to the default resolves as default (no deviation flag)", () => {
	const r = resolveTuple("review", { isAvailable: allAvailable, overrideModel: "claude-fable-5", overrideEffort: "xhigh" });
	assert.equal(r.ok, true);
	if (r.ok) assert.equal(r.source, "default");
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

test("strategy 2 swaps only the plan and plan-critique tuples", () => {
	const strategy = "cheap-plans-strong-critique";
	const plan = resolveTuple("plan", { isAvailable: allAvailable, strategy });
	const crit = resolveTuple("plan-critique", { isAvailable: allAvailable, strategy });
	assert.ok(plan.ok && crit.ok);
	if (plan.ok) {
		assert.deepEqual({ model: plan.model, effort: plan.effort }, { model: "gpt-5.6-luna", effort: "max" });
		assert.deepEqual(plan.defaultTuple, { model: "gpt-5.6-luna", effort: "max" });
		assert.equal(plan.source, "default");
	}
	if (crit.ok) assert.deepEqual({ model: crit.model, effort: crit.effort }, { model: "claude-opus-5", effort: "xhigh" });
	const impl = resolveTuple("implement", { isAvailable: allAvailable, strategy });
	if (impl.ok) assert.equal(impl.model, "gpt-5.6-luna");
});

test("strategy 1 (and unset/unknown) keeps the table defaults", () => {
	for (const strategy of [undefined, "strong-plans-cheap-critique", "garbage"] as const) {
		const plan = resolveTuple("plan", { isAvailable: allAvailable, strategy });
		assert.ok(plan.ok);
		if (plan.ok) assert.equal(plan.model, "claude-opus-5");
	}
});

test("planning strategies enumerate spec strategies 1 and 2 in order", () => {
	assert.deepEqual(PLANNING_STRATEGIES.map((s) => s.id), ["strong-plans-cheap-critique", "cheap-plans-strong-critique"]);
	for (const s of PLANNING_STRATEGIES) assert.ok(s.summary.length > 0);
});
