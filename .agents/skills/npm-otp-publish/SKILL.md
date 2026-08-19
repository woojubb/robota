---
name: npm-otp-publish
description: Sub-orchestration for phase 3 of a release — the publish boundary. Sequences the strictly-ordered preflight (sync and already-published check, build, state-artifact readiness, publish preflight, registry auth, full dry-run), then the hard halt for the user's one-time password, then the single sanctioned publish command as the very next action, then post-publish verification. Every step must complete before the next; it routes on each outcome and never crosses the boundary early. Holds no publish policy. Dispatched by release-orchestration.
loop: over=attempt; bound=3 requests
---

# npm OTP Publish — pipeline only

Phase 3 of a release: everything inside the publish boundary. The ordering **is** the safety property
here — a one-time password has a short life, so anything that could fail must have already failed before
the user is asked for one. Every step must complete before the next runs.

This skill owns that ordering and its routing. Which publish command is permitted, which are forbidden,
what the boundary is, and what may cross it are invariants owned by
[publish.md](../../rules/publish.md) and are pointed at, never restated.

## Rule Anchor

- [publish.md](../../rules/publish.md) — "Publish Command" (the single allowed command and the forbidden
  list), "Publish Safety Gate", "OTP Protocol" (the prohibitions), "Publish Boundary", "Publish Scope
  Approval", "All packages must be published together", "Stop Conditions".
- [version-management](../version-management/SKILL.md) — dist-tag expectations after a publish.

## Preflight — ordered, each gate blocking

Run in this order. **Nothing below may be reordered, and no step may be skipped because it "usually
passes".** A failure at any preflight step routes as its row says; none of them proceeds toward the
password.

| #   | Gate                                                                                                           | On failure                                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Sync to the release target's latest remote head; confirm the target version is **not already fully published** | Already fully published → return `COMPLETE` with that finding (nothing to do). **Partially** published → go to **Partial publish** below. |
| 2   | Build passes, verified as the rule's Publish Safety Gate requires                                              | Dispatch `ci-failure-triager`, apply the minimal fix off this branch, then **repeat step 1** — a fix changes the SHA.                     |
| 3   | The release-run state artifact exists for this version and its publish-readiness fields are set                | Create or update it through the entry point the rule names, then repeat step 3.                                                           |
| 4   | The publish preflight check on the state artifact passes                                                       | **Fix it here.** Never advance while this is failing — the rule makes asking for a password past a failing preflight a violation.         |
| 5   | Registry authentication confirmed                                                                              | Tell the user to authenticate, **wait for their confirmation**, re-check, then repeat step 5. Do not run this as the flow's first step.   |
| 6   | Full, unfiltered dry-run passes                                                                                | Go to **Dry-run failure** below.                                                                                                          |

If any package in scope has never been published, the rule requires explicit user approval before it goes
out — obtain it during preflight, not after the password is in hand.

## The boundary — hard halt for the user

7. **STOP and ask the user for the one-time password.** Run no command while asking. This is a
   halt-for-user edge, not a wait: the pipeline has no way to produce this value itself, and the rule
   forbids asking the user to type it into an interactive prompt.

8. **On receiving it, the publish command is the very next action taken.** Not a status check, not a
   re-verify, not a `git` call — the password expires in seconds and any intervening command wastes it.
   Pass it explicitly to the single sanctioned command; the rule names both.

| Outcome                                 | Route                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| The user declines or does not answer    | Return `HALT`. Leave the state artifact showing the boundary as unreached.                 |
| Password rejected as expired or invalid | **Return to step 7** and request a fresh one. Bounded: at most **3** requests per release. |
| Anything ran between steps 7 and 8      | Discard the password, **return to step 7**, and request a fresh one.                       |

## Post-publish verification

9. Confirm every in-scope package is published at the target version and its dist-tags resolve as
   [version-management](../version-management/SKILL.md) requires. Registry propagation lags, so a
   mismatch seconds after publish is re-checked per package before it is treated as a failure.

| Outcome                             | Route                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------- |
| Every package at the target version | Return `COMPLETE`.                                                     |
| Some packages missing               | Go to **Partial publish**.                                             |
| Published but a dist-tag is wrong   | Re-run the tag sync, re-verify once, then return `COMPLETE` or `HALT`. |

## Partial publish

The publish script is idempotent: already-published packages are skipped, so recovery is **re-running the
same script**, never publishing a package by hand (a Publish Boundary prohibition).

1. Classify the interruption with `ci-failure-triager` before retrying (an expired password and a registry
   outage need different responses, and guessing wastes another password).
2. Return to **step 7** with a fresh password and re-run. Bounded by the same 3-request cap.
3. If packages are still missing after the cap, return `HALT` with the exact list of published and
   unpublished packages — a half-published version is a state the user must be told about explicitly.

## Dry-run failure

A dry-run that exits after printing only a filtered package list has not told you why. Re-run the full
unfiltered dry-run in the same permission context and read that output before concluding anything. Treat
registry/network/cache errors as environment failures until proven otherwise, and re-run outside a
restricted sandbox before classifying them as defects. Then:

| Classified as               | Route                                                                |
| --------------------------- | -------------------------------------------------------------------- |
| Environment                 | Repeat step 6 after re-running outside the restriction.              |
| A real defect               | Dispatch `ci-failure-triager`, fix off-branch, **return to step 1**. |
| Unresolved after 2 attempts | Return `HALT`.                                                       |

## Outcome contract

- `COMPLETE` — every in-scope package is published at the target version with verified dist-tags.
- `REGRESSED` — the release target changed under this phase; the caller returns to phase 1.
- `HALT` — a stop condition fired, a cap was exceeded, or the release is partially published. Name which,
  and list the exact package state.

This phase never returns `RETRY`: re-entering the publish boundary is always an explicit, bounded,
password-consuming decision, so the caller must see the reason rather than a silent re-run. Bounded:
**at most 3 OTP requests per release** — each consumes the user's attention and a password window,
and a publish that cannot complete in three is stopped and reported, not retried into. (This number
lived only in the orchestration map before HARNESS-072; the skill owns it now.)

## Record the run

Open a ledger entry before the first round, record each round's finding count, and close it with the
terminal reason it actually reached — `converged`, `no-progress`, `bound-reached`, `halted-for-user`, or
`abandoned` if it stopped without reaching any of them. A run that leaves no record cannot be told from a
run that never happened ([a loop run is recorded](../../rules/enforcement-architecture.md), which owns
what each terminal reason means).

```bash
node scripts/harness/loop-run.mjs open  --loop npm-otp-publish
node scripts/harness/loop-run.mjs round --loop npm-otp-publish --run <id> --findings <n>
node scripts/harness/loop-run.mjs close --loop npm-otp-publish --run <id> --terminal <reason>
```
