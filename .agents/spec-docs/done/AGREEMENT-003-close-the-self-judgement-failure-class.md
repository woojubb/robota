---
status: done
type: AGREEMENT
tags: [typescript]
---

# AGREEMENT-003: close the self-judgement failure class

Paired with `.agents/tasks/AGREEMENT-003-close-the-self-judgement-failure-class.md`. Converted from
[issue #1763](https://github.com/woojubb/robota/issues/1763).

## Problem

Six times in one session, a role judged its own output. Every one was caught by an independent
reviewer; none by the producer.

The rule already exists. [enforcement-architecture.md](../../rules/enforcement-architecture.md) `:21`:
_"A skill/agent that both produces and judges, or that judges and also routes, violates this rule.
Split it."_ The failure is not a missing policy — it is four places the policy does not reach:

1. **A contract's state is read from a proxy signal** — `grep` finds no consumer, so "dead"; the
   surface is "published", so "unmodifiable" — and the agent that reads the proxy then acts on it.
2. **A verification's verdict is not a function of the condition it names** — it cannot go red on the
   violation, or cannot go green on correct input.
3. **Wiring is performed and declared done by the same role**, with nothing asking whether the
   registration check would have gone red had the wiring been absent.
4. **A defect found mid-task has no filing path** that neither interrupts the work nor loses the
   finding.

## Prior Art Research

Waived: in-repo governance change with no external product analog — this initiative applies an
existing in-repo rule to four in-repo gaps, and the relevant prior art is the repository's own
worker/guardian/orchestrator implementations, enumerated under Architecture Review below rather than
sought externally.

The waiver is recorded rather than the section left empty, per
[research.md](../../rules/research.md). It applies to **this decomposition document only** — each
child brings its own design, and a child that proposes a mechanism with an external analog (a
published-version check, a scan-coverage convention) should run its own pass rather than inherit this
one.

## Architecture Review

**The split is already implemented several times here and should be matched, not re-derived:**

| Existing                                        | Shape                                                                               |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| `architecture-refresh`, `documentation-refresh` | Orchestrators holding no policy, routing on a guardian's verdict                    |
| `backlog-gate-guard`, the worktree gates        | Guardians judging one thing, emitting `GATE VERDICT`                                |
| `backlog-writer`, `prior-art-researcher`        | Workers that produce and do not inspect their own output                            |
| `check-agent-def-convention.mjs`                | Mechanizes role shape: read-only tool scope, closed signal vocabulary, registration |

**Reachability.** Every child's mechanism targets `.agents/` or `scripts/harness/`, both already
scanned by `pnpm harness:scan`. No new dependency edge, no new package.

**Capability preservation.** Nothing existing is replaced. The four children add roles and checks;
the `contract-audit` **name** is the one collision, recorded in the Task and reserved to HARNESS-097's
design.

**Adversarial pass — not yet run.** Required before GATE-APPROVAL for anything crossing a contract
boundary. At draft stage this document proposes a decomposition, not a design; each child brings its
own design and its own pass. Stated so the gap is visible rather than assumed closed.

**The initiative's own strongest failure mode:** HARNESS-098 is about checks that cannot fail. Any
mechanism this initiative ships without its red proof would be the initiative committing the defect it
exists to close. That is why step 9 is a constraint here and not a formality.

## Solution

Four children, one cause each — see the Task's table for the mapping from the issue's eight skills.
Splitting by cause rather than by artifact count is the decision, and it is made against a measured
alternative: an adjacent item's `area` grew from 3 packages to 13 across twelve review rounds because
each verified finding was absorbed rather than routed to its owner.
[finding-depth.md](../../rules/finding-depth.md) owns that distinction.

## Completion Criteria

- **TC-01** Each child reaches a **named terminal state** for its mechanism — mechanized, or
  infeasible-now with a written concrete obstacle **and** a tracked item. Silence fails.
- **TC-02** Each mechanized check is proven against its pre-fix state: **FAILS** before, **PASSES**
  after, recorded in the child.
- **TC-03** No partial wiring — every artifact each child ships is registered and connected, or none
  of it is.
- **TC-04** HARNESS-099's guardian demonstrates the falsifiability half: an unwired fixture makes the
  registration check go red.
- **TC-05** HARNESS-097 does not reuse the `contract-audit` name, and its artifact is distinguishable
  from the existing skill by description alone.
- **TC-06** `pnpm harness:scan` green; every new Task passes `task-lifecycle.mjs classify`.

## Test Plan

Per-child. At the initiative level, the check is TC-01 and TC-02 across all four: a child whose
mechanism has no named terminal state, or no recorded before/after, is not complete regardless of what
prose it carries (`lesson-to-harness` step 11).

## Tasks

- [x] HARNESS-097 — done — `.agents/tasks/completed/HARNESS-097-contract-state-judged-by-proxy-signal.md`
- [x] HARNESS-098 — done — `.agents/tasks/completed/HARNESS-098-verifications-that-cannot-fail-or-cannot-pass.md`
- [x] HARNESS-099 — done — `.agents/tasks/completed/HARNESS-099-wiring-is-performed-and-judged-by-the-same-role.md`
- [x] HARNESS-100 — done — `.agents/tasks/completed/HARNESS-100-mid-task-discovery-has-no-filing-path-that-does-not-disturb-the-work.md`

## Evidence Log

| Claim                                                         | Verified at                                                                |
| ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| The produce-vs-judge rule already exists                      | `.agents/rules/enforcement-architecture.md:21`                             |
| Removal of an unconsumed surface is a product decision        | `.agents/project-structure.md:225`                                         |
| Wire fully / mechanism / prove-it-fails are existing steps    | `.agents/skills/lesson-to-harness/SKILL.md` steps 6, 8, 9, 11              |
| A `contract-audit` skill already exists, about something else | `.agents/skills/contract-audit/SKILL.md` — SPEC.md Class Contract Registry |
| Registration is already mechanized                            | `scripts/harness/check-agent-def-convention.mjs` (check 4)                 |
| The unfalsifiable mirror is filed separately                  | <https://github.com/woojubb/robota/issues/1765>                            |
| The source directives                                         | <https://github.com/woojubb/robota/issues/1763>                            |

## Outcome

All four children `done` and on `main`. Every completion criterion met: each child reached a named
mechanism terminal state (TC-01), each mechanized one carries its recorded before/after (TC-02),
nothing was partially wired (TC-03), the wiring guardian's falsifiability half rests on an existing
red fixture (TC-04), the `contract-audit` name was not reused (TC-05), and the scans and lifecycle
checks are green (TC-06).

Two remainders were filed as their own items rather than left as notes inside closed Tasks —
**HARNESS-101** (fixture existence is not fixture quality) and **HARNESS-102** (a dropped finding
leaves no artifact). Filing them is the disposition this document argued for in its own decomposition
section: a cause without an owner is not closed by being written down somewhere else.
