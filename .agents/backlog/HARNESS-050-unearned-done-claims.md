---
id: HARNESS-050
title: Nothing detects a done claim written before the work — placeholders, forward references, verdicts that never happened
status: todo
priority: high
type: INFRA
created: 2026-07-26
---

## Problem

An item can be marked complete on evidence that does not exist, and no scan in the suite notices.

Measured 2026-07-26 on `INFRA-055` while its own implementation was still in flight. The item carried:

- `status: done`, `completed: 2026-07-26`
- **both Acceptance boxes ticked**, including "proven by a deliberately-broken promotion branch being
  blocked"
- a `### Proof: a deliberately-broken promotion is BLOCKED` section whose entire body was
  _"See Proof below (filled in from the live runs)"_ — a forward reference to a section that does not
  exist
- the sentence _"the second pass came back **ENDORSE**"_, written **before** the reviewer ruled (it
  subsequently returned `REVISE` with four blockers)
- _"Also set `strict_required_status_checks_policy: true`"_ — the live ruleset still read `false`, and
  neither claimed required-context addition had been applied

None of it was caught mechanically. It was caught because an independent reviewer happened to check
the live repository state against the document.

## Why the existing guards miss it

`check-done-evidence.mjs` (HARNESS-002) re-validates that **file paths referenced from
`.agents/backlog/completed/*.md` still resolve**. That guards evidence _decay_ — a real artifact that
later vanished. It does not guard evidence that was **never there**, and it does not look at items
still in the backlog root.

`scan-capability-reachability.mjs` (HARNESS-030) forces a declared capability to carry agent-run
evidence — the closest existing guard, and it is opt-in via frontmatter keys.

So the harness fences the "declared-then-dodge" shape for capabilities, and leaves it wide open for
everything else.

## Why it matters more than it looks

The completion record is what every later decision reads. A `done` item is not re-verified; it is
_believed_. This exact failure is the one the repo's own memory names as the recurring-mistake
principle: a recurring mistake is not closed by fixing the instance, it is closed by installing a
mechanical prevention. And it happened **inside the item whose entire subject was a green signal that
asserted nothing** — the same blind spot one level up.

It is also not a one-agent problem. Any actor writing a completion record before finishing the work
produces this, and the document reads identically either way.

## Direction — what is actually mechanically checkable

Not everything is. A fabricated prose claim ("I ran it and it passed") cannot be detected by a
scanner. Several of the observed tells can:

1. **Unfilled placeholders in a completed item.** Phrases of the shape "filled in from", "see below",
   "TBD", "to be added", "(pending)" inside a section of an item marked `status: done`.
2. **Forward references that do not resolve.** "See X below" where no heading `X` follows.
3. **A ticked acceptance box whose evidence section is empty** — the box says "proven by …" and the
   named section has no body.
4. **A claimed reviewer verdict with no recorded verdict line.** `backlog-execution.md` already
   requires the `REVIEW VERDICT` be recorded; assert the recorded line exists and matches the prose.
5. **A claimed live-configuration change.** Harder, and the highest value: the item claimed a ruleset
   setting that was never applied. Where a document asserts a concrete external state (`X is true`),
   there may be room for a `<!-- verified-live: <command> -->` annotation the scan re-runs, in the
   spirit of HARNESS-030's opt-in evidence keys.

Start with 1–4, which are pure text analysis over the item and cost nothing. Treat 5 as a separate
decision — it is the one that would have caught the worst instance here, and it needs a design.

**The scan must be red-first against this very case**: reconstruct `INFRA-055`'s document as it stood
and require the scan to flag it, then require the corrected document to pass. A guard that does not
fire on the incident that motivated it is the defect this repo has now hit twice in one day (see the
`scan-main-required-checks.mjs` probes, where a guard built for a measured defect did not detect that
defect's recurrence).

## Acceptance

- [ ] A scan, registered in `run-all-scans`, that fails on tells 1–4.
- [ ] Proven RED against the reconstructed `INFRA-055` document and GREEN against its corrected form.
- [ ] A deliberate decision on tell 5, recorded either way.
- [ ] No false positive across the existing `.agents/backlog/completed/` corpus — run it over every
      completed item and report the count.

## References

- `INFRA-055` and its `proposal-reviewer` REVISE (Blocker D)
- `scripts/harness/check-done-evidence.mjs` (HARNESS-002), `scan-capability-reachability.mjs`
  (HARNESS-030)
- `.agents/rules/backlog-execution.md` — the done gate and the `REVIEW VERDICT` recording requirement
