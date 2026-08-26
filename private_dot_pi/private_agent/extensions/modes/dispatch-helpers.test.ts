/**
 * Tests for pure dispatch helpers. Run with:
 *   node --experimental-strip-types --test dispatch-helpers.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { countQuestions } from "./dispatch-helpers.ts";

test("countQuestions counts list items under ## Questions", () => {
	const report = [
		"## Result",
		"Done.",
		"## Questions",
		"- Should the cache be per-repo?",
		"- Is the timeout configurable?",
		"## Concerns",
		"- none",
	].join("\n");
	assert.equal(countQuestions(report), 2);
});

test("countQuestions treats 'none' placeholders as zero", () => {
	assert.equal(countQuestions("## Questions\n- none"), 0);
	assert.equal(countQuestions("## Questions\nNone."), 0);
	assert.equal(countQuestions("## Questions\n(none)"), 0);
	assert.equal(countQuestions("## Questions\nn/a"), 0);
});

test("countQuestions handles a missing section and null", () => {
	assert.equal(countQuestions("## Result\nDone."), 0);
	assert.equal(countQuestions(null), 0);
	assert.equal(countQuestions(""), 0);
});

test("countQuestions counts numbered items and stops at the next section", () => {
	const report = ["## Questions", "1. One?", "2. Two?", "3. Three?", "## Result", "- not a question"].join("\n");
	assert.equal(countQuestions(report), 3);
});

test("countQuestions counts a bare prose question line as one", () => {
	assert.equal(countQuestions("## Questions\nShould we split this module?"), 1);
});
