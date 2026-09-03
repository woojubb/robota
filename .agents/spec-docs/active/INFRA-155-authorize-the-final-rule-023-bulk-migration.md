---
status: in-progress
type: INFRA
tags: [github, migration, governance]
lane: L2
---

# INFRA-155: authorize the final RULE-023 bulk migration

Paired with `.agents/tasks/INFRA-155-authorize-the-final-rule-023-bulk-migration.md`.

## Problem

The final RULE-023 batch cannot be applied safely because the durable manifest still reports only 8 ABSORB and 0 RETAIN rows, despite 48 additional exact Task mappings and 20 independent-lifecycle decisions being approved. Staging the manifest now is refused by `scan-user-execution-plan-order.mjs --staged --base develop` with `staged implementation has no planning checkpoint ancestor`; the same final integration would also fail on one append-only AGREEMENT-008 evidence reference that must be frozen rather than rewritten.

## Prior Art Research

Waived: RULE-023 and INFRA-152 already define the repository-local migration and multi-Issue ownership contracts. This work only binds an approved finite set to those existing contracts and creates no new product or architectural surface.

## Architecture Review

### Affected Scope

- The RULE-023 durable manifest and reference-kind baseline.
- This exact paired INFRA Task/spec.
- No product code, package, public API, or GitHub mutation in the authorization commit.

### Alternatives Considered

1. **Bypass planning-order or edit append-only evidence.**
   - Pro: fewer commits.
   - Con: destroys the provenance boundary and evidence immutability.
2. **Create one exact owner checkpoint for both governance files.**
   - Pro: preserves authorization ordering while batching both remaining local debts.
   - Con: adds one planning lifecycle.
3. **Authorize rows during GitHub mutation.**
   - Pro: combines local and external writes.
   - Con: removes the pre-mutation rollback and review boundary.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — governance evidence only.
- [x] Sibling scan 완료 — RULE-023 manifest, all 48 live Tasks, 20 RETAIN reasons, and reference baseline were inspected.
- [x] 대안 최소 2개 검토 완료 — three alternatives above.
- [x] 결정 근거 문서화 완료 — immutable preauthorization outweighs one extra lifecycle.
- [x] New-surface placement: N/A — no runtime or product surface.

### Decision

Use one INFRA checkpoint and one implementation batch. This accepts one additional planning lifecycle in exchange for a durable pre-mutation boundary that binds all exact rows, Task owners, owner approval, expected population arithmetic, and the one approved baseline freeze before any GitHub write.

**Delivery mode:** `single`

## Frozen Authorization

Population baseline: 272 open Issues. Expected result: `272 - 48 ABSORB closures - 1 COMPLETED closure + 3 parent reopens = 226` open Issues.

RETAIN IDs: issue #1989, issue #1990, issue #2066, issue #2067, issue #2073, issue #2075, issue #2076, issue #2077, issue #2078, issue #2504, issue #2515, issue #2516, issue #2517, issue #2520, issue #2522, issue #2525, issue #2526, issue #2527, issue #2533, issue #2534. Each requires `Semantic review: @woojubb on 2026-09-03 — RETAIN` plus its substantive manifest reason.

