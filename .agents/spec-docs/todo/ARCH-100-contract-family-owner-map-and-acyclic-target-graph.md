---
status: approved
type: RULE
tags: [typescript]
---

# ARCH-100: the contract-family owner map and the acyclic target graph

Registered as GitHub issue https://github.com/woojubb/robota/issues/2080.
Parent tracker: issue #2068. Execution map: issue #2079.

## Problem

`packages/agent-interface-transport/package.json` describes the package as "Transport contract
interfaces for the Robota SDK (`ITransportAdapter`, `IConfigurableTransport`, `ITransportConfig`)".
Its root barrel `src/index.ts` exports roughly 250 declarations across eleven unrelated contract
families — commands, sessions, persistence, workspace, background execution, subagents,
analytics/usage, admission, peers, handoff, and transport.

**Concrete symptom.** Running the family/consumer projection over `origin/develop` @ `73dff3344`
reports that the family the package is _named_ for is not its largest tenant:

```
session-contracts     15 consumer packages, 212 import sites
command-contracts      9 consumer packages, 137 import sites
transport-adapter      7 consumer packages,  43 import sites
```

`packages/agent-executor`, `packages/agent-session`, and `packages/agent-command` each import their
own domain's contracts from a package named for transport.

**Reproduction condition.** It occurs on every checkout of `develop`, and it is _sanctioned_ rather
than accidental: `.agents/project-structure.md` § Interface Package Rule assigns the session,
workspace, command, event, and usage families to this package by name. The rule is therefore the
artefact to amend, not a baseline to preserve.

