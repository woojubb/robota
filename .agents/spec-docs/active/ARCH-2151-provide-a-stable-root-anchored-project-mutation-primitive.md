---
status: in-progress
type: SECURITY
tags: [typescript, auth]
lane: L2
---

# ARCH-2151: Provide a stable root-anchored project mutation primitive

Paired with `.agents/tasks/ARCH-2151-provide-a-stable-root-anchored-project-mutation-primitive.md`. Arising from [issue #2151](https://github.com/woojubb/robota/issues/2151).

## Problem

`packages/agent-framework/src/workspace-trust/project-relative-writer.ts` validates an approved
workspace and then performs mutation through pathnames. When an ancestor directory or final target is
renamed or replaced with a symlink between those operations, a write or delete can be redirected away
from the approved workspace. The current Linux implementation partially addresses this with `/proc`-
backed descriptors, but all non-Linux mutation calls fail closed because no equivalent stable-root
primitive is owned there. The same low-level writer is used by project mutation, settings writer, and
state storage, so a pathname-only fix at one caller would leave the boundary inconsistent.

The reproduction condition is an authority-bearing project mutation under a concurrent parent or
target swap, or a supported host where mutation is refused solely because the current writer has no
portable stable-root implementation.

## Prior Art Research

The repository's prior-art record in `ARCH-042` was consulted directly because the user prohibits
subagents in this session; no external research worker was dispatched.

- [VS Code Workspace Trust](https://code.visualstudio.com/docs/editing/workspaces/workspace-trust)
  centralizes trust decisions, keeps unfamiliar workspaces restricted, and gives consumers an
  explicit trust state rather than treating a path as trusted by default.
- [Claude Code security](https://code.claude.com/docs/en/security) and [secure deployment](https://code.claude.com/docs/en/agent-sdk/secure-deployment)
  bound sensitive operations to an explicit working-directory boundary and recommend least-privilege
  mounts and fail-closed approval boundaries.
- [OpenAI Agents SDK sandbox concepts](https://openai.github.io/openai-agents-js/guides/sandbox-agents/concepts/)
  and [sandbox clients](https://openai.github.io/openai-agents-js/guides/sandbox-agents/clients/)
  use bounded workspace-relative capabilities and revalidate identity/grants at lifecycle boundaries.
- [`cap-std` filesystem capabilities](https://docs.rs/cap-std/latest/cap_std/fs/index.html) replace
  ambient path operations with directory capabilities and make entry into the process-wide namespace
  explicit.

Common behavior: trust is centralized; project access is conveyed through a bounded capability rather
than a path; relative operations stay under an already-authorized root; and unavailable guarantees do
not silently widen access. Robota must preserve its existing public authority decision and add stable
mutation anchoring beneath it, while retaining explicit refusal for hosts that cannot guarantee the
contract.

## Architecture Review

### Affected Scope

- `packages/agent-framework/src/workspace-trust/project-relative-writer.ts`
- `packages/agent-framework/src/workspace-trust/project-mutation.ts`
- `packages/agent-framework/src/workspace-trust/project-settings-writer.ts`
- `packages/agent-framework/src/workspace-trust/project-state-storage.ts`
- `packages/agent-framework/src/workspace-trust/types.ts` (only if the stable capability requires a
  public type projection)
- `packages/agent-framework/src/workspace-trust/project-relative-writer.test.ts`
- `packages/agent-framework/src/workspace-trust/workspace-project-authority.test.ts`
- `packages/agent-framework/docs/SPEC.md`

### Alternatives Considered

1. Recheck `realpath`/identity immediately before each pathname mutation.
   - Pro: small change and keeps the current public API unchanged.
   - Con: a rename or symlink swap can still occur after the final check and before the open/unlink;
     it does not establish a stable parent or target capability.
2. Use one stable-root mutation primitive backed by descriptor-relative or platform-equivalent
   no-follow operations, with explicit fail-closed refusal where the host cannot provide the guarantee.
   - Pro: gives every consumer one race-resistant owner and preserves least-privilege authority.
   - Con: requires platform adapters, careful handle lifetime management, and host-specific tests.
3. Copy mutations through a temporary file and rename the result using the existing path API.
   - Pro: can make replacement writes more atomic on some hosts.
   - Con: still trusts pathname resolution for parent and final target, does not cover append/delete,
     and can move a file outside the approved root.

### Decision

Choose alternative 2. A pathname recheck is not a containment primitive, and temp-file replacement
does not cover the full mutation surface. The existing `project-relative-writer.ts` remains the single
owner; it will delegate to stable-root host operations while `project-mutation.ts`, settings, and state
storage continue to express authorization and purpose decisions above it. Before approval, reachability
is validated for all three consumers, the existing `IWorkspaceProjectMutation` capability and denial
semantics are preserved, and an adversarial pass covers parent replacement, final-target replacement,
symlink traversal, non-regular files, stale workspace identity, handle closure, partial writes, and
unsupported hosts.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: internal fix with no contract change; the remedy is the repository's own precedent
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None. Unsupported hosts remain an explicit refusal, not a fallback to pathname mutation; the change
introduces no silent catch-to-default or broader-authority path.

## Solution

1. Define the stable-root operation boundary and host capability contract in
   `packages/agent-framework/src/workspace-trust/project-relative-writer.ts` (and
   `types.ts` only if a type projection is necessary).
2. Implement platform-specific stable-root/no-follow operations and the documented fail-closed
   decision in `project-relative-writer.ts`, preserving `WorkspaceAuthorityRequiredError` outcomes.
3. Keep `project-mutation.ts`, `project-settings-writer.ts`, and `project-state-storage.ts` as thin
   authorized consumers of the shared owner; remove any duplicated pathname mutation checks revealed
   by the audit.
4. Add deterministic swap, symlink, regular-file, stale-identity, and unsupported-host coverage in
   `project-relative-writer.test.ts` and `workspace-project-authority.test.ts`.
5. Update `packages/agent-framework/docs/SPEC.md`, the paired Task, and evidence artifacts with the
   final platform matrix, commands, and user execution result.

## Affected Files

- `packages/agent-framework/src/workspace-trust/project-relative-writer.ts`
- `packages/agent-framework/src/workspace-trust/project-relative-writer.test.ts`
- `packages/agent-framework/src/workspace-trust/workspace-project-authority.test.ts`
- `packages/agent-framework/src/workspace-trust/project-mutation.ts`
- `packages/agent-framework/src/workspace-trust/project-settings-writer.ts`
- `packages/agent-framework/src/workspace-trust/project-state-storage.ts`
- `packages/agent-framework/src/workspace-trust/types.ts` (conditional)
- `packages/agent-framework/docs/SPEC.md`

## Completion Criteria

- [ ] TC-01: `pnpm exec vitest run packages/agent-framework/src/workspace-trust/project-relative-writer.test.ts` → exits 0; the swap/refusal cases fail when the stable-root implementation is reverted.
- [ ] TC-02: `pnpm exec vitest run packages/agent-framework/src/workspace-trust/workspace-project-authority.test.ts` → exits 0 and confirms project mutation, settings, and state-storage consumers retain the same authority/purpose boundary.
- [ ] TC-03: `pnpm --filter @robota-sdk/agent-framework typecheck` → exits 0 with the final public types and host matrix.
- [ ] TC-04: `pnpm --filter @robota-sdk/agent-framework build` → exits 0 and emits the package artifact without unresolved stable-root imports.
- [ ] TC-05: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exits 0.
- [ ] TC-06: `pnpm exec tsx packages/agent-framework/examples/arch-2151-project-mutation.ts` → exits 0 and reports that every parent/final-target swap is refused or remains inside workspace A, with workspace B unchanged.

## Test Plan

| TC-ID | Test Type | Tool / Approach | Notes |
| ----- | --------- | --------------- | ----- |
| TC-01 | Security unit | `pnpm exec vitest run packages/agent-framework/src/workspace-trust/project-relative-writer.test.ts` | Swap mutant must be RED; complete file GREEN with fix. |
| TC-02 | Security integration | `pnpm exec vitest run packages/agent-framework/src/workspace-trust/workspace-project-authority.test.ts` | Consumer authority and purpose checks. |
| TC-03 | Type boundary | `pnpm --filter @robota-sdk/agent-framework typecheck` | Public capability types and platform declarations. |
| TC-04 | Package build | `pnpm --filter @robota-sdk/agent-framework build` | Artifact and import reachability. |
| TC-05 | Harness suite | `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` | Affected repository gates. |
| TC-06 | SDK user scenario | `pnpm exec tsx packages/agent-framework/examples/arch-2151-project-mutation.ts` | Public SDK mutation boundary and cleanup result. |

## User Execution Test Scenarios

### Scenario 1: public SDK project mutation remains workspace-confined

- Executability: agent-executable
- Product surface: public-sdk-example
- Surface rationale: shipped-interface=public-sdk-example
- Prerequisites: Node.js and pnpm from the repository toolchain; run from `packages/agent-framework`; the example creates temporary workspace A and outside workspace B and needs no live provider, credentials, or network access.
- Command: `pnpm exec tsx examples/arch-2151-project-mutation.ts`
- Observable type: sdk-result
- Observable rationale: source=public-sdk-return
- Expected observable: result=all-swaps-refused; workspace-b-unchanged=true
- Cleanup: the example removes both temporary workspaces and every symlink or handle it creates.
- Evidence: implementation evidence pending; the command must exit 0 and print the expected result.

## Tasks

- [ ] `.agents/tasks/ARCH-2151-provide-a-stable-root-anchored-project-mutation-primitive.md` — todo

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-10

**Status upgrade:** draft → review-ready

- GATE-WRITE — Contains a concrete symptom: `project-relative-writer.ts` validates a pathname and later opens or unlinks that same pathname, so a rename or symlink swap can redirect the authority-bearing mutation outside the approved workspace.
- GATE-WRITE — Contains a reproduction condition: the defect occurs when the validated root, parent directory, or target path is renamed or replaced between validation and the later write/delete operation; the risk applies to the workspace-trust mutation boundary on hosts where pathname identity can change during that interval.
- GATE-WRITE — Research findings feed Alternatives Considered / Decision: the cited VS Code, Claude Code, OpenAI Agents SDK, and cap-std material supports capability-scoped, fail-closed, root-confined filesystem access; those findings are reflected in the rejection of pathname rechecking and the selection of a stable root/parent-handle primitive.
- GATE-WRITE — Decision references the trade-off that drove the choice: the selected primitive preserves the existing public capability while closing the TOCTOU window; pathname rechecking is simpler but remains raceable, and copy/rename is heavier and does not cover direct delete semantics.
- GATE-WRITE — New-surface placement (conditional): no new package, app, presentation, interface, or product-family surface is introduced; the mutation primitive remains owned by the existing `packages/agent-framework` workspace-trust boundary, with public behavior exposed only through its existing project authority.
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: TC-01 and TC-02 cover stable write/delete behavior and existing authority consumers; TC-03 and TC-04 cover type/build and scan gates; TC-05 covers the public user scenario; TC-06 covers adversarial swap/refusal behavior, so each implementation and verification sub-item has an observable criterion.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form: every TC item names an executable command and exit expectation or states a directly observable result such as refusal, authority preservation, and workspace B remaining unchanged.

**Manual semantic review:** completed in the single permitted checkout. The user has prohibited subagents and additional worktrees, so these semantic criteria were checked directly against the GATE-WRITE catalogue and the cited repository evidence.

### [GATE-APPROVAL] — ✅ PASS | 2026-09-10

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "다 사전승인함"
**Given:** 2026-09-10, this conversation
**Review fingerprint:** 713176fdc194 (review 464cefb8, type/tags 19a7d3b6)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-10, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (713176fdc194) equals the document's current fingerprint
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: the user’s explicit “다 사전승인함” is the standing authorization for the current implementation work and its approved ARCH-2151 plan in this conversation.
- GATE-APPROVAL — The item is inside the class as the registry defines it: this approval uses route DIRECT, so no delegated class boundary is invoked or required.
- GATE-APPROVAL — Independent architecture validation (conditional): the spec introduces no new package, app, interface, or product-family surface; it keeps the existing agent-framework workspace-trust owner, so the conditional independent-validation requirement is not applicable.

**Manual semantic review:** completed in the single permitted checkout against the GATE-APPROVAL catalogue. No subagent or additional worktree was used, per the user’s restriction.

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `1b9098b64a6f` · base `origin/develop@1b9098b64a6f` · document `.agents/spec-docs/backlog/ARCH-2151-provide-a-stable-root-anchored-project-mutation-primitive.md` blob `8327ccee6717` (untracked)

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-09-10

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` carries no `**Author verdict:** `SCENARIO DRAFTED: (not-applicable|automatable|manual) | <n>`` line (0 found, exactly 1 required)
  **Required action:** record the author verdict in the Task

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `1b9098b64a6f` · base `origin/develop@1b9098b64a6f` · document `.agents/spec-docs/todo/ARCH-2151-provide-a-stable-root-anchored-project-mutation-primitive.md` blob `ab5ca32898f4` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-10

**Status upgrade:** approved → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "다 사전승인함"
**Given:** 2026-09-10, this conversation
**Review fingerprint:** e238893bad66 (review 436cf699, type/tags 19a7d3b6)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-10, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (e238893bad66) equals the document's current fingerprint
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: the user’s explicit “다 사전승인함” is the standing authorization for the current implementation work and its approved ARCH-2151 plan in this conversation.
- GATE-APPROVAL — The item is inside the class as the registry defines it: this approval uses route DIRECT, so no delegated class boundary is invoked or required.
- GATE-APPROVAL — Independent architecture validation (conditional): the spec introduces no new package, app, interface, or product-family surface; it keeps the existing agent-framework workspace-trust owner, so the conditional independent-validation requirement is not applicable.

**Manual semantic review:** completed in the single permitted checkout against the GATE-APPROVAL catalogue. No subagent or additional worktree was used, per the user’s restriction.

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `1b9098b64a6f` · base `origin/develop@1b9098b64a6f` · document `.agents/spec-docs/todo/ARCH-2151-provide-a-stable-root-anchored-project-mutation-primitive.md` blob `00052f99bd48` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-10

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-10; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/ARCH-2151-provide-a-stable-root-anchored-project-mutation-primitive.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/ARCH-2151-provide-a-stable-root-anchored-project-mutation-primitive.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task carries 10 checkbox tasks for 6 criteria
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 730 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: automatable | 1`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->
```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/ARCH-2151-provide-a-stable-root-anchored-project-mutation-primitive.md",
  "specPath": ".agents/spec-docs/todo/ARCH-2151-provide-a-stable-root-anchored-project-mutation-primitive.md",
  "taskItems": [
    {
      "kind": "checkbox",
      "value": "Read the package contract and existing reader/authority primitives; document the current Linux containment and unsupported-platform behavior as the baseline."
    },
    {
      "kind": "checkbox",
      "value": "Write and approve the paired spec defining the stable-root mutation contract, operation semantics, platform matrix, failure policy, and consumer ownership."
    },
    {
      "kind": "checkbox",
      "value": "Add characterization and deterministic race/swap tests for create, overwrite/replace, append, and delete operations, including authority and regular-file checks."
    },
    {
      "kind": "checkbox",
      "value": "Implement the shared primitive and route every project mutation consumer through it without duplicating pathname validation."
    },
    {
      "kind": "checkbox",
      "value": "Run the user execution test scenario, affected verification, package contract/build checks, and repository harness gates; record concrete evidence before completion."
    },
    {
      "kind": "checkbox",
      "value": "One documented owner defines stable-root semantics for project create, replace/overwrite, append, and delete operations."
    },
    {
      "kind": "checkbox",
      "value": "Parent-directory and final-target rename/symlink swaps cannot redirect a mutation outside the approved workspace; unsafe targets are refused without partial writes or deletes."
    },
    {
      "kind": "checkbox",
      "value": "Cross-platform behavior and fail-closed refusal are explicit and covered by tests on each supported or intentionally unsupported host class."
    },
    {
      "kind": "checkbox",
      "value": "`createWorkspaceProjectMutation`, project settings writers, and project state storage all use the owned primitive rather than reproducing pathname-only mutation checks."
    },
    {
      "kind": "checkbox",
      "value": "Package SPEC, Task/spec gate evidence, user execution test scenario evidence, affected tests, build/typecheck, lint, and repository harness checks are green."
    }
  ],
  "plan": {
    "outcome": "automatable",
    "count": 1
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/ARCH-2151-provide-a-stable-root-anchored-project-mutation-primitive.md",
    ".agents/tasks/ARCH-2151-provide-a-stable-root-anchored-project-mutation-primitive.md"
  ]
}
```
<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `1b9098b64a6f` · base `origin/develop@1b9098b64a6f` · document `.agents/spec-docs/todo/ARCH-2151-provide-a-stable-root-anchored-project-mutation-primitive.md` blob `a7ed12bf7139` (untracked)

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-09-10

**Status remains:** in-progress
**Failed criteria:**

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: status is `in-progress`, `approved` expected
  **Required action:** run the prior gate to PASS first

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `1b9098b64a6f` · base `origin/develop@1b9098b64a6f` · document `.agents/spec-docs/active/ARCH-2151-provide-a-stable-root-anchored-project-mutation-primitive.md` blob `42bbc98eddcc` (modified)
