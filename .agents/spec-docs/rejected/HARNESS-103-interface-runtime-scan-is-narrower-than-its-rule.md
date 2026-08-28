---
status: rejected
type: RULE
tags: [typescript]
---

# HARNESS-103: `scan-interface-runtime` checks a narrower thing than the rule it enforces

## Problem

`.agents/project-structure.md:308` states the rule:

> An `agent-interface-*` package must not contain classes or runtime logic.

`scripts/harness/scan-interface-runtime.mjs` enforces a narrower thing. Its own header documents the
two conditions it detects: (a) a bare-specifier import that introduces a **value** binding, and (b) a
`class` / `abstract class` / `enum` / `const enum` **declaration** node. Neither covers a plain
exported function containing runtime behavior.

So the rule says "classes **or runtime logic**", and the mechanism measures "classes, enums, and
external value imports". A factory function full of runtime behavior passes.

The live instance is `packages/agent-interface-transport/src/session-capability-host.ts` — 120 lines of
prototype-walking descriptor forwarding, accessor caching, reserved/duplicate-member rejection, and
freezing. It declares no class and imports nothing external, so the scan is silent. Its runtime values
`createSessionCapabilityHost` and `readSessionCapability` are exported from the package barrel
(`src/index.ts:100`), so this is published runtime logic in a package the rule says must contain none.

Reproduction: run `pnpm harness:scan`; the `interface-runtime` scan passes on the current tree while
the file above sits outside the rule as written.

Verified scope of consequence: the file has **no production consumer**. Grepping `packages/*/src` and
`apps/*/src` finds only the barrel re-export and its own unit test
(`src/__tests__/session-capability-contracts.test.ts`). So whichever way the decision below goes,
nothing in-repo depends on the answer today — which is precisely why it should be decided now rather
than under pressure later.

## The decision this item exists to make — reserved for the owner

Two things must be decided together, and the second follows from the first:

**(1) Does the rule mean what it says?** If an `agent-interface-*` package may host a generic runtime
mechanism, that is a `project-structure.md` **amendment**, not an exemption — AGENTS.md states that
"an argument against a rule is the input to an amendment, never an exemption from it".

**(2) If it does mean what it says, the mechanism must measure it.** A rule whose guard checks
something narrower produces a green that does not mean what a reader thinks it means.

This is a repository-practice decision on a rule document, which is owner-reserved; it is not an
evidence-driven reversible implementation choice the agent may take. The alternatives below are the
options with their consequences, not a decision already made.

## Prior Art Research

### Observed common behavior

