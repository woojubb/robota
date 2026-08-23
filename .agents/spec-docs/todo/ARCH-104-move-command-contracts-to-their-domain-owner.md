---
status: approved
type: DATA
tags: [typescript]
---

# ARCH-104: move command and capability contracts to their domain owner

Registered as GitHub issue https://github.com/woojubb/robota/issues/2108.
Parent tracker: issue #2068. Owner map: ARCH-100. Layer rule: ARCH-101.

## Problem

**Concrete symptom.** `packages/agent-command` — the package whose entire subject is commands —
imports `ICommand`, `ICommandResult`, `ICommandSource` and 18 more of its own domain's contracts from
`@robota-sdk/agent-interface-transport`, across **64 files**. Nothing in that path involves transport.

**Reproduction condition.** Present on every checkout. This is the second wave-1 leaf of the owner map
merged by ARCH-100; ARCH-103 moved the execution family and proved the shape.

**Measured on `origin/develop` @ `bd50f8b28`:** 21 symbols across two modules; 9 consumer packages;
110 import statements; 12 of them MIXED.

## Prior Art Research

Waived: the prior-art question for this change was answered by ARCH-103's spec-doc
(`.agents/spec-docs/done/ARCH-103-move-execution-contracts-to-their-domain-owner.md` §
Prior Art Research), which cited Nx's `@nx/workspace:move` generator for the importer-rewrite
mechanics and Semantic Versioning 2.0.0 §4/§9 for why a prerelease owes no forwarding alias. This leaf
is the same operation on a different family, under the same owner map and the same rule, and no new
external question arises. Re-researching it would produce the same two citations.

## Architecture Review Checklist

- [x] Affected package/layer list complete — a new `agent-interface-command`;
      `agent-interface-transport` loses two modules and their barrel exports; 9 consumer packages
      change import specifiers. No runtime value, signature or shipped behavior changes.
- [x] Sibling scan complete — `agent-interface-execution` (ARCH-103) is the direct precedent and the
      template: same manifest shape, same layer, same `interface-runtime` / `interface-imports` /
      `interface-family-owner` policing. Its PLACEMENT condition already arms for the four execution
      modules and will arm for these two.
- [x] At least 2 alternatives considered — see Alternatives Considered.
- [x] Decision rationale documented — see Decision.

**New-surface placement (conditional — APPLIES, one new package):** (a) it mirrors
`agent-interface-execution` and `agent-interface-tui`, `agent-interface-*` **contract layer**
packages — declarations only, no runtime mechanism. Contract-layer packages are not a product family.
(b) Reuse is at the shared contract/core level: manifest dependencies `{agent-core}` **only**, layer 0
with no peer edge, no product package depended on. Its layer is declared in
`.agents/specs/contract-family-owner-map.md` per ARCH-101.

## Alternatives Considered

**A — Create the owner, move both modules, rewire every consumer, in one change.** (chosen)

- Pro: the end state issue #2068 requires, reached directly, using the codemod and manifest passes
  ARCH-103 debugged. The tree is never half-migrated.
- Con: one atomic change across 10 packages. `agent-command`'s 64 files make it the most concentrated
  rewrite of the programme so far.

**B — Move `command-contracts` and leave `capability-contracts` in transport.**

- Pro: a smaller diff, and `capability-contracts` has no consumer outside the package, so it looks
  like it could stay.
- Con: **it creates an upward edge and would be refused.** `command-contracts` is
  `capability-contracts`'s only importer, so leaving it behind makes `command(0) → transport(1)` —
  upward, which ARCH-101's rule forbids and `interface-family-owner`'s LAYER condition catches. The
  "no external consumer" observation that makes B tempting is exactly the one the owner ruled on in
  issue #2177, and the ruling was to keep the export, not to strand the module.

## Decision

Adopt **A**.

The trade-off that drove it: B is smaller and is refused by the rule, which settles it without
appeal — but the interesting half is _why_ it looked plausible. `capability-contracts` has zero
external consumers, and that measurement invites the conclusion that it can stay put or be narrowed.
It established the question and never answered it, which is the lesson recorded on issue #2177.

**`capability-contracts` moves with its export intact.** The owner ruled on issue #2177 that it stays
public. This leaf carries out that decision and removes no surface.

**`agent-interface-transport` stays declared at layer 1.** It still holds the session family until
issue #2110. Declaring it at its target 0 is the trap that refused a legal migration in ARCH-103: the
real `transport → command` edge would read as same-layer. The layer describes where a package IS.

## Completion Criteria

- [ ] **TC-01** `packages/agent-interface-command` exists holding `command-contracts` and
      `capability-contracts`, with manifest dependencies `{@robota-sdk/agent-core}` and nothing else.
- [ ] **TC-02** Its barrel exports all 21 symbols including the three capability contracts, per the
      issue #2177 ruling.
- [ ] **TC-03** `agent-interface-transport`'s barrel exports none of the 21, and no forwarding
      re-export is added anywhere.
- [ ] **TC-04** All 9 consumer packages import command contracts from
      `@robota-sdk/agent-interface-command`; each of the 12 mixed statements is split so that only
      moving symbols change specifier.
