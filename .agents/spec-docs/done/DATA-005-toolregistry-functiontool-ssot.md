---
status: done
type: DATA
tags: [typescript]
---

# DATA-005: Consolidate ToolRegistry / FunctionTool onto a single SSOT

## Problem

`ToolRegistry` and `FunctionTool` are implemented **twice** — once in
`packages/agent-core/src/tool-registry/` and once in `packages/agent-tools/src/`
(`registry/tool-registry.ts`, `implementations/function-tool.ts`). Verified state of the two copies:

- **`FunctionTool` — genuinely drifting (the real defect).** The `agent-tools` copy delegates
  validation to `implementations/function-tool/parameter-validator.ts`
  (`getValidationErrors`/`validateToolParameters`) and honors `schema.parameters.additionalProperties`;
  the `agent-core` copy validates **inline** and **ignores `additionalProperties`**. The two can
  accept/reject different inputs — a silent behavioral fork of a foundational primitive.
- **`ToolRegistry` — effectively identical.** The two files differ only by import ordering and one
  stray comment (`// 🔍 [TOOL-FLOW]…`); no behavioral drift. It is duplicated, not forked.

Both classes depend only on core-internal things (`interfaces/tool.ts` contracts, `utils/errors`,
`utils/logger`) — no Zod, no sandbox, nothing from the tools domain. Surfaced as ARL-01 by the
architecture-refresh conformance pass (`.agents/architecture-remediation-log.md`).

**Reproduction condition:** call a tool whose schema sets `additionalProperties: true` (or an object
schema) with an extra property. The `agent-tools` factory path (tools `FunctionTool` →
`parameter-validator.ts`) **accepts** it (`additionalProperties === true` → `continue`); the
`agent-core` `tool-manager` path (core `FunctionTool`) **rejects** it — core validates inline
(`function-tool.ts:141-143`), never reads `additionalProperties`, and pushes `Unknown parameter: <key>`
unconditionally. (At `additionalProperties: false`/omitted, both reject — no drift there.) So core is
the _stricter_ copy; the fork is at `additionalProperties: true|object`.

## Architecture Review

### Affected Scope

- **Owner (chosen SSOT):** `packages/agent-core/src/tool-registry/` — `ToolRegistry`, `FunctionTool`
  (dependency-free runtime primitives; core already owns their contracts in `interfaces/tool.ts`).
- **Duplicate to delete:** `packages/agent-tools/src/registry/tool-registry.ts` (identical copy),
  `packages/agent-tools/src/implementations/function-tool.ts` (forked class only; keep the
  `createFunctionTool` / `createZodFunctionTool` factories). The `additionalProperties`-aware
  `implementations/function-tool/parameter-validator.ts` must be **relocated into agent-core** as the
  canonical validation.
- **External consumers to repoint — `FunctionTool` only, 5 files, all in `packages/agent-playground/`**
  (`lib/playground/robota-executor/{agent-session,tool-card-adapter,tool-normalization}.ts`,
  `lib/playground/universal-tool-factory.ts`, `tools/current-time/index.ts`). The `agent-tools`
  **`ToolRegistry` class has ZERO external consumers**. (The 5 `agent-framework` files import the
  factory `createZodFunctionTool`, which is unchanged.)
- **Barrel gap:** `agent-core/src/index.ts` does **not** currently export `FunctionTool`/`ToolRegistry`
  at the package top level (only the internal `tool-registry/index.ts` does) — it must, so consumers
  can import from `@robota-sdk/agent-core`.
- **Docs/rules:** `agent-core/docs/SPEC.md`, `agent-tools/docs/SPEC.md`, and `.agents/project-structure.md`
  line 9 (which currently lists `agent-tools` as owning `FunctionTool`).

### Alternatives Considered

1. **agent-core is the sole owner (chosen).** The concrete `ToolRegistry`/`FunctionTool` are
   **dependency-free foundational primitives** that the zero-dep Robota engine (`tool-manager.ts`)
   constructs directly (`new ToolRegistry()`, `new FunctionTool(...)`), and core already owns their
   contracts (`interfaces/tool.ts`) and is the _enforced_ public home of `createFunctionTool`
   (`agent-playground/.../import-checks.ts` asserts it must be imported from `@robota-sdk/agent-core`).
   Core keeps the classes, adopts the `additionalProperties`-aware validator (moved in from
   agent-tools) as canonical, exports them from its barrel; `agent-tools` deletes its copies and its
   factories construct core's `FunctionTool`; the 5 playground `FunctionTool` consumers import from core.
   - _Pro:_ a foundational primitive lives in the foundation that already depends on nothing and already
     owns its contract; removes the silent fork; no pluggability lost (one implementation).
   - _Con (cost, not a veto):_ moves a validator module + edits two barrels + repoints 5 imports +
     reconciles the `additionalProperties` behavior on the core path (characterization-tested).
