---
title: 'HARNESS-099: a skill that is not wired is not invoked, and wiring that is not verified is not wiring — today the same role performs the wiring and declares it done, and nothing asks whether the registration check would have gone red had it not been wired'
status: done
created: 2026-08-16
completed: 2026-08-16
priority: high
urgency: now
area: .agents/skills, .claude/agents, scripts/harness
depends_on: []
---

# HARNESS-099: split wiring into worker, guardian, orchestrator

Converted from [issue #1763](https://github.com/woojubb/robota/issues/1763) (owner directives,
2026-08-16 session), items **4 / 5 / 6**.

## Problem

`enforcement-architecture.md:21` is unambiguous: _"A skill/agent that both produces and judges, or
that judges and also routes, violates this rule. Split it."_ Wiring is currently exempt from it in
practice — the same role registers a skill in the index, adds the AGENTS.md routing row, connects it
to its dispatching pipeline, and then declares it wired.

`lesson-to-harness` step 6 already says "no partial wiring", and step 8 requires a mechanism. Neither
asks the question that actually matters.

## Direction — three roles, per the owner directive

| Role                    | Does                                                                                                           | Does not    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- | ----------- |
| **wiring worker**       | Performs the wiring: index registration, AGENTS.md routing, connection to the dispatching pipeline             | Judge       |
| **wiring guardian**     | Judges whether it is wired **and whether the registration check would actually have gone red had it not been** | Fix         |
| **wiring orchestrator** | Thin: sequences worker → guardian, routes on the verdict                                                       | Hold policy |

**The guardian's second half is the whole point, and the directive says why:** _"Without that second
half we would be installing an unfalsifiable check in the wiring-verification slot, which is defect
#3 one layer up."_ A guardian that only confirms "the name appears in the index" is exactly the shape
HARNESS-098 exists to eliminate. This item and HARNESS-098 constrain each other and should be
designed with that in mind, though neither blocks the other.

## Prior art in the repo — build from it, do not re-derive

The worker/guardian/orchestrator split is already implemented several times, and the shapes are worth
matching rather than reinventing:

- `architecture-refresh`, `documentation-refresh` — orchestrators that hold no policy and route on a
  guardian's verdict.
- `backlog-gate-guard`, the worktree gates — guardians that judge one thing and emit `GATE VERDICT`.
- `check-agent-def-convention.mjs` already asserts registration (`.agents/skills/index.md`
  reference) mechanically, so the guardian has a mechanism to lean on for half its job — the half it
  does **not** have is the falsifiability check.

## Mechanism (required — see `lesson-to-harness` step 8)

The registration half exists. What must be added is evidence that the check is falsifiable: a fixture
in which an unwired artifact makes the registration check go **red**, asserted in the harness's own
tests, so the guardian's verdict rests on something checkable rather than on its own reading.

**Infeasible-now is permitted only with a written concrete obstacle plus a tracked item.**

## Test Plan

- Prove-it-fails (step 9): construct an unwired fixture artifact and confirm the registration check
  FAILS on it; wire it and confirm it PASSES. That pair IS the guardian's second half, mechanized.
- Assert the three roles' tool scopes match their responsibilities — the guardian read-only, the
  worker without judgement authority, the orchestrator holding no policy — via
  `check-agent-def-convention.mjs`, which already enforces read-only tool scope.
- Sweep (step 5): enumerate skills/agents currently registered but not connected to any dispatching
  pipeline, which is the failure "wired" was supposed to exclude.
- `pnpm harness:scan` green.

## User Execution Test Scenarios

Not applicable — harness/process change with no runnable user-facing behaviour. The prove-it-fails
pair under Test Plan is the evidence.

## Delivered (2026-08-16)

**Three roles, split per `enforcement-architecture.md:21`:**

- `.claude/agents/wiring-worker.md` — produces only; derives the touchpoint set **from the tree**
  rather than from a list in its own file, and reports touchpoints it could not complete rather than
  declaring the job done.
- `.claude/agents/wiring-guardian.md` — read-only, `GATE VERDICT`. Asks both questions, and the second
  is the reason it exists.
- `.agents/skills/wiring-orchestration/SKILL.md` — thin; holds no wiring policy.

**The guardian's second question has a defined outcome for "cannot establish":** `NON-COMPLIANCE`,
which routes to escalation and explicitly **not** back to the worker — the touchpoints are present, so
re-running the worker cannot close a gap that is in the check. Without that branch the honest answer
would have had nowhere to go except a green, which is the defect this item is about.

**Mechanism terminal state: MECHANIZED, and it was already half-built.**
`check-agent-def-convention.mjs` enforces registration, and its fixture at
`__tests__/check-agent-def-convention.test.mjs:145` already feeds it an unregistered agent and asserts
the finding — so the falsifiability evidence the guardian must cite exists rather than being asserted.
`check-fixture-floor.mjs` (HARNESS-098) is the second enforcing check, registered in the orchestration
map row for this pipeline.

**Prove-it-fails (step 9):** demonstrated live during this work — the orchestration-map scan went RED
on both new agents ("has no row in the Orchestration Map — a mention in prose or inside a diagram is
not a listing") until each was given a row, and the agent-def guard's unregistered-agent fixture is
the standing red case.

**Wired fully:** both agents registered in `.agents/skills/index.md`, both rows added to the
orchestration map's agent table, and a `Wiring` pipeline row added with its escalation semantics.

## Closed

Delivered and on `main`. All three roles wired, and the guardian's falsifiability half rests on an
existing fixture rather than on its own reading. Nothing of this item remains open.
