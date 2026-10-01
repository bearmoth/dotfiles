# Research: catalogue-entry methodology for System One hook questions

Wayfinder ticket: [bearmoth/dotfiles#51](https://github.com/bearmoth/dotfiles/issues/51) (child of map issue #44).

Question: how do we write a catalogue entry — a named System One (TypeSafe/Jev-style)
question a CLI asks on behalf of a coding-agent hook — that can be trusted before it
ever gets to act? Covers atomic-question design, mandatory abstain options, state
budgeting, probability vs. confidence thresholding, version pinning, threshold
fitting, shadow-mode scoring, known failure modes, and the logging schema.

## Verdict

Trust comes from surviving shadow mode on real traffic, never from a prompt reading well.
Decompose every judgment into atomic questions; keep combining weights in code, not the
model ([composite-scoring](https://docs.typesafe.ai/patterns/composite-scoring)). Give every
Choice an explicit no-match option — deleting it doesn't make Jev abstain, it makes it
confidently wrong: 0% forced accuracy at 0.79 confidence vs. 95% correct abstention with the
option present ([KoBBQ audit](https://github.com/jujumilk3/jev-calibration-audit/blob/main/FINDINGS.md)).
Gate on `confidence`, sized to stakes, not on raw probability
([Confidence](https://docs.typesafe.ai/confidence)). Pin the exact model id and log the id
that actually answered — an alias can move under you ([Models](https://docs.typesafe.ai/models)).
Fit thresholds only past ~100 shadow labels, and re-fit on traffic-mix shift: one certified
threshold missed its target by 3x once the mix changed
([jev-certify](https://github.com/nikkoxgonzales/jev-certify/blob/main/results/REPORT.md)).
A confident classifier is not automatically a good sort key
([jev-orderby-bench](https://github.com/yodablocks/jev-orderby-bench)). Every rule below is
backed by someone measuring the failure it guards against — see Sources.

## Checklist

### 1. Decompose before you write a single question

- [ ] State the judgment the hook actually needs as one sentence. If that sentence
      has an "and" or hides a sub-decision, it is not one question yet.
- [ ] Split a composite judgment into independent atomic Choice/Score/Noul questions,
      one property each — e.g. don't ask "is this spam?" as one Noul, ask
      `requests_credentials`, `offers_unexpected_reward`, `creates_time_pressure`,
      `sender_identity_mismatch` as four, and combine in code
      ([how-to-build-with-system-one](https://docs.typesafe.ai/concepts/how-to-build-with-system-one)).
      "Broad questions hide several judgments behind one answer. Atomic questions
      expose those judgments so you can inspect, tune, and combine them in code"
      (same source).
- [ ] Normalize each sub-answer (Score → `score / max_level`) and combine with
      explicit weights **in the catalogue entry's code**, not folded back into the
      model — this is what makes the combination inspectable and re-tunable
      ([composite-scoring](https://docs.typesafe.ai/patterns/composite-scoring)).
- [ ] For a verifier/gate question (e.g. the destructive-command noul), frame it so
      the escalate/deny case is `true`, with explicit criteria for both arms. A Noul
      where `true` maps to "safe" underperforms one where `true` maps to "stop" —
      Jev "might get confused" when instructions and criteria pull in different
      directions
      ([jev-1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13#contradictory-instructions-and-criteria)).
      The same convention ("bad = TRUE, with explicit criteria") is what makes the
      SDE-cascade verifier battery legible
      ([SDE cascade, Appendix A](https://docs.typesafe.ai/cookbooks/sde_cascade)).
- [ ] Aggregate a battery of per-field/per-signal Noul flags with `max` ("any flag
      fires"), not `mean` — a mean lets one confident red flag get averaged into
      silence (same source). This is the right default for a destructive-command
      gate backed by more than one check.
- [ ] Put everything the hook might need in one request (speculative fan-out);
      additional questions cost tokens but barely affect latency, and code is free
      to ignore the ones that turn out irrelevant
      ([Speculative fan-out](https://docs.typesafe.ai/patterns/fan-out)).

### 2. Make abstention mandatory, and word it correctly

- [ ] Every Choice with a fixed option set gets an `other` / `none of the above` /
      "doesn't match" option whenever the input might not fit any listed option —
      "so the model can say none of the others fit"
      ([Choice primitive](https://docs.typesafe.ai/primitives/choice)).
- [ ] Do not treat this as boilerplate. An independent KoBBQ audit on jev-1.13.0
      found that with the abstain option (`"알 수 없음"` / "unknown") present, the
      model abstained correctly on 95.0% of genuinely unanswerable items (3.0%
      picked the dataset's stereotype, ECE 0.023 — on the measurement's own noise
      floor). **Delete that one option** and, on the identical items, accuracy is
      necessarily 0%, the model picks the stereotype 79.0% of the time, and it
      reports 0.793 mean confidence while doing it — "it never signals the problem
      by spreading probability mass"
      ([jev-calibration-audit FINDINGS.md §1](https://github.com/jujumilk3/jev-calibration-audit/blob/main/FINDINGS.md)).
      For a catalogue entry this means: an entry with no no-match option is not
      merely incomplete, it is actively unsafe on exactly the inputs where safety
      matters most.
- [ ] Word the abstain option as a real criterion with its own description (not a
      bare label) — the same convention as every other option
      ([Choice primitive](https://docs.typesafe.ai/primitives/choice)).
- [ ] Do not assume structural identities across question shapes hold. A `Noul` and
      the semantically equivalent two-option `Choice` are different questions to
      the model: complementary probabilities summed to 1.018 on average but ranged
      0.71–1.42 across 400 items, and 16.3% of items differed by more than 0.2
      between the Noul and the Choice framing of the same judgment
      ([jev-calibration-audit FINDINGS.md §3](https://github.com/jujumilk3/jev-calibration-audit/blob/main/FINDINGS.md)).
      A threshold fit on one phrasing does not transfer to the other — this is
      also TypeSafe's own documented position
      ([jev-1.13 jaggedness, "Common-sense structural invariants"](https://docs.typesafe.ai/model-jaggedness/jev-1.13#common-sense-structural-invariants)).

### 3. Budget the state deliberately

- [ ] State is "the material you would present to a panel of experts before asking
      them to make a judgment" — put only what the question needs in it; keep
      content and questions separate ([State](https://docs.typesafe.ai/concepts/state)).
- [ ] Use structured JSON with named fields over a flat string whenever the hook has
      more than one related fact to pass (ticket + policy + order, not one
      paragraph); point a question at a specific nested path with a backticked
      reference when that removes ambiguity
      ([how-to-build-with-system-one](https://docs.typesafe.ai/concepts/how-to-build-with-system-one)).
- [ ] Filter before you send. Accuracy falls as state grows with content unrelated
      to the decision — "unrelated detail acts as a distractor" — and large,
      irrelevant context also makes it harder to diagnose a wrong answer
      ([jev-1.13 jaggedness, "Large state full of irrelevant detail"](https://docs.typesafe.ai/model-jaggedness/jev-1.13#large-state-full-of-irrelevant-detail)).
      For a hook question this means: the prompt text, the catalogue excerpt(s),
      and repo signals belong in state only if the question actually reads them —
      don't pass the whole diff when three file paths and a line count decide it.
- [ ] Respect the hard limit: 64k tokens for `state` + all questions combined, 32k
      for `state` + the single longest question, on `jev-1.13`
      ([Models](https://docs.typesafe.ai/models)).
- [ ] Order effects on the hosted model are a non-issue in practice: an independent
      test found reversing a two-option Choice's option order changed the
      probability by a mean of 0.005 and flipped the argmax 0 times out of 400 —
      "the opposite of the generative-LLM result"
      ([jev-calibration-audit FINDINGS.md §4](https://github.com/jujumilk3/jev-calibration-audit/blob/main/FINDINGS.md)).
      UNVERIFIED / scope note: this is specific to TypeSafe's hosted `jev-1.13.0`.
      If a catalogue entry is ever served by a self-hosted logit-reading decision
      head instead (e.g. the AnyJev pattern), order bias is real and the mitigation
      is cyclic-shift marginalization, not something to assume away
      ([AnyJev, `docs/levels.md`](https://github.com/nokia-applied-research/AnyJev/blob/main/docs/levels.md)).
- [ ] Questions in the same call don't interfere with each other, including under an
      adversarial bundle: paired against the same item asked alone, a 16-question
      bundle (10 filler + 5 hostile) shifted mean confidence by 0.008 and flipped
      the answer on 0.4% of items, at 14ms extra latency
      ([jev-calibration-audit FINDINGS.md §5](https://github.com/jujumilk3/jev-calibration-audit/blob/main/FINDINGS.md)).
      This licenses speculative fan-out for catalogue entries that bundle several
      questions per hook call.

### 4. Probability vs. confidence, and the coverage-at-risk metric

- [ ] Read `probabilities` (the full distribution) and `confidence` (a single 0–1
      summary of how peaked that distribution is) as different things. Confidence
      is derived from probabilities, not the other way round, and is not provided
      for Noul answers ([Confidence](https://docs.typesafe.ai/confidence)).
- [ ] Never gate on a single global confidence number. Threshold per action, scaled
      to the cost of being wrong: a read-only action can act at a low floor, a
      destructive or high-stakes one needs a high floor, with a genuinely-unsure
      floor (e.g. 0.5–0.6) below which the entry always defers regardless of which
      option won
      ([Confidence-gated routing](https://docs.typesafe.ai/patterns/confidence-routing)).
- [ ] When confidence is low, consider answering **one level up** instead of
      abstaining outright, if your option set has a hierarchy. Classifying SEC
      filings into 75 industry groups at a 0.9 confidence cutoff: the confident
      half (30/60 filings) was right 90% of the time; forced down to a broader
      division, the unsure half went from 40% right to 70% right, with the whole
      pipeline still at one request per document
      ([Classification using confidence](https://docs.typesafe.ai/cookbooks/classification_using_confidence)).
      For a model-tier or skill-choice entry, "one level up" might mean a
      coarser/safer tier rather than a specific pick.
- [ ] **Coverage at ≤5% risk** ("`cov@5%`" in AnyJev's bench columns): order shadow
      answers by confidence descending, and find the largest prefix (coverage)
      whose error rate on that prefix (risk) is ≤5%. Higher coverage at the same
      risk bound is better
      ([AnyJev, `docs/levels.md`](https://github.com/nokia-applied-research/AnyJev/blob/main/docs/levels.md)).
      To compute it from a shadow log: sort logged calls by `confidence` desc,
      walk the prefix accumulating `wrong/seen`, stop at the last point where
      `wrong/seen ≤ 0.05`; coverage is `seen / total`.
  - [ ] The rigorous version of the same idea is a certified bound, not just an
        empirical ratio: conformal risk control fit on 460 calibration queries
        picked a confidence threshold (0.831) certifying ≤4.99% expected
        misrouted traffic per incoming query; on 400 held-out queries that
        threshold auto-routed 84.75% of traffic at a measured 2.25% loss per
        query — the certificate held
        ([jev-certify REPORT.md §1](https://github.com/nikkoxgonzales/jev-certify/blob/main/results/REPORT.md)).
  - [ ] A tighter risk target is not always attainable at a given sample size — at
        n=460, a 1% target was infeasible; the floor is set by `1/(n+1)` and by
        how many calibration items already sit at probability 1.0 with a wrong
        label behind them (same source, §1 and §4b). An entry whose shadow log
        has fewer labels than this floor allows should not promote to a strict
        risk target yet.
- [ ] Do not use Score-answer probabilities/expectations to reconstruct an exact
      number between two levels — Score levels are not numerically calibrated for
      interpolation, only for thresholding
      ([jev-1.13 jaggedness, "Math using score"](https://docs.typesafe.ai/model-jaggedness/jev-1.13#math-and-numbers)).

### 5. Version pinning

- [ ] Every entry's gating thresholds are tuned against a specific versioned model
      id (e.g. `jev-1.13.0`), never against `jev-latest`/`jev-preview` — those
      aliases "move when a new release ships, so the answers behind them can
      change without a change on your side"
      ([Models](https://docs.typesafe.ai/models)).
- [ ] Log the response's own `model` field on every call — it reports the exact
      versioned id that actually answered, independent of which alias was
      requested (same source). This is the ground truth for "which version
      produced this row," not the request.
- [ ] Treat a version bump as a re-validation trigger, not a silent upgrade: hold
      the entry in shadow mode against the new id until its own shadow log clears
      the same label-count and coverage-at-risk bar the old version cleared.
      TypeSafe's own jaggedness notes are versioned the same way ("Applies to
      `jev-1.13`. Last reviewed 2026-09-17";
      [jev-1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13)) —
      a new model version can fix or introduce exactly these failure modes.
  - [ ] UNVERIFIED / design parallel: AnyJev's L1/L2 calibration artifacts are
        keyed by `(model, question hash)` and `load_artifact` refuses to load an
        artifact fit on a different model or a different option layout
        ([AnyJev, `docs/levels.md`](https://github.com/nokia-applied-research/AnyJev/blob/main/docs/levels.md)).
        The catalogue does not use AnyJev, but the same hard-fail-on-mismatch
        discipline is worth adopting for threshold artifacts keyed to
        `(model id, entry id)`.

### 6. Threshold fitting

- [ ] Minimum label counts before fitting anything: treat **under ~100 labels per
      question as pre-threshold** — shadow-log, don't gate. AnyJev's own
      temperature-scaling calibration (L1) is fit on 100–500 labeled examples per
      question, and its closed-form head (L2) wants "at least `max(8, 2K)` labels
      and in practice 100–300"
      ([AnyJev, `docs/levels.md`](https://github.com/nokia-applied-research/AnyJev/blob/main/docs/levels.md)).
      jev-certify's conformal procedure used 460 calibration / 400 evaluation
      queries — well above that floor — and still hit a resolution floor on its
      tightest risk target
      ([jev-certify REPORT.md §1](https://github.com/nikkoxgonzales/jev-certify/blob/main/results/REPORT.md)).
- [ ] Procedure: split shadow-logged, labeled calls into a calibration set and a
      held-out evaluation set; fit the threshold (confidence cutoff, or a
      conformal-risk-control threshold if you want a certified bound) on
      calibration only; report coverage and risk on the held-out set, not the
      calibration set (same source, throughout).
- [ ] Population shift breaks a fitted threshold silently. The exact same
      threshold and certificate, re-scored on traffic whose out-of-scope share
      rose from 13.04% to 42.86%, missed its target by 3.3–7× depending on the
      target; re-scoring on a traffic mix matched back to the calibration mix
      mostly restored the bound
      ([jev-certify REPORT.md §3](https://github.com/nikkoxgonzales/jev-certify/blob/main/results/REPORT.md)).
      "Prevalence is a first-class input to a per-query certificate, not a
      detail" (same source). Practical rule: monitor the mix the entry actually
      sees (e.g. the share of "no-match" fires, or of a given intent), and
      re-fit when it drifts materially from the calibration mix — don't wait for
      a calendar date.
  - [ ] A second, sharper failure: a threshold calibrated on a narrow taxonomy
        (e.g. 20 of 150 possible intents) has, by construction, never seen the
        traffic it should reject — its scope gate cannot be calibrated at all for
        the unlisted cases, and measured loss on that unlisted-intent traffic hit
        100% ([jev-certify REPORT.md §6](https://github.com/nikkoxgonzales/jev-certify/blob/main/results/REPORT.md)).
        For the catalogue's model-tier/skill-choice entries (fixed allow-lists),
        this means the calibration sample must include negative/out-of-list cases,
        not just in-list ones.
- [ ] Re-fit triggers, in order of urgency: (a) model version bump (§5), (b)
      measured traffic-mix drift beyond what the calibration set represents, (c)
      a new catalogue option added or removed from an entry's allow-list, (d) a
      scheduled periodic recheck as a backstop for drift nobody is watching for.

### 7. Shadow-mode scoring and the go/no-go

- [ ] Log every shadow answer against the implicit outcome signal (the tuple the
      orchestrator actually chose; a hand-invoked skill counts as a miss) without
      acting on the entry's own answer.
- [ ] Track, at minimum: **agreement** (answer matches the outcome signal),
      **coverage at ≤5% risk** (§4), and **cost delta** against the status quo
      path (e.g. "always ask the bigger model," "always ask a human"). An
      insurance-claims rubric and a moderation rubric both show this pattern
      concretely: TypeSafe repeated its own plurality answer 90.8% of the time
      across 15 resamples of one Choice rubric, rising to 99.2% agreement once
      answers below 0.60 top probability were routed to an `uncertain` bucket
      instead of forced — at the cost of only auto-deciding 74.2% of items
      ([Self-consistency: choices](https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook)).
      That agreement-vs-coverage trade is the same shape as the coverage-at-risk
      metric in §4 and should be reported the same way.
- [ ] Cost delta is concrete and should be logged in real units, not estimated once
      and forgotten: jev-certify's own cost table shows $0.1455/1k queries at the
      certified 5%-risk threshold vs. $4.20/1k for "always escalate to an LLM" —
      a ~29x delta at that specific threshold, and the delta narrows or reverses
      at looser/tighter thresholds, which is exactly why it has to be measured
      per threshold rather than assumed
      ([jev-certify REPORT.md §7](https://github.com/nikkoxgonzales/jev-certify/blob/main/results/REPORT.md)).
- [ ] How long to run shadow mode before deciding: long enough to clear the
      label-count floor in §6 (≈100+ labeled calls per question, more for a
      certified bound) **and** to observe at least one full cycle of whatever
      drives mix shift for that entry (e.g. a week of mixed repo activity,
      not one afternoon of one task type).
- [ ] Go/no-go per entry, concretely: promote out of shadow only if (1) the
      labeled shadow log clears the §6 floor, (2) coverage at ≤5% risk (or a
      certified equivalent) meets a bar set in advance per the action's stakes
      (§4), (3) the measured cost delta is favorable versus the current default
      path, and (4) no population-shift red flag is currently open (§6). Any one
      failing is a no-go; log the reason against the entry, not just the number.

### 8. Known failure modes to design against

- [ ] **Ordering ≠ classification.** A question that classifies well is not
      automatically a good sort/rank key. `jev-1.13.0` passed all six
      pre-registered ranking gates on 360 human-labeled, easy topic-membership
      rows, but failed four of six on 306 human-graded, hard shopping-relevance
      pairs (Score ordinal inversion 0.254 against a 4-level human grade; choice
      confidence ECE 0.279)
      ([jev-orderby-bench](https://github.com/yodablocks/jev-orderby-bench)). The
      same study found the request shape itself changes the answer: the identical
      rows, batched 40-per-request instead of one-per-request, flipped a passing
      ranking gate into a failing one, and two-decimal probability output left 53
      of 360 rows tied at 0.99, so `ORDER BY ... LIMIT k` cuts inside a tie (same
      source). If a catalogue entry is ever used to rank (not just pick) — e.g.
      ranking candidate skills instead of picking one — treat that as a
      separate, separately-validated claim from "this entry classifies well,"
      and keep it to one request per ranked item until measured otherwise.
- [ ] **Adversarial / authority framing.** State is data; Jev does not treat it as
      hostile by default, and adversarially-framed content can move the answer
      ([jev-1.13 jaggedness, "Adversarial content"](https://docs.typesafe.ai/model-jaggedness/jev-1.13#adversarial-content)).
      A 111-case approval-gate study found exactly this in practice: both Jev and
      a structured-output LLM baseline made one "unsafe allow" each, and
      "conditional-and-hedged" (authority that was never actually given) and
      "injection-resistance" (instructions embedded in quoted content) were
      explicit case families that both providers only partly handled —
      "[c]ontract and policy mapping was the largest single source of wrong
      decisions for both," and the authors' conclusion is to "[e]scalate
      consequential tool families with deterministic policy even when a semantic
      answer seems confident"
      ([agent-action-gate-v1](https://github.com/ghubnab99/jev-enterprise-decision-fabric/blob/main/docs/evaluations/agent-action-gate-v1.md)).
      For a destructive-command noul, this means: deterministic policy
      (allow-list / deny-list patterns in code) still gates the truly irreversible
      actions, with the noul as an additional signal, not the sole gate.
- [ ] **Cascade cost blow-ups.** A verifier-gated cascade (cheap extractor → Jev
      verifier → escalate to a reasoning model) only pays off if the gate is
      cheap, independent, and aggregated with `max` rather than averaged into
      silence; the published 100-prompt frontier shows the cascade sitting
      "up-and-left of every single model" only when the gate threshold is swept
      and chosen deliberately, not left at a default
      ([SDE cascade](https://docs.typesafe.ai/cookbooks/sde_cascade)). jev-certify's
      cost table shows the same shape from the other side: pushing the
      confidence threshold toward 0.999 ("saturated," not certified) costs more
      per 1k queries than the certified 5%-risk threshold while auto-routing
      *less* traffic — tightening a threshold past its certified point can raise
      cost without buying safety
      ([jev-certify REPORT.md §7](https://github.com/nikkoxgonzales/jev-certify/blob/main/results/REPORT.md)).
      Catalogue rule: any entry that can escalate to a bigger/more expensive
      model or a human needs its escalation rate logged and charted against cost
      from day one of shadow mode, not added later.
- [ ] **Context-pruning information loss.** Filtering state to reduce "large state
      full of irrelevant detail" (§3) is correct, but over-pruning removes
      evidence the question needs. TypeSafe's own mitigation is to score
      relevance explicitly (a Noul per candidate passage) rather than guess what
      to keep, and route only passages that clear it
      ([Classifying RAG passages](https://docs.typesafe.ai/cookbooks/classifying_rag_passages), referenced from
      [jev-1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13#large-state-full-of-irrelevant-detail)).
      For a repo-signal-heavy entry (e.g. model-tier choice over a diff), prefer
      "ask a cheap relevance Noul per candidate signal, then include only what
      passed" over a hand-tuned truncation heuristic.

## Worked example: model-tier choice over an allow-list

Entry: `model_tier_choice` — a `Choice` over an allow-list `{haiku, sonnet, opus}`,
asked once per task hand-off, in shadow mode, scored against the tier the orchestrator
actually used.

**1. Decompose first (checklist §1).** Don't ask one Choice "which model should
handle this?" cold. Ask narrower, atomic signals in the same call and combine with
weights in code, mirroring the composite-scoring pattern
([composite-scoring](https://docs.typesafe.ai/patterns/composite-scoring)):

```json
{
  "state": {
    "task_description": "Refactor the retry/backoff logic in src/client.py",
    "repo_signals": {
      "changed_files": ["src/client.py"],
      "diff_lines": 42,
      "touches_security_sensitive_paths": false,
      "touches_release_config": false
    },
    "catalogue_excerpt": "model_tier_choice: pick a tier for a bounded coding task from an allow-list {haiku, sonnet, opus}. See docs/research/catalogue-methodology.md."
  },
  "questions": {
    "estimated_difficulty": {
      "type": "score",
      "instructions": "How much reasoning depth does this task require, based on task_description and repo_signals?",
      "criteria": [
        "Mechanical: rename, formatting, single obvious fix",
        "Local: one function/file, clear constraints",
        "Cross-cutting: several files or an ambiguous design choice",
        "High-stakes or deeply ambiguous: wide blast radius or unclear intent"
      ]
    },
    "high_risk_signal": {
      "type": "noul",
      "instructions": "Does repo_signals indicate this touches security-sensitive or release-config paths?"
    },
    "tier": {
      "type": "choice",
      "instructions": "Which model tier from the allow-list best fits this task, given task_description and repo_signals?",
      "criteria": {
        "haiku": "Mechanical or narrowly scoped change with low ambiguity",
        "sonnet": "Typical feature or bugfix work needing real but bounded reasoning",
        "opus": "Cross-cutting, high-stakes, or deeply ambiguous work",
        "no_match": "None of the above fits this task well; defer to a human or a default tier"
      }
    }
  }
}
```

Note the mandatory `no_match` option on `tier` (checklist §2) — without it, an
off-distribution task (e.g. a one-line doc fix wrapped in unusually alarming
language) gets forced into a tier rather than flagged, which is exactly the KoBBQ
failure mode.

**2. Gate on confidence, scaled to stakes (checklist §4).** Because picking too
small a tier is more costly to silently get wrong than picking too large a tier
(a wrong `haiku` pick risks a bad diff; a wrong `opus` pick only costs money), the
entry's code applies asymmetric thresholds, the same pattern as the voice-banking
example in [confidence-gated routing](https://docs.typesafe.ai/patterns/confidence-routing):

```python
tier = response.answers["tier"]
difficulty = response.answers["estimated_difficulty"]
high_risk = response.answers["high_risk_signal"]

if tier.confidence < 0.5 or tier.choice == "no_match":
    log_shadow(entry="model_tier_choice", action="deferred_low_confidence")
    # shadow mode: do not act; orchestrator's own choice is still the outcome signal
elif high_risk.noul > 0.6 and tier.choice != "opus":
    log_shadow(entry="model_tier_choice", action="would_override_to_opus")
elif tier.choice == "haiku" and tier.confidence < 0.85:
    log_shadow(entry="model_tier_choice", action="would_bump_to_sonnet")
else:
    log_shadow(entry="model_tier_choice", action=f"would_use_{tier.choice}")
```

**3. Log the full call (checklist §9/logging schema below), including the
responding model id** (checklist §5) — never the alias — and compare
`action` against the orchestrator's actual tier choice after the fact to compute
agreement, coverage at ≤5% risk, and cost delta (checklist §4, §7).

**4. Promote only on evidence (checklist §6, §7).** This entry does not gate
anything live until: its shadow log has ≥100 labeled calls per distinct allow-list
member (so `haiku`/`sonnet`/`opus`/`no_match` each clear the label floor, not just
the total); coverage at ≤5% risk meets a bar set before looking at the data (e.g.
"≥70% of calls auto-decided at ≤5% disagreement with the orchestrator, measured on
a held-out slice"); the cost delta against "orchestrator always decides manually" is
positive; and no population-shift flag is open (e.g. a sudden surge of
security-sensitive tasks that weren't represented in calibration).

## Logging schema

One JSON object per call, written to the shadow log. Fields follow the pattern used
by the independent studies' own raw JSONL records
(e.g. [jev-calibration-audit's `results/raw/*.jsonl`](https://github.com/jujumilk3/jev-calibration-audit),
[jev-certify's per-call journal](https://github.com/nikkoxgonzales/jev-certify),
[agent-action-gate-v1's `evals/runs/*.jsonl`](https://github.com/ghubnab99/jev-enterprise-decision-fabric)):

| Field | Type | Notes |
|---|---|---|
| `entry_name` | string | Catalogue entry id, e.g. `model_tier_choice`. |
| `entry_version` | string | Catalogue-side version of the question/criteria text, independent of model version — bump when wording changes (§2, §5). |
| `pinned_model` | string | The versioned model id the entry was configured to call, e.g. `jev-1.13.0` — never an alias (§5). |
| `responding_model` | string | The `model` field from the actual response. Must equal `pinned_model`; mismatch is a hard error, not a warning (§5). |
| `call_id` | string | Unique id for this call, for joining to the eventual outcome signal. |
| `timestamp` | ISO 8601 | Call time. |
| `state_class` | string | Category of state sent (e.g. `repo_signals_only`, `repo_signals+catalogue_excerpt`) — lets you audit state budgeting (§3) after the fact. |
| `state_token_estimate` | int | Approximate token count of `state` + questions, to watch the 64k/32k ceiling (§3). |
| `context` | object | Freeform: repo, branch, hook name, orchestrator session id — whatever is needed to reconstruct "what was happening" without re-sending the full state. |
| `questions_asked` | array[string] | Question ids included in this call (supports the speculative-fan-out pattern, §1/§3). |
| `answers` | object | Per-question: `type`, `choice`/`score`/`noul`, `probabilities` (Choice/Score), `confidence` (Choice/Score only; absent for Noul) — raw, unprocessed (§4). |
| `derived_action` | string | What the entry's code *would have done* in shadow mode (e.g. `would_use_sonnet`, `deferred_low_confidence`) — this is the thing scored against the outcome signal, not the raw answer. |
| `latency_ms` | number | Round-trip latency for this call. |
| `backend_health` | string/object | Rate-limit status, retry count, any `429`/`5xx` seen — lets you separate a bad threshold from a bad day for the API (§7). |
| `outcome_signal` | object or null | The implicit signal once it arrives: the tuple the orchestrator actually chose, or `"manual_skill_invocation"` for a hand-invoked miss. Null until it arrives. |
| `outcome_arrived_at` | ISO 8601 or null | When `outcome_signal` was filled in — outcome often arrives after the call, so this is logged separately from `timestamp`. |
| `label_source` | string or null | How `outcome_signal` was obtained (`orchestrator_choice`, `human_override`, `manual_skill_invocation`, `post_hoc_review`) — needed to separate calibration-quality labels from noisy ones. |

Derived, not logged directly, but computed from the above for the go/no-go (§7):
agreement rate, coverage at ≤5% risk (§4), cost delta, and population-mix drift
(share of `no_match`/`deferred_low_confidence` over time, compared to the
calibration-period baseline, §6).

## Sources

**TypeSafe docs** (docs.typesafe.ai; fetched 2026-10-01 via each page's `.md`
suffix, discovered from https://docs.typesafe.ai/llms.txt):
- [Introduction / Jev with coding agents](https://docs.typesafe.ai/introduction/coding-agents)
- [State](https://docs.typesafe.ai/concepts/state)
- [Primitives (Choice)](https://docs.typesafe.ai/primitives/choice)
- [Primitives (Noul)](https://docs.typesafe.ai/primitives/noul)
- [Confidence](https://docs.typesafe.ai/confidence)
- [How to build with TypeSafe](https://docs.typesafe.ai/concepts/how-to-build-with-system-one)
- [Patterns: confidence-gated routing](https://docs.typesafe.ai/patterns/confidence-routing)
- [Patterns: composite scoring](https://docs.typesafe.ai/patterns/composite-scoring)
- [Patterns: intent routing](https://docs.typesafe.ai/patterns/intent-routing)
- [Patterns: speculative fan-out](https://docs.typesafe.ai/patterns/fan-out)
- [Cookbook: SDE cascade](https://docs.typesafe.ai/cookbooks/sde_cascade)
- [Cookbook: Classification using confidence](https://docs.typesafe.ai/cookbooks/classification_using_confidence)
- [Cookbook: Self-consistency (nouls)](https://docs.typesafe.ai/cookbooks/consistency_noul_cookbook)
- [Cookbook: Self-consistency (choices)](https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook)
- [Cookbook: Classifying RAG passages](https://docs.typesafe.ai/cookbooks/classifying_rag_passages) (referenced, not fetched in full)
- [Models](https://docs.typesafe.ai/models)
- [Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13)

**AnyJev** (github.com/nokia-applied-research/AnyJev, `main` @ 2026-10-01):
- [README](https://github.com/nokia-applied-research/AnyJev)
- [docs/levels.md](https://github.com/nokia-applied-research/AnyJev/blob/main/docs/levels.md)
- [docs/results_bench.md](https://github.com/nokia-applied-research/AnyJev/blob/main/docs/results_bench.md)

**Independent studies** (via [awesome-typesafe-jev](https://github.com/AbdelStark/awesome-typesafe-jev), `main` @ 2026-10-01):
- [jev-calibration-audit / FINDINGS.md](https://github.com/jujumilk3/jev-calibration-audit/blob/main/FINDINGS.md) — the KoBBQ abstention audit.
- [jev-certify / results/REPORT.md](https://github.com/nikkoxgonzales/jev-certify/blob/main/results/REPORT.md) — conformal risk control / "coverage at ≤5% risk" methodology and numbers.
- [jev-orderby-bench README](https://github.com/yodablocks/jev-orderby-bench) — the ordering study.
- [jev-enterprise-decision-fabric / docs/evaluations/agent-action-gate-v1.md](https://github.com/ghubnab99/jev-enterprise-decision-fabric/blob/main/docs/evaluations/agent-action-gate-v1.md) — the action-gate study.
- [JevBench README](https://github.com/fstandhartinger/jevbench) — composite scoring across model comparisons; cited for the composite-score convention and its own documented limits (sealed items still exposed to evaluated services, some cost/latency figures estimated).
- [awesome-typesafe-jev README](https://github.com/AbdelStark/awesome-typesafe-jev) — curation and summary table used to locate the above and cross-check claims.

All independent-study numbers above are from single runs on `jev-1.13.0` on the
dates stated in each source; treat them as directional for catalogue design, not as
guarantees that transfer unchanged to a different model version or a different
task's data, per each study's own stated limitations.
