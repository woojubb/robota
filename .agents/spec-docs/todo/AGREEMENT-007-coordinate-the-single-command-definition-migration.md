---
status: approved
type: AGREEMENT
tags: [agreement, github, commands]
lane: L2
---

# AGREEMENT-007: Coordinate the single command definition migration

Paired with `.agents/tasks/AGREEMENT-007-coordinate-the-single-command-definition-migration.md`.
Arising from [issue #2061](https://github.com/woojubb/robota/issues/2061) under canonical external
problem [issue #2079](https://github.com/woojubb/robota/issues/2079).

## Problem

Issue #2061 and its four leaves duplicate an internal execution graph in GitHub without an independent
external lifecycle. The current tree still reproduces the defect: `ICommandModule` carries parallel
`commandSources` and `systemCommands`; `ICommand` and `ISystemCommand` separately own overlapping identity,
presentation, policy, and invocation fields; and `SystemCommandExecutor` consumes only the executable half.
The reproduction condition is any module that supplies both arrays or manually projects one contract into
the other: a field added to one side can be omitted from the other while both registries remain valid.

All five target Issues are open P1 children with no assignee, Task marker, Task citation, linked open PR,
matching live branch/worktree, or independent-lifecycle evidence. Their manifest rows remain
`OWNER_REVIEW`; this proposal assigns exact Tasks but does not authorize GitHub mutation.

## Prior Art Research

Waived: this conversion applies the already researched and approved RULE-023 Issue-to-Task migration
mechanism. The runtime design remains for the four child Task recommendation gates. Local prior art was
still surveyed: completed ARCH-100 fixes the command-contract owner package, and the current framework,
command, product, transport, and CLI consumers confirm the parallel registry/projection shape persists.

## Architecture Review

### Affected Scope

- The five RULE-023 manifest rows `{2061,2088,2092,2100,2129}`.
- AGREEMENT-007 plus CMD-010 through CMD-013 and this paired planning spec.
- A later separately authorized GitHub evidence batch for issue #2079 and the five targets.

No package/app source, runtime behavior, public API, package placement, or live GitHub record changes in
this prerequisite work unit.

### Alternatives Considered

1. Retain the tracker and four leaves as the execution hierarchy.
   - Pro: avoids migration writes.
   - Con: GitHub and Tasks would duplicate priority, dependency, ownership, and completion state without a
     distinct external lifecycle.
2. Flatten all command work into one Task.
   - Pro: one record is simple to enumerate.
   - Con: contract definition, total projection, skill/plugin migration, and final removal have distinct
     prerequisites and independently verifiable outcomes.
3. Convert to one AGREEMENT plus four ordered CMD Tasks.
   - Pro: preserves the exact cause split and dependency order while keeping cross-tracker prerequisites
     externally visible.
   - Con: requires a prerequisite merge, four later implementation lifecycles, and a separate recoverable
     GitHub apply batch.

### Decision

Choose alternative 3. AGREEMENT-007 owns shared sequencing and terminal reconciliation. CMD-010 owns the
discriminated executable/data contract, CMD-011 owns total projections, CMD-012 owns skill/plugin migration,
and CMD-013 owns final removal and reintroduction prevention. The additional coordination cost is accepted
because flattening would let later migrations or cleanup claim completion before their external
prerequisites are resolved.

Open [issue #2094](https://github.com/woojubb/robota/issues/2094) remains a prerequisite of CMD-012. Open
[issue #2121](https://github.com/woojubb/robota/issues/2121),
[issue #2122](https://github.com/woojubb/robota/issues/2122),
[issue #2123](https://github.com/woojubb/robota/issues/2123),
[issue #2124](https://github.com/woojubb/robota/issues/2124), and
[issue #2125](https://github.com/woojubb/robota/issues/2125) remain prerequisites of CMD-013 and must each
be read individually.
Closed [issue #2080](https://github.com/woojubb/robota/issues/2080) and completed ARCH-100 are historical
owner-map evidence only.

**Delivery mode:** `sequenced`

**Continuation artifacts:** `.agents/evidence/RULE-023-child-issue-migration-manifest.json`, `.agents/spec-docs/active/AGREEMENT-007-coordinate-the-single-command-definition-migration.md`, `.agents/tasks/AGREEMENT-007-coordinate-the-single-command-definition-migration.md`, `.agents/tasks/CMD-010-define-the-discriminated-command-definition-and-serializable-descriptor.md`, `.agents/tasks/CMD-011-derive-command-projections-from-one-definition.md`, `.agents/tasks/CMD-012-migrate-skill-and-plugin-commands-to-discriminated-definitions.md`, `.agents/tasks/CMD-013-remove-parallel-command-contracts-and-registries.md`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — the five targets, native order, current contract owners/consumers, existing Tasks,
      live external prerequisites, open PRs, branches, worktrees, assignees, and markers were checked.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: N/A for this conversion-only unit; each child must independently review any
      later public contract or package-surface change.

## Fallback & Degradation Declaration

None

## Solution

1. Add the exact AGREEMENT/spec and four child Tasks atomically in the native sequence.
2. Update only the five manifest rows with exact candidate Task paths while keeping them
   `OWNER_REVIEW` and mutation-unauthorized.
3. Run the L2 planning gates and land the prerequisite records on `develop` without GitHub mutation.
4. Re-fetch the five targets, canonical issue #2079, all six live prerequisites, historical issue #2080,
   native dependencies, Tasks, PRs, branches, worktrees, and the complete open-Issue population.
5. Only after independent apply review authorizes the exact rows, update issue #2079's complete map,
   append/read exact Task markers, remove P labels, close the five targets `NOT_PLANNED` in reverse order,
   and read every body/state/relationship/dependency back.
6. Keep the Tasks open for their own implementation lifecycles and complete AGREEMENT-007 only after all
   children and issue #2079's full-SHA mappings are complete.

## Completion Criteria

- [ ] TC-01: the exact five-row candidate set is complete, fresh, independently reviewed, maps to
      AGREEMENT-007 plus CMD-010 through CMD-013, and remains mutation-unauthorized before merge.
- [ ] TC-02: parent/child Task and paired spec projections are exact, every source Issue resolves, and
      `CMD-010 → CMD-011 → CMD-012 → CMD-013` matches the native dependency graph.
- [ ] TC-03: issue #2094 and issues #2121–#2125 remain explicit live prerequisites while issue #2080 and
      ARCH-100 are recorded only as history, with no migration claiming their outcomes complete.
- [ ] TC-04: a separately approved apply batch preserves bodies/history/relationships/dependencies, writes
      and reads exact Task markers before P-label removal, and closes only the five authorized rows.
- [ ] TC-05: AGREEMENT-007 completes only after all four child Tasks are done and issue #2079 contains
      resolvable full-SHA links to their exact completed paths.

## Test Plan

| Criterion | Test Type      | Tool/Approach                                                  | Expected Evidence                                     |
| --------- | -------------- | -------------------------------------------------------------- | ----------------------------------------------------- |
| TC-01     | Manifest/live  | JSON assertions plus authenticated GitHub read-back            | Exact five held candidates; no mutation authority     |
| TC-02     | Lifecycle      | Task placement, AGREEMENT projection, and plan-order scans     | Exact IDs, paths, statuses, and dependency order      |
| TC-03     | Live ownership | Read issues 2094, 2121–2125, 2080, and completed ARCH-100      | Live prerequisites and historical evidence stay split |
| TC-04     | Live migration | Frozen apply, immediate read-back, and hierarchy audit         | Five exact terminal results with history/edges intact |
| TC-05     | Completion     | Child lifecycle plus issue 2079 map/full-SHA resolution checks | Four done children and terminal parent reconciliation |

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This work unit changes Task/spec governance and future GitHub Issue administration only; it
exposes no runnable Robota product surface, so child Tasks own future command scenarios.

## Tasks

Paired execution record:
`.agents/tasks/AGREEMENT-007-coordinate-the-single-command-definition-migration.md`.

- [ ] CMD-010 — todo — `.agents/tasks/CMD-010-define-the-discriminated-command-definition-and-serializable-descriptor.md`
- [ ] CMD-011 — todo — `.agents/tasks/CMD-011-derive-command-projections-from-one-definition.md`
- [ ] CMD-012 — todo — `.agents/tasks/CMD-012-migrate-skill-and-plugin-commands-to-discriminated-definitions.md`
- [ ] CMD-013 — todo — `.agents/tasks/CMD-013-remove-parallel-command-contracts-and-registries.md`

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-03

**Status upgrade:** draft → review-ready

- GATE-WRITE — File begins with `---` YAML frontmatter block: PASS — the file begins with a delimited `---` frontmatter block.
- GATE-WRITE — `status: draft` present in frontmatter: PASS — frontmatter declares `status: draft`.
- GATE-WRITE — `type:` is exactly one permitted value: PASS — `type: AGREEMENT` is one of the 11 allowed values.
- GATE-WRITE — `tags:` field present in frontmatter: PASS — `tags:` is present with three values.
- GATE-WRITE — Contains a concrete symptom: PASS — `ICommandModule` exposes parallel `commandSources` and `systemCommands`, `ICommand` and `ISystemCommand` duplicate command metadata, and `SystemCommandExecutor` consumes only `ISystemCommand`; the current source confirms each named shape.
- GATE-WRITE — Contains a reproduction condition: PASS — the Problem identifies any module supplying both arrays or manually projecting between the two contracts, where either valid registry can omit a field added to the other.
- GATE-WRITE — Does not contain `TBD`, `TODO`, or a vague single-sentence Problem: PASS — the Problem contains neither token and has 917 characters across five specific sentences.
- GATE-WRITE — `## Prior Art Research` or `## Research` section present: PASS — `## Prior Art Research` is present.
- GATE-WRITE — Prior Art Research is substantiated by a source, no-comparable-reference result, or waiver: PASS — the section explicitly waives duplicate external research and records the completed ARCH-100 and current local consumer survey.
- GATE-WRITE — Explicit `Waived: <reason>` alternative is satisfied: PASS — the reason scopes this unit to the already researched RULE-023 conversion mechanism while deferring runtime design to child recommendation gates.
- GATE-WRITE — Research findings or waiver feed Alternatives Considered and Decision: PASS — the conversion-only boundary and measured four-part cause split directly support the ordered AGREEMENT alternative and preserve runtime decisions for the children.
- GATE-WRITE — All Architecture Review checklist items are checked: PASS — all five displayed items are `[x]`.
- GATE-WRITE — Sibling scan is checked with completion evidence or an explicit N/A reason: PASS — the checked item names the five targets, native order, contract owners and consumers, Tasks, prerequisites, PRs, branches, worktrees, assignees, and markers inspected.
- GATE-WRITE — Alternatives Considered has at least two entries with Pro and Con: PASS — three numbered alternatives each state both.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — it accepts additional coordination and later lifecycles to preserve four independently verifiable causes and prevent migrations or cleanup from completing ahead of prerequisites.
- GATE-WRITE — New-surface placement conditional: PASS as N/A — this atomic unit changes only manifest and planning records, creates no package, app, runtime/public/presentation interface, sibling-product dependency, or layer/product-family reclassification, and leaves later surface decisions to child gates.
- GATE-WRITE — Every Completion Criterion has a `TC-NN` prefix: PASS — all five criteria are prefixed TC-01 through TC-05.
- GATE-WRITE — At least one criterion exists per distinct feature or sub-item: PASS — TC-01 covers the frozen candidate authority, TC-02 projections and native order, TC-03 live versus historical prerequisites, TC-04 the separately approved mutation/read-back, and TC-05 terminal child/parent reconciliation.
- GATE-WRITE — Each criterion uses Command or Observable behavior form: PASS — every TC requires inspectable rows, paths, statuses, dependency order, Issue state, markers, read-back, child completion, or resolvable full-SHA links rather than a subjective quality claim.
- GATE-WRITE — No criterion uses a forbidden vague phrase: PASS — none contains `works correctly`, `no errors`, `implemented`, or `displays correctly`.
- GATE-WRITE — `## Test Plan` section present: PASS — the section is present.
- GATE-WRITE — One Test Plan row exists for each Completion Criterion: PASS — five rows match five TC criteria.
- GATE-WRITE — Every Test Plan row has a non-empty Test Type and Tool/Approach without `TBD`: PASS — all five rows satisfy the required fields.
- GATE-WRITE — Manual Test Plan rows explain why automation is impossible: PASS — there are zero manual rows.
- GATE-WRITE — `## Tasks` section present with placeholder: PASS — it names the paired AGREEMENT record and all four todo child Tasks.
- GATE-WRITE — `## Evidence Log` was present and empty before this first entry: PASS — the mechanical dry-run observed zero prior entries and no later-gate entry.
- GATE-WRITE — No body `## Status` or `## Classification` section: PASS — neither body section exists.

### [GATE-APPROVAL] — ✅ PASS | 2026-09-03

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "지금부터 좀더 신속하게 하기
위해 작업을 몰아서 하세요. 매 작업마다
검증하지 말고 한꺼번에 다 처리해서 검증은 큰 묶음에서 한방에 하도록 하고. 필요하다면 절차를 다 생략해도 됩니다"
**Given:** 2026-09-03, this conversation
**Review fingerprint:** 3a0bc1013f2b (review 5bf1e8e6, type/tags e68795cb)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-03, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (3a0bc1013f2b) equals the document's current fingerprint