2. **agent-tools is the sole owner; core keeps interfaces only.** _Rejected._ Not merely "blocked by
   layering" — it would drag a **dependency-free primitive out of the foundation that depends on it**.
   `agent-core` (zero-dep) cannot import `agent-tools`, so core's engine would lose the ability to
   construct a tool/registry standalone. Wrong direction for a primitive that carries no tools-domain
   dependency.
3. **Dependency inversion: interfaces in core, concrete `ToolRegistry`/`FunctionTool` in agent-tools,
   core's `tool-manager` depends on `IToolRegistry` and receives the concrete via DI.** _Rejected._
   Dependency inversion pays off when the concrete carries a **volatile or external** dependency the
   foundation should not take on — but these concretes depend on nothing outside core. Inverting a
   dependency-free primitive adds an injection seam at every construction site, defeats the engine's
   standalone self-sufficiency, and buys no decoupling (there is one implementation, no pluggability
   requirement). DI for its own sake — YAGNI. Naming and rejecting it is what confirms Alternative 1.
4. **Core owns; agent-tools re-exports core's classes** (consumers keep importing from agent-tools).
   _Rejected —_ violates the repo no-pass-through-re-export rule (`.agents/project-structure.md`); a
   re-export of a class the package does not own re-introduces the drift risk this item removes.

### Decision

**Alternative 1**, grounded on principle (not blast radius): the concrete `ToolRegistry`/`FunctionTool`
are **dependency-free core-runtime primitives constructed directly by the zero-dep engine**, and core
already owns their contracts and is the enforced home of the `createFunctionTool` factory — so core is
the correct owner of the canonical implementation too. `agent-tools` correctly retains only the
Zod-flavored `createZodFunctionTool` factory (needs Zod) and the domain built-ins. Core adopts the
`additionalProperties`-aware validator as canonical (characterization-tested first). Blast radius is
acknowledged as a cost and sequenced safely; it is **not** a reason for the choice.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-core (owner + barrel export + validator move), agent-tools (delete dup + factory repoint), agent-playground (5 FunctionTool imports), project-structure.md line 9
- [x] Sibling scan 완료 — `ToolRegistry` class has zero external consumers; only `FunctionTool` is externally imported (5 agent-playground files from agent-tools); no external import from agent-core (verified by rg + proposal-reviewer)
- [x] 대안 최소 2개 검토 완료 — 4 alternatives incl. the dependency-inversion option; 3 rejected on principle
- [x] 결정 근거 문서화 완료 — dependency-free foundational primitive owned by the zero-dep engine that already owns its contract; blast radius is a cost, not the rationale

## Solution

1. Write characterization tests (RED-first). The drift case: a schema with `additionalProperties: true`
   (and the object-schema form) plus an extra property — the `agent-tools` factory path **accepts**, the
   `agent-core` `tool-manager` path currently **rejects** (`Unknown parameter`). This test is genuinely
   RED on core today and green after the reconcile. Also add an unchanged-behavior guard
   (`additionalProperties: false`/omitted → both reject, before and after). And characterize the
   concrete-only `ToolRegistry` surface the engine relies on (`size()`, `getName()`,
   `setEventService()`, `getToolNames()`, `getToolsByPattern()`), not just the
   `IToolRegistry`/`IFunctionTool` contract.
2. Relocate `agent-tools/src/implementations/function-tool/parameter-validator.ts` into agent-core and
   reconcile core's `FunctionTool` to use it (adopt `additionalProperties`-aware validation as
   canonical). **This makes core's `FunctionTool` more permissive for `additionalProperties: true|object`**
   (a real semantic change on the core `tool-manager` path — it will now accept extra props those schemas
   allow), green under the characterization tests.
3. Export `FunctionTool` and `ToolRegistry` from the `agent-core/src/index.ts` package barrel (they are
   currently only in the internal `tool-registry/index.ts`).
4. Delete `agent-tools/src/registry/tool-registry.ts` and the `FunctionTool` **class** in
   `agent-tools/src/implementations/function-tool.ts`; keep `createFunctionTool`/`createZodFunctionTool`
   and have them construct core's `FunctionTool` (import from `@robota-sdk/agent-core`).
5. Remove the `ToolRegistry`/`FunctionTool` class re-exports from `agent-tools/src/index.ts` (keep the
   factory + interface exports).
