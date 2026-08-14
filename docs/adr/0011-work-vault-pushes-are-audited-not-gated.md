# ADR-0011: Work-vault pushes are audited, not gated

**Status:** accepted 2026-08-14 (decided in-session with Phil; supersedes the
confirm/ack behaviour of the #29 push gate)

## Context

The pilot (#17) produced consistent evidence that human gates on org-vault
egress charge rent without catching anything:

- The push gate's tty heuristic misclassified human pushes as agent-driven
  and hard-blocked them (eos-issue `eos-push-gate/tty-detection`).
- Its confirm step never vetoed real content: every summary shown during the
  pilot was approved unchanged.
- The `personal/` directory and three-tier sensitivity classification inside
  the Engagement PKB caused repeated policy trips (agent ACL ambiguity,
  harness classifier denials) while protecting material that the routing
  rules already keep out of the org vault.

The deeper cause: the org vault was allowed to *contain* sensitive material
(machine-local `raw/` mirrors, `personal/`), so egress had to be judged. That
judgment point is expensive, error-prone, and — because `raw/` and
`personal/` were gitignored — never actually exercised by a push.

## Decision

1. **An org vault carries only org-visible content, by construction.**
   Admission control happens at the source boundary (public channels,
   org-public Confluence/Jira/PagerDuty). First-person and private material
   routes to the personal Journal per the existing context × role rules. The
   three-tier classification and the org vault's `personal/` tree are
   retired (its contents drained to the Journal, 2026-08-14).
2. **Push gates downgrade from confirm to audit.** `eos-push-gate` prints
   the outbound summary (commits, files, outside-`wiki/` and large-add
   flags), appends a `push_audit` event to the eos audit log, and lets the
   push proceed unconditionally. No tty detection, no `EOS_PUSH_ACK`.
3. **The exposure ratchet (ADR-0002) survives as a routing rule only**:
   personal/private material never *lands* in an org vault. Enforcement is
   at write-routing time, not at push time.

## Consequences

- Agents are auditable rather than permission-slipped: the review surface is
  `git log`, the printed summary, and the audit log — consulted when wanted,
  not demanded on every action.
- A mechanical secret-scan (e.g. gitleaks) may later be added to the audit
  step; it must stay deterministic and non-interactive.
- Anything genuinely sensitive found in an org vault is an incident to fix
  at the admission boundary, not a case for reinstating push confirms.
- The `weekly-ingest` classification decision tree simplifies: sources are
  either admissible to the org vault or they are not; "stage privately in
  the org vault" is no longer a category.
