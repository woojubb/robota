---
status: done
type: INFRA
tags: [typescript]
---

# INFRA-035: Mechanize the interface-package purity invariant (resolves the interface-accessors decision)

## Problem

`agent-interface-*` packages are meant to be dependency-light contract packages. `agent-interface-transport`
also ships four **pure, dependency-free** derivation accessors (`readAssistantReplies`, `readLastAssistantText`,
`readToolCalls`, `readErrors`) over union types it owns — a legitimate "contracts + pure derivations"
shape the earlier doc pass reconciled `.agents/project-structure.md:22` to allow. That reconciliation was
a **prose** decision with **no mechanical guard**: nothing stops a future edit from adding a runtime
`@robota-sdk/*`/node-builtin import or a `class`/`enum` to an interface package and silently regressing
its inertness. The open "Design alternatives" item in `.agents/architecture-remediation-log.md` asked
whether to keep this model or relocate the accessors; an independent `architecture-auditor` pass
recommended **keep** (the accessors are verifiably pure, single-owned, and used by only two consumers;
relocating would push contract-pure `-ws`/`-http` siblings toward a runtime dependency on the heavier
`agent-transport` or duplicated filters — an SSOT/coupling regression) **and harden the model with a
mechanical guard** that enforces the invariant that actually matters: zero runtime dependency edges, no
runtime constructs.

**Reproduction condition:** add `import { x } from '@robota-sdk/agent-core'` (value, not `import type`)
or `export class Foo {}` to any `agent-interface-*/src` file — nothing in `pnpm harness:scan` fails,
though it violates the reconciled interface-package rule.

## Architecture Review

### Affected Scope

- **New scan** `scripts/harness/scan-interface-runtime.mjs`, wired into `scripts/harness/run-all-scans.mjs`
  beside the existing `check-interface-imports.mjs` (which already mechanizes import _direction_).
- Rule doc `.agents/project-structure.md:22` (cross-reference the new guard from the reconciled prose).
- `.agents/architecture-remediation-log.md` — close the "interface-accessors" design item as decided (A-keep) + mechanized.

### Alternatives Considered

1. **Keep the accessors; add a mechanical purity guard (chosen).** Enforce, on each `agent-interface-*`
   package `src`: no **value** import (or `require`) of `@robota-sdk/*` or a node builtin (type-only
   `import type` is allowed), and no `class`/`enum`/`abstract class` declaration. Pure local functions
   over owned types remain allowed.
   - _Pro:_ turns the reconciled prose into a machine check pointed at the invariant that matters (zero
     runtime coupling / no runtime constructs); keeps pure derivations co-located with the union they
     derive from (SSOT); no relocation churn; the current code already passes (verified — no value
     imports, no class/enum in either interface package).
   - _Con:_ a `src`-based lexical check (not a dist check) — must be careful to allow `import type` /
     inline `type`-qualified specifiers and value exports of pure functions.
2. **Relocate the accessors to a runtime package + guard "interface packages emit zero runtime JS".**
   _Rejected (per the auditor)_ — optimizes the wrong invariant (zero statements vs zero coupling); splits
   the union from its canonical readers; forces contract-pure `-ws`/`-http` siblings toward a runtime dep
   on `agent-transport` or duplicated filters — an SSOT/coupling regression outweighing the crispness.
3. **Close the decision as keep, add no guard (prose only).** _Rejected —_ leaves the invariant
   unenforced; the repo doctrine (`harness-governance`) prefers a mechanical check over standing prose.

### Decision

Keep the "contracts + pure derivations" model (A) and mechanize the invariant that matters — **zero
runtime dependency edges** (not "zero statements"). Add `scan-interface-runtime.mjs` (AST/TS-compiler-API
based; comment/string-stripped; whole-statement normalized) that, for each `agent-interface-*/src` file,
FAILS if (a) any `import` / `export … from` / `import x = require()` with a **bare (non-relative)** module
specifier introduces a **value** binding — i.e. the statement is not `import type`/`export type` and not
every named specifier is inline `type`-qualified — or (b) a `class` / `abstract class` / `enum` /
`const enum` **declaration** appears. **Relative** value imports/re-exports (`./`, `../`) and pure exported
functions are allowed. Close the design item as decided-and-mechanized. This predicate is strictly more
faithful to "zero runtime edges" than an `@robota-sdk/*`+builtin allowlist (it also catches a future
`import { z } from 'zod'`), and remains non-breaking (both interface packages have no bare value imports today).

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — new harness scan + run-all-scans wiring; project-structure cross-ref; remediation-log decision close
- [x] Sibling scan 완료 — sits beside `check-interface-imports.mjs`; scope is `agent-interface-*` only (agent-interface-transport, agent-interface-tui — verified the current src has no value @robota/builtin imports and no class/enum, so the guard is non-breaking)
- [x] 대안 최소 2개 검토 완료 — 3 alternatives; 2 rejected (relocate = SSOT/coupling regression; prose-only = unenforced) — per the neutral architecture-auditor
- [x] 결정 근거 문서화 완료 — enforce zero runtime coupling (the invariant that matters), not relocation; auditor-recommended A + guard

## Solution

