/**
 * Dispatch profile registry and brief-template skeletons
 * (ORCHESTRATE-V2-SPEC.md "Profiles and templates: who versus what").
 *
 * Layering: Role → Profile → Template.
 *
 * - A Role defines permissions (v1: implementor/researcher/reviewer — ADR
 *   0001). Profiles NEVER change permissions.
 * - A Profile = role + default step tuple (step-config.ts) + standing skill
 *   references + standing mandates.
 * - A Template is the per-dispatch brief skeleton: the v1 self-contained
 *   sections plus the profile's standing mandates. The orchestrator fills in
 *   the workstream specifics; composeBrief() prepends the profile preamble.
 */

import type { Role } from "./dispatch.ts";
import type { StepName } from "./step-config.ts";

export interface Profile {
	role: Role;
	/** Default pipeline step; selects the {model, effort} tuple from step-config. */
	step: StepName;
	/** Standing skill references the worker should load (by skill name). */
	skills: string[];
	/** Standing mandates baked into this profile's template. */
	mandates: string[];
	/** One-line purpose, shown in tool description / UI. */
	summary: string;
}

// Shared standing mandates (spec: "Standing mandates are inherited by the
// relevant templates").
const CONVENTIONAL_COMMITS = "Commits use Conventional Commits.";
const CONVENTIONAL_COMMENTS = "Review comments use Conventional Comments.";
const TESTS_LINT = "Tests and lint pass before you report — this is part of your definition of done.";
const REPORT_CLASSES = "Report classes, not just instances: when you find a defect, look for the pattern and report the class.";
const VERIFY_ONLY = "Run checks, change nothing, report.";
export const CLASS_SEARCH_MANDATE =
	"Rework mandate: search for other instances of the flagged CLASS of problem, fix all of them, and report the class and count.";

export const PROFILES = {
	"implementor:tdd": {
		role: "implementor",
		step: "implement",
		skills: ["tdd"],
		mandates: [
			"Work test-first (red-green-refactor) per the tdd skill.",
			TESTS_LINT,
			CONVENTIONAL_COMMITS,
		],
		summary: "Test-first implementation work",
	},
	"implementor:diagnose": {
		role: "implementor",
		step: "diagnose",
		skills: ["diagnosing-bugs"],
		mandates: [
			"Follow the diagnosing-bugs loop; you may run mutation-capable experiments and tests.",
			"Deliver a diagnosis report; fix the issue only when the brief calls for it.",
			TESTS_LINT,
			CONVENTIONAL_COMMITS,
		],
		summary: "Diagnosis needing mutation-capable experiments/tests; may fix when briefed",
	},
	"reviewer:standards": {
		role: "reviewer",
		step: "review",
		skills: ["code-review"],
		mandates: [
			"Review the diff against this repository's documented coding standards and conventions.",
			CONVENTIONAL_COMMENTS,
			REPORT_CLASSES,
		],
		summary: "Standards/conventions review of a diff",
	},
	"reviewer:security": {
		role: "reviewer",
		step: "review",
		skills: [],
		mandates: [
			"Review the diff for security issues: injection, authn/authz, secrets handling, unsafe deserialization, trust-boundary violations.",
			CONVENTIONAL_COMMENTS,
			REPORT_CLASSES,
		],
		summary: "Security-focused review of a diff",
	},
	"reviewer:performance": {
		role: "reviewer",
		step: "review",
		skills: [],
		mandates: [
			"Review the diff for performance issues: algorithmic complexity, N+1 access, allocation churn, blocking I/O on hot paths.",
			CONVENTIONAL_COMMENTS,
			REPORT_CLASSES,
		],
		summary: "Performance-focused review of a diff",
	},
	// Planner and plan-critique use researcher permissions (read-only) —
	// planning is a dispatchable step, not an orchestrator-only conversation.
	planner: {
		role: "researcher",
		step: "plan",
		skills: ["codebase-design"],
		mandates: [
			"You are read-only apart from the save_artifact tool. Your input is the refined spec plus research artifacts; your durable output is the plan, saved via save_artifact (ADR 0008). Your report lists the artifact path with consumption instructions under '## Artifacts', plus a short '## Result' summary.",
			"Structure the plan as a master plan: reviewable units, their ordering and dependencies, and invalidation notes (which later units must be re-checked or re-planned after an earlier unit lands). Implementation is dispatched per unit, never as one 'implement the plan'.",
			"The plan must record the review-unit decomposition (how many PRs/reviewable units) and its rationale, and select which reviewer specialist profiles fan out per diff.",
			"Surface any alternative-tuple routing choices explicitly with reasons.",
		],
		summary: "Produces the master plan artifact from the refined spec and research artifacts",
	},
	"plan-critique": {
		role: "researcher",
		step: "plan-critique",
		skills: ["grilling"],
		mandates: [
			"You are read-only apart from the save_artifact tool. Grill the plan against the refined spec and research artifacts; save substantial findings via save_artifact and list them under '## Artifacts'. Findings that fit in 1-3 paragraphs may stay in the report body.",
			"You critique only: the critique does not approve the plan and does not dispatch implementation. User approval remains the explicit checkpoint.",
		],
		summary: "Grills the plan artifact before user approval; findings only",
	},
} as const satisfies Record<string, Profile>;

export type ProfileName = keyof typeof PROFILES;
export const PROFILE_NAMES = Object.keys(PROFILES) as ProfileName[];

/** Whether this profile's template mandates verify-only behavior. */
function isVerifyOnly(name: ProfileName): boolean {
	return PROFILES[name].step === "verify-run";
}

/**
 * Template skeleton for a profile: profile preamble (skills + standing
 * mandates) plus the v1 self-contained brief sections for the orchestrator
 * to fill in.
 */
export function templateSkeleton(name: ProfileName): string {
	return [
		profilePreamble(name),
		"",
		"## Objective",
		"<what done looks like>",
		"",
		"## Relevant paths",
		"<files/dirs the worker needs>",
		"",
		"## Constraints",
		"<boundaries, non-goals, protected areas>",
		"",
		"## Acceptance criteria",
		"<verifiable criteria>",
		"",
		"## Prior findings",
		"<rework/review dispatches only; omit otherwise>",
	].join("\n");
}

/** The standing profile preamble: skills, mandates, and required report format. */
function profilePreamble(name: ProfileName, opts: { rework?: boolean } = {}): string {
	const p = PROFILES[name];
	const lines: string[] = [`Profile: ${name} (${p.summary}).`];
	if (p.skills.length > 0) {
		lines.push(`Load and follow the ${p.skills.map((s) => `\`${s}\``).join(", ")} skill${p.skills.length > 1 ? "s" : ""}.`);
	}
	lines.push("", "Standing mandates:");
	for (const m of p.mandates) lines.push(`- ${m}`);
	if (isVerifyOnly(name)) lines.push(`- ${VERIFY_ONLY}`);
	if (opts.rework) lines.push(`- ${CLASS_SEARCH_MANDATE}`);
	lines.push(
		"- End your report with exactly these sections: ## Result / ## Changes / ## Concerns / ## Questions.",
		"- Anything requiring writes outside your workdir goes in ## Concerns/## Questions — never work around the write fence.",
	);
	return lines.join("\n");
}

/**
 * Compose the final dispatch brief: profile preamble + the orchestrator's
 * per-dispatch brief body (objective, paths, constraints, criteria, findings).
 */
export function composeBrief(name: ProfileName, body: string, opts: { rework?: boolean } = {}): string {
	return `${profilePreamble(name, opts)}\n\n${body}`;
}
