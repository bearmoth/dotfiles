/**
 * Per-step {model, effort} tuple configuration and resolution
 * (ORCHESTRATE-V2-SPEC.md "Model and effort configuration").
 *
 * Every configuration value is a tuple — effort is never inherited across a
 * model swap. Two distinct routing concepts keep degradation loud:
 *
 * - fallback:          tried only when the selected model is UNAVAILABLE;
 *                      exhausted chain → stop and ask the user.
 * - downgradeAllowed:  models the orchestrator may EXPLICITLY choose for
 *                      trivial work; always surfaced in plan/report/UI.
 *
 * Unavailability is not a quality signal and never authorizes a downgrade.
 * Availability is read from the pi model registry (models-store.json),
 * injectable for tests.
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
	fallback?: ModelTuple[];
	downgradeAllowed?: ModelTuple[];
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
		fallback: [{ model: "claude-opus-5", effort: "xhigh" }],
		downgradeAllowed: [LUNA_MAX], // trivial diffs only; explicit choice
	},
	diagnose: { default: LUNA_MAX },
};

export type TupleSource = "default" | "fallback" | "downgrade" | "override";

export type ResolveResult =
	| { ok: true; model: string; effort: string; source: TupleSource; defaultTuple: ModelTuple }
	| { ok: false; error: string };

export interface ResolveOptions {
	/** Is this model currently available? Default: registry lookup. */
	isAvailable?: (model: string) => boolean;
	/** Explicit user-approved model override (requires overrideEffort). */
	overrideModel?: string;
	overrideEffort?: string;
	/** Explicit orchestrator downgrade for trivial work (from downgradeAllowed). */
	downgrade?: boolean;
}

/** Resolve the tuple for a step per the v2 routing rules. */
export function resolveTuple(step: StepName, opts: ResolveOptions = {}): ResolveResult {
	const def = STEP_CONFIG[step];
	if (!def) return { ok: false, error: `Unknown step "${step}". Steps: ${Object.keys(STEP_CONFIG).join(", ")}.` };
	const available = opts.isAvailable ?? registryAvailability();
	const defaultTuple = def.default;

	if (opts.overrideModel) {
		if (!opts.overrideEffort) {
			return { ok: false, error: `Model override "${opts.overrideModel}" requires its own effort — effort is never inherited across a model swap.` };
		}
		if (!available(opts.overrideModel)) {
			return { ok: false, error: `Override model "${opts.overrideModel}" is unavailable. Stop and ask the user.` };
		}
		return { ok: true, model: opts.overrideModel, effort: opts.overrideEffort, source: "override", defaultTuple };
	}

	if (opts.downgrade) {
		const list = def.downgradeAllowed ?? [];
		const pick = list.find((t) => available(t.model));
		if (!pick) {
			return { ok: false, error: `Step "${step}" has no available downgrade_allowed tuple; downgrade is not permitted here. Use the default tuple or ask the user.` };
		}
		return { ok: true, model: pick.model, effort: pick.effort, source: "downgrade", defaultTuple };
	}

	if (available(defaultTuple.model)) {
		return { ok: true, model: defaultTuple.model, effort: defaultTuple.effort, source: "default", defaultTuple };
	}
	for (const t of def.fallback ?? []) {
		if (available(t.model)) return { ok: true, model: t.model, effort: t.effort, source: "fallback", defaultTuple };
	}
	return {
		ok: false,
		error: `Model for step "${step}" is unavailable (${[defaultTuple, ...(def.fallback ?? [])].map((t) => t.model).join(", ")} all unavailable). Stop and ask the user — never degrade further or invent another model.`,
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