6. Repoint the 5 `agent-playground` files' `FunctionTool` imports to `@robota-sdk/agent-core`.
7. Update `agent-core/docs/SPEC.md` (document core as public owner of the classes), `agent-tools/docs/SPEC.md`
   (remove the class from its surface; note factories delegate to core), and `.agents/project-structure.md`
   line 9 (agent-tools no longer owns `FunctionTool`).
8. Full build + typecheck + affected test suites green; `pnpm harness:scan` 45/45.

## Affected Files

- `packages/agent-core/src/tool-registry/function-tool.ts` (adopt relocated validator), `.../tool-registry.ts` (unchanged behavior), `.../index.ts`; **new** `packages/agent-core/src/tool-registry/parameter-validator.ts` (moved in); `packages/agent-core/src/index.ts` (barrel-export `FunctionTool`/`ToolRegistry`)
- `packages/agent-tools/src/registry/tool-registry.ts` (delete), `packages/agent-tools/src/implementations/function-tool.ts` (delete class, keep factories → core `FunctionTool`), `packages/agent-tools/src/implementations/function-tool/parameter-validator.ts` (delete/move), `packages/agent-tools/src/index.ts` (drop class re-exports)
- `packages/agent-playground/src/lib/playground/robota-executor/{agent-session,tool-card-adapter,tool-normalization}.ts`, `.../universal-tool-factory.ts`, `packages/agent-playground/src/tools/current-time/index.ts` (repoint `FunctionTool` import)
- `packages/agent-core/docs/SPEC.md`, `packages/agent-tools/docs/SPEC.md`, `.agents/project-structure.md` (line 9)
- `.agents/architecture-remediation-log.md` (mark ARL-01 resolved)

## Completion Criteria

- [ ] TC-01: Exactly one `class ToolRegistry` and one `class FunctionTool` exist in the repo (both in `agent-core`); `rg "class (ToolRegistry|FunctionTool)"` returns only agent-core hits.
- [ ] TC-02: `agent-tools` factories (`createFunctionTool`/`createZodFunctionTool`) construct core's `FunctionTool`; no `agent-tools`-local `FunctionTool` class or `parameter-validator.ts` remains.
- [ ] TC-03: The 5 agent-playground consumers import `FunctionTool` from `@robota-sdk/agent-core`; `rg "FunctionTool|ToolRegistry" ... from '@robota-sdk/agent-tools'` returns no class import (factory imports allowed).
- [ ] TC-04: Canonical validation adopts `additionalProperties`: a tool whose schema sets `additionalProperties: true` (and the object-schema form) ACCEPTS an extra property on the core `tool-manager` path — RED before the reconcile (core currently rejects with `Unknown parameter`), green after; and the `additionalProperties: false`/omitted guard rejects on both paths before and after (unchanged). No other validation regression.
- [ ] TC-05: `agent-core/src/index.ts` barrel exports `FunctionTool` and `ToolRegistry` (`import { FunctionTool, ToolRegistry } from '@robota-sdk/agent-core'` type-checks).
- [ ] TC-06: `pnpm build`, `pnpm typecheck`, affected package test suites, and `pnpm harness:scan` (45/45) all green.
- [ ] TC-07: `agent-core`/`agent-tools` SPECs + `.agents/project-structure.md` line 9 updated; ARL-01 marked resolved.

## Test Plan

Test strategy (DATA + typescript): type-level + unit. FunctionTool validation parity is behavioral →
unit tests (vitest); ownership/surface is structural → grep/type assertions.

| TC-ID | Test Type           | Tool / Approach                                                                                              | Notes                                      |
| ----- | ------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| TC-01 | Structural          | `rg "class (ToolRegistry\|FunctionTool)"` — single owner assertion                                           | mechanical                                 |
| TC-02 | Unit + Structural   | vitest — factories produce a working core `FunctionTool`; `rg` no tools class/validator                      | agent-tools suite                          |
| TC-03 | Structural          | `rg` import-source assertion across packages                                                                 | no agent-tools class import remains        |
| TC-04 | Unit (characterize) | vitest — `additionalProperties:true\|object` extra-prop ACCEPTED on core (RED today) + `false` guard rejects | written first (RED), green after reconcile |
| TC-05 | Type                | vitest-expect-type / tsc — barrel import `{ FunctionTool, ToolRegistry }` from core                          | package top-level export                   |
| TC-06 | Build/CI            | `pnpm build && pnpm typecheck && pnpm test` (affected) + `harness:scan`                                      | green gate                                 |
| TC-07 | Structural          | SPEC + project-structure.md diff + remediation-log update review                                             | docs/rules in sync                         |

## Tasks

