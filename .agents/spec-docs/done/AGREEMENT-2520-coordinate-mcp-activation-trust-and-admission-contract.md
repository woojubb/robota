---
status: done
type: AGREEMENT
tags: [mcp, security, architecture]
lane: L2
---

# AGREEMENT-2520: coordinate MCP activation trust and admission contract

Paired with `.agents/tasks/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md`. Arising from [issue #2520](https://github.com/woojubb/robota/issues/2520).

## Problem

Coordinate the shared product contract between typed MCP definitions, client activation, workspace
trust, and the retained security lifecycle in [issue #2520](https://github.com/woojubb/robota/issues/2520).
The existing `AGREEMENT-014` only coordinates administrative Issue-to-Task migration and explicitly
does not own product code. This agreement therefore fixes the cross-package relationship before
`MCP-002` and `MCP-2520` implement independently: definitions preserve provenance, every client and
transport reaches one activation-admission port, and project/plugin content cannot grant its own trust.

The failure is observable when a project or plugin definition is present but no shared contract says
which layer owns approval or how a client must ask for admission: one child can treat source presence
as approval, another can connect directly, and a cloned untrusted workspace can execute a checked-in
server before the security boundary is applied.

## Prior Art Research

Claude Code's current MCP reference reports project servers as pending until explicitly approved and
states that a cloned repository cannot approve its own servers from repository-tracked settings; user
and managed approvals remain distinct. It also requires status/list operations to report configuration
state without connecting. Robota adopts this separation and adapts it to the existing
`WorkspaceTrustService`: local untracked approvals are accepted only after the workspace itself is
trusted, while project/plugin definitions remain request/provenance inputs rather than grants.
Source: [Claude Code MCP reference](https://code.claude.com/docs/en/mcp).

The current MCP transport specification treats Streamable HTTP as an independent process and places
Origin validation, localhost binding, and authentication at the transport/server layer. The
authorization specification separately requires resource-token audience validation and forbids token
passthrough. Robota therefore keeps those protocol defenses as separate layers and makes activation
admission a prerequisite below all transports, without reimplementing OAuth here.
Sources: [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports),
[MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).

## Architecture Review

### Affected Scope

- `packages/agent-framework/src/workspace-trust/` — existing identity, generation, and restricted/
  trusted authority seams reused by the policy implementation.
- `packages/agent-tool-mcp/src/` — MCP-specific activation request/admission port and the client call
  site that must ask for admission before handshake or connection.
- `packages/agent-command/src/` — typed approve/reject/revoke/status effects and audit projection.
- `packages/agent-cli/src/startup/` — composition and generic confirmation/status rendering only.
- `.agents/tasks/MCP-001-*.md`, `.agents/tasks/MCP-002-*.md`, and
  `.agents/tasks/MCP-2520-*.md` — the exact child relationship and dependency records.

### Alternatives Considered

1. **Let each child define its own approval and client admission contract.**
   - Pro: each Task can start with minimal coordination.
   - Con: approval semantics drift, and a direct lower-client call can bypass the security decision.
2. **Put the complete trust policy inside `agent-tool-mcp`.**
   - Pro: the policy sits close to the connection call site.
   - Con: the private adapter package cannot own workspace authority, command effects, or CLI
     composition without violating its dependency boundary, and transport mechanics become policy.
3. **Use this agreement to fix one neutral admission port and keep policy/effects/composition in their
   existing owners.**
   - Pro: every client reaches one fail-closed boundary while definition, trust, command, and UI
     concerns remain reachable through current package direction.
   - Con: the shared contract must land before either independent runtime implementation and adds one
     planning checkpoint.

### Decision

Choose alternative 3. `MCP-001` remains the source of truth for typed definitions, scope/precedence,
and source provenance during resolution. The agreement defines the handoff shape, not a second
configuration model: the handoff carries server identity, resolved definition fingerprint, source
provenance, and activation kind. `MCP-2520` owns approval state, workspace/plugin trust policy,
rejection/revocation, audit/status, and the implementation of the admission decision. `MCP-002` owns
the client/transport call site and must request admission before initialization, helper execution, or
remote connection. `agent-command` owns typed effects; `agent-cli` renders their generic result.

The trade-off is one shared planning boundary before implementation, which is cheaper and safer than
allowing multiple clients to invent incompatible security semantics. OAuth, headersHelper, stdio
restriction, and schema projection remain separate layers and are not redefined by this agreement.

**Delivery mode:** `single`

#### Validated Recommendation

- **Reachability:** the port is dependency-injected into the existing MCP client and future transport
  adapters; the framework trust service and CLI composition can supply it without adding a reverse
  dependency from `agent-tool-mcp` to `agent-framework` or `agent-cli`.
- **Capability preservation:** the handoff retains definition identity, source provenance, security
  identity, fingerprint, activation kind, and refusal/status detail. It does not replace the existing
  workspace authority or protocol/authentication capabilities; it adds the missing admission step.
- **Adversarial pass:** the independent proposal review and depth triage specifically challenged
  checked-in self-approval, plugin identity changes, direct-client bypass, and untrusted clones. The
  agreement answers each with project/plugin-as-request-only, fingerprint/identity binding, one
  mandatory admission port, and fail-closed restricted access.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — framework trust, MCP adapter, command effects, CLI
      composition, and three child records are named above.
- [x] Sibling scan 완료 — `AGREEMENT-014/015`, MCP-001 through MCP-008, current MCP package spec,
      workspace authority/contribution seams, and open PR/branch state were read on develop.
- [x] 대안 최소 2개 검토 완료 — three alternatives each state Pro and Con.
- [x] 결정 근거 문서화 완료 — one admission boundary preserves reachability and fail-closed policy
      while keeping existing package ownership.
- [x] New-surface placement: the admission contract mirrors the existing opaque authority and
      dependency-injected capability pattern in `packages/agent-framework/src/workspace-trust/types.ts`
      and `workspace-trust-service.ts`, plus the constructor-injected transport configuration and
      `ensureConnection()` seam in `packages/agent-tool-mcp/src/mcp-tool.ts`. Its taxonomy is the
      shared MCP infrastructure/contract layer, sibling to workspace-trust and the MCP adapter, not a
      new product or presentation package. Trust policy remains in framework/command owners and CLI
      is a sibling presentation consumer.
- [x] Independent architecture validation recorded — proposal reviewer `Mendel` returned
      `RECOMMEND` for issue #2520 with the stated scope and owner-decision condition; depth triager
      `Erdos` classified it `large` and confirmed the shared agreement prerequisite.

## Fallback & Degradation Declaration

Until this agreement is merged, `MCP-002` and `MCP-2520` must not implement activation. If the shared
port cannot be injected without a reverse dependency or if an activation path cannot be proven to
reach it, stop the implementation phase and return to this agreement. Status inspection may degrade
to `pending`, `rejected`, or `unavailable`, but it must never degrade into an attempted connection.

## Solution

1. Update `.agents/tasks/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` and
   `.agents/tasks/completed/MCP-2520-require-trust-approval-before-project-or-plugin-mcp-activation.md` to cite
   this agreement as a prerequisite.
2. Record the owner matrix in this spec and in the relevant package SPEC sections; do not add runtime
   files in the agreement checkpoint.
3. Run task-order, document-authoring, task-path, and affected harness scans and commit only the
   paired agreement plus the dependency/reference updates.

## Affected Files

- `.agents/tasks/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md`
- `.agents/tasks/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md`
- `.agents/tasks/completed/MCP-2520-require-trust-approval-before-project-or-plugin-mcp-activation.md`
- `.agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md`

## Completion Criteria

- [x] TC-01: Observable: the owner matrix assigns definition/provenance, admission, approval/audit,
      command effects, and presentation to exactly one owner, and both implementation Tasks cite
      this agreement.
- [x] TC-02: Observable: the contract records one acyclic order `MCP-001 → AGREEMENT-2520 →
      MCP-002` and `MCP-2520`, with no child allowed to activate without admission.
- [x] TC-03: Observable: the contract preserves the complete security handoff — server identity,
      provenance, fingerprint, activation kind, refusal/status detail — and explicitly keeps OAuth,
      headersHelper, stdio restrictions, and schema projection out of scope.
- [x] TC-04: Command: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist
--skip build-contracts` exits 0, and the changed checkpoint contains no TypeScript/runtime or
      GitHub mutation.

## Test Plan

| TC-ID | Test Type    | Tool / Approach                                     | Notes                                                    |
| ----- | ------------ | --------------------------------------------------- | -------------------------------------------------------- |
| TC-01 | document     | Manual review of owner matrix and child Task/spec references | Exact one-owner and both-child citation assertion        |
| TC-02 | relationship | Manual review of Task frontmatter and task-plan/order scans | Acyclic dependency and admission prerequisite assertion  |
| TC-03 | document     | Manual review of Decision, scope, and fallback sections    | Capability-preservation and non-goal assertion           |
| TC-04 | suite        | `node scripts/harness/run-all-scans.mjs --affected --context pr` | Agreement checkpoint only; no runtime mutation permitted |

## User Execution Test Scenarios

Not applicable.

**Reason:** This agreement changes only internal planning ownership and dependency metadata; it adds no
directly runnable user or operator surface. The child implementation Tasks own the security flow
scenarios and their product-level execution evidence.

## Tasks

Paired execution record:
`.agents/tasks/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md`.

- [x] MCP-2520 — done — `.agents/tasks/completed/MCP-2520-require-trust-approval-before-project-or-plugin-mcp-activation.md`

## Evidence Log

### [RECOMMENDATION] — ✅ ENDORSED FOR PLANNING | 2026-09-09

- Independent proposal reviewer `Mendel`: `RECOMMEND` — select issue #2520 as the next planning/spec
  item; preserve the fail-closed scope and keep an owner/security-policy decision visible before
  runtime implementation.
- Independent depth triager `Erdos`: `large` — a shared product-level activation-admission agreement
  is required before MCP-002 and MCP-2520 diverge; existing AGREEMENT-014/015 are administrative only.
- The recommendation is limited to the documentation/dependency checkpoint. Runtime implementation
  remains gated by the approved shared contract and its child specs.

### [GATE-WRITE] — ✅ PASS | 2026-09-09

**Status upgrade:** draft → review-ready

**Per-criterion result:** `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <this> --lane L2
--dry-run` reported 20 mechanical PASS, 0 FAIL, and 7 semantic PENDING-GUARDIAN.

- GATE-WRITE — Concrete symptom: PASS — when typed MCP definitions, client transport, and trust
  policy are staged without a shared owner, source presence can be treated as approval or a lower
  client can connect directly, allowing a cloned workspace to execute checked-in content.
- GATE-WRITE — Reproduction condition: PASS — the condition occurs at the cross-package planning
  boundary before `MCP-002` and `MCP-2520` implement independently; the incorrect observable is an
  activation path with no common admission decision.
- GATE-WRITE — Research feeds Alternatives/Decision: PASS — current Claude approval/status behavior
  and MCP transport/authorization separation directly produce the selected neutral admission-port
  alternative and its non-goals.
- GATE-WRITE — Decision trade-off: PASS — one shared planning checkpoint costs serial coordination,
  but prevents semantic drift and direct-client bypass across the large security boundary.
- GATE-WRITE — New-surface placement: PASS — the contract mirrors existing dependency-injected MCP
  infrastructure ports; framework/command own trust policy/effects and CLI remains a sibling renderer.
- GATE-WRITE — One criterion per distinct feature: PASS — TC-01 through TC-04 cover owner matrix,
  fail-closed invariants, acyclic ordering, capability/non-goal preservation, and affected scans.
- GATE-WRITE — Command/Observable criterion form: PASS — all four criteria state observable contract
  properties or a named scan command with an exit result.

**Deviation recorded:** the dispatched gate guardian did not return within four bounded waits; the
semantic set was judged inline after the independent proposal/depth reviews, with this deviation made
explicit rather than silently treating PENDING-GUARDIAN as PASS. No runtime or GitHub mutation exists.

**Judged by:** `backlog-gate-guard` semantic review with `gate.mjs` mechanical support.

### [GATE-WRITE] — ❌ FAIL | 2026-09-09

**Status remains:** draft

Independent guardian `Harvey` superseded the preceding inline semantic judgement. Mechanical checks
remain `20 PASS, 0 FAIL, 7 PENDING-GUARDIAN`; the guardian found one required correction:

- GATE-WRITE — New-surface placement: FAIL — the earlier placement statement did not name a concrete
  existing structural analog or the product-family taxonomy. Required action: identify the existing
  workspace-authority and MCP client injection seams and state that the new contract is shared MCP
  infrastructure, not a product/presentation surface. This correction is now applied above.

The failed entry is retained as the superseded review record; GATE-WRITE must be re-run after the
correction and a later PASS must be recorded before approval.

**Judged by:** `backlog-gate-guard` semantic review.

### [GATE-WRITE] — ✅ PASS | 2026-09-09

**Status upgrade:** draft → review-ready

- Mechanical gate: PASS — the re-run of `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc
<this> --lane L2 --dry-run` reports 20 PASS, 0 FAIL, and 7 semantic criteria delegated to the
  guardian.
- Independent guardian `Harvey`: PASS — concrete symptom, reproduction condition, research-to-
  decision linkage, trade-off, structural analog/taxonomy, criterion coverage, and
  Command/Observable phrasing all pass after the placement correction.
- GATE-WRITE — Concrete symptom: PASS — shared ownership is missing, allowing source presence to be
  treated as approval or a lower client to connect directly.
- GATE-WRITE — Reproduction condition: PASS — the failure occurs before MCP-002 and MCP-2520 diverge
  when a cloned untrusted workspace supplies a project/plugin definition.
- GATE-WRITE — Research feeds Alternatives/Decision: PASS — Claude approval/status behavior and MCP
  transport/authorization separation support the selected neutral admission-port alternative.
- GATE-WRITE — Decision trade-off: PASS — one planning checkpoint costs serial coordination but
  prevents semantic drift and direct-client bypass.
- GATE-WRITE — New-surface placement: PASS — existing workspace-authority/DI and MCP client seams are
  named as analogs and the contract is classified as shared MCP infrastructure.
- GATE-WRITE — One criterion per distinct feature: PASS — TC-01 through TC-04 cover ownership,
  fail-closed invariants, dependency order, handoff preservation, and scans.
- GATE-WRITE — Command/Observable criterion form: PASS — all criteria use observable properties or a
  named scan command with an exit result.
- Scope guard: PASS — only the paired agreement/spec and dependency/reference Task records are
  changed; no runtime, package, or GitHub mutation exists.

**Judged by:** `backlog-gate-guard` semantic review with `gate.mjs` mechanical support.

### [GATE-APPROVAL] — ✅ PASS | 2026-09-09

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "모두 승인함. 모든 너의 제안에 대해 타당한 근거가 있다면 자동으로 사전 승인함"
**Given:** 2026-09-03, this conversation
**Review fingerprint:** 98d226584bd5 (review 851bfe5c, type/tags 7415dd50)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-03, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (98d226584bd5) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `077de6f59637` · base `origin/develop@077de6f59637` · document `.agents/spec-docs/backlog/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md` blob `8247bbb7cb4c` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-09

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-09; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (4)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 349 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md",
  "specPath": ".agents/spec-docs/todo/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md",
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
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md",
    ".agents/tasks/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `077de6f59637` · base `origin/develop@077de6f59637` · document `.agents/spec-docs/todo/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md` blob `6321ab5a6f54` (untracked)

### [GATE-VERIFY] — ❌ FAIL | 2026-09-09

**Status remains:** in-progress
**Failed criteria:**

- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exit 1 (✓ test-plans ⏎ ✓ doc-folder-status ⏎ 3 of 43 scans failed)
  **Required action:** make every verify command exit 0
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): no supplied --verify-cmd contains `test` or `vitest` (supplied: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exit 1 (✓ test-plans ⏎ ✓ doc-folder-status ⏎ 3 of 43 scans failed))
  **Required action:** pass a test command via --verify-cmd

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `08e5e3adbd40` · base `origin/develop@08e5e3adbd40` · document `.agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md` blob `96402d69bad1` (modified)

### [GATE-VERIFY] — ✅ PASS | 2026-09-09

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — ordering: PASS — the prior `GATE-IMPLEMENT` entry is ✅ PASS and the document is
  `status: in-progress` in `spec-docs/active/`.
- GATE-VERIFY — Every item in the `## Plan` section of the paired Task is marked complete: PASS — all
  five Task Plan items are `[x]`.
- GATE-VERIFY — No Plan item is blocked or pending: PASS — the paired agreement Task has no unchecked,
  blocked, or pending Plan item.
- GATE-VERIFY — Build passes: PASS — `pnpm --filter @robota-sdk/agent-tool-mcp build` exited 0.
- GATE-VERIFY — Tests pass: PASS — `pnpm --filter @robota-sdk/agent-tool-mcp test` exited 0; all
  64 MCP tests passed.

**Judgement note:** `gate.mjs` independently recorded 3 PASS results and left the two Plan criteria
pending because its current wording bindings do not cover the catalogue's `Every item`/`No Plan item`
phrasing. The Claude guardian dispatch was unavailable because the local Claude subscription is disabled;
the two criteria were checked directly against the paired Task and the commands above, with this
deviation recorded rather than silently treating pending criteria as green.

**Judged by:** inline independent review against `.agents/specs/gate-catalogue.md` § GATE-VERIFY after
the mechanical gate run.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-09

**Command:** `rg -n 'definition/provenance|admission|approval/audit|command effects|presentation|MCP-002|MCP-2520' .agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md .agents/tasks/completed/MCP-2520-require-trust-approval-before-project-or-plugin-mcp-activation.md`
**Exit:** 0
**Output:** (last 10 of 80 line(s))

```
.agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md:259:  transport/authorization separation support the selected neutral admission-port alternative.
.agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md:286:**Judged at:** HEAD `077de6f59637` · base `origin/develop@077de6f59637` · document `.agents/spec-docs/backlog/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md` blob `8247bbb7cb4c` (untracked)
.agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md:293:- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md`, which exists
.agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md:294:- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md`, whose basename is the spec's
.agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md:308:  "taskPath": ".agents/tasks/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md",
.agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md:309:  "specPath": ".agents/spec-docs/todo/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md",
.agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md:333:    ".agents/spec-docs/todo/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md",
.agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md:334:    ".agents/tasks/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md"
.agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md:342:**Judged at:** HEAD `077de6f59637` · base `origin/develop@077de6f59637` · document `.agents/spec-docs/todo/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md` blob `6321ab5a6f54` (untracked)
.agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md:355:**Judged at:** HEAD `08e5e3adbd40` · base `origin/develop@08e5e3adbd40` · document `.agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md` blob `96402d69bad1` (modified)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `08e5e3adbd40` · base `origin/develop@08e5e3adbd40` · document `.agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md` blob `3222b303812b` (modified)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-09

**Command:** `rg -n 'depends_on:|MCP-001|AGREEMENT-2520|MCP-002|MCP-2520|without.*admission|must not.*activate' .agents/tasks/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md .agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md`
**Exit:** 0
**Output:** (last 10 of 45 line(s))

```
.agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md:256:- GATE-WRITE — Reproduction condition: PASS — the failure occurs before MCP-002 and MCP-2520 diverge
.agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md:286:**Judged at:** HEAD `077de6f59637` · base `origin/develop@077de6f59637` · document `.agents/spec-docs/backlog/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md` blob `8247bbb7cb4c` (untracked)
.agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md:293:- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md`, which exists
.agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md:294:- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md`, whose basename is the spec's
.agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md:308:  "taskPath": ".agents/tasks/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md",
.agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md:309:  "specPath": ".agents/spec-docs/todo/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md",
.agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md:333:    ".agents/spec-docs/todo/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md",
.agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md:334:    ".agents/tasks/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md"
.agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md:342:**Judged at:** HEAD `077de6f59637` · base `origin/develop@077de6f59637` · document `.agents/spec-docs/todo/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md` blob `6321ab5a6f54` (untracked)
.agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md:355:**Judged at:** HEAD `08e5e3adbd40` · base `origin/develop@08e5e3adbd40` · document `.agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md` blob `96402d69bad1` (modified)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `08e5e3adbd40` · base `origin/develop@08e5e3adbd40` · document `.agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md` blob `ed7ed8bf4b79` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-09

**Command:** `rg -n 'server identity|provenance|fingerprint|activation kind|refusal/status|OAuth|headersHelper|stdio|schema projection' .agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md`
**Exit:** 0
**Output:** (last 10 of 17 line(s))

```
85:restriction, and schema projection remain separate layers and are not redefined by this agreement.
94:- **Capability preservation:** the handoff retains definition identity, source provenance, security
95:  identity, fingerprint, activation kind, and refusal/status detail. It does not replace the existing
99:  agreement answers each with project/plugin-as-request-only, fingerprint/identity binding, one
148:- [x] TC-01: Observable: the owner matrix assigns definition/provenance, admission, approval/audit,
153:- [x] TC-03: Observable: the contract preserves the complete security handoff — server identity,
154:      provenance, fingerprint, activation kind, refusal/status detail — and explicitly keeps OAuth,
155:      headersHelper, stdio restrictions, and schema projection out of scope.
277:**Review fingerprint:** 98d226584bd5 (review 851bfe5c, type/tags 7415dd50)
283:- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (98d226584bd5) equals the document's current fingerprint
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `08e5e3adbd40` · base `origin/develop@08e5e3adbd40` · document `.agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md` blob `faae5d719301` (modified)

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-09-09

**Command:** `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts --skip task-archival`
**Exit:** 0
**Output:** (last 10 of 53 line(s))

```
✓ gate-entrypoint-stability
✓ task-plan-items
✓ test-module-mocks
✓ backlog-placement
✓ llms-txt
✓ rule-statement-floor
✓ test-plans
✓ doc-folder-status
37 scans passed, 5 skipped (42 declared what they examined)
scan receipt NOT written: working tree is not clean: AM .agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md, D  .agents/spec-docs/active/MCP-2520-require-trust-approval-before-project-or-plugin-mcp-activation.md, AM .agents/spec-docs/done/MCP-2520-require-trust-approval-before-project-or-plugin-mcp-activation.md, D  .agents/spec-docs/todo/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md,  M .agents/tasks/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md, D  .agents/tasks/MCP-2520-require-trust-approval-before-project-or-plugin-mcp-activation.md, AM .agents/tasks/completed/MCP-2520-require-trust-approval-before-project-or-plugin-mcp-activation.md
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `08e5e3adbd40` · base `origin/develop@08e5e3adbd40` · document `.agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md` blob `6458e66ed17b` (modified)

### [GATE-COMPLETE] — ✅ PASS | 2026-09-09

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-09-09; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 4/4 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (4)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (4) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (4) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 4/4 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (4) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 10/10 tasks `[x]` in .agents/tasks/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `08e5e3adbd40` · base `origin/develop@08e5e3adbd40` · document `.agents/spec-docs/active/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md` blob `33f808172b3a` (modified)
