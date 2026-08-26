/**
 * Tool registration for save_artifact (ADR 0008). Kept separate from the
 * pure core (save-artifact.ts) so the core stays dependency-free and
 * node --test-able; see dispatch-helpers.ts for the same pattern.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { saveArtifactFile } from "./save-artifact.ts";

const SaveArtifactParams = Type.Object({
	name: Type.String({
		description: "Flat lower-case markdown filename (e.g. plan.md, findings.md). No directories — the artifact directory is fixed per dispatch.",
	}),
	content: Type.String({ description: "Full markdown content of the artifact." }),
});

export interface SaveArtifactHooks {
	isModeLocked: () => boolean;
}

/** Register the tool. Inert unless mode-locked worker + PI_ARTIFACT_DIR. */
export function registerSaveArtifactTool(pi: ExtensionAPI, hooks: SaveArtifactHooks): void {
	pi.registerTool({
		name: "save_artifact",
		label: "Save artifact",
		description: [
			"Persist a durable workstream artifact (plan, research note, critique findings) as markdown.",
			"The file is written into this dispatch's own workstream artifact directory — you never choose the path, only the filename and content.",
			"Exclusive-create: an existing name is never overwritten; nothing is edited in place.",
			"After saving, list every saved artifact path with one-line consumption instructions under '## Artifacts' in your report.",
			"Only available to dispatched workers with an active workstream; otherwise every call errors.",
		].join(" "),
		parameters: SaveArtifactParams,
		async execute(_toolCallId, params) {
			const res = saveArtifactFile(
				{ artifactDir: process.env.PI_ARTIFACT_DIR, modeLocked: hooks.isModeLocked() },
				params.name,
				params.content,
			);
			if (!res.ok) return { content: [{ type: "text", text: res.error }], isError: true };
			return {
				content: [
					{ type: "text", text: `Saved ${res.path}. List it under '## Artifacts' in your report with a one-line consumption instruction.` },
				],
				details: { path: res.path },
			};
		},
	});
}