- [x] `.agents/tasks/DATA-005.md` — created (T1–T9, one+ per TC-N; includes Test Plan / 검증 section)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-07-07

**Status upgrade:** draft → review-ready
Frontmatter: `---` block present; `status: draft`; `type: DATA` (valid); `tags: [typescript]`.
Problem: concrete symptom (both `tool-registry.ts` and `function-tool.ts` copies DIFFER on origin/main; validation paths diverge) + reproduction condition (edit validation in one copy, the other keeps old behavior); no TBD/TODO.
Architecture Review: all 4 checklist items `[x]`; sibling scan `[x]` (no external import of these classes from agent-core; only 5 agent-playground files import them from agent-tools, verified by rg); 3 alternatives with pro/con (2 rejected with reasons); Decision references the layering constraint + smallest-blast-radius trade-off.
Completion Criteria: TC-01..TC-06, all TC-N-prefixed, command/observable form, no vague language.
Test Plan: present; 6 rows matching TC-01..TC-06 (count matches); each row has Test Type + Tool; no "manual" rows.
Structure: Tasks placeholder present; Evidence Log was empty; no `## Status`/`## Classification` in body.

### [Design Review] — proposal-reviewer (universal/neutral) | 2026-07-07

Independent neutral review (`.claude/agents/proposal-reviewer.md`), judged on correctness not diff size:

- Round 1 → **REVISE**: decision (agent-core sole owner) correct on merits, but justification leaned on "smallest blast radius" (discounted); missing the dependency-inversion alternative; two premise imprecisions.
- Round 2 → **REVISE**: re-grounding + DI alternative + scope now correct, but the concrete drift direction was inverted.
- Round 3 → **ENDORSE**: drift direction verified against source (core rejects extra props unconditionally = stricter; tools accepts when `additionalProperties: true|object`); TC-04 genuinely RED-on-core-today; ownership on principle, rule-aligned (one-way deps, no pass-through, SSOT, TDD-characterization). "Approve as written."

### [GATE-APPROVAL] — ✅ PASS | 2026-07-07

**Status upgrade:** review-ready → approved
Approval mechanism (user-defined this conversation, verbatim): "타당한 이유와 함께 추천안을 제시해야 합니다. 그게 타당하고 우리 전체 규칙 기조에 맞으면 승인됩니다" — approval = the neutral proposal-reviewer finds the recommendation sound and rule-aligned. The reviewer returned `REVIEW VERDICT: ENDORSE` with sound reasoning and no rule conflict (correctness-based ownership, rule-aligned with one-way deps / no-pass-through / SSOT). Architecture Review + frontmatter type/tags unchanged after this approval.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-07

**Status upgrade:** approved → in-progress
`.agents/tasks/DATA-005.md` created; path recorded in `## Tasks`. Tasks T1–T9 map to TC-01..TC-07 (≥1 per TC-N). Tasks file includes a `## Test Plan / 검증` section (>50 chars, RED-first characterization strategy) — satisfies the `test-plans` harness scan [AF-24].

### [GATE-VERIFY] — ✅ PASS | 2026-07-07

**Status upgrade:** in-progress → verifying
TC-01: `rg "class (ToolRegistry|FunctionTool)"` → only `packages/agent-core/src/tool-registry/{function-tool,tool-registry}.ts` (single owner). TC-02: `createFunctionTool`/`createZodFunctionTool` construct core's `FunctionTool`; no agent-tools `FunctionTool` class or `parameter-validator.ts` remains. TC-03: no external class import of `FunctionTool`/`ToolRegistry` from `@robota-sdk/agent-tools` in packages/apps. TC-04: `function-tool.characterization.test.ts` present; RED→green confirmed by implementer (`2 failed | 9 passed` before → `11 passed` after adopting the relocated `additionalProperties`-aware `parameter-validator.ts`). TC-05: `agent-core/src/index.ts` barrel exports `{ FunctionTool, ToolRegistry }`. TC-06: `pnpm build`/`typecheck` clean; tests green (agent-core 851, agent-tools 147, agent-playground 165). TC-07: `pnpm harness:scan` 45/45.

### [GATE-COMPLETE] — ✅ PASS | 2026-07-07

**Status upgrade:** verifying → done
All TC-01..TC-07 satisfied (evidence above). Docs/rules updated: `agent-core`/`agent-tools` SPECs, `.agents/project-structure.md` line 9, `content/guide/building-agents.md`; ARL-01 moved to Resolved in `.agents/architecture-remediation-log.md` referencing DATA-005. Implemented by the `architecture-implementer` agent; decision signed off by `proposal-reviewer` (ENDORSE after 2 REVISE rounds).
