/**
 * Tests for the dispatch profile registry and template skeletons
 * (Orchestrate v2 — ORCHESTRATE-V2-SPEC.md "Profiles and templates").
 * Run with: node --experimental-strip-types --test profiles.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { PROFILES, PROFILE_NAMES, composeBrief, templateSkeleton, type ProfileName } from "./profiles.ts";
import { STEP_CONFIG } from "./step-config.ts";

test("registry contains exactly the v2 pass-2 profiles", () => {
	assert.deepEqual(
		[...PROFILE_NAMES].sort(),
		[
			"implementor:diagnose",
			"implementor:tdd",
			"plan-critique",
			"planner",
			"reviewer:performance",
			"reviewer:security",
			"reviewer:standards",
		],
	);
});

test("profiles map to v1 roles only — never new permission sets (ADR 0001)", () => {
	const v1Roles = new Set(["implementor", "researcher", "reviewer"]);
	for (const name of PROFILE_NAMES) {
		assert.ok(v1Roles.has(PROFILES[name].role), `${name} must use a v1 role`);
	}
});

test("planner and plan-critique use researcher permissions with their step tuples", () => {
	assert.equal(PROFILES.planner.role, "researcher");
	assert.equal(PROFILES.planner.step, "plan");
	assert.equal(PROFILES["plan-critique"].role, "researcher");
	assert.equal(PROFILES["plan-critique"].step, "plan-critique");
});

test("each profile's default step exists in step-config", () => {
	for (const name of PROFILE_NAMES) {
		assert.ok(PROFILES[name].step in STEP_CONFIG, `${name}: step ${PROFILES[name].step}`);
	}
});

test("implementor profiles route to their steps and reference their skills", () => {
	assert.equal(PROFILES["implementor:tdd"].role, "implementor");
	assert.equal(PROFILES["implementor:tdd"].step, "implement");
	assert.ok(PROFILES["implementor:tdd"].skills.includes("tdd"));
	assert.equal(PROFILES["implementor:diagnose"].role, "implementor");
	assert.equal(PROFILES["implementor:diagnose"].step, "diagnose");
	assert.ok(PROFILES["implementor:diagnose"].skills.includes("diagnosing-bugs"));
});

test("reviewer specialists use the review step", () => {
	for (const name of ["reviewer:standards", "reviewer:security", "reviewer:performance"] as ProfileName[]) {
		assert.equal(PROFILES[name].role, "reviewer");
		assert.equal(PROFILES[name].step, "review");
	}
});

test("template skeletons carry the v1 brief sections and report format", () => {
	for (const name of PROFILE_NAMES) {
		const t = templateSkeleton(name);
		for (const section of ["## Objective", "## Relevant paths", "## Constraints", "## Acceptance criteria"]) {
			assert.ok(t.includes(section), `${name}: missing ${section}`);
		}
		assert.ok(t.includes("## Result / ## Changes / ## Concerns / ## Questions"), `${name}: missing report format`);
	}
});

test("standing mandates are inherited by the relevant templates", () => {
	// implementor templates require tests and lint to pass before the report
	for (const name of ["implementor:tdd", "implementor:diagnose"] as ProfileName[]) {
		assert.match(templateSkeleton(name), /tests and lint pass before you report/i);
		assert.match(templateSkeleton(name), /Conventional Commits/);
	}
	// review briefs: Conventional Comments + report classes, not just instances
	for (const name of ["reviewer:standards", "reviewer:security", "reviewer:performance"] as ProfileName[]) {
		const t = templateSkeleton(name);
		assert.match(t, /Conventional Comments/);
		assert.match(t, /classes, not just instances/i);
	}
});

test("diagnose deliverable rule: researcher cannot diagnose; implementor:diagnose may fix when briefed", () => {
	assert.match(templateSkeleton("implementor:diagnose"), /fix the issue only when the brief calls for it/i);
});

test("planner template targets the saved plan artifact and no repo mutation", () => {
	const t = templateSkeleton("planner");
	assert.match(t, /save_artifact/);
	assert.match(t, /master plan/i);
	assert.match(t, /read-only/i);
});

test("plan-critique template grills the plan without approving or dispatching", () => {
	const t = templateSkeleton("plan-critique");
	assert.match(t, /does not approve/i);
	assert.match(t, /findings/i);
});

test("composeBrief prepends the profile preamble to the orchestrator's brief body", () => {
	const body = "## Objective\nDo the thing.";
	const out = composeBrief("implementor:tdd", body);
	assert.ok(out.includes(body));
	assert.ok(out.indexOf("Standing mandates") < out.indexOf(body));
	assert.match(out, /`tdd`.*skill/i);
	assert.match(out, /## Result \/ ## Changes \/ ## Concerns \/ ## Questions/);
});

test("composeBrief includes the class-search rework mandate when prior findings are flagged", () => {
	const out = composeBrief("implementor:tdd", "## Objective\nRework.", { rework: true });
	assert.match(out, /CLASS of problem/);
	assert.match(out, /report the class and count/i);
});