1. Write `scripts/harness/scan-interface-runtime.mjs` using the **TypeScript compiler API** (parse to AST;
   do NOT line/word-grep — that false-positives on the current tree: multi-line `import type { … } from
'@robota-sdk/agent-core'` in `session-contracts.ts` where `type` is lines above the `from`, and the word
   `class` inside a comment in `background-task-contracts.ts`). For each `packages/agent-interface-*/src/**/*.ts`
   (excluding tests): FAIL if (a) any `import` / `export … from` / `import x = require()` with a **bare
   (non-relative) module specifier** introduces a **value** binding — i.e. it is not `import type`/`export type`
   and not every named specifier is inline `type`-qualified (bare specifiers subsume `@robota-sdk/*`, node
   builtins, AND third-party like `zod`/`react`); or (b) a `class` / `abstract class` / `enum` / `const enum`
   **declaration** node appears. **Relative** (`./`, `../`) value imports/re-exports and pure exported
   functions are allowed. Report offending `file:line`.
2. Wire it into `scripts/harness/run-all-scans.mjs` (new scan `interface-runtime`, matching the existing
   entries' `name` field; reuse `check-interface-imports.mjs`'s package-enumeration scaffolding).
3. Cross-reference the guard from `.agents/project-structure.md:22`.
4. Close the "interface-accessors" item in the remediation log (A-keep, mechanized by INFRA-035).
5. `pnpm harness:scan` → now the current count + 1, all pass (both interface packages already satisfy the corrected invariant — no bare value imports, no class/enum).

## Affected Files

- new `scripts/harness/scan-interface-runtime.mjs`
- `scripts/harness/run-all-scans.mjs` (register the scan)
- `.agents/project-structure.md` (cross-ref the guard from line ~22)
- `.agents/architecture-remediation-log.md` (design item closed)

## Completion Criteria

- [ ] TC-01: `scan-interface-runtime.mjs` FAILS fixtures with (i) a bare value import `import { z } from 'zod'`, (ii) a value `@robota-sdk/*` import, (iii) `class Foo {}` / `enum E {}`; and PASSES fixtures with (iv) a multi-line `import type { … } from '@robota-sdk/agent-core'`, (v) the word `class` inside a comment, (vi) a relative value re-export `export { readAssistantReplies } from './interaction-contracts.js'`, and (vii) the four pure accessors.
- [ ] TC-02: The scan is registered in `run-all-scans.mjs` and runs under `pnpm harness:scan`.
- [ ] TC-03: the guard passes the CURRENT real `agent-interface-transport` + `agent-interface-tui` src unchanged (incl. the multi-line `import type` and comment-with-`class` hazards) — non-breaking; only `import type`/type-qualified/relative-value imports and pure functions are permitted.
- [ ] TC-04: `pnpm harness:scan` green (now includes `interface-runtime`); full count reported.
- [ ] TC-05: `.agents/project-structure.md` references the guard; the remediation-log design item is closed as A-keep + mechanized.

## Test Plan

Test strategy (INFRA, harness): the scan's own fixture-based self-check (fails-on-violation, passes-on-current) is the authoritative test; `harness:scan` green confirms integration.

| TC-ID | Test Type  | Tool / Approach                                                            | Notes             |
| ----- | ---------- | -------------------------------------------------------------------------- | ----------------- |
| TC-01 | Unit       | run the scan against a temp violating fixture (value import; class) → fail | fixture-based     |
| TC-02 | CI/harness | scan registered + runs in `harness:scan`                                   | integration       |
| TC-03 | Unit       | scan passes `import type` + the 4 pure accessors                           | no false positive |
| TC-04 | CI/harness | `pnpm harness:scan` green                                                  | full count        |
| TC-05 | Structural | project-structure.md cross-ref + remediation-log close                     | docs in sync      |

## Tasks

- [ ] `.agents/tasks/INFRA-035.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-07-07

**Status upgrade:** draft → review-ready
Frontmatter valid; Problem has concrete symptom + reproduction; Architecture Review checklist all [x] with sibling scan; 3 alternatives with pro/con (per architecture-auditor A-keep+guard rec); TC-01..TC-05 with matching Test Plan rows; Tasks placeholder; empty Evidence Log.

### [Design Review] — proposal-reviewer | 2026-07-07

Rounds → **ENDORSE** (verified against code). Decision sound + rule-aligned.

### [GATE-APPROVAL] — ✅ PASS | 2026-07-07

**Status upgrade:** review-ready → approved
Approval mechanism (user rule): approved when the neutral proposal-reviewer ENDORSEs a sound, rule-aligned recommendation. Reviewer returned ENDORSE. No Architecture Review / type / tags changed after approval.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-07

**Status upgrade:** approved → in-progress
Tasks file `.agents/tasks/INFRA-035-interface-package-purity-guard.md` created; TC-mapped; includes Test Plan / 검증.

### [GATE-VERIFY] — ✅ PASS | 2026-07-08

**Status upgrade:** in-progress → verifying
All TCs verified: new AST scan(s) registered in run-all-scans; fixture self-tests fail-on-violation + pass-on-current (26/26 across both); harness:scan 47/47 (45→47). INFRA-035: interface-runtime passes current interface-\* src unchanged (non-breaking). INFRA-030: agent-def-convention passes all 9 agents; 5 signal-bearing agents got `signal:` frontmatter, 3 edit agents none; capability-scout added; document-standards partial rows + text follow-ons pass check-document-standards-index; lesson-to-harness dispatch pointer + index registration; INFRA-036 defers agent-skill-author/orchestration-skill behind the guard.

### [GATE-COMPLETE] — ✅ PASS | 2026-07-08

**Status upgrade:** verifying → done
proposal-reviewer ENDORSE (after 2 REVISE each — caught current-code false-positives / the 8-agent signal-rule contradiction); implemented by architecture-implementer; harness:scan 47/47.
