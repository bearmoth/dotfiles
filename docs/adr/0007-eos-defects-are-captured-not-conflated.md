# Engineering-OS defects are captured, not conflated

A defect in engineering-OS *itself* — a hook misfiring, a routine whose
instructions are ambiguous, a directory resolving to UNRESOLVED when it
shouldn't, a missing scaffold — is captured to a dedicated backlog rather than
lost. It flows through a two-tier loop that keeps it separate from two things it
is easily confused with: **knowledge**, and **planned work**.

- **Not knowledge.** An eos defect is a system fault, so it never routes through
  knowledge-routing or into a vault. Capture is `/eos-issue` (or a hook's own
  crash breadcrumb), writing a raw JSON sighting to the **inbox** at
  `~/.local/state/engineering-os/eos-issues.jsonl` — always writable from any
  cwd, offline, no context resolution required.
- **Not planned work.** The inbox is drained by the registry-maintenance
  `routines-audit` into `docs/eos-issues.md` (git-tracked next to the ADRs whose
  behaviour it critiques; not deployed). A sighting graduates to a wayfinder gh
  issue only **by hand**, when it becomes scheduled work. Raw sightings and
  scheduled tickets are different maturities; auto-promoting the former into the
  latter pollutes the backlog with un-triaged noise.

The pulse surfaces an un-drained inbox as a threshold-gated debt line (blocking
items immediately, the rest once aged), the same silent-unless-rotting rule as
`_inbox` and the de-spec queue.

## First-writer-creates

The motivating report (eos issue #3) was itself a depended-on resource that was
never initialised — a worklog month-shard the nudge assumed existed. To avoid
reproducing that class of bug, every resource this feature introduces obeys one
invariant: **the writer that first needs a resource bootstraps it; every reader
tolerates its absence as empty.** `eos-issue` and the hook breadcrumb `mkdir -p`
the state dir and create-append the inbox; the drain creates `docs/eos-issues.md`
if absent; `eos-resolve pulse` counts a missing inbox as zero. No component ever
assumes a peer initialised a resource. A hook that *discovers* such a gap can
itself drop a sighting — turning the #3 class into a self-reporting event.

## Considered options

- **Promote sightings straight to gh wayfinder issues.** Rejected: conflates a
  raw "I noticed something off" with "this is scheduled work," and forces a
  network/`gh` dependency into a capture path that must work offline from any
  cwd.
- **Route defects through a vault (e.g. Journal `_inbox`).** Rejected: conflates
  system faults with knowledge; the whole point is that they are *not* notes and
  must not pass through the routing/exposure machinery.
- **Inbox only, no digested backlog.** Rejected: a jsonl is fine to capture into
  and to drain, but not something to sit with, browse, or annotate — and the
  value of the backlog is that it lives in git beside the code it indicts.

## Consequences

- Capture is zero-friction and dependency-free; the only thing that ever touches
  git is the deliberate drain, so there is never a commit per sighting.
- Hooks stop swallowing their own crashes silently — the one defect a fail-open
  hook can honestly self-report now lands in the backlog.
- The distinction is enforced by construction: `/eos-issue` bypasses
  knowledge-routing, and nothing auto-files a gh issue.
