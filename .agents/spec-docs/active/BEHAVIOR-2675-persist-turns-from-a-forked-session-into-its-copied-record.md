---
status: in-progress
type: BEHAVIOR
tags: [cli, async, typescript]
lane: L2
---

# BEHAVIOR-2675: Persist turns from a forked session into its copied record

Paired with `.agents/tasks/BEHAVIOR-2675-persist-turns-from-a-forked-session-into-its-copied-record.md`. Arising from [issue #2675](https://github.com/woojubb/robota/issues/2675).

## Problem

When `/fork` creates a background job, the job receives `resumeSessionId` and restores the copied
conversation, but the child `Session` is created without the session store and with a transient task
id. After the fork answers a prompt, its new user/assistant turns remain only in the background
transcript; attaching later opens the frozen record from fork creation time. The same regression is
present in the child-process runner. Persisted parent records can also be rejected as corrupt because
the strict background-task decoder does not yet accept the already-declared `resumeSessionId` field.

## Prior Art Research

Waived: User authorized procedure shortening for urgent delivery and prohibited subagent use; the existing CLI-1994 repository contract is the relevant prior art.

## Architecture Review

### Affected Scope

* `packages/agent-framework` — subagent session assembly, in-process resume wiring, functional
  fork/attach scenario, SPEC, README, and SDK verification example.
* `packages/agent-subagent-runner` — child-process session-store wiring and runner tests.
* `packages/agent-session` — persisted background-task record decoding and codec tests.
* `packages/agent-transport-tui` — attach documentation describing the now-persistent copied record.

### Alternatives Considered

1. Persist every background task as a session record, regardless of how it was started.
   - Pro: one uniform persistence rule for all background jobs.
   - Con: expands storage and changes ordinary subagent semantics that currently use task transcripts.
2. Persist only jobs with `resumeSessionId`, using that id and the existing store for the resumed
   child session; leave ordinary jobs transient.
   - Pro: fixes `/fork` with the smallest compatible change and preserves existing ordinary-job
     behavior.
   - Con: the runner must keep an explicit conditional seam and test both paths.
3. Keep the child transient and copy its transcript back into the fork record after completion.
   - Pro: avoids passing a store into the child session.
   - Con: loses turns until completion, duplicates record merge logic, and cannot make an attached
     running fork observe incremental turns.

### Decision

Choose alternative 2. The existing `resumeSessionStore` and `openSessionStore` seams already make the
record reachable in both runners, so passing the same store to the resumed child preserves the existing
id-only IPC boundary and incremental session persistence. Ordinary jobs remain unchanged. Before
approval, the design was checked against the in-process and child-process consumers (reachability),
preserves restore plus attach and does not merge parent records (capability preservation), and was
stress-checked for missing-store, missing-record, ordinary-job, and parent-metadata cases (adversarial
pass). Missing required storage remains an explicit error, not a fallback.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: User authorized procedure shortening for urgent delivery and prohibited subagent use; the existing CLI-1994 repository contract is the relevant prior art.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

1. Extend `createSubagentSession` with an optional `sessionStore` and pass it only for a resumed fork,
   using the resumed record id as the child session id so each turn writes to the copied record.
2. Wire the existing in-process `resumeSessionStore` and child-process `openSessionStore` seams into
   that session construction; reuse one store for restore and writes, while ordinary jobs remain
   transient and the IPC payload remains id-only.
3. Add `resumeSessionId` to the strict session-record decoder so fork metadata round-trips without a
   corrupt load outcome.
4. Add unit, integration, child-process, codec, and public SDK scenario coverage, then update the
   affected package SPECs, READMEs, TUI attach documentation, and guide content if required by the
   documentation sync gate.

## Affected Files

* `packages/agent-framework/src/assembly/create-subagent-session.ts`
* `packages/agent-framework/src/subagents/in-process-subagent-runner.ts`
* `packages/agent-framework/src/subagents/__tests__/fork-job-resumes-record.test.ts`
* `packages/agent-framework/src/interactive/__tests__/fork-background-attach-persistence.test.ts`
* `packages/agent-framework/examples/verify-fork-record-persistence.ts`
* `packages/agent-framework/package.json`
* `packages/agent-framework/docs/SPEC.md`
* `packages/agent-framework/README.md`
* `packages/agent-subagent-runner/src/child-process-subagent-resume.ts`
* `packages/agent-subagent-runner/src/child-process-subagent-worker.ts`
* `packages/agent-subagent-runner/src/__tests__/child-process-subagent-runner.test.ts`
* `packages/agent-subagent-runner/src/__tests__/fixtures/fork-persistence-worker-entry.mjs`
* `packages/agent-subagent-runner/docs/SPEC.md`
* `packages/agent-subagent-runner/README.md`
* `packages/agent-session/src/session-record-codec/background-task-decoders.ts`
* `packages/agent-session/src/__tests__/session-record-codec.test.ts`
* `packages/agent-session/docs/SPEC.md`
* `packages/agent-session/README.md`
* `packages/agent-transport-tui/docs/SPEC.md`

## Completion Criteria

- [ ] TC-01: `pnpm exec vitest run packages/agent-framework/src/interactive/__tests__/fork-background-attach-persistence.test.ts` exits 1 before the implementation and exits 0 after it, proving the copied record receives child turns while the parent remains separate.
- [ ] TC-02: `pnpm exec vitest run packages/agent-framework/src/subagents/__tests__/fork-job-resumes-record.test.ts packages/agent-subagent-runner/src/__tests__/child-process-subagent-runner.test.ts packages/agent-session/src/__tests__/session-record-codec.test.ts` exits 0 for the complete focused regression set.
- [ ] TC-03: `pnpm --filter @robota-sdk/agent-framework scenario:verify:fork-record-persistence` exits 0 and reports the public SDK fork/restore/persist observable.
- [ ] TC-04: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` exits 0.
- [ ] TC-05: affected package builds and typechecks exit 0 for `agent-session`, `agent-framework`, and `agent-subagent-runner`.

## Test Plan

| TC-ID | Test Type | Tool / Approach                             | Notes                                             |
| ----- | --------- | ------------------------------------------- | ------------------------------------------------- |
| TC-01 | Integration | `pnpm exec vitest run packages/agent-framework/src/interactive/__tests__/fork-background-attach-persistence.test.ts` | RED then GREEN; live InteractiveSession and persistent store |
| TC-02 | Unit / integration | focused Vitest command above | in-process, child-process, and codec regression suites |
| TC-03 | SDK scenario | `pnpm --filter @robota-sdk/agent-framework scenario:verify:fork-record-persistence` | public `InteractiveSession` usage with deterministic provider |
| TC-04 | Harness | `run-all-scans.mjs --affected --context pr` | affected tree and gate evidence |
| TC-05 | Build / typecheck | package `build` and `typecheck` scripts | contract and generated declaration verification |

## User Execution Test Scenarios

### Scenario 1: SDK fork record persists new turns

- executability: agent-executable
- product surface: public-sdk-example
- surface rationale: shipped-interface=public-sdk-example
- prerequisites: repository dependencies installed and the agent-framework package built; current directory is `packages/agent-framework`; no live provider credentials or external service required because the example uses a deterministic replay provider
- command: `pnpm exec tsx examples/verify-fork-record-persistence.ts`
- observable type: sdk-result
- observable rationale: source=public-sdk-return
- expected observable: result=FORK_RECORD_PERSISTENCE_PASS
- cleanup: the example removes its temporary session-store directory before exit
- evidence: record command output in the Task's scenario evidence field after implementation.

## Tasks

- [ ] `.agents/tasks/BEHAVIOR-2675-persist-turns-from-a-forked-session-into-its-copied-record.md` — todo

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-10

**Status upgrade:** draft → review-ready

**Judged by:** self-assessment against `.agents/specs/gate-catalogue.md` § GATE-WRITE. A guardian
subagent was not dispatched because the user's current instruction explicitly prohibits multi-agent
use; the mechanical judge independently reported 20 PASS and 7 semantic pending criteria before this
manual completion. The semantic criteria were checked against the document and source survey:

- Concrete symptom: the Problem names `/fork`, `resumeSessionId`, the missing child store, the frozen
  attached record, and the corrupt decoder outcome.
- Reproduction condition: the Problem specifies the background fork path, both in-process and
  child-process runners, and persisted parent-record reload.
- Research feeds the decision: the explicit waiver names the existing CLI-1994 contract, and the
  Decision uses the already-existing read/store seams to choose conditional persistence.
- Decision trade-off: alternative 2 is chosen to preserve ordinary transient jobs and the id-only IPC
  boundary; alternatives 1 and 3 document the storage and completion-time merge costs.
- New-surface placement: N/A — no package, app, presentation surface, or layer/product-family
  reclassification is introduced.
- Criteria coverage: TC-01 covers the integrated fork observable, TC-02 the runner/codec regressions,
  TC-03 the public SDK scenario, TC-04 the affected scans, and TC-05 build/type contracts.
- Observable form: every criterion names an executable command and exit/output condition.

This is a gate-content assessment only; it does not establish implementation correctness or merge
landing. The user approval is recorded separately at GATE-APPROVAL.

- GATE-WRITE — File begins with `---` YAML frontmatter block: PASS — frontmatter begins with `---`.
- GATE-WRITE — `status: draft` present in frontmatter: PASS — `status: draft`.
- GATE-WRITE — `type:` is exactly one allowed prefix: PASS — `type: BEHAVIOR`.
- GATE-WRITE — `tags:` field present: PASS — three tags are present.
- GATE-WRITE — Contains a concrete symptom: PASS — `/fork` child turns remain outside the copied record and decoder reload can be corrupt.
- GATE-WRITE — Contains a reproduction condition: PASS — the condition names background fork execution in both runners and subsequent attach/reload.
- GATE-WRITE — Problem has no placeholder or vague single sentence: PASS — the Problem is four concrete sentences with no `TBD` or `TODO`.
- GATE-WRITE — Prior Art Research section present: PASS — section present.
- GATE-WRITE — Research section substantiated or explicitly waived: PASS — explicit `Waived:` line names the existing CLI-1994 contract and the user's procedure-shortening authorization.
- GATE-WRITE — Research findings feed Alternatives / Decision: PASS — the waiver's repository-local prior art directly motivates conditional store wiring.
- GATE-WRITE — Architecture checklist complete: PASS — all five displayed checklist items are checked.
- GATE-WRITE — Sibling scan checked with evidence or N/A: PASS — N/A is explicit because no new surface is introduced and subagent dispatch is prohibited by the user.
- GATE-WRITE — Alternatives have Pro and Con: PASS — three alternatives each have both.
- GATE-WRITE — Decision references the trade-off: PASS — alternative 2 preserves ordinary transient jobs and the id-only IPC boundary.
- GATE-WRITE — New-surface placement conditional: PASS — N/A; existing package and interface surfaces only.
- GATE-WRITE — Completion Criteria use TC-N prefixes: PASS — TC-01 through TC-05.
- GATE-WRITE — At least one criterion per distinct feature: PASS — runner persistence, codec compatibility, SDK observable, scans, and build/type contracts are covered.
- GATE-WRITE — Criteria use command or observable form: PASS — all five criteria name commands and expected exit/output conditions.
- GATE-WRITE — No forbidden vague criterion language: PASS — no prohibited phrases occur.
- GATE-WRITE — Test Plan section present: PASS — section present.
- GATE-WRITE — Test Plan row count matches criteria: PASS — five rows for five criteria.
- GATE-WRITE — Every Test Plan row has Test Type and Tool/Approach: PASS — all five rows are populated.
- GATE-WRITE — Manual rows explain automation limits: PASS — zero manual rows.
- GATE-WRITE — Tasks section present with paired task: PASS — exact Task path is listed.
- GATE-WRITE — Evidence Log was empty before first gate entry: PASS — this is the first manual gate entry.
- GATE-WRITE — No body Status or Classification section: PASS — neither body section exists.
- GATE-WRITE — Completion Criteria and Test Plan counts match: PASS — five criteria and five rows.

### [GATE-APPROVAL] — ✅ PASS | 2026-09-10

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "다 사전승인함"
**Given:** 2026-09-10, this conversation
**Review fingerprint:** 971f5a4c6e74 (review 0ea8689a, type/tags 4cee8e68)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-10, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (971f5a4c6e74) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `5c0833dce84f` · base `origin/develop@5c0833dce84f` · document `.agents/spec-docs/backlog/BEHAVIOR-2675-persist-turns-from-a-forked-session-into-its-copied-record.md` blob `76bfa4df67db` (untracked)

**Semantic completion:** self-assessed because the user's current instruction prohibits any
multi-agent dispatch. The standing instruction `다 사전승인함` is an unambiguous approval of the
already-scoped implementation and its documented gate path in this conversation; the item is a
single-cause BEHAVIOR issue inside the direct route, not a delegated-class decision. The conditional
independent architecture review is N/A because the spec introduces no new package, app, presentation
surface, or layer/product-family boundary.

- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — the standing instruction `다 사전승인함` authorizes the already identified BEHAVIOR-2675 implementation and gate sequence in the current conversation.
- GATE-APPROVAL — The item is inside the class as the registry defines it: PASS (N/A) — route is DIRECT, so no delegated approval class boundary applies.
- GATE-APPROVAL — Independent architecture validation conditional: PASS (N/A) — no new package, app, presentation surface, or layer/product-family reclassification is introduced.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-10

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-10; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/BEHAVIOR-2675-persist-turns-from-a-forked-session-into-its-copied-record.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/BEHAVIOR-2675-persist-turns-from-a-forked-session-into-its-copied-record.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task carries 5 checkbox tasks for 5 criteria
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 889 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: automatable | 1`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 6 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->
```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/BEHAVIOR-2675-persist-turns-from-a-forked-session-into-its-copied-record.md",
  "specPath": ".agents/spec-docs/todo/BEHAVIOR-2675-persist-turns-from-a-forked-session-into-its-copied-record.md",
  "taskItems": [
    {
      "kind": "checkbox",
      "value": "Update the paired `BEHAVIOR-2675` spec and affected package SPEC/README/docs before code."
    },
    {
      "kind": "checkbox",
      "value": "Add red tests for in-process persistence, child-process persistence, codec round-trip, missing store failure, and ordinary-job non-persistence."
    },
    {
      "kind": "checkbox",
      "value": "Implement conditional session-store wiring and stable resumed session id in both runners."
    },
    {
      "kind": "checkbox",
      "value": "Run the public SDK scenario, focused tests, builds, typechecks, lint, and affected harness scans."
    },
    {
      "kind": "checkbox",
      "value": "Complete the spec/task done gate, publish one PR, merge to `origin/develop`, close #2675, and inspect/close only related issues invalidated by the delivered behavior."
    }
  ],
  "plan": {
    "outcome": "automatable",
    "count": 1
  },
  "worktreePaths": [
    ".agents/loop-runs/backlog-execution-orchestrator.jsonl",
    ".agents/loop-runs/post-implementation-checklist.jsonl",
    ".agents/loop-runs/user-execution-scenario.jsonl",
    ".agents/loop-runs/user-request-gate.jsonl",
    ".agents/spec-docs/todo/BEHAVIOR-2675-persist-turns-from-a-forked-session-into-its-copied-record.md",
    ".agents/tasks/BEHAVIOR-2675-persist-turns-from-a-forked-session-into-its-copied-record.md"
  ]
}
```
<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `5c0833dce84f` · base `origin/develop@5c0833dce84f` · document `.agents/spec-docs/todo/BEHAVIOR-2675-persist-turns-from-a-forked-session-into-its-copied-record.md` blob `6a1e273cfe38` (untracked)
