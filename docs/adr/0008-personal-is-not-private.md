# Personal is not private: vault governance supersedes session taint

Vault safety was carried by a single per-vault fact, `exposure: org | private`, plus a session-taint hook (ADR-0005) that gated org-writes after any private read. That one word did three jobs at once — "Phil-only visibility", "contents are sensitive", and "org-context but DM-mirror-grade" — and the taint hook fired in the wrong direction. This ADR splits the overloaded axis into two orthogonal per-vault facts and makes governance **stateless read/write ACLs over context × privacy**; session taint is demoted to a transitional backstop, to be retired on data. (Supersedes the value vocabulary of [ADR-0002](0002-exposure-is-a-one-way-ratchet.md); amends the directionality of [ADR-0005](0005-session-taint-gates-org-writes.md). Wayfinder [#25](https://github.com/bearmoth/dotfiles/issues/25) retires the last vault that still needs the backstop.)

## The split

- **`exposure: org | personal`** — who may see the vault (rename: the old value `private` becomes `personal`).
- **`private: true | false`** — whether the contents are sensitive: material that must never flow outward without Phil's eyes.

They are independent. "Personal" is a visibility fact; "private" is a sensitivity fact. Tech Notes is personal-exposed yet **not** private — freely readable and writable — which the old single axis could not express.

| Vault | context | exposure | private |
|---|---|---|---|
| Engagement PKB | easygo | org | false |
| Easygo (roleless) | easygo | personal | true |
| Tech Notes | personal | personal | false |
| Journal | personal | personal | true |

## Governance rules (hook-enforced, PreToolUse)

1. **Reads.** A `private: true` vault is readable only from a session in that vault's own context. Cross-context reads are **hard-denied** (deny, not ask — Phil is never prompted), with a one-line reason telling the agent to ask Phil to paste in anything it needs. Non-private vaults: reads unrestricted from anywhere. (This amends ADR-0005's "reads stay unrestricted everywhere".)
2. **Writes.** Org-exposed vault writes are autonomous only from the vault's owning context; a cross-context org write is downgraded to `ask`. Writes *into* private vaults (write-down: worklogs, captures) are always permitted by this hook and never set taint. The diary prohibition (never agent-written) is a separate, unchanged rule.
3. **Code repos are not vaults.** The hook matches vault roots only; repo reads and writes — any repo, any direction, including cross-repo work from any context — are never gated. Previously an accident of implementation; now a stated guarantee.
4. **Worklog `log/` writes are plumbing-into-wiki.** They take the same ACL treatment as any other vault write; ADR/doc prose uses the "plumbing" vocabulary, mirroring the De-spec Queue's "transient plumbing" precedent.

## The three defects this fixes (evidenced 2026-07-28)

- **Directionality bug.** ADR-0005 defined taint as private material *entering* the session, but the hook set taint on any *touch* of a private path — including writes *into* the Journal. The end-of-session worklog routine (write worklog → wiki, write capture → Journal) therefore tripped the gate on nearly every session; every `taint_set` in the day's audit was this false positive. ADR-0005's "collisions are rare by construction" was empirically false, and the gate had likely never fired on its real threat scenario.
- **Illegible prompt.** The gate message was a static string naming ADR-0005 by number only — no tainting read, no write target, no approve/reject semantics. Logged as a blocking eos-issue.
- **Overloaded vocabulary.** `exposure: private` meant three different things across the Journal (truly sensitive), Tech Notes (merely Phil's), and the Easygo roleless vault (org-context but DM-mirror-grade sensitive).

## Taint: transitional backstop

Kept only while the Easygo roleless vault exists — the one remaining legitimate private-read-then-org-write path (wayfinder #25 migrates and retires that vault).

- Taint is set **only by an actual read from a `private: true` vault** (the allowed, same-context kind). Writes-down never taint; non-private reads never taint.
- **Bash directionality heuristic** (conservative-with-carve-outs): a command mentioning a private vault path taints *unless* every mention is recognisably a write destination — the path is the target of `>` / `>>` / `tee` / `cp` / `mv` into the vault. Ambiguous forms still taint (crude stays crude, in the safe direction).
- The taint marker records `{ts, tool, detail}` instead of being an empty file; old empty-format markers from live sessions read as "tainted, provenance unknown".
- The gate prompt is **self-sufficient**, built from state: the tainting read (vault/path at time), the write target, and what Approve/Reject each do.
- **Audit enrichment:** `taint_set` records the tainting path; `gate_trip` records the resolved target and a truncated command.

## Considered options

- **Mailbox/queue for gated writes** (queue a blocked write, drain at leisure) — a good fit, but parked as a pre-agreed follow-up, taken up **only if** the gate-trip counter stays non-trivial after this lands. With the directionality bug fixed, the counter is expected to fall to near-zero, so the mailbox may never be needed.
- **Per-claim provenance** — already rejected by ADR-0005 (agent nuance in the loop) and not revisited here.

## Consequences

- Governance is stateless: the deny/ask decision is a pure function of (session context, vault context, exposure, private, read/write), unit-testable without a live session. Session taint no longer participates in the common case.
- The end-of-session worklog routine runs with **zero** gate interaction — the acceptance test that the directionality bug is dead.
- Fail-open on hook error and the once-per-session crash breadcrumb are unchanged.
- **Retirement condition:** the Easygo vault migrated (#25) **and** zero gate trips over 30 consecutive days of audit ⇒ delete the taint machinery in a follow-up change. Data-triggered, per ADR-0005's own principle.