| ABSORB Issue | Exact live Task                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| issue #2061  | `.agents/tasks/AGREEMENT-007-coordinate-the-single-command-definition-migration.md`                           |
| issue #2062  | `.agents/tasks/AGREEMENT-009-coordinate-the-kind-safe-background-task-migration.md`                           |
| issue #2064  | `.agents/tasks/REFACTOR-027-remove-phantom-service-and-factory-ports-from-agent-core.md`                      |
| issue #2065  | `.agents/tasks/REFACTOR-028-finish-removing-the-ghost-workflow-subsystem-from-agent-core.md`                  |
| issue #2069  | `.agents/tasks/TRANS-012-coordinate-exact-session-capability-transport-bindings.md`                           |
| issue #2071  | `.agents/tasks/AGREEMENT-010-coordinate-the-remote-control-host-extraction.md`                                |
| issue #2072  | `.agents/tasks/CMD-014-coordinate-command-features-as-owner-aligned-vertical-slices.md`                       |
| issue #2074  | `.agents/tasks/HOST-015-coordinate-headless-and-programmatic-host-extraction.md`                              |
| issue #2086  | `.agents/tasks/REMOTE-015-extract-the-pure-remote-control-host-state-reducer.md`                              |
| issue #2087  | `.agents/tasks/HOST-016-extract-the-headless-stdio-host-package.md`                                           |
| issue #2088  | `.agents/tasks/CMD-010-define-the-discriminated-command-definition-and-serializable-descriptor.md`            |
| issue #2089  | `.agents/tasks/DATA-010-define-the-kind-indexed-background-task-contract-map.md`                              |
| issue #2090  | `.agents/tasks/HANDOFF-002-move-authority-transitions-into-session-mobility.md`                               |
| issue #2091  | `.agents/tasks/TRANS-011-the-transport-registry-erases-heterogeneous-exact-session-capabilities-into-one-.md` |
| issue #2092  | `.agents/tasks/CMD-011-derive-command-projections-from-one-definition.md`                                     |
| issue #2094  | `.agents/tasks/SECURITY-003-migrate-skill-and-plugin-discovery-to-the-strict-decoder.md`                      |
| issue #2095  | `.agents/tasks/SECURITY-004-migrate-agent-definition-loading-to-the-strict-decoder.md`                        |
| issue #2098  | `.agents/tasks/TRANS-016-decode-jsonl-events-by-event-name-before-replay.md`                                  |
| issue #2099  | `.agents/tasks/SEC-021-reject-configured-hook-types-without-reachable-executors.md`                           |
| issue #2100  | `.agents/tasks/CMD-012-migrate-skill-and-plugin-commands-to-discriminated-definitions.md`                     |
| issue #2101  | `.agents/tasks/ARCH-117-type-the-runner-registry-and-migrate-background-runners.md`                           |
| issue #2103  | `.agents/tasks/HOST-017-extract-the-programmatic-in-process-host-package.md`                                  |
| issue #2105  | `.agents/tasks/REMOTE-016-define-the-remote-control-host-facade-and-effect-ports.md`                          |
| issue #2106  | `.agents/tasks/HANDOFF-003-move-inventory-and-refusal-policy-into-session-mobility.md`                        |
| issue #2107  | `.agents/tasks/TRANS-013-bind-http-and-mcp-to-their-exact-session-ports.md`                                   |
| issue #2114  | `.agents/tasks/DATA-011-migrate-persisted-background-state-and-command-views-to-kind-safe-variants.md`        |
| issue #2116  | `.agents/tasks/TRANS-014-bind-ws-protocol-and-webrtc-adapters-to-exact-session-ports.md`                      |
| issue #2117  | `.agents/tasks/TRANS-015-remove-iinteractive-session-from-production-transport-seams.md`                      |
| issue #2119  | `.agents/tasks/REMOTE-017-implement-node-identity-and-trusted-device-repository-adapters.md`                  |
| issue #2120  | `.agents/tasks/REMOTE-018-wire-the-host-service-into-cli-and-delete-the-controller.md`                        |
| issue #2121  | `.agents/tasks/CMD-015-move-execution-background-and-schedule-commands-to-their-owners.md`                    |
| issue #2122  | `.agents/tasks/CMD-016-move-session-history-compact-and-rewind-commands-to-their-owners.md`                   |
| issue #2123  | `.agents/tasks/CMD-017-move-provider-settings-and-plugin-commands-to-their-owners.md`                         |
| issue #2124  | `.agents/tasks/CMD-018-move-help-language-and-permission-commands-to-the-product-shell.md`                    |
| issue #2125  | `.agents/tasks/CMD-019-expose-coding-commands-as-leaf-entries-and-remove-umbrella-consumers.md`               |
| issue #2126  | `.agents/tasks/HANDOFF-004-move-source-and-destination-orchestration-into-session-mobility.md`                |
| issue #2127  | `.agents/tasks/HANDOFF-005-reduce-transport-protocol-to-codecs-and-remove-the-cli-bridge.md`                  |
| issue #2128  | `.agents/tasks/HOST-018-migrate-consumers-and-remove-the-agent-transport-umbrella.md`                         |
| issue #2129  | `.agents/tasks/CMD-013-remove-parallel-command-contracts-and-registries.md`                                   |
| issue #2518  | `.agents/tasks/INFRA-154-reuse-final-tree-verification-receipts-and-parallelize-independent-gates.md`         |
| issue #2519  | `.agents/tasks/MCP-001-add-a-typed-mcp-configuration-and-management-control-plane.md`                         |
| issue #2521  | `.agents/tasks/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md`                        |
| issue #2523  | `.agents/tasks/MCP-003-add-an-mcp-connection-and-capability-catalog-supervisor.md`                            |
| issue #2524  | `.agents/tasks/MCP-004-hand-long-running-mcp-calls-to-background-tasks.md`                                    |
| issue #2528  | `.agents/tasks/MCP-005-project-mcp-tool-schemas-safely-across-providers.md`                                   |
| issue #2530  | `.agents/tasks/MCP-006-export-canonical-session-runtime-tools-through-mcp.md`                                 |
| issue #2531  | `.agents/tasks/MCP-007-ship-robota-mcp-serve-as-a-carrier-owning-stdio-product-mode.md`                       |
| issue #2532  | `.agents/tasks/MCP-008-prove-an-mcp-served-session-can-also-consume-mcp-tools.md`                             |

