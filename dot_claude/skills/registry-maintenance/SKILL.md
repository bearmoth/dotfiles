---
name: registry-maintenance
description: Edit the engineering-OS registry (add/change contexts, vaults, ownership patterns, machine mounts, spans) or run a routines-audit (writes per routine, triage debt, offer acceptance, gate trips). Use when a directory resolves to UNRESOLVED, when onboarding a machine or workplace context, when a vault is added/drained, or when the user asks for a routines audit.
---

# Registry maintenance

Two layers, one rendered artifact (wayfinder #9). Never edit
`~/.config/engineering-os/registry.{yaml,json}` directly — edit a source
layer, then `chezmoi apply` re-renders both; verify with `eos-resolve`.

| Layer | File | Holds |
|---|---|---|
| Shared | `.chezmoidata/contexts.yaml` in `bearmoth/dotfiles` | context names, ownership patterns, vault defs (name/repo/exposure/role), spans |
| Machine | `~/.config/chezmoi/chezmoi.yaml` → `data.eos` | mounts (role → vault path, roleless paths, roots), clone root, worktree root |

Schema notes: roles are only `wiki`/`journal`, one vault per (context, role);
`exposure` is `org`/`private` per vault (the registry's one sensitivity
fact); a workplace context carries `span: {start, end}` (era — default
subject for dated journal notes); `roleless:` vaults are visible but never
routing destinations. Repos are **never enumerated** — a repo joins a context
via its org's ownership pattern (per-repo exceptions only where a repo breaks
its org's pattern). Worktrees are never registry data.

Common edits:

- **UNRESOLVED directory** → add an ownership pattern (shared) if it has a
  remote, else a machine root (path rule) or explicit exception. Prefer
  patterns over exceptions.
- **New workplace context** → add a context block with span + ownership +
  vault defs (shared) and mounts on the machines that carry it. Zero policy
  edits — routing rules key on roles.
- **New machine** → write `data.eos` in its local chezmoi config; the shared
  layer needs nothing. A privacy-conscious context may live entirely in
  machine-local data (same schema, never committed).
- **Vault drained/retired** → remove from shared layer (roleless during the
  drain, gone when drained).

## Mode: routines-audit

On-demand deep report backing the pilot's exit criteria (#14/#17); the
SessionStart pulse is its one-line summary. Report, per routine:

1. **Worklog coverage** — entries in each context wiki `log/YYYY-MM.md` over
   the audit window (count + dates present) vs `stop_nudge` events.
2. **Session-capture coverage** — files in Journal `captures/sessions/` over
   the window.
3. **Triage debt** — `eos-resolve pulse --json`: `_inbox` count +
   oldest-age; de-spec queue count + oldest-age; ingestion staleness.
4. **Gate trips & guardrail blocks** — from
   `~/.local/state/engineering-os/audit.jsonl` (`gate_trip`,
   `guardrail_block`, `taint_set`, `stop_nudge` events): counts, and
   whether any gate trip looks like a false positive (flag for ADR-0005's
   evidence-based revisit).
5. **Offer acceptance** — best-effort: ADRs/reflections/de-spec queue
   entries created in the window vs offers visible in recent session
   captures.

Present as a short table + one-line verdict per pilot criterion. Never
"fix" debt inside the audit — draining is knowledge-routing's job, on
request.
