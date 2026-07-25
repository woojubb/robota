---
name: ci-gate-watch
description: Shared sub-orchestration for waiting on a long-running gate (a CI run, a dry-run, a publish) without spinning. Loops observe → report the current job and step → decide, escalating a gate that exceeds the expected behaviour for its current step to ci-failure-triager for the stall verdict, and terminating any watcher it started. It observes and routes only; it never decides why a check is red. Dispatched by any pipeline step that waits on a gate.
---

# CI Gate Watch — pipeline only

Every wait must have a reason. This skill is the loop that supplies one: it observes a pending gate,
reports what is actually happening inside it, and routes — rather than repeating "still pending" until
something changes.

It observes; it does not judge. "Is this stalled or just slow?" is a verdict, and verdicts belong to
`ci-failure-triager`.

## Rule Anchor

- [publish.md](../../rules/publish.md) — "Long-Running Gates" (the observation invariants and the
  watcher-cleanup mandate).

## Input

The gate to watch: the run or check name, the exact SHA or version it applies to, and the caller's
expectation of how long its current step normally takes. Without the expectation there is no way to
distinguish slow from stalled — ask for it rather than inventing a timeout.

## The loop

Track `observations = 0`.

1. **Observe.** Read the gate's current state: which job, which step, and how long that step has been
   running. Read the step — not merely the aggregate status, which cannot distinguish queued from stuck.
2. **Conclusive?** Green → return `GREEN`. Red → return `RED` (the caller dispatches triage; this skill
   does not).
3. **Report.** State whether the gate is queued, building, testing, publishing, or unchanging, **and**
   what the next decision will be. A report identical to the previous one, with no new step or decision,
   is not a report — if you have nothing new to say, you have nothing to add by waiting again yet.
4. **Within expectation?** If the current step is still inside its expected behaviour → wait, increment
   `observations`, and return to step 1.
5. **Beyond expectation** → dispatch `ci-failure-triager` on the gate for a stall verdict, and return
   `STALLED` with its class and triage note.
6. **Cap.** If `observations` exceeds 10 without the step changing, treat it as beyond expectation and
   take step 5, whatever the stated expectation was. A loop with no bound is a defect even when every
   individual wait was justified.

## Watcher cleanup (unconditional)

If this loop started any background watcher, terminate it before returning — on **every** exit edge,
including `RED`, `STALLED`, an exception, and a user interruption. The rule makes an uncleared watcher a
publish-blocking condition, so leaving one running does not merely litter: it stops a later gate.

## Outcome contract

- `GREEN` — the gate passed on the SHA/version it was asked about.
- `RED` — the gate failed. The caller dispatches triage; this skill supplies the evidence it observed.
- `STALLED` — the gate exceeded expectation and `ci-failure-triager` returned a class for the stall.

## What This Skill Does NOT Do

| Not this skill's job               | Owner                                   |
| ---------------------------------- | --------------------------------------- |
| Decide why a gate is red or stuck  | `ci-failure-triager` (agent)            |
| Fix anything, re-run, or push      | the caller's own routing                |
| Define how long a gate should take | the caller, from the gate's own history |