Reconciliation-only rows are issue #2093 (delivery evidence then COMPLETED closure) and issue #2514 (already resolved; no mutation).

## Solution

1. Create the exact paired checkpoint on current `develop`.
2. Update the manifest to 56 total ABSORB, 20 RETAIN, and 2 reconciliation rows, with 48 unique new live Task mappings.
3. Add only the approved single-path/single-count reference baseline entry for active AGREEMENT-008.
4. Verify the combined staged state and commit it before external mutation.

## Completion Criteria

- [ ] TC-01: Observable: the manifest exactly matches the 48 issue-to-Task rows frozen above and every path exists uniquely.
- [ ] TC-02: Observable: the manifest exactly matches the 20 RETAIN IDs frozen above, each with a substantive external-lifecycle reason and `@woojubb` review receipt.
- [ ] TC-03: Observable: issue #2093 and issue #2514 are the only reconciliation rows; counts are ABSORB 56, RETAIN 20, OWNER_REVIEW 2; and the frozen `272-48-1+3` formula yields 226.
- [ ] TC-04: Observable: the reference baseline adds exactly one occurrence for the active AGREEMENT-008 path and the scanner exits zero.
- [ ] TC-05: Command: staged planning-order, reference-kind, manifest assertions, and `git diff --check` all exit zero.

## Test Plan

| Criterion | Test Type | Tool / Approach                                    |
| --------- | --------- | -------------------------------------------------- |
| TC-01     | automated | exact-set and live Task identity assertion         |
| TC-02     | automated | RETAIN reason and reviewer receipt assertion       |
| TC-03     | automated | manifest count and population arithmetic assertion |
| TC-04     | automated | reference-kind baseline scan                       |
| TC-05     | automated | combined staged governance scans                   |

The manifest authorization and reference baseline are delivered together as one bounded governance batch.

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This work changes governance evidence only; all observable outcomes are machine-verifiable and no product user surface changes.

## Tasks

Paired execution record: `.agents/tasks/INFRA-155-authorize-the-final-rule-023-bulk-migration.md`.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-03

**Status upgrade:** draft → review-ready