- [ ] **TC-05** `interface-family-owner` reports both modules placement-checked in their owner and a
      legal layer graph; `deps` accepts `transport(1) → command(0)` as downward.
- [ ] **TC-06** `pnpm harness:scan` exits 0 and `pnpm harness:verify-like-ci` reports green.

## Test Plan

| TC    | Test Type   | Tool / Approach                                                                          | Notes                                                              |
| ----- | ----------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| TC-01 | Structural  | Read the new manifest; `deps` and `dep-kind` assert the dependency set                   | —                                                                  |
| TC-02 | Structural  | Assert the barrel's export list against the two modules' declarations                    | —                                                                  |
| TC-03 | Structural  | Diff the transport barrel; assert none of the 21 remains                                 | —                                                                  |
| TC-04 | Compilation | Workspace `pnpm typecheck` — a missed or over-eager rewrite fails to resolve             | Type-level move: the compiler is the assertion, not a bespoke test |
| TC-05 | Gate        | `node scripts/harness/scan-interface-family-owner.mjs`; `check-dependency-direction.mjs` | —                                                                  |
| TC-06 | Gate        | `pnpm harness:scan`; `pnpm harness:verify-like-ci`                                       | manual invocation — `verify-like-ci` is the CI-mirror entry point  |

## User Execution Test Scenarios

**Not applicable — this task delivers no user-facing behavior.** It relocates type contracts between
packages. No runtime value, function signature, CLI surface, file format or observable behavior
changes; every moved declaration is a type erased at build time.

What a consumer sees is the import specifier, which is a source-level concern for developers building
on the SDK rather than an end-user surface. The verification surface is the workspace typecheck, the
harness gate, and the 9 consumer packages' own suites, recorded in the Test Plan above.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-23

**Status upgrade:** draft → review-ready
**Judged by:** self-assessment against `.agents/specs/gate-catalogue.md` § GATE-WRITE. Not a
`backlog-gate-guard` verdict.

- Frontmatter: `status: draft`, `type: DATA`, `tags: [typescript]`; frontmatter scan exits 0.
- Problem — concrete symptom: `agent-command` importing 21 named contracts of its own domain from a
  transport-named package across 64 files, with the measured scope beside it.
- Problem — reproduction condition and figures measured at `bd50f8b28`, not carried forward.
- Prior Art Research: explicit `Waived:` with the reason — ARCH-103's spec answered the same question
  for the same operation under the same rule, and the two citations would be identical.
  `scan-spec-research` accepts it.
- Architecture Review Checklist: all 4 `[x]`; sibling scan names `agent-interface-execution` as the
  direct precedent and the three scans that police the result.
- New-surface placement (conditional — APPLIES): (a) mirrors `agent-interface-execution`, contract
  layer, not a product family; (b) deps `{agent-core}` only, layer 0, no peer edge.
- Alternatives Considered: 2 entries with Pro and Con; B carries the specific rule that refuses it.
- Decision: names the driving trade-off and, more usefully, why B looked plausible — a zero-consumer
  measurement establishing a question it does not answer.
- Completion Criteria: 6 items, all `TC-N`, command or observable-behavior form.
- Test Plan: 6 rows for 6 TCs, each with Test Type and Tool/Approach; TC-04 states why the compiler is
  the assertion and TC-06 notes the manual invocation.
- `## User Execution Test Scenarios` present with an explicit not-applicable and its reason — written
  now rather than discovered at `spec-user-execution-section` on the way to `done/`, which is where
  ARCH-100, HARNESS-116, HARNESS-117 and ARCH-101 all met it.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-23

**Status upgrade:** review-ready → approved

Passed on the standing delegation recorded in ARCH-100's spec-doc, in RULE-012's three-part form. The
provenance limit recorded there applies unchanged; see
`.agents/spec-docs/done/ARCH-100-contract-family-owner-map-and-acyclic-target-graph.md` §
GATE-APPROVAL.

**1 — The delegation.** As recorded in ARCH-100, corroborated in-repo by
`.agents/tasks/completed/RULE-012-…md` § Evidence.

**2 — The evidence condition is satisfied**, measured at `bd50f8b28` rather than reused: 21 symbols,
9 consumer packages, 110 statements, 12 mixed, and the two transport modules that still name command
types.

**3 — The item is inside the delegated class.** It relocates type declarations between packages,
moves no runtime value, and changes no shipped behavior. The two things that could take it outside
were both settled before this leaf:

- **Public surface.** No export is removed. `capability-contracts` moves **with its export intact**
  because the owner ruled exactly that on issue #2177. The transport barrel loses the 21 symbols, but
  the owner map relocating them is ARCH-100's merged decision and the owner ruled
  「레거시는 고려하지 마세요. 아직 출시 전입니다」 (`code-quality.md:59`) on forwarding aliases.
- **The interface→interface edge.** `transport(1) → command(0)` is a declared downward edge under
  ARCH-101, which landed the owner's layer ruling.

Nothing here decides which family belongs to which owner — that is ARCH-100's, merged and unchanged.