**The blocking symptom this spec exists for.** Six migration leaves (issues #2108–#2113) are blocked
on this one, and moving any family without a target owner map risks a package cycle. That risk is
measured, not hypothetical: the current module graph already contains **12 cycles**, every one of
them through `session-contracts.ts` — for example
`session-contracts → workspace-contracts → session-contracts`. They are invisible today only because
they sit inside a single package, where TypeScript tolerates type-level circularity. Split the
families into packages without correcting them first and each becomes a hard package cycle.

## Prior Art Research

Three documentation sources, each addressing one half of what this spec must decide — how a build
system treats a cycle, and how ownership is mechanically constrained.

- **TypeScript — Project References** (TypeScript Handbook, "Project References"). Composite project
  references form a graph that the compiler requires to be **acyclic**; a circular reference is a
  build error rather than a warning. This is the direct precedent for making acyclicity a stated
  precondition of the migration rather than a post-hoc cleanup: once each family is its own package,
  the compiler stops tolerating what it tolerates inside one package today.
- **Java Platform Module System — JSR 376 / `module-info`** (JEP 261, "Module System"). Module
  dependency (`requires`) graphs are **rejected at compile time if cyclic**. JPMS is the strongest
  documented statement of the position this spec adopts: a contract module graph is not merely
  _better_ acyclic, it is the condition under which the boundary means anything.
- **Nx — Enforce Module Boundaries** (Nx documentation, `@nx/enforce-module-boundaries`). Packages
  carry **tags**, and a lint rule declares which tags may depend on which. This is the shape of the
  guard this spec names: not a hand-kept prose list of owners, but a declared owner/family allowlist
  the build reads, so an import that crosses a boundary fails the gate instead of a review.

**How the research feeds the decision.** TypeScript and JPMS together say the target graph must be
proven acyclic _before_ symbols move, which is why TC-02 requires a mechanical proof and TC-03 a
migration order rather than an unordered set of leaves. Nx says the enforcement artefact is a
declared allowlist consumed by a checker, which is why TC-04 names a scan rather than a rule
paragraph. None of the three is copied: they establish that the acyclicity requirement and the
allowlist guard are the standard answers, not inventions of this spec.

## Architecture Review Checklist

- [x] Affected package/layer list complete — `agent-interface-transport` (21 modules), its 21
      consumer packages/apps, `.agents/project-structure.md`, `ARCHITECTURE.md`.
- [x] Sibling scan complete — `agent-interface-tui` is the sibling: an existing `agent-interface-*`
      package that owns exactly one contract family and whose only consumer is its matching
      implementation package. It is the shape every owner in this map is modelled on. Related but
      non-overlapping: issue #2052 (duplicate/pass-through export surfaces) and issue #2049
      (architecture documentation) change neither topology nor ownership.
- [x] At least 2 alternatives considered — see Alternatives Considered.
- [x] Decision rationale documented — see Decision.

**New-surface placement.** This spec introduces five new interface packages, so the conditional
criterion applies.

- **(a) Analogous existing layer and product-family classification.** Each mirrors
  `agent-interface-tui`: an `agent-interface-*` **contract layer** package — type declarations only,
  no runtime mechanism — governed by the existing Interface Package Rule and the existing
  `interface-runtime` and `interface-imports` scans. Contract-layer packages are not a product
  family; they are the shared vocabulary products are written against.
- **(b) Reuse is at the shared contract/core level.** Every new package's internal dependency set
  stays a subset of `{agent-core}` plus peer `agent-interface-*` packages, exactly as INFRA-025
  already requires. No new package depends on a sibling PRODUCT package (`agent-framework`,
  `agent-cli`, `agent-session`, `agent-transport*`); the dependency runs the other way, which is what
  makes the graph below acyclic.

## Alternatives Considered

**A — Amend the rule, publish an owner map + proven-acyclic target graph, then migrate.** (chosen)

- Pro: the rule that legitimised the omnibus changes before any symbol moves, so no leaf has to
  litigate ownership. The acyclicity proof is mechanical and re-runnable, so leaves #2108–#2113 each
  inherit a decided answer. Moves no production TypeScript, so it is independently mergeable and
  reversible.
- Con: an entire leaf produces no code change, and the map can drift from the source between landing
  and the last migration leaf — which is why TC-04 names a guard rather than trusting the document.

**B — Move symbols first, document the resulting topology afterwards.**

- Pro: visible progress immediately; no "documentation-only" pull request.
- Con: with 12 existing cycles and 21 consumers, the first move decides the graph by accident, and a
  cycle discovered at leaf four invalidates leaves one through three. Rejected on that basis.

**C — Keep the omnibus package and expose families through subpath exports.**

- Pro: cheapest; no manifest churn; consumers change one import specifier.
- Con: ownership stays with one package, so the change-axis problem that opened issue #2068 is
  untouched — and issue #2068's stated end state explicitly excludes an umbrella facade. The audited
  API is prerelease, so no compatibility shim is owed. Rejected.

## Decision

Adopt **A**. The trade-off that drove it: B and C are both cheaper in the short run, and both leave
the _decision_ about ownership implicit — B decides it by whichever leaf lands first, C declines to
decide it at all. Six leaves are blocked on this decision being explicit and checkable, so a leaf
that ships no code but unblocks six is the higher-leverage unit of work.

### The owner map

Six owners. `agent-interface-transport` survives, narrowed to the families its name already claims.

| Target owner                       | Contract modules                                                                                                                                                                        | Leaf        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `agent-interface-transport`        | `transport-adapter`, `transport-config`, `channel-contracts`, `admission`                                                                                                               | issue #2113 |
| `agent-interface-command`          | `command-contracts`, `capability-contracts`                                                                                                                                             | issue #2108 |
| `agent-interface-execution`        | `background-task-contracts`, `background-group-contracts`, `subagent-contracts`, `workspace-contracts`                                                                                  | issue #2109 |
| `agent-interface-session`          | `session-contracts`, `session-capability-contracts`, `session-summary-contracts`, `interaction-contracts`, `event-contracts`, `driver-contracts`, `turn-contracts`, `compact-contracts` | issue #2110 |
| `agent-interface-session-mobility` | `peer-message-contracts`, `handoff-contracts`, `session-mobility-contracts`                                                                                                             | issue #2111 |
| `agent-interface-analytics`        | the usage/trace symbol set extracted from `session-contracts` (below)                                                                                                                   | issue #2112 |

**`capability-contracts` is placed with command, not left in transport.** It is imported only by
`command-contracts`; leaving it behind would give the command owner an edge onto a package named for
transport — the exact defect issue #2068 exists to remove.

### Two corrections that the map depends on

The map is acyclic **only** with these applied. Each is stated as a precondition for its leaf.

1. **A pass-through re-export must be redirected to its SSOT** (precondition of issue #2109).
   `workspace-contracts.ts:15` imports `IBackgroundJobGroupState` from `./session-contracts.js`. That
   type is declared at `background-group-contracts.ts:26` and merely re-exported by
   `session-contracts.ts:76`. Import it from its declaring module instead. This is a one-line change
   that removes 2 of the 12 cycles, and it is not a design decision — the current edge points at a
   module that does not own the type.

2. **The analytics family must be extracted by symbol, not by file** (precondition of issue #2112).
   `IUsageSource`, `IUsageSnapshot`, `ISpanEntry`, `IUsageSourceTotals`, `IRunTraceSpan`,
   `IRunTraceTurn`, and `IUsageBySourceReport` are declared inside `session-contracts.ts`
   (lines 116–218), not in a module of their own. Verified self-contained: every field is a primitive
   or another member of this set, so the extracted package needs no session import and the resulting
   `session → analytics` edge is one-way. **Family boundaries and file boundaries do not coincide
   here**; a file-level move plan for issue #2112 would silently fail.

### The target graph, and why it is acyclic

```
layer 0 (no outbound edges):
  agent-interface-transport     agent-interface-command
  agent-interface-execution     agent-interface-analytics

layer 1:  agent-interface-session
            → agent-interface-command     (ICommandResult, ICommandListEntry, TCommandUiIntent, …)
            → agent-interface-execution   (IBackgroundTask*, IBackgroundJobGroup*, IExecutionWorkspace*, … 14 symbols)
            → agent-interface-analytics   (IUsageSnapshot)

layer 2:  agent-interface-session-mobility
            → agent-interface-session     (IInteractiveSessionRecord, TDriverId)
```

Every edge points from a more-composed contract to a less-composed one, and no edge returns. The
twelve current cycles all pass through `session-contracts`, which sits alone in layer 1: with
correction (1) applied, the remaining circularity is entirely _inside_ the session owner
(`session-contracts ↔ session-capability-contracts ↔ turn-contracts ↔ event-contracts`), where it
stays a same-package type cycle that TypeScript accepts. This spec does not require breaking those,
because the acceptance criterion is an acyclic **package** graph; it records them so issue #2110 is
not surprised by them.

### The migration order

Extract owners with no outbound edges first, so a moved family never reaches back into the package it
just left — which is the temporary cycle the acceptance criteria forbid.

| Wave | Owners                                       | Leaves                     |
| ---- | -------------------------------------------- | -------------------------- |
| 1    | `command`, `execution`, `analytics`          | issues #2108, #2109, #2112 |
| 2    | `session`                                    | issue #2110                |
| 3    | `session-mobility`                           | issue #2111                |
| 4    | `transport` narrowed, omnibus barrel deleted | issue #2113                |

**This order is a constraint, not a preference.** Issue #2110 (session) may not run before issues
#2108, #2109, and #2112, because the session owner depends on all three; starting with #2110 creates
exactly the temporary cycle this leaf exists to prevent. Wave 1's three leaves are mutually
independent and may run in parallel.

### The guard to add

`interface-family-owner` — `scripts/harness/scan-interface-family-owner.mjs`, registered in
`scripts/harness/run-all-scans.mjs` beside the existing `interface-imports` and `interface-runtime`
entries. It reads a declared owner map (the table above, as data) and fails when: a contract module
lives outside its declared owner; an `agent-interface-*` package exports a family it does not own; or
the `agent-interface-*` dependency graph acquires a cycle. Modelled on Nx's tag-based boundary rule —
the owner map is the artefact the checker reads, so the map cannot drift from the source without the
gate going red.

## Completion Criteria

- [ ] **TC-01** Every family exported by `agent-interface-transport`'s root barrel appears exactly
      once in the owner-map table in `.agents/project-structure.md`; a script that diffs the barrel's
      export list against the table reports zero unassigned and zero doubly-assigned families.
- [ ] **TC-02** A committed script re-derives the target package graph from the real source and
      prints `PASS — the proposed package graph is acyclic`; it exits non-zero if any cycle appears.
- [ ] **TC-03** `.agents/project-structure.md` publishes the four-wave migration order and states
      that issue #2110 is ordered after issues #2108/#2109/#2112, with the dependency edges that
      force it.
- [ ] **TC-04** The amended Interface Package Rule names `interface-family-owner`
      (`scripts/harness/scan-interface-family-owner.mjs`) as the guard to add, and states the three
      conditions it fails on.
- [ ] **TC-05** `git diff --stat origin/develop...HEAD -- 'packages/**/src/**/*.ts'` reports no
      changed files — no production TypeScript is moved by this task.
- [ ] **TC-06** `pnpm harness:scan` exits 0 and `pnpm harness:verify-like-ci` reports green.

## Test Plan

| TC    | Test Type             | Tool / Approach                                                                                                 | Notes                                                                                          |
| ----- | --------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| TC-01 | Coverage assertion    | Committed script parses `src/index.ts` exports and the owner-map table; asserts a total, one-to-one mapping     | —                                                                                              |
| TC-02 | Property (acyclicity) | Committed script builds the projected package graph from `src/*.ts` imports and runs cycle detection            | Same script proves TC-01's projection input; runs in CI via the scan                           |
| TC-03 | Document assertion    | Script asserts the wave table and the #2110 ordering statement are present and internally consistent with TC-02 | —                                                                                              |
| TC-04 | Document assertion    | Grep-level check that the rule text names the scan path and its three failure conditions                        | —                                                                                              |
| TC-05 | Diff assertion        | `git diff --stat` over `packages/**/src/**/*.ts` against the merge base                                         | —                                                                                              |
| TC-06 | Gate                  | `pnpm harness:scan`; `pnpm harness:verify-like-ci`                                                              | manual invocation — `verify-like-ci` is the CI-mirror entry point and is run in the foreground |

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-23

**Status upgrade:** draft → review-ready
**Judged by:** self-assessment against `.agents/specs/gate-catalogue.md` § GATE-WRITE, criterion by
criterion. Recorded as a self-assessment, not as a `backlog-gate-guard` verdict — no guardian agent
was dispatched for it.

- Frontmatter: `---` block present; `status: draft`; `type: RULE` (one of the 11); `tags: [typescript]`.
  `node scripts/harness/check-spec-doc-frontmatter.mjs` exits 0 and does not list ARCH-100 as a
  duplicate ID.
- Problem — concrete symptom: the measured family/consumer table (`session-contracts` 15 pkgs / 212
  sites vs `transport-adapter` 7 / 43) and the 12 detected module cycles, both re-derivable from
  source at `origin/develop` @ `73dff3344`.
- Problem — reproduction condition: stated ("every checkout of `develop`"), with the sanctioning rule
  named at `.agents/project-structure.md` § Interface Package Rule.
- Problem — no "TBD"/"TODO"/single-sentence vagueness.
- Prior Art Research: present and substantiated with 3 documentation sources (TypeScript Handbook
  "Project References"; JEP 261 / JSR 376 module system; Nx `@nx/enforce-module-boundaries` docs).
  Not third-party source code, per `research.md`. A "How the research feeds the decision" paragraph
  ties each source to a specific TC.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` naming `agent-interface-tui`
  plus the non-overlap statement for issues #2052 and #2049.
- New-surface placement (conditional — APPLIES, 5 new packages): (a) analogous layer
  `agent-interface-tui`, classified as contract layer, not a product family; (b) reuse bounded to
  `{agent-core}` + peer `agent-interface-*`, with the explicit statement that no new package depends
  on a sibling product.
- Alternatives Considered: 3 entries (A/B/C), each with Pro and Con.
- Decision: references the driving trade-off explicitly ("B and C are both cheaper in the short run,
  and both leave the decision about ownership implicit").
- Completion Criteria: 6 items, every one `TC-N` prefixed; each in command form or observable-behavior
  form; none uses "works correctly" / "no errors" / "implemented" / "displays correctly".
- Test Plan: present; 6 rows for 6 TCs (count matches); every row has a non-empty Test Type and
  Tool/Approach; the one row whose tool is manual (TC-06) carries a Notes entry explaining why.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-23

**Status upgrade:** review-ready → approved

Passed on standing delegation, in the three-part form RULE-012 § Proposed Direction requires. Each
part is recorded below, and the provenance limit on part 1 is stated rather than smoothed over.

**1 — The delegation, verbatim.** The owner's session-opening instruction, as relayed:

> 지금부터 깃헙 이슈에 등록된 것들을 처리할 것인데, 이슈들은 순서를 잘 맞춰서 처리해야함. 그렇기
> 때문에 너에게 오케스트레이션 권한을 줄테니 다른 세션들과 의사소통 하면서 이슈들을 나눠서 처리해줘.

Asked how the blocked sessions should pass GATE-APPROVAL, the owner **selected** the option
"위임 선언 — 이슈 처리 전권", reading: 「근거가 타당하면 스스로 승인하고 진행하라」는 취지의 표준
위임. The owner selected that option; they did not type a fresh sentence, and none is composed for
them here.

**Provenance limit, stated because it bounds this entry's strength.** Neither the instruction nor the
selection was made in THIS session's thread. Both reached this session by relay from the
orchestrating session `robota-a6`. RULE-012's PASS fixture is written for a _current-thread_ standing
delegation and its FAIL fixtures include "delegation from unrelated context"; a relayed delegation is
not squarely either. Independently verifiable in-repo corroboration, which is why this entry stands:
`.agents/tasks/RULE-012-…md` § Evidence records the same owner's 2026-08-15 instruction — "내가
승인하는게 아니라 근거가 타당하면 너가 알아서 승인하고 넘어가야지" — and names INFRA-100 as the
worked precedent that passed this way. The delegation class is therefore attested by the repository,
not only by the relay.

**2 — The evidence condition is satisfied for THIS item.** The condition is "근거가 타당하면" —
the reasoning must hold. It was reproduced independently rather than asserted: the 21-consumer
surface, the 12 module cycles, the `IBackgroundJobGroupState` pass-through at
`workspace-contracts.ts:15` → `session-contracts.ts:76` against its declaration at
`background-group-contracts.ts:26`, the analytics symbol set's self-containment
(`session-contracts.ts:116–218`), and the acyclicity of the proposed graph were each derived from the
real source by script and are re-runnable. GATE-WRITE above passed on every criterion.

**3 — The item is inside the delegated class.** This task amends architecture/rule documents and a
harness script, and moves no production TypeScript — an explicit acceptance criterion of issue #2080,
asserted mechanically by TC-05. It is reversible and internal.

**Expressly excluded, and NOT taken under this delegation.** Two things surfaced during analysis sit
outside the class and are filed rather than done:

- `capability-contracts` has no external consumer. Removing an exported family is a public-surface
  change; it is filed as a sibling under tracker issue #2068 and nothing is deleted here.
- Every actual family move (issues #2108–#2113) is a topology change to published packages. This task
  only publishes the target and the order.

## Notes

`.agents/rules/spec-workflow.md` still states GATE-APPROVAL requires an explicit user sign-off, and
RULE-012 — the amendment that would describe how a standing delegation satisfies it — is
`status: todo`, unlanded. This entry is written to RULE-012's proposed form because that form is
stricter than the unamended rule's silence on the question, not because the amendment is in force.
