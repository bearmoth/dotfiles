/**
 * DispatchLog: in-memory record of every dispatch this session, feeding the
 * dispatch UI surfaces (widget strip, sidebar, detail pane — see FUTURES.md
 * "Dispatch log groundwork").
 *
 * Written by dispatch.ts (start/update/settle), rebuilt from session entries
 * on session_start (resume-safe; no state file to own). Async-ready shape:
 * each record has a stable id (the toolCallId), role, workdir, status, and
 * timing — parallel workers and workstream grouping slot in without rework.
 */

import type { DispatchResult, DispatchRouting } from "./dispatch.ts";
import { PROFILES, type ProfileName } from "./profiles.ts";

export type DispatchStatus = "running" | "ok" | "error" | "timeout" | "killed";

export interface DispatchRecord {
	id: string; // toolCallId
	role: string;
	title: string;
	workdir: string;
	status: DispatchStatus;
	startedAt: number; // epoch ms
	durationMs?: number; // settled only
	turns?: number;
	tokens?: number;
	cost?: number;
	finalMessage?: string | null;
	/** Latest assistant text while running (per-turn stream; not the final report). */
	progressText?: string;
	sessionFile?: string;
	/** Resolved model routing (v2 observability): model, effort, source, defaults. */
	routing?: DispatchRouting;
	/** Dispatch profile (v2): resolves role + step tuple + template. */
	profile?: string;
	/** Artifact files saved via save_artifact (ADR 0008). */
	artifacts?: string[];
}

type Listener = () => void;

const records = new Map<string, DispatchRecord>();
const listeners = new Set<Listener>();

function emit(): void {
	for (const l of listeners) l();
}

/** Subscribe to log changes; returns an unsubscribe function. */
export function onDispatchLogChange(listener: Listener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** All records, oldest first. */
export function getDispatchRecords(): DispatchRecord[] {
	return [...records.values()].sort((a, b) => a.startedAt - b.startedAt);
}

export function getDispatchRecord(id: string): DispatchRecord | undefined {
	return records.get(id);
}

export function logDispatchStart(id: string, role: string, title: string, workdir: string, routing?: DispatchRouting, profile?: string): void {
	records.set(id, { id, role, title, workdir, status: "running", startedAt: Date.now(), routing, profile });
	emit();
}

export function logDispatchProgress(id: string, turns: number, progressText?: string): void {
	const r = records.get(id);
	if (!r) return;
	r.turns = turns;
	if (progressText !== undefined) r.progressText = progressText;
	emit();
}

export function logDispatchSettle(id: string, result: DispatchResult): void {
	const r = records.get(id);
	if (!r) return;
	r.status = result.status;
	r.durationMs = result.durationMs;
	r.finalMessage = result.finalMessage;
	r.sessionFile = result.sessionFile;
	if (result.routing) r.routing = result.routing;
	if (result.profile) r.profile = result.profile;
	if (result.artifacts) r.artifacts = result.artifacts;
	if (result.usage) {
		r.turns = result.usage.turns;
		r.tokens = result.usage.tokens;
		r.cost = result.usage.cost;
	}
	emit();
}

/**
 * Rebuild the log from session entries (resume/compaction safe). Only settled
 * dispatches exist in history; a dispatch running at crash time reappears as
 * its recorded result entry or not at all.
 */
export function rebuildDispatchLog(entries: Iterable<unknown>): void {
	records.clear();
	// Tool *calls* carry role/title/workdir; tool *results* carry the outcome.
	const calls = new Map<string, { role: string; title: string; workdir: string; profile?: string; ts: number }>();
	let order = 0;
	for (const entry of entries) {
		const e = entry as {
			type?: string;
			message?: {
				role?: string;
				content?: unknown;
				toolName?: string;
				toolCallId?: string;
				input?: { role?: string; title?: string; brief?: string; workdir?: string; profile?: string };
				details?: DispatchResult;
				isError?: boolean;
			};
		};
		if (e.type !== "message" || !e.message) continue;
		const m = e.message;
		order++;
		if (m.role === "assistant" && Array.isArray(m.content)) {
			for (const part of m.content as Array<{ type?: string; id?: string; name?: string; arguments?: { role?: string; title?: string; brief?: string; workdir?: string; profile?: string } }>) {
				if (part.type === "toolCall" && part.name === "dispatch_task" && part.id) {
					const a = part.arguments ?? {};
					calls.set(part.id, {
						role: a.role ?? (a.profile ? (PROFILES[a.profile as ProfileName]?.role ?? "?") : "?"),
						title: a.title || (a.brief ?? "").split("\n").find((l) => l.trim())?.replace(/^[#*\s]+/, "").trim().slice(0, 60) || "(untitled)",
						workdir: a.workdir ?? "",
						profile: a.profile,
						ts: order,
					});
				}
			}
		}
		if (m.role === "toolResult" && m.toolName === "dispatch_task" && m.toolCallId) {
			const call = calls.get(m.toolCallId);
			const d = m.details;
			if (!call || !d || typeof d.status !== "string") continue;
			records.set(m.toolCallId, {
				id: m.toolCallId,
				role: call.role,
				title: call.title,
				workdir: call.workdir,
				status: d.status,
				startedAt: call.ts, // ordering key only; wall time is not in history
				durationMs: d.durationMs,
				finalMessage: d.finalMessage,
				sessionFile: d.sessionFile,
				routing: d.routing,
				profile: d.profile ?? call.profile,
				artifacts: d.artifacts,
				turns: d.usage?.turns,
				tokens: d.usage?.tokens,
				cost: d.usage?.cost,
			});
		}
	}
	emit();
}