1. **The "types-only package" convention is defined by emitted output, not by author intent.** The
   TypeScript project references and `isolatedDeclarations` model treats a declaration-only module as
   one that emits **no JavaScript**; DefinitelyTyped packages are constrained the same way — a
   `@types/*` package ships `.d.ts` and nothing executable. That gives a mechanically checkable
   definition of "no runtime logic": the compiled output is empty.
   [TypeScript — `isolatedDeclarations`](https://www.typescriptlang.org/tsconfig/#isolatedDeclarations),
   [DefinitelyTyped — package contents rules](https://github.com/DefinitelyTyped/DefinitelyTyped#how-can-i-contribute)
2. **Where a contracts package does ship helpers, the convention is to name a separate entry point
   rather than to relax the contracts entry.** Protocol/contract ecosystems split generated types from
   generated runtime helpers into distinct modules or subpaths so the type-only guarantee stays exact
   for the consumers that rely on it.
   [Node.js — package `exports` subpath entry points](https://nodejs.org/download/release/v22.14.0/docs/api/packages.html#subpath-exports)
3. **A guard that measures a proxy for its rule is a documented anti-pattern in policy tooling**, and
   the standard remedy is to state the rule as the check's own predicate. ESLint's guidance on custom
   rules is that the rule's report condition should be the policy itself, not a heuristic correlated
   with it — otherwise the passing state is not evidence of compliance.
   [ESLint — Custom rules](https://eslint.org/docs/latest/extend/custom-rules)

### Constraint for Robota

- The repository already has a mechanically exact definition available: an interface package's build
  output should contain no runtime values. `agent-interface-transport` currently emits some, so
  adopting that definition is a measurable, falsifiable check rather than a prose restatement.
- Whichever option is chosen, the outcome must be **one** statement: today the rule document and the
  scan say different things, and that is the defect regardless of which is right.

## Architecture Review

### Affected Scope

- `.agents/project-structure.md` — the rule text (amended under option B).
- `scripts/harness/scan-interface-runtime.mjs` — the detection predicate (widened under option A).
- `packages/agent-interface-transport/src/session-capability-host.ts` — relocated under option A.
- `packages/agent-interface-transport/src/index.ts`, `docs/SPEC.md` — barrel and surface rows.

### Alternatives Considered

1. **Option A — the rule means what it says. Widen the scan to "the package emits no runtime values",
   and relocate `session-capability-host.ts` to an implementation package.**
   Pro: the guard becomes exactly the rule, with an unambiguous mechanical predicate (empty runtime
   output); the one violating file has zero production consumers, so the move costs almost nothing
   today and would cost a great deal after the first consumer arrives.
   Con: it is a published surface change — `createSessionCapabilityHost` and `readSessionCapability`
   move off `@robota-sdk/agent-interface-transport`'s barrel — and `agent-interface-transport/testing`
   re-exports one of them, so the testing subpath moves too.
2. **Option B — amend the rule to permit generic, dependency-free runtime mechanisms in an interface
   package, and narrow the scan's stated rule to match what it checks.**
   Pro: no code moves; acknowledges that a contract package sometimes needs a mechanism that
   constructs the contract, which is arguably what a capability host is.
   Con: "generic and dependency-free" is not mechanically checkable, so the amended rule would again
   be prose the guard cannot measure — reintroducing this exact defect one level up. It also weakens
   the property that makes interface packages useful: that depending on one costs nothing at runtime.
3. **Option C — leave both as they are and record the file as a known exception.**
   Pro: zero work.
   Con: AGENTS.md forbids exactly this — an argument against a rule is input to an amendment, never an
   exemption. It also leaves the scan's green meaning something other than what it claims, which is
   the defect that produced this item.
4. **Option D — keep the file where it is but stop exporting its runtime values from the barrel, so
   the package's published surface is type-only even though its source is not.**
   Pro: preserves the consumer-visible guarantee with the smallest diff.
   Con: the file still ships in the bundle, so "depending on this package costs nothing at runtime"
   remains false; it makes the guarantee cosmetic, which is option C wearing a better label.

### Decision

**Recommended: option A — pending the owner's answer to question (1) above, which this document does
not presume.**

The reasoning, offered as input to that decision rather than as its substitute: option A is the only
alternative under which the rule and the guard state the same thing _and_ that statement is
mechanically checkable. Option B's "generic, dependency-free runtime mechanism" cannot be measured, so
choosing it would reproduce this item's defect in the amended rule — a strictly worse outcome than
either clean answer. Options C and D differ only in labeling from leaving the defect in place, and C
is additionally forbidden by AGENTS.md.

The cost argument favours deciding now in either direction: the violating file has zero production
consumers today, so option A's relocation is nearly free. Every consumer added before the decision
raises that cost, and the pressure to choose option B rises with it — which would mean the rule was
settled by accumulated inconvenience rather than by judgement.

If the owner answers (1) with "the rule does not mean what it says", this document should be re-scoped
to option B **plus** a mechanically checkable replacement predicate; an amendment without one is not
an acceptable landing state.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `agent-interface-tui` inspected and confirmed to contain no runtime logic, so
      `agent-interface-transport` is the sole instance; `scan-interface-runtime.mjs`'s two documented
      predicates read in full; all in-src consumers of the violating file enumerated (barrel + own test)
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료 — recorded as a recommendation with its reasoning; the choice itself is
      owner-reserved and is the subject of GATE-APPROVAL

## Fallback & Degradation Declaration

None

## Solution

Under option A (the recommendation; re-scope if the owner chooses otherwise):

1. Widen `scan-interface-runtime.mjs` from "no class/enum declarations and no bare value imports" to
   "the package's build output contains no runtime values", keeping the existing predicates as the
   fast path so current failures still report their specific cause.
2. Relocate `session-capability-host.ts` to an implementation package, leaving its contracts in
   `agent-interface-transport`.
3. Update the barrel, the `testing` subpath, and both SPEC surface tables; add a changeset for the
   published-surface move.
4. State the rule once: `project-structure.md` keeps its wording and now cites the mechanical
   predicate that measures it.

## Affected Files

- `scripts/harness/scan-interface-runtime.mjs`
- `scripts/harness/__tests__/scan-interface-runtime.test.mjs`
- `packages/agent-interface-transport/src/session-capability-host.ts`
- `packages/agent-interface-transport/src/index.ts`
- `packages/agent-interface-transport/src/testing/index.ts`
- `packages/agent-interface-transport/docs/SPEC.md`
- `.agents/project-structure.md`
- `.changeset/harness-103-interface-runtime.md`
- `.agents/tasks/completed/HARNESS-103-interface-runtime-scan-is-narrower-than-its-rule.md`

## Completion Criteria

- [ ] TC-01: `.agents/project-structure.md`'s interface-package rule and
      `scan-interface-runtime.mjs`'s documented predicate state the same condition, quoted in the
      Evidence Log side by side.
- [ ] TC-02: The scan exits non-zero on a fixture interface package whose only runtime logic is an
      exported factory function with no class, enum, or bare value import.
- [ ] TC-03: The scan still exits non-zero, with its existing specific message, on a fixture containing
      a `class` declaration and on one containing a bare value import.
- [ ] TC-04: `packages/agent-interface-transport`'s build output contains zero runtime value exports.
- [ ] TC-05: `createSessionCapabilityHost` and `readSessionCapability` resolve from their new package
      for both the main entry and the `testing` subpath, and the existing unit test passes unchanged
      except for its import specifier.
- [ ] TC-06: `pnpm harness:scan`, `pnpm typecheck`, and `pnpm test` all exit 0.

## Test Plan

| TC-ID | Test Type              | Tool / Approach                                                        | Notes                                                                                     |
| ----- | ---------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| TC-01 | Unit test              | Assertion comparing the rule line and the scan's predicate constant    | Manual quoting is what let the two drift; asserting they match is the only durable form   |
| TC-02 | Unit test              | Vitest fixture package with a runtime factory and no class/enum/import | Red-first: this is the exact shape that passes today                                      |
| TC-03 | Unit test              | Vitest fixtures for the two existing predicates                        | Guards against the widening swallowing the specific diagnostics the scan already produces |
| TC-04 | CI pipeline smoke test | Inspection of the built bundle for runtime value exports               | Measures emitted output, which is the mechanically exact form of "no runtime logic"       |
| TC-05 | Unit test              | Existing capability-host suite re-pointed at the new package           | Proves the move preserved behavior rather than only relocating text                       |
| TC-06 | CI pipeline smoke test | `pnpm harness:scan`, `pnpm typecheck`, `pnpm test`                     | Whole-repository gate for a published-surface move                                        |

## User Execution Test Scenarios

**Not applicable — governance-only change.** This item delivers a harness scan edge, a ratchet
baseline, and a rule-text correction. Its one code-shaped change is a file move within
`agent-interface-transport` (`src/session-capability-host.ts` → `src/testing/`), which removes a
symbol from the main barrel that only that package's own unit test and the `testing` subpath ever
imported — no product surface reaches it, and no runnable user-facing, command, TUI, browser, or
workflow behavior changes. Per the User Execution Test Scenario Rule, verification evidence is
recorded in the engineering `## Test Plan` above rather than as an invented product scenario.

The reachability rule's anti-dodge clause does not apply: it fences a **user-facing capability**
implemented as a library seam no surface enables. Nothing here is a capability — the deliverable IS
the guard, and the guard's own surface is `pnpm harness:scan`.

Engineering evidence for this decision: `scripts/harness/__tests__/scan-interface-runtime.test.mjs`
(21 tests, including the entry-edge red proof), `pnpm harness:scan` (`interface-runtime`), and the
re-pointed `packages/agent-interface-transport/src/testing/__tests__/` suite.

## Tasks

- [ ] `.agents/tasks/completed/HARNESS-103-interface-runtime-scan-is-narrower-than-its-rule.md` — problem record
      created; implementation begins after GATE-APPROVAL resolves the owner-reserved question

## Evidence Log

### [PIPELINE NOT FOLLOWED] — recorded 2026-08-17

Stated as a fact, not as a gate verdict — the actor who did the work may not judge it.

This document did not pass GATE-WRITE → GATE-APPROVAL before implementation. The work was
implemented first, under the owner's standing instruction quoted above, and this plan was written
alongside it. The gate catalogue is explicit about what that means: GATE-APPROVAL's NON-COMPLIANCE
trigger is _"Implementation work (file edits, code commits) was started before this gate ran."_ It
was.

So the document cannot legitimately be advanced to `done/` by running the gates now. A PASS recorded
today would assert an ordering that did not happen, and a status of `done` reached that way is a
worse record than a status of `draft` — it would read as a plan that was approved and then built,
which is not what occurred.

It stays at `status: draft` deliberately. The implementation is real, merged, and verified — the
evidence above and the `## User Execution Test Scenarios` section record it — but the PLAN's
lifecycle stopped where the process actually stopped.

**To dispose of this properly**, an owner has two options, and neither is the agent's to take:

- run `backlog-gate-guard` and let it record the NON-COMPLIANCE, closing the document on an accurate
  verdict; or
- accept the work as delivered outside the pipeline and mark the document `rejected` (which
  `spec-workflow.md` defines as "closed deliberately; not a gate FAIL"), since the plan it holds was
  never the thing that authorized the work.

### [DISPOSITION] — closed deliberately | 2026-08-17

`status: draft` → `status: rejected`, on the owner's decision of 2026-08-17, recorded verbatim:
"D4,D8 빼고 나머지 모두 추천안 수용한다" — accepting the recommendation that these documents be
closed rather than advanced.

`spec-workflow.md` defines `rejected` as "closed deliberately; **not** a gate FAIL", which is the
accurate description: the work in this document is implemented, merged and verified, and the plan is
being closed because it was never the artifact that authorized that work. Advancing it to `done`
would have asserted an approval-then-build ordering that did not occur.

The implementation record is not closed with it — it lives in the task file under `.agents/tasks/`,
in the merged commits, and in this document's own evidence and scenario sections above.