- GATE-WRITE — File begins with `---` YAML frontmatter block: PASS — the file begins with a delimited `---` frontmatter block.
- GATE-WRITE — `status: draft` present in frontmatter: PASS — frontmatter declares `status: draft`.
- GATE-WRITE — `type:` is exactly one permitted value: PASS — `type: INFRA` is one of the 11 allowed values.
- GATE-WRITE — `tags:` field present in frontmatter: PASS — `tags:` is present with three values.
- GATE-WRITE — Contains a concrete symptom: PASS — the durable manifest still reports only 8 ABSORB and 0 RETAIN rows despite 48 approved Task mappings and 20 RETAIN decisions, while the staged planning-order scanner refuses the manifest and an append-only AGREEMENT-008 reference remains unfrozen.
- GATE-WRITE — Contains a reproduction condition: PASS — staging the manifest and running `scan-user-execution-plan-order.mjs --staged --base develop` produces exit failure with `staged implementation has no planning checkpoint ancestor` before the final integration.
- GATE-WRITE — Does not contain `TBD`, `TODO`, or a vague single-sentence Problem: PASS — the Problem contains neither token and has 526 characters across two specific sentences.
- GATE-WRITE — `## Prior Art Research` or `## Research` section present: PASS — `## Prior Art Research` is present.
- GATE-WRITE — Prior Art Research is substantiated by a source, no-comparable-reference result, or waiver: PASS — the section explicitly waives duplicate external research because RULE-023 and INFRA-152 already define the repository-local migration and multi-Issue ownership contracts.
- GATE-WRITE — Explicit `Waived: <reason>` alternative is satisfied: PASS — the waiver explains that this finite binding operation creates no new product or architecture surface.
- GATE-WRITE — Research findings or waiver feed Alternatives Considered and Decision: PASS — the established preauthorization and ownership contracts directly yield the bypass, exact owner checkpoint, and mutation-time alternatives and the selected pre-mutation checkpoint.
- GATE-WRITE — All Architecture Review checklist items are checked: PASS — all five displayed items are `[x]`.
- GATE-WRITE — Sibling scan is checked with completion evidence or an explicit N/A reason: PASS — the checked item records inspection of the RULE-023 manifest, all 48 live Tasks, 20 RETAIN reasons, and the reference baseline.
- GATE-WRITE — Alternatives Considered has at least two entries with Pro and Con: PASS — three numbered alternatives each state both.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — it accepts one additional planning lifecycle in exchange for a durable pre-mutation provenance and rollback boundary covering exact owners, approval, population arithmetic, and the approved baseline freeze.
- GATE-WRITE — New-surface placement conditional: PASS as N/A — this governance-only authorization introduces no package, app, presentation/public interface, product-family surface, or layer reclassification.
- GATE-WRITE — Every Completion Criterion has a `TC-NN` prefix: PASS — all five criteria are prefixed `TC-01:` through `TC-05:`.
- GATE-WRITE — At least one criterion exists per distinct feature or sub-item: PASS — TC-01 covers the exact 48 ABSORB mappings and live Tasks; TC-02 the 20 substantive RETAIN decisions and reviewer receipts; TC-03 manifest and population counts; TC-04 the single AGREEMENT-008 baseline occurrence; and TC-05 all combined staged governance scans.
- GATE-WRITE — Each criterion uses Command or Observable behavior form: PASS — every criterion requires exact sets, live paths, substantive receipts, exact counts, a single baseline occurrence, or named scans and `git diff --check` exiting zero.
- GATE-WRITE — No criterion uses a forbidden vague phrase: PASS — none contains `works correctly`, `no errors`, `implemented`, or `displays correctly`.
- GATE-WRITE — `## Test Plan` section present: PASS — the section is present.
- GATE-WRITE — One Test Plan row exists for each Completion Criterion: PASS — five rows match the five completion criteria.
- GATE-WRITE — Every Test Plan row has a non-empty Test Type and Tool/Approach without `TBD`: PASS — all five rows satisfy the required fields.
- GATE-WRITE — Manual Test Plan rows explain why automation is impossible: PASS — there are zero manual rows.
- GATE-WRITE — `## Tasks` section present with placeholder: PASS — the section names the paired INFRA-155 execution record.
- GATE-WRITE — `## Evidence Log` was present and empty before this first entry: PASS — the mechanical dry-run observed zero prior entries and no later-gate entry.
- GATE-WRITE — No body `## Status` or `## Classification` section: PASS — neither body section exists.

### [GATE-APPROVAL] — ✅ PASS | 2026-09-03

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "한꺼번에 모두 승인함. 더이상 승인 못할 이유가 없음"
**Given:** 2026-09-03, this conversation
**Review fingerprint:** dca5276ef622 (review e913bb53, type/tags 964acd44)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-03, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (dca5276ef622) equals the document's current fingerprint
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — immediately after the exact INFRA-155 authorization scope was presented, the user replied `한꺼번에 모두 승인함. 더이상 승인 못할 이유가 없음`; the first sentence directly approves the whole presented batch and the second explicitly removes any residual approval ambiguity.
- GATE-APPROVAL — The item is inside the class as the registry defines it: PASS (N/A) — the entry selects the mutually exclusive DIRECT route, so no delegated approval class is asserted and the Route CLASS boundary criterion does not apply.
- GATE-APPROVAL — Independent architecture validation (conditional): PASS (N/A) — this governance-only authorization introduces no package, app, product/interface/presentation surface, sibling-product dependency, or layer/product-family reclassification; its GATE-WRITE review records the same N/A boundary.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-03

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-03; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-155-authorize-the-final-rule-023-bulk-migration.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-155-authorize-the-final-rule-023-bulk-migration.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (5)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 413 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/INFRA-155-authorize-the-final-rule-023-bulk-migration.md",
  "specPath": ".agents/spec-docs/todo/INFRA-155-authorize-the-final-rule-023-bulk-migration.md",
  "taskItems": [
    {
      "kind": "tc-id",
      "value": "TC-01"
    },
    {
      "kind": "tc-id",
      "value": "TC-02"
    },
    {
      "kind": "tc-id",
      "value": "TC-03"
    },
    {
      "kind": "tc-id",
      "value": "TC-04"
    },
    {
      "kind": "tc-id",
      "value": "TC-05"
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/INFRA-155-authorize-the-final-rule-023-bulk-migration.md",
    ".agents/tasks/INFRA-155-authorize-the-final-rule-023-bulk-migration.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->
