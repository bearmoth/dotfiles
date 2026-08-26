/**
 * Per-step {model, effort} tuple configuration and resolution
 * (ORCHESTRATE-V2-SPEC.md "Model and effort configuration").
 *
 * Every configuration value is a tuple — effort is never inherited across a
 * model swap. Each step has a single default plus an ordered allow-list of
 * sanctioned alternative tuples serving two roles:
 *
 * - fallback:     when the default is UNAVAILABLE the list is walked in
 *                 order; exhausted → stop and ask the user.
 * - alternative:  the orchestrator may EXPLICITLY pick any allowed tuple
 *                 (up- or downgrade) for the work at hand; always surfaced
 *                 in plan/report/UI with a reason.
 *
 * A {model, effort} pair outside the list is an override and requires user
 * approval. Availability is read from the pi model registry
 * (models-store.json), injectable for tests.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface ModelTuple {
	model: string;
	effort: string; // pi thinking level: off|minimal|low|medium|high|xhigh|max
}

export interface StepDef {
	default: ModelTuple;
	/** Ordered allow-list: availability fallback chain AND the sanctioned alternatives the orchestrator may pick explicitly. */
	allowed?: ModelTuple[];
}

export type StepName = "research" | "plan" | "plan-critique" | "implement" | "verify-run" | "review" | "diagnose";

const LUNA_MAX: ModelTuple = { model: "gpt-5.6-luna", effort: "max" };

/** Working defaults per the v2 spec — strategy 1 (strong-model-plans + cheap-critique). */
export const STEP_CONFIG: Record<StepName, StepDef> = {
	research: { default: LUNA_MAX },
	plan: { default: { model: "claude-opus-5", effort: "xhigh" } },
	"plan-critique": { default: LUNA_MAX },
	implement: { default: LUNA_MAX },
	"verify-run": { default: LUNA_MAX },
	review: {
		default: { model: "claude-fable-5", effort: "xhigh" },
		// Fallback order on unavailability; also the alternatives the
		// orchestrator may pick explicitly (luna/max for trivial diffs).
		allowed: [{ model: "claude-opus-5", effort: "xhigh" }, LUNA_MAX],
	},
	diagnose: { default: LUNA_MAX },
};

export type TupleSource = "default" | "fallback" | "alternative" | "override";

/**
 * Planning strategies (spec "Planning strategy"; A/B-able, recorded in the
 * workstream manifest). Strategy 2 swaps the plan and plan-critique tuples;
 * everything else is identical.
 */
export const PLANNING_STRATEGIES = [
	{ id: "strong-plans-cheap-critique", summary: "Strategy 1: strong-model plans + cheap critique (plan: claude-opus-5/xhigh)" },
	{ id: "cheap-plans-strong-critique", summary: "Strategy 2: cheap plans flagging help areas + strong critique (critique: claude-opus-5/xhigh)" },
] as const;
export type PlanningStrategy = (typeof PLANNING_STRATEGIES)[number]["id"];

/** The step table under a strategy; unknown/unset strategy = strategy 1. */
export function stepConfigFor(strategy?: string): Record<StepName, StepDef> {
	if (strategy !== "cheap-plans-strong-critique") return STEP_CONFIG;
	return { ...STEP_CONFIG, plan: STEP_CONFIG["plan-critique"], "plan-critique": STEP_CONFIG.plan };
}

export type ResolveResult =
	| { ok: true; model: string; effort: string; source: TupleSource; defaultTuple: ModelTuple }
	| { ok: false; error: string };

export interface ResolveOptions {
	/** Is this model currently available? Default: registry lookup. */
	isAvailable?: (model: string) => boolean;
	/**
	 * Explicit {model, effort} choice (requires overrideEffort). If the tuple
	 * is in the step's allow-list it resolves as a sanctioned "alternative";
	 * otherwise it is an "override" and must be user-approved.
	 */
	overrideModel?: string;
	overrideEffort?: string;
	/** Recorded workstream planning strategy; swaps plan/plan-critique tuples under strategy 2. */
	strategy?: string;
}

/** Resolve the tuple for a step per the v2 routing rules. */
export function resolveTuple(step: StepName, opts: ResolveOptions = {}): ResolveResult {
	const def = stepConfigFor(opts.strategy)[step];
	if (!def) return { ok: false, error: `Unknown step "${step}". Steps: ${Object.keys(STEP_CONFIG).join(", ")}.` };
	const available = opts.isAvailable ?? registryAvailability();
	const defaultTuple = def.default;

	if (opts.overrideModel) {
		if (!opts.overrideEffort) {
			return { ok: false, error: `Model override "${opts.overrideModel}" requires its own effort — effort is never inherited across a model swap.` };
		}
		if (!available(opts.overrideModel)) {
			return { ok: false, error: `Model "${opts.overrideModel}" is unavailable. Stop and ask the user.` };
		}
		// Same tuple as the default → not a deviation at all.
		if (opts.overrideModel === defaultTuple.model && opts.overrideEffort === defaultTuple.effort) {
			return { ok: true, model: defaultTuple.model, effort: defaultTuple.effort, source: "default", defaultTuple };
		}
		// In the allow-list → sanctioned alternative (orchestrator judgment,
		// surfaced but not requiring user approval).
		const sanctioned = (def.allowed ?? []).some((t) => t.model === opts.overrideModel && t.effort === opts.overrideEffort);
		return { ok: true, model: opts.overrideModel, effort: opts.overrideEffort, source: sanctioned ? "alternative" : "override", defaultTuple };
	}

	if (available(defaultTuple.model)) {
		return { ok: true, model: defaultTuple.model, effort: defaultTuple.effort, source: "default", defaultTuple };
	}
	for (const t of def.allowed ?? []) {
		if (available(t.model)) return { ok: true, model: t.model, effort: t.effort, source: "fallback", defaultTuple };
	}
	return {
		ok: false,
		error: `Model for step "${step}" is unavailable (${[defaultTuple, ...(def.allowed ?? [])].map((t) => t.model).join(", ")} all unavailable). Stop and ask the user — never degrade further or invent another model.`,
	};
}

/**
 * Availability from pi's model registry (~/.pi/agent/models-store.json).
 * Matches bare ids and provider/id forms. Unreadable registry → assume
 * available (the worker spawn will surface a real failure loudly).
 */
export function registryAvailability(storePath?: string): (model: string) => boolean {
	let ids: Set<string> | undefined;
	try {
		const file = storePath ?? path.join(os.homedir(), ".pi", "agent", "models-store.json");
		const store = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, { models?: Array<{ id?: string }> }>;
		ids = new Set<string>();
		for (const [provider, entry] of Object.entries(store)) {
			for (const m of entry?.models ?? []) {
				if (m?.id) {
					ids.add(m.id);
					ids.add(`${provider}/${m.id}`);
				}
			}
		}
	} catch {
		ids = undefined;
	}
	return (model: string) => {
		if (!ids || ids.size === 0) return true; // fail open: spawn surfaces real errors
		if (ids.has(model)) return true;
		// provider-prefixed query against bare ids
		const slash = model.lastIndexOf("/");
		return slash !== -1 && ids.has(model.slice(slash + 1));
	};
}
