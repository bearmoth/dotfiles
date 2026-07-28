# Personal ≠ private: vault read/write governance supersedes session taint

Status: approved by Phil 2026-07-28 (brainstorming session, chezmoi cwd).
Destination: `docs/superpowers/specs/2026-07-28-personal-not-private-taint-redesign-design.md` — the implementing session commits this file there, verbatim, as its first commit.

## Problem

Three defects converged (all evidenced 2026-07-28, see eos-issues backlog + `~/.local/state/engineering-os/audit.jsonl`):

1. **Directionality bug.** ADR-0005 defines taint as private material *entering* the session, but `eos-taint-gate.py` sets taint on any *touch* of a private vault path — including writes *into* the Journal. The end-of-session worklog routine (write personal worklog → Journal, then easygo worklog → Engagement PKB) therefore trips the gate at the end of nearly every easygo session. Every `taint_set` in the 2026-07-28 audit is this false positive; ADR-0005's "collisions are rare by construction" is empirically false, and the gate has likely never fired on its real threat scenario.
2. **Illegible prompt.** The gate's message is a static string: names ADR-0005 by number only, omits the tainting read, the write target, and what approve/reject actually do. Logged as a blocking eos-issue.
3. **Overloaded vocabulary.** `exposure: private` currently means three different things across the Journal (truly sensitive), Tech Notes (merely Phil's), and the Easygo roleless vault (org-context but DM-mirror-grade sensitive).

## Decision (ADR-0008: "Personal is not private")

Split the overloaded axis into two orthogonal per-vault facts:

- **`exposure: org | personal`** — who can see the vault (rename: value `private` → `personal`).
- **`private: true | false`** — whether contents are sensitive: material that must never flow outward without Phil's eyes.

| Vault | exposure | private |
|---|---|---|
| Engagement PKB | org | false |
| Easygo (roleless) | personal | true |
| Tech Notes | personal | false |
| Journal | personal | true |

Governance becomes **stateless read/write ACLs over context × privacy**; session taint is demoted to a transitional backstop and retired on data.

## Governance rules (hook-enforced, PreToolUse)

1. **Reads.** A `private: true` vault is readable only from a session in that vault's own context. Cross-context reads are **hard-denied** (deny, not ask — Phil is never prompted) with a one-line reason instructing the agent to ask Phil to paste in anything needed. Non-private vaults: reads unrestricted from anywhere. (This amends ADR-0005's "reads stay unrestricted everywhere".)
2. **Writes.** Org-exposed vault writes are autonomous only from the vault's owning context. A cross-context org write → `ask`. Writes *into* private vaults (write-down: worklog, captures) are always permitted by this hook and never set taint — the diary prohibition (never agent-written) is a separate existing rule and is unchanged.
3. **Code repos are not vaults.** The hook matches vault roots only; repo reads/writes (any repo, any direction, including cross-repo work from any context) are never gated. Previously an accident of implementation; now a stated guarantee in ADR-0008.
4. **Worklog `log/` writes are plumbing-into-wiki** (routing-audit decision, 2026-07-28): same ACL treatment as any vault write, but ADR/doc prose must use the plumbing vocabulary, mirroring the De-spec Queue's "transient plumbing" precedent.

## Taint: transitional backstop

Kept only while the Easygo roleless vault exists (the one remaining legitimate private-read-then-org-write path — wayfinder issue #25 migrates and retires that vault).

- Taint is set **only by an actual read from a `private: true` vault** (the allowed, same-context kind). Writes-down never taint. Non-private reads never taint.
- **Bash directionality heuristic** (conservative-with-carve-outs): a command mentioning a private vault path taints *unless* every mention is recognizably a write destination — the path is the target of `>` / `>>` / `tee` / `cp` / `mv` into the vault. Ambiguous forms still taint (crude stays crude, in the safe direction).
- The taint marker stops being an empty file: it records `{ts, tool, path-or-command-snippet}`. Old empty-format markers from live sessions are read as "tainted, provenance unknown".
- **Gate prompt becomes self-sufficient**, built from state. Template (adjust wording freely, keep all four elements):
  > Taint gate (ADR-0005/0008, docs/adr/): this session read private material — **{vault}/{relpath} at {time}** — so this write to org-visible **{target vault}/{relpath}** needs your review. **Approve** = this one command runs exactly as shown. **Reject** = it's blocked; the agent re-derives the content from org-visible sources and continues.
- **Audit enrichment:** `taint_set` records the tainting path; `gate_trip` records resolved target and truncated command (today Bash trips log `paths: []`).
- **Retirement condition (record in ADR-0008):** Easygo vault migrated (#25) AND zero gate trips over 30 consecutive days of audit → delete the taint machinery in a follow-up change. Data-triggered, per ADR-0005's own principle.

## Implementation surface

- **Registry schema:** `.chezmoidata/contexts.yaml` (chezmoi source of truth) gains `private:` per vault; `exposure` values renamed. Rendered `registry.yaml` + `registry.json` follow. Edits go through the **registry-maintenance** skill flow.
- **Resolver:** `eos-resolve vaults --json` must emit both fields (find its source in this repo; it is chezmoi-managed).
- **Hook:** `dot_claude/hooks/executable_eos-taint-gate.py` — extract decision logic into pure functions (see Testing). Fail-open philosophy and the crash-breadcrumb-to-eos-issues behavior are unchanged.
- **Registry readers must keep working** (explicit requirement): SessionStart pulse (`executable_eos-session-start.py`), Stop hook (`executable_eos-stop.py`), git guardrail, knowledge-routing skill docs — sweep for `exposure` / `private` literals.
- **Docs:** new `docs/adr/0008-personal-is-not-private.md` (records the split, the governance matrix, the repos-never-gated guarantee, the taint retirement condition, and the audit evidence); short amendment notes in ADR-0002 and ADR-0005 pointing forward (do not rewrite history); update `CONTEXT.md` glossary and `dot_claude/CLAUDE.md` where they say "exposure"/"private-exposure".

## Non-regressions

- Pulse compatibility: "worklog <context>" freshness and log-derived ingest entries keep working through the rename.
- The Stop hook must continue to **not** pre-create month shards in possibly-org vaults (deliberate, see eos-issues backlog entry #3 context).
- Fail-open on hook error, once-per-session crash breadcrumb: unchanged.
- End-of-session worklog routine must run with **zero** gate interaction (this is the acceptance test that the directionality bug is dead).

## Testing

- pytest at repo root (`tests/` — not under `dot_claude/`, so chezmoi never deploys it): deny matrix (context × vault × read/write), taint directionality including every Bash carve-out and ambiguous forms, prompt content (all four elements present, real paths), registry parsing with and without the new field, old-format taint marker handling.
- Scenario replays from the 2026-07-28 audit: (a) worklog routine end-to-end → no taint, no gate; (b) easygo session reads Journal → deny; (c) easygo session reads Easygo vault then writes PKB → gate fires with self-sufficient prompt.

## Out of scope (explicitly)

- Mailbox/queue for gated writes (approach C) — pre-agreed follow-up **only if** the gate-trip counter stays non-trivial after this lands.
- Easygo vault content migration itself — wayfinder #25.
- Personal digest routine design, CONTEXT.md worklog-definition amendment, Tech Notes CLAUDE.md `log/` documentation — routing-audit handover deliverables, separate work.
