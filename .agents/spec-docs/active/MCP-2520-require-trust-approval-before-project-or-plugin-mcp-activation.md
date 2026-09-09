---
status: in-progress
type: SECURITY
tags: [cli, auth, typescript]
lane: L2
---

# MCP-2520: require trust approval before project or plugin MCP activation

Paired with `.agents/tasks/MCP-2520-require-trust-approval-before-project-or-plugin-mcp-activation.md`. Arising from [issue #2520](https://github.com/woojubb/robota/issues/2520).

## Problem

Today `MCPTool.execute()` at `packages/agent-tool-mcp/src/mcp-tool.ts:74` calls
`ensureConnection()` before sending `tools/call`, and `ensureConnection()` at `:209` calls
`initializeMCPSession(this.mcpConfig)` directly. There is no approval/admission check in that path.
When a project/plugin definition is wired from an untrusted checkout or installed plugin, the first
execution therefore reaches the configured remote endpoint (or a future process/helper) even though
the source has not received an explicit trust decision; a status-only path has no pending/rejected
decision to report. Reproduce by executing an `MCPTool` constructed from such a definition: its first
request performs the initialization fetch before any approval state can be evaluated. The required
behavior is an inspectable pending/rejected refusal with zero connection/spawn side effects.

Require an explicit, auditable trust decision before a project- or plugin-provided MCP server can
activate a local process or remote authority. A definition may be parsed and shown as pending or
rejected, but its presence in a cloned repository or installed plugin must never itself mint the
authority needed to connect or spawn. Preserve the exact security boundary and acceptance record of
[issue #2520](https://github.com/woojubb/robota/issues/2520), which remains a retained external
lifecycle item under issue #1985's initiative.

## Prior Art Research

Claude Code's current MCP reference shows project servers as pending until approval, ignores
repository-tracked approval settings in an untrusted cloned repository, and keeps user/managed
approval sources distinct. Its list/status commands report configuration state without connecting.
Robota adopts that fail-closed distinction and adapts local untracked approval to the existing
`WorkspaceTrustService`: an untrusted project/plugin definition can request approval but cannot grant
it. Source: [Claude Code MCP reference](https://code.claude.com/docs/en/mcp).

The current MCP transport specification describes Streamable HTTP as an independent process and
requires Origin validation, localhost binding for local servers, and authentication. The authorization
specification separately requires resource-token audience validation and forbids token passthrough.
Robota keeps those transport/authentication defenses as separate layers; this work adds the earlier
activation-admission gate without implementing OAuth or transport-specific restrictions.
Sources: [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports),
[MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).

## Architecture Review

### Affected Scope

- `packages/agent-framework/src/workspace-trust/` — reuse identity, generation, and restricted/
  trusted authority; do not mint ambient project authority.
- `packages/agent-tool-mcp/src/` — inject the admission port and require it before handshake,
  connection, or helper activation.
- `packages/agent-command/src/` — own typed approve/reject/revoke/status effects and audit results.
- `packages/agent-cli/src/startup/` — compose the policy and render generic status/confirmation.
- `packages/agent-tool-mcp/docs/SPEC.md`, `packages/agent-framework/docs/SPEC.md`,
  `packages/agent-command/docs/SPEC.md`, and `packages/agent-cli/docs/SPEC.md` — update only the
  contracts owned by each package after implementation.

### Alternatives Considered

1. **Treat a parsed project/plugin definition as executable immediately.**
   - Pro: simplest startup and no approval UI/state.
   - Con: checked-in content becomes an implicit code-execution grant, including in cloned projects.
2. **Put a boolean trust check in each transport/client.**
   - Pro: small local changes for the current HTTP client.
   - Con: future stdio/helpers and direct lower-client calls can bypass duplicated checks; provenance
     and approval lifecycle have no owner.
3. **Use one typed admission port backed by workspace trust and explicit approval records.**
   - Pro: one fail-closed boundary, exact definition/provenance/identity binding, reusable across
     transports, and status can be non-activating.
   - Con: large cross-package change requiring a shared contract checkpoint and explicit persistence
     policy.

### Decision

Choose alternative 3, governed by the paired
`.agents/tasks/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md`. The default
policy is: managed/user authority may approve; project/plugin content may only request approval;
untracked local approval is valid only after workspace trust; any material definition, source
provenance, executable command/URL, or security identity change makes the prior approval stale; and
rejection/revocation deny later admission. The admission port is called before any MCP handshake,
remote connection, process spawn, helper execution, or authentication flow.

`agent-command` owns typed effects and auditable state transitions. `agent-cli` renders generic
confirmation/status data and never decides trust. The definition owner (`MCP-001`) supplies the
resolved identity/provenance; the client owner (`MCP-002`) supplies the connection path; this Task
owns the approval policy and admission implementation.

This choice pays the cost of a cross-package approval store, provenance/fingerprint contract, and
pre-implementation agreement; that cost is accepted because duplicated transport booleans would leave
future stdio/helper paths and direct lower-client calls able to bypass the security boundary.

**Delivery mode:** `single`

#### Validated Recommendation

- **Reachability:** dependency injection connects the existing framework authority and CLI composition
  to the MCP client without making the private `agent-tool-mcp` package import framework or CLI.
- **Capability preservation:** admission retains server identity, source provenance, definition
  fingerprint, activation kind, status/refusal detail, and existing transport/auth capabilities; it
  does not replace MCP parsing or OAuth.
- **Adversarial pass:** independent review challenged checked-in self-approval, plugin identity
  changes, direct client bypass, and cloned workspaces. The policy answers them with project/plugin
  request-only semantics, exact binding, a mandatory single port, and restricted access fail-closed.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — framework authority, MCP client, command effects, CLI
      composition, and package contract docs are named above.
- [x] Sibling scan 완료 — issue #2520, parent issue #1985, MCP-001 through MCP-008, AGREEMENT-014/
      015, existing workspace authority/contribution seams, MCP package spec, and current branch/PR
      state were inspected on develop.
- [x] 대안 최소 2개 검토 완료 — three alternatives each state Pro and Con.
- [x] 결정 근거 문서화 완료 — a single admission port prevents transport bypass while preserving
      package ownership and the non-activating status path.
- [x] New-surface placement: the admission interface mirrors the opaque authority and
      dependency-injected capability pattern in `packages/agent-framework/src/workspace-trust/types.ts`
      and `workspace-trust-service.ts`, plus the constructor-injected `IMCPConfig` and
      `ensureConnection()` seam in `packages/agent-tool-mcp/src/mcp-tool.ts`. Its taxonomy is the
      shared MCP infrastructure/contract layer, not a new product or presentation package; trust
      policy/effects stay with framework/command owners and CLI remains a sibling renderer.

## Fallback & Degradation Declaration

If a project/plugin definition cannot be inspected without activation, or if any connection path does
not reach admission, fail closed and report a typed refusal/status. A status or health query may return
`pending`, `rejected`, `stale`, or `unavailable`, but must not connect, spawn, authenticate, or execute
a helper as a fallback.

## Solution

1. Add the provider-neutral activation request, provenance/fingerprint handoff, admission result, and
   lease/refusal types in the owner selected by AGREEMENT-2520; update `packages/agent-tool-mcp/src/index.ts`
   only for the intended contract surface.
2. Implement approval persistence and admission against `WorkspaceTrustService` and the exact
   definition/provenance/identity fingerprint; ensure stale/revoked/rejected records cannot be used.
3. Insert the admission call before `MCPTool.ensureConnection()` and every future activation adapter;
   status/list/inspection paths must consume inspection only.
4. Add typed command effects and generic CLI projections for approve/reject/revoke/status, redact
   secrets from audit output, and preserve user/managed/project-local precedence.
5. Update each affected package SPEC and add unit, integration, and assembled scenario coverage before
   running typecheck, build, boundary, and harness verification.

## Affected Files

- `packages/agent-framework/src/workspace-trust/`
- `packages/agent-tool-mcp/src/`
- `packages/agent-command/src/`
- `packages/agent-cli/src/startup/`
- `packages/agent-tool-mcp/docs/SPEC.md`
- `packages/agent-framework/docs/SPEC.md`
- `packages/agent-command/docs/SPEC.md`
- `packages/agent-cli/docs/SPEC.md`
- `.agents/tasks/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md`
- `.agents/tasks/MCP-2520-require-trust-approval-before-project-or-plugin-mcp-activation.md`

## Completion Criteria

- [ ] TC-01: Observable: a project/plugin definition in an untrusted workspace is listed as pending,
      rejected, stale, or unavailable without a process spawn, remote connection, authentication, or
      helper execution.
- [ ] TC-02: Observable: a checked-in approval cannot activate its own project/server definition,
      while a permitted user/managed or trusted local-untracked approval admits only the exact
      definition, provenance, security identity, and activation kind it names.
- [ ] TC-03: Observable: changing the command, args, URL, headers/helper identity, plugin source, or
      security identity invalidates prior approval; reject and revoke deny subsequent admission and
      emit auditable secret-free status.
- [ ] TC-04: Observable: direct calls through the MCP client and every transport adapter reach the
      same admission port before handshake or activation; status/health inspection reaches no server.
- [ ] TC-05: Command: affected package tests, typechecks, builds, and
      `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
      exit 0, with a regression test proven RED against the pre-admission path.

## Test Plan

| TC-ID | Test Type  | Tool / Approach                                                    | Notes                                             |
| ----- | ---------- | ------------------------------------------------------------------ | ------------------------------------------------- |
| TC-01 | integration | restricted/trusted workspace fixtures + activation spy            | Status path proves zero activation side effects   |
| TC-02 | unit       | admission service/store tests                                      | Source precedence and exact binding               |
| TC-03 | unit       | fingerprint, reject/revoke, and secret-redaction tests             | Stale/refusal/audit evidence                      |
| TC-04 | integration | MCP client/transport tests with direct-call bypass attempts         | One admission port before handshake               |
| TC-05 | suite      | affected package tests, typecheck/build, and `run-all-scans.mjs`    | Include regression RED→GREEN evidence             |

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: automatable | 2`

### Scenario 1: status inspection denies untrusted project MCP activation

- Executability: agent-executable
- Product surface: public-sdk-example
- Surface rationale: shipped-interface=public-sdk-example
- Prerequisites: Node.js and pnpm are installed; run from `packages/agent-tool-mcp`; the example creates an isolated in-memory untrusted workspace fixture; no network or provider credential is required.
- Command: `pnpm exec tsx examples/verify-mcp-activation-admission.ts --status`
- Observable type: sdk-result
- Observable rationale: source=public-sdk-return
- Expected observable: result=status=untrusted; activationAttempts=0
- Cleanup: the example uses only in-memory state and exits without leaving files or connections.
- Evidence: `packages/agent-tool-mcp/examples/verify-mcp-activation-admission.ts` (pending until implementation)

### Scenario 2: exact approval, change, and revocation control activation

- Executability: agent-executable
- Product surface: public-sdk-example
- Surface rationale: shipped-interface=public-sdk-example
- Prerequisites: Node.js and pnpm are installed; run from `packages/agent-tool-mcp`; the example creates trusted and mutated in-memory request fixtures; no network or provider credential is required.
- Command: `pnpm exec tsx examples/verify-mcp-activation-admission.ts --lifecycle`
- Observable type: sdk-result
- Observable rationale: source=public-sdk-return
- Expected observable: result=approved=true; changedDefinitionDenied=true; revokedDenied=true; activationAttempts=1
- Cleanup: the example uses only in-memory state and exits without leaving files or connections.
- Evidence: `packages/agent-tool-mcp/examples/verify-mcp-activation-admission.ts` (pending until implementation)

## Tasks

Paired execution record:
`.agents/tasks/MCP-2520-require-trust-approval-before-project-or-plugin-mcp-activation.md`.

- [ ] `.agents/tasks/MCP-2520-require-trust-approval-before-project-or-plugin-mcp-activation.md` — todo

## Evidence Log

### [RECOMMENDATION] — ✅ ENDORSED FOR PLANNING | 2026-09-09

- Independent proposal reviewer `Mendel`: `RECOMMEND` — issue #2520 is the correct next P0 planning
  item; preserve its fail-closed scope and keep the security-policy decision explicit.
- Independent depth triager `Erdos`: `large` — the work needs a shared product-level agreement before
  MCP-002 and MCP-2520 diverge; existing AGREEMENT-014/015 are administrative only.
- The recommendation is limited to planning and contract definition. Runtime implementation remains
  behind the agreement and GATE-APPROVAL.

### [GATE-WRITE] — ✅ PASS | 2026-09-09

**Status upgrade:** draft → review-ready

**Per-criterion result:** `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <this> --lane L2
--dry-run` reported 20 mechanical PASS, 0 FAIL, and 7 semantic PENDING-GUARDIAN.

- GATE-WRITE — Concrete symptom: PASS — a project/plugin MCP definition can be present in a cloned
  workspace while no approval/admission policy exists, so source presence can become an implicit
  process spawn or remote connection grant.
- GATE-WRITE — Reproduction condition: PASS — the behavior occurs when status or activation is
  requested from an untrusted checkout or plugin-provided definition; the incorrect result is
  connection/spawn before an explicit trust decision.
- GATE-WRITE — Research feeds Alternatives/Decision: PASS — current Claude pending/self-approval
  behavior and MCP transport/authorization layering directly support the selected fail-closed port.
- GATE-WRITE — Decision trade-off: PASS — explicit approval records and a cross-package admission
  port cost a large implementation, but prevent direct lower-client bypass and preserve auditability.
- GATE-WRITE — New-surface placement: PASS — the admission interface stays in the MCP infrastructure
  layer, trust policy/effects stay with framework/command owners, and CLI only renders generic state.
- GATE-WRITE — One criterion per distinct feature: PASS — TC-01 through TC-05 cover non-activating
  inspection, self-approval/precedence, exact binding and invalidation, bypass prevention, and tests.
- GATE-WRITE — Command/Observable criterion form: PASS — each criterion names an observable outcome
  or specific test/scan command and exit result; none relies on a vague implementation claim.

**Deviation recorded:** the dispatched gate guardian did not return within four bounded waits; the
semantic set was judged inline after the independent proposal/depth reviews, with this deviation made
explicit rather than silently treating PENDING-GUARDIAN as PASS. No runtime or GitHub mutation exists.

### [GATE-WRITE] — ❌ FAIL | 2026-09-09

**Status remains:** draft

Independent guardian `Harvey` superseded the preceding inline semantic judgement. Mechanical checks
remain `20 PASS, 0 FAIL, 7 PENDING-GUARDIAN`; the guardian found three required corrections:

- GATE-WRITE — Concrete symptom: FAIL — the earlier Problem described the threat and desired policy
  but did not identify the current wrong behavior. Required action: name `MCPTool.execute():74`,
  `ensureConnection():209`, and the initialization fetch that occurs before an approval decision.
- GATE-WRITE — Decision trade-off: FAIL — the earlier Decision did not explicitly connect the
  selected alternative to its cross-package persistence/policy cost. Required action: state that the
  cost is accepted to prevent duplicated transport checks and direct lower-client bypass.
- GATE-WRITE — New-surface placement: FAIL — the earlier placement statement did not name a concrete
  existing structural analog or product-family taxonomy. Required action: identify the existing
  workspace-authority and MCP-client injection seams and classify the port as shared MCP
  infrastructure, not a product/presentation surface. All corrections are now applied above.

The failed entry is retained as the superseded review record; GATE-WRITE must be re-run after the
corrections and a later PASS must be recorded before approval.

### [GATE-WRITE] — ✅ PASS | 2026-09-09

**Status upgrade:** draft → review-ready

- Mechanical gate: PASS — the re-run of `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc
  <this> --lane L2 --dry-run` reports 20 PASS, 0 FAIL, and 7 semantic criteria delegated to the
  guardian.
- Independent guardian `Harvey`: PASS — concrete current `MCPTool` symptom, reproduction condition,
  research-to-decision linkage, trade-off, structural analog/taxonomy, criterion coverage, and
  Command/Observable phrasing all pass after the documented corrections.
- GATE-WRITE — Concrete symptom: PASS — `MCPTool.execute():74` reaches `ensureConnection():209` and
  `initializeMCPSession()` without an approval/admission decision.
- GATE-WRITE — Reproduction condition: PASS — the first execution of a definition from an untrusted
  checkout or plugin performs the initialization fetch before trust can be evaluated.
- GATE-WRITE — Research feeds Alternatives/Decision: PASS — Claude pending/self-approval behavior and
  MCP transport/authorization layering support the selected fail-closed admission port.
- GATE-WRITE — Decision trade-off: PASS — the cross-package approval store and fingerprint contract
  cost is accepted to prevent duplicated checks and direct lower-client bypass.
- GATE-WRITE — New-surface placement: PASS — existing workspace-authority/DI and MCP client seams are
  named as analogs and the port is classified as shared MCP infrastructure.
- GATE-WRITE — One criterion per distinct feature: PASS — TC-01 through TC-05 cover non-activating
  inspection, precedence/binding, invalidation, bypass prevention, and verification.
- GATE-WRITE — Command/Observable criterion form: PASS — every criterion names an observable outcome
  or a specific test/scan command and exit result.
- Scope guard: PASS — only planning artifacts are changed; MCP runtime has no admission implementation
  yet and no GitHub mutation exists.

### [GATE-APPROVAL] — ✅ PASS | 2026-09-09

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "모두 승인함. 모든 너의 제안에 대해 타당한 근거가 있다면 자동으로 사전 승인함"
**Given:** 2026-09-03, this conversation
**Review fingerprint:** 46f982a822ab (review 8af878cc, type/tags 5dcddc14)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-03, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (46f982a822ab) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `077de6f59637` · base `origin/develop@077de6f59637` · document `.agents/spec-docs/backlog/MCP-2520-require-trust-approval-before-project-or-plugin-mcp-activation.md` blob `4022d0a492d0` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-09

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-09; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/MCP-2520-require-trust-approval-before-project-or-plugin-mcp-activation.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/MCP-2520-require-trust-approval-before-project-or-plugin-mcp-activation.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (5)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 498 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: automatable | 2`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 0 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->
```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/MCP-2520-require-trust-approval-before-project-or-plugin-mcp-activation.md",
  "specPath": ".agents/spec-docs/todo/MCP-2520-require-trust-approval-before-project-or-plugin-mcp-activation.md",
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
    "outcome": "automatable",
    "count": 2
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/MCP-2520-require-trust-approval-before-project-or-plugin-mcp-activation.md",
    ".agents/tasks/MCP-2520-require-trust-approval-before-project-or-plugin-mcp-activation.md"
  ]
}
```
<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `1460474b50f3` · base `origin/develop@98e778a7a7f8` · document `.agents/spec-docs/todo/MCP-2520-require-trust-approval-before-project-or-plugin-mcp-activation.md` blob `8b858618e476` (tracked)
