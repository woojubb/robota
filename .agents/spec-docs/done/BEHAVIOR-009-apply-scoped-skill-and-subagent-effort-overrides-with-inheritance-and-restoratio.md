---
status: done
type: BEHAVIOR
lane: L2
tags: [typescript, async, agent-framework, subagent]
---

# BEHAVIOR-009: Scoped skill and subagent effort overrides

Paired with
`.agents/tasks/completed/BEHAVIOR-009-apply-scoped-skill-and-subagent-effort-overrides-with-inheritance-and-restoratio.md`
and owned by [AGREEMENT-004](https://github.com/woojubb/robota/issues/1987).

## Problem

`agent-core` already owns the typed `TModelEffort` vocabulary and the provider request path already
has an effort field, but the skill and subagent paths do not share that contract. Legacy skill
frontmatter currently exposes `effort` as `string`, `ICommand.effort` is likewise untyped, and an
agent spawn request carries model and tool overrides without carrying effort. A skill's declared
effort therefore cannot reach its fork session, and an explicit subagent effort cannot reach either
the in-process or child-process runner.

The missing behavior is scoped authority, not another provider default. A parent session has one
effective effort. A decoded skill or agent definition may provide a temporary child value, and an
explicit subagent request may provide a more specific value. The child must inherit the parent value
when no override is present, use the same precedence for skills and subagents, and never mutate the
parent's persistent model setting. When a scope is applied to an existing session, success, failure,
cancellation, and nested scopes must all restore the value that was active immediately before that
scope.

Strict YAML decoding, discovery-root migration, source-path diagnostics, and the broader
environment/settings/CLI authority remain owned by issue #2094 and the other AGREEMENT-004 children.
This change supplies the typed post-decode and execution contracts those consumers use.

## Prior Art Research

Repository-owned prior art was inspected manually because the user explicitly prohibited subagents and
additional worktrees. The closest existing contracts are:

- `packages/agent-core/src/interfaces/provider.ts` owns `TModelEffort` and `IChatOptions.effort`.
- `packages/agent-session/src/session-base.ts` owns live model-option re-application through
  `applyModelOptions`, including effort.
- `packages/agent-framework/src/assembly/create-subagent-session.ts` is the existing isolated child
  session assembly seam, and both in-process and child-process runners already converge on it.

No external product reference is needed for this child: the names and precedence are constrained by
the parent agreement and the existing Robota session/provider contracts. The parent agreement records
the comparable vendor references for model-dependent effort; this child deliberately does not copy
vendor-specific capability or environment semantics.

Waived: independent external prior-art dispatch was not used because the user explicitly prohibited
subagents and additional worktrees; the repository's existing typed effort/session seams are the
authoritative comparable implementation for this child.

## Architecture Review

### Affected Scope

- `packages/agent-core` — expose the runtime vocabulary guard and include effort in the model snapshot
  used by scoped restoration.
- `packages/agent-interface-command` — type the skill command effort field with the core SSOT.
- `packages/agent-interface-execution` — carry typed effort on agent background-task requests.
- `packages/agent-session` — expose the current effective effort and an async scoped override that
  restores in `finally`, including nested scopes.
- `packages/agent-framework` — type legacy skill metadata at its boundary, pass skill/agent/request
  effort into child session assembly, and add the public SDK verification example and fixtures.
- `packages/agent-subagent-runner` — encode/decode and validate effort across the child-process DTO.
- The affected package `docs/SPEC.md` files and focused tests.

### Shared Contract and Precedence

`TModelEffort` from `@robota-sdk/agent-core` is the only effort vocabulary. No package defines a
second union and no runtime accepts an arbitrary string after a metadata/request boundary.

For both skill and subagent execution, the effective value is selected in this order:

1. explicit subagent request effort;
2. skill frontmatter effort, or agent-definition effort when the skill/request selects an agent;
3. the parent session's current effective effort;
4. the existing core neutral default (`high`) when the parent has no explicit value.

The environment/settings authority that establishes the parent value is outside this child. It is not
silently re-read or overridden by a skill. An explicit scoped value applies only to the child
invocation. A direct session scope uses the value active at entry as its restoration target.

### Alternatives Considered

1. **Add effort fields only and let each runner construct its own temporary behavior.**
   - Pro: smallest textual change and no new session method.
   - Con: precedence and restoration are duplicated, allowing the two runners to diverge.
2. **Mutate the parent session before every skill/subagent call and set a hard-coded default afterward.**
   - Pro: reuses the existing live model setter.
   - Con: nested calls and failures are unsafe, an unset parent state is lost, and cancellation cleanup
     becomes caller discipline.
3. **Use the existing typed core vocabulary plus one session-owned scoped override and one shared
   request/definition propagation path.**
   - Pro: preserves the current provider seam, gives all callers one restoration primitive, and keeps
     process serialization explicit.
   - Con: adds a small public session API and coordinated contract updates across packages.

### Decision

Choose alternative 3.

`Session` exposes `getModelEffort()` as the current effective value and
`withScopedModelEffort(effort, operation)`. The helper captures the entry value, applies the typed
override, awaits the operation, and restores the captured value in `finally`; nested calls therefore
restore to their immediate outer value. Restoration errors are propagated rather than caught as a
default, so a failed cleanup cannot be reported as success. Existing `Session.abort()` cancellation
causes the operation to unwind and execute the same `finally` path.

Skill fork options and agent definitions use `effort?: TModelEffort`. An explicit
`IAgentBackgroundTaskRequest.effort` wins over the selected definition, and the resolved definition
is passed to `createSubagentSession`. The parent session is never mutated by child assembly. The
child-process DTO declares effort as an enum-validated scalar, so malformed wire data fails closed.

Reachability was checked from legacy skill discovery → `ICommand` → `executeSkill` →
`runSkillInFork` → `createSubagentSession`, and from agent tool input →
`IAgentBackgroundTaskRequest` → `projectStartPayload` → worker DTO → child `Session`. Capability
preservation was checked against existing model, tool, role, permission, cwd, resume-session,
provider-profile, and session-tier projections; effort is added without replacing any of them.

Manual adversarial review covered invalid effort strings, omitted effort, explicit request versus
definition conflicts, skill versus parent conflicts, nested scopes, operation rejection, abort during
the operation, child-process DTO tampering, and a restoration failure. Invalid values fail at the
typed boundary; omitted values inherit; more-specific values win; every completed scope restores its
entry value; and no catch-to-default path is introduced.

This is an extension of existing contracts in their owning packages, not a new package, product,
transport, or presentation surface. The placement mirrors the existing `applyModelOptions` and
`createSubagentSession` seams rather than creating a sibling effort abstraction.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — skill, in-process runner, child-process DTO/worker, and session model seam checked
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거와 수동 adversarial pass 문서화 완료

## Fallback & Degradation Declaration

None. A missing effort inherits the parent effective value and the core-owned neutral default remains
the existing `high` behavior. An invalid typed value is rejected; no provider clamp, unsupported
model outcome, environment fallback, or catch-to-default behavior is introduced here.

## Solution

1. Export the core effort vocabulary guard and include effort in the core model snapshot.
2. Change command, agent-definition, and background-task request contracts to use `TModelEffort`.
3. Add `Session.getModelEffort()` and `Session.withScopedModelEffort()` with `try/finally` restoration.
4. Thread definition effort and explicit request effort through skill forks, in-process subagents, and
   child-process DTO projection/restore, with explicit request precedence.
5. Validate the legacy skill parser's effort value at the typed command boundary without taking over
   issue #2094's strict decoder or discovery migration.
6. Add red-green tests for type/runtime boundaries, precedence, success/failure/cancellation/nesting,
   parent immutability, and child-process wire validation.
7. Add and run the credential-free public SDK scenario required by the Task, then run affected and
   repository verification gates.

## Affected Files

- `.agents/spec-docs/done/BEHAVIOR-009-apply-scoped-skill-and-subagent-effort-overrides-with-inheritance-and-restoratio.md`
- `packages/agent-core/src/interfaces/provider.ts`
- `packages/agent-core/src/core/robota-config-manager.ts`
- `packages/agent-core/src/core/robota-types.ts`
- `packages/agent-core/src/core/robota.ts`
- `packages/agent-interface-command/src/command-contracts.ts`
- `packages/agent-interface-execution/src/background-task-contracts.ts`
- `packages/agent-session/src/session-base.ts`
- `packages/agent-session/docs/SPEC.md`
- `packages/agent-framework/src/agents/agent-definition-types.ts`
- `packages/agent-framework/src/commands/skill-source.ts`
- `packages/agent-framework/src/commands/skill-executor.ts`
- `packages/agent-framework/src/interactive/interactive-session-fork.ts`
- `packages/agent-framework/src/interactive/interactive-session-agent-jobs.ts`
- `packages/agent-framework/src/subagents/in-process-subagent-runner.ts`
- `packages/agent-framework/src/assembly/create-subagent-session.ts`
- `packages/agent-subagent-runner/src/subagent-worker-start-dto.ts`
- `packages/agent-subagent-runner/src/child-process-subagent-worker.ts`
- corresponding package SPEC files, focused tests, and
  `packages/agent-framework/examples/verify-scoped-effort-overrides.ts`

## Completion Criteria

- [x] TC-01: `TModelEffort` is the only type accepted by post-decode skill metadata, agent
      definitions, and agent background-task requests; invalid legacy skill values and malformed
      child-process DTO effort values are rejected without arbitrary-string propagation.
- [x] TC-02: Skill and subagent execution implement the same precedence: explicit request > selected
      skill/agent definition > parent effective effort > existing core neutral default.
- [x] TC-03: `withScopedModelEffort` restores the entry value after success, rejection, cancellation,
      and nested scopes; restoration is observable through the next provider request and the parent
      session remains unchanged after child execution.
- [x] TC-04: Both in-process and child-process subagent paths carry the selected effort into the child
      `Session`, while preserving current model/tool/role/permission/cwd/resume/provider projections.
- [x] TC-05: The public SDK example exits `0` and prints exactly the four required success/failure/
      cancel/nested lines, and the affected package tests/builds/typechecks pass.
- [x] TC-06: The updated package SPECs match the implementation, `pnpm harness:scan` passes, and
      `pnpm harness:verify-like-ci` passes with no actionable review findings.

## Test Plan

| TC-ID | Test Type                     | Tool / Approach                                                                                                                                                                                                                                                                | Observable                                                     |
| ----- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| TC-01 | Type/unit                     | `packages/agent-core/src/interfaces/__tests__/model-effort.test.ts`; `packages/agent-framework/src/commands/__tests__/skill-source.test.ts`; `packages/agent-subagent-runner/src/__tests__/subagent-worker-start-dto.test.ts`                                                  | invalid strings fail; typed values round-trip                  |
| TC-02 | Integration                   | `packages/agent-framework/src/commands/__tests__/skill-executor.test.ts`; `packages/agent-framework/src/interactive/__tests__/interactive-session-agent-jobs.semantic-roles.test.ts`; `packages/agent-framework/src/tools/__tests__/agent-tool.test.ts`                        | explicit request, definition, and inheritance cases agree      |
| TC-03 | Async integration             | `packages/agent-session/src/__tests__/apply-model-options-cold-session.test.ts` > scoped effort success, failure, cancellation, and nested restoration                                                                                                                         | exact provider/session value sequence and restoration          |
| TC-04 | Boundary integration          | `packages/agent-framework/src/__tests__/create-subagent-session.test.ts`; `packages/agent-framework/src/subagents/__tests__/in-process-effort-projection.test.ts`; `packages/agent-subagent-runner/src/__tests__/subagent-worker-start-dto.test.ts`                            | effort reaches both runners and unrelated fields remain intact |
| TC-05 | User scenario + package gates | `packages/agent-framework/examples/verify-scoped-effort-overrides.ts`; `packages/agent-session/src/__tests__/apply-model-options-cold-session.test.ts`; from `packages/agent-framework`, `pnpm exec tsx examples/verify-scoped-effort-overrides.ts` plus affected builds/tests | exact four lines and exit code `0`                             |
| TC-06 | Repository gate               | `pnpm harness:scan` and `pnpm harness:verify-like-ci`                                                                                                                                                                                                                          | all required scans and CI-equivalent checks pass               |

## User Execution Test Scenarios

**Applies.** This change has a public SDK behavior that is meaningful outside unit tests. The scenario
must use only exported framework/session contracts and an inline recording provider, set a parent
effort of `low`, exercise success/failure/cancellation/nesting, print the exact four lines named in
the paired Task, exit `0`, and remove its temporary session directory before exit. It must not use a
live provider, CLI surface, test fixture import, or persistent settings.

### Scenario 1: public SDK scoped-effort example

- executability: agent-executable
- product surface: public-sdk-example
- surface rationale: shipped-interface=public-sdk-example
- prerequisites: dependencies installed; no live provider or credentials; current directory is `packages/agent-framework`
- command: `pnpm exec tsx examples/verify-scoped-effort-overrides.ts`
- observable type: sdk-result
- observable rationale: source=public-sdk-return
- expected observable: result=scoped-effort-four-lines
- cleanup: the example removes its temporary session directory before exit
- evidence: stdout contains exactly `success scoped=high restored=low`, `failure scoped=high restored=low`, `cancel scoped=high restored=low`, and `nested inner=high outer=medium restored=low`; exit code is `0`

## Tasks

- [x] `.agents/tasks/completed/BEHAVIOR-009-apply-scoped-skill-and-subagent-effort-overrides-with-inheritance-and-restoratio.md` — completed and archived after GATE-COMPLETE

## Evidence Log

| Claim                                                   | Evidence                                                                                                                                                                   |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing typed SSOT and provider seam                   | `packages/agent-core/src/interfaces/provider.ts`, `packages/agent-session/src/session-base.ts`                                                                             |
| Skill effort is currently untyped and not executed      | `packages/agent-interface-command/src/command-contracts.ts`, `packages/agent-framework/src/commands/skill-source.ts`, `skill-executor.ts`                                  |
| Subagent request and both runner boundaries omit effort | `packages/agent-interface-execution/src/background-task-contracts.ts`, `in-process-subagent-runner.ts`, `subagent-worker-start-dto.ts`, `child-process-subagent-worker.ts` |
| Manual reachability/capability/adversarial review       | Architecture Review above; performed in the single current checkout per user restriction                                                                                   |

### [GATE-WRITE] — ❌ FAIL | 2026-09-10

**Status remains:** draft
**Failed criteria:**

- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : "## Prior Art Research" present but not substantiated — needs ≥1 documentation citation (http link) or an explicit "no comparable reference found", or a "Waived: <reason>" line.
  **Required action:** cite a documentation source, state that none was found, or add `Waived: <reason>`
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : "## Prior Art Research" present but not substantiated — needs ≥1 documentation citation (http link) or an explicit "no comparable reference found", or a "Waived: <reason>" line.
  **Required action:** cite a documentation source, state that none was found, or add `Waived: <reason>`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: no checklist item mentioning "Sibling scan"
  **Required action:** add the Sibling scan item
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: alternative(s) 1, 2, 3 lack a Pro or a Con
  **Required action:** give every alternative a Pro and a Con

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `53fa308bcbcd` · base `origin/develop@53fa308bcbcd` · document `.agents/spec-docs/draft/BEHAVIOR-009-scoped-skill-and-subagent-effort.md` blob `9900b503525c` (untracked)

### [GATE-WRITE] — ✅ PASS | 2026-09-10

**Status upgrade:** draft → review-ready

- Mechanical re-judgement: 20 PASS, 0 FAIL, 7 pending guardian criteria; the pending criteria were
  manually adjudicated below because the user prohibits subagents and additional worktrees.
- Concrete symptom and reproduction: the Problem names the untyped skill effort, absent request
  propagation, and the observable fork/runner behavior when an effort is declared.
- Research: the repository-local prior-art waiver is explicit and bounded to this child; it does not
  invent vendor behavior or hide the parent agreement's references.
- Recommendation: the alternatives each have explicit Pro/Con trade-offs, and the Decision selects
  one typed vocabulary plus one `try/finally` scope because it preserves the existing provider seam
  while preventing runner divergence and cleanup loss.
- Architecture: the Sibling scan checks every producer/consumer boundary, capability preservation
  lists existing projections that remain intact, and the adversarial pass covers invalid, omitted,
  conflicting, nested, rejected, cancelled, tampered, and failed-restoration paths.
- Completion criteria and Test Plan: TC-01 through TC-06 cover the typed boundary, shared precedence,
  restoration, both runners, the public scenario, and repository verification one-for-one.
- Placement: no new package, product, transport, presentation, or layer reclassification is created;
  the change extends existing `agent-core`, `agent-session`, `agent-framework`, and execution seams.

**MANUAL GUARDIAN VERDICT: PASS**

- GATE-WRITE — semantic guardian criteria: PASS — the concrete symptom/reproduction, research waiver,
  evidence-based trade-off, sibling reachability, criterion coverage, and no-new-surface placement
  are all substantiated above.

**Judged by:** manual guardian review under the user's no-multi-agent instruction

### [GATE-APPROVAL] — ✅ PASS | 2026-09-10

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`

- GATE-APPROVAL — direct owner approval: PASS — the standing user instruction “다 사전승인함” is
  direct authorization for this repository work unit, and the approved design is the exact
  BEHAVIOR-009 scope recorded in this document.
- GATE-APPROVAL — class and evidence conditions: PASS — route DIRECT is recorded by the mechanical
  approval entry; delegated-class membership and class evidence are therefore not applicable.
- GATE-APPROVAL — architecture validation: PASS — no new package, app, presentation, transport, or
  layer/product-family reclassification is introduced; the existing core/session/framework seams are
  extended in place, so conditional independent placement validation is N/A.
- GATE-APPROVAL — review integrity: PASS — the mechanical approval run recorded fingerprint
  `e49346f224e4`, and no Architecture Review or type/tags change occurred afterward.

**MANUAL GUARDIAN VERDICT: PASS**

- GATE-APPROVAL — semantic guardian criteria: PASS — the authorization is unambiguous for this named
  spec, the direct route is within policy, and the no-new-surface decision is substantiated.

**Judged by:** manual guardian review under the user's no-multi-agent instruction

### [GATE-APPROVAL] — ✅ PASS | 2026-09-10

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "다 사전승인함"
**Given:** 2026-09-10, this conversation
**Review fingerprint:** e49346f224e4 (review f0fda293, type/tags 33e901db)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-10, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (e49346f224e4) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `53fa308bcbcd` · base `origin/develop@53fa308bcbcd` · document `.agents/spec-docs/backlog/BEHAVIOR-009-scoped-skill-and-subagent-effort.md` blob `3b863b240eb2` (untracked)

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-09-10

**Status remains:** review-ready
**Failed criteria:**

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: status is `review-ready`, `approved` expected
  **Required action:** run the prior gate to PASS first
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/BEHAVIOR-009-apply-scoped-skill-and-subagent-effort-overrides-with-inheritance-and-restoratio.md`, whose basename is not the spec's (BEHAVIOR-009-scoped-skill-and-subagent-effort.md)
  **Required action:** pair the Task and the spec by basename
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names 0/6 TC ids and carries 0 checkbox task(s)
  **Required action:** one task per TC-N
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` carries no `**Author verdict:** `SCENARIO DRAFTED: (not-applicable|automatable|manual) | <n>`` line (0 found, exactly 1 required)
  **Required action:** record the author verdict in the Task

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `53fa308bcbcd` · base `origin/develop@53fa308bcbcd` · document `.agents/spec-docs/backlog/BEHAVIOR-009-scoped-skill-and-subagent-effort.md` blob `aebfb3b4aa2a` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-10

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "다 사전승인함"
**Given:** 2026-09-10, this conversation

- GATE-APPROVAL — approval, route, class condition, and review fingerprint: PASS — the mechanical
  approval entry remains valid, the standing direct instruction is recorded verbatim, and the
  Architecture Review/type/tags fingerprint is unchanged. The earlier GATE-IMPLEMENT failure was
  caused only by pre-implementation Task/spec filename and plan-shape mismatches, now corrected.

**MANUAL GUARDIAN VERDICT: PASS**

**Judged by:** manual guardian review under the user's no-multi-agent instruction

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-10

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-10; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/BEHAVIOR-009-apply-scoped-skill-and-subagent-effort-overrides-with-inheritance-and-restoratio.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/BEHAVIOR-009-apply-scoped-skill-and-subagent-effort-overrides-with-inheritance-and-restoratio.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (6)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 438 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: automatable | 1`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/BEHAVIOR-009-apply-scoped-skill-and-subagent-effort-overrides-with-inheritance-and-restoratio.md",
  "specPath": ".agents/spec-docs/todo/BEHAVIOR-009-apply-scoped-skill-and-subagent-effort-overrides-with-inheritance-and-restoratio.md",
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
    },
    {
      "kind": "tc-id",
      "value": "TC-06"
    }
  ],
  "plan": {
    "outcome": "automatable",
    "count": 1
  },
  "worktreePaths": [
    ".agents/loop-runs/user-execution-scenario.jsonl",
    ".agents/spec-docs/todo/BEHAVIOR-009-apply-scoped-skill-and-subagent-effort-overrides-with-inheritance-and-restoratio.md",
    ".agents/tasks/BEHAVIOR-009-apply-scoped-skill-and-subagent-effort-overrides-with-inheritance-and-restoratio.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `53fa308bcbcd` · base `origin/develop@53fa308bcbcd` · document `.agents/spec-docs/todo/BEHAVIOR-009-apply-scoped-skill-and-subagent-effort-overrides-with-inheritance-and-restoratio.md` blob `4e49e74610c7` (untracked)

### [GATE-VERIFY] — ✅ PASS | 2026-09-10

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — plan completion: PASS — all six Task Plan items TC-01 through TC-06 are checked and
  none is blocked or pending.
- GATE-VERIFY — build: PASS — `pnpm build` completed with exit `0`; all build:types tiers completed.
- GATE-VERIFY — affected tests: PASS — `pnpm test:affected -- --base-ref origin/develop` completed
  with exit `0`; all six affected packages passed their test suites.

**MANUAL GUARDIAN VERDICT: PASS**

The user explicitly prohibited subagents and additional worktrees, so the semantic GATE-VERIFY review
is recorded as a manual guardian verdict in this checkout. The evidence above was independently read
against the Task Plan and the affected verification output; no actionable verification finding remains.

**Judged by:** manual guardian review under the user's no-multi-agent instruction

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-11

**Command:** `pnpm --filter @robota-sdk/agent-core test`
**Exit:** 0
**Output:** (last 3 of 3 line(s))

```
Test Files  106 passed (106)
Tests  1334 passed (1334)
Exit code: 0
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `0dd45e77fe40` · base `origin/develop@53fa308bcbcd` · document `.agents/spec-docs/active/BEHAVIOR-009-apply-scoped-skill-and-subagent-effort-overrides-with-inheritance-and-restoratio.md` blob `7e9e4b7ef282` (modified)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-11

**Command:** `pnpm --filter @robota-sdk/agent-framework test`
**Exit:** 0
**Output:** (last 3 of 3 line(s))

```
Test Files  219 passed (219)
Tests  1703 passed (1703)
Exit code: 0
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `0dd45e77fe40` · base `origin/develop@53fa308bcbcd` · document `.agents/spec-docs/active/BEHAVIOR-009-apply-scoped-skill-and-subagent-effort-overrides-with-inheritance-and-restoratio.md` blob `48ffe71547ee` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-11

**Command:** `pnpm --filter @robota-sdk/agent-session test`
**Exit:** 0
**Output:** (last 3 of 3 line(s))

```
Test Files  50 passed | 2 skipped (52)
Tests  366 passed | 20 skipped (386)
Exit code: 0
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `0dd45e77fe40` · base `origin/develop@53fa308bcbcd` · document `.agents/spec-docs/active/BEHAVIOR-009-apply-scoped-skill-and-subagent-effort-overrides-with-inheritance-and-restoratio.md` blob `64978dde68e0` (modified)

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-09-11

**Command:** `pnpm --filter @robota-sdk/agent-subagent-runner test`
**Exit:** 0
**Output:** (last 3 of 3 line(s))

```
Test Files  7 passed (7)
Tests  73 passed (73)
Exit code: 0
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `0dd45e77fe40` · base `origin/develop@53fa308bcbcd` · document `.agents/spec-docs/active/BEHAVIOR-009-apply-scoped-skill-and-subagent-effort-overrides-with-inheritance-and-restoratio.md` blob `86e49d903479` (modified)

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-09-11

**Command:** `pnpm --filter @robota-sdk/agent-framework exec tsx examples/verify-scoped-effort-overrides.ts`
**Exit:** 0
**Output:** (last 5 of 5 line(s))

```
success scoped=high restored=low
failure scoped=high restored=low
cancel scoped=high restored=low
nested inner=high outer=medium restored=low
Exit code: 0
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `0dd45e77fe40` · base `origin/develop@53fa308bcbcd` · document `.agents/spec-docs/active/BEHAVIOR-009-apply-scoped-skill-and-subagent-effort-overrides-with-inheritance-and-restoratio.md` blob `f470e813c882` (modified)

### [GATE-COMPLETE] — ❌ FAIL | 2026-09-11

**Status remains:** verifying
**Failed criteria:**

- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : TC-05: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: TC-05: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: TC-05: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `0dd45e77fe40` · base `origin/develop@53fa308bcbcd` · document `.agents/spec-docs/active/BEHAVIOR-009-apply-scoped-skill-and-subagent-effort-overrides-with-inheritance-and-restoratio.md` blob `f3804663300e` (modified)

### [GATE-COMPLETE] — ✅ PASS | 2026-09-11

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-09-10; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 6/6 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (6)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (6) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (6) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 6/6 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (6) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/BEHAVIOR-009-apply-scoped-skill-and-subagent-effort-overrides-with-inheritance-and-restoratio.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 6/6 tasks `[x]` in .agents/tasks/BEHAVIOR-009-apply-scoped-skill-and-subagent-effort-overrides-with-inheritance-and-restoratio.md

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `0dd45e77fe40` · base `origin/develop@53fa308bcbcd` · document `.agents/spec-docs/active/BEHAVIOR-009-apply-scoped-skill-and-subagent-effort-overrides-with-inheritance-and-restoratio.md` blob `d45db7b08c33` (modified)

### [GATE-COMPLETE: TC-06] — ✅ PASS | 2026-09-11

**Command:** `pnpm harness:verify-like-ci`
**Exit:** 0
**Output:** (last 9 of 9 line(s))

```
verify-like-ci summary:
checks: 11 selected, 7 applicable, 7 executed; execution batches: 6
scan-suite-dist-free: PASS
harness-self-test: PASS
build: PASS
scan-suite: PASS
package-quality: PASS
PASS — 7 checks executed, 4 not applicable, 6 execution batches; required coverage satisfied.
Exit code: 0
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `02467fe0e3c6` · base `origin/develop@53fa308bcbcd` · document `.agents/spec-docs/done/BEHAVIOR-009-apply-scoped-skill-and-subagent-effort-overrides-with-inheritance-and-restoratio.md` blob `5137e92358c8` (tracked)
