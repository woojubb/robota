---
title: 'MCP-2520: require trust approval before project or plugin MCP activation'
issue: https://github.com/woojubb/robota/issues/2520
status: in-progress
created: 2026-09-09
priority: critical
urgency: now
area: MCP activation trust and workspace authority
depends_on: [MCP-001, AGREEMENT-2520]
---

# MCP-2520: require trust approval before project or plugin MCP activation

## Objective

Require an explicit, auditable trust decision before a project- or plugin-provided MCP server can
activate a local process or remote authority. A definition may be parsed and shown as pending or
rejected, but its presence in a cloned repository or installed plugin must never itself mint the
authority needed to connect or spawn. Preserve the exact security boundary and acceptance record of
[issue #2520](https://github.com/woojubb/robota/issues/2520), which remains a retained external
lifecycle item under issue #1985's initiative.

The shared product relationship is fixed by the paired
`.agents/tasks/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md` record and
its spec; implementation may begin only after that agreement is complete and its admission port is
reachable from the client/transport owners.

The implementation must reuse the existing workspace identity/authority seams, preserve server
provenance from resolution through activation, and expose one reusable admission port that every
transport and lower client calls. `agent-command` owns typed approval effects; `agent-cli` may render
generic confirmation, status, and audit views but must not own trust policy.

## Source Constraints

- A project or plugin MCP definition can be inspected without connecting, spawning, authenticating,
  or executing a helper.
- An untrusted workspace fails closed: repository-tracked settings cannot approve their own server,
  and project/plugin provenance cannot be replaced by an ambient boolean or caller assertion.
- An approval identifies the exact server definition, provenance, and security identity. A material
  definition or identity change invalidates the approval; rejection and revocation are effective for
  later admission and observable without exposing secrets.
- User/managed settings and local untracked approval may be allowed only through an explicit,
  documented precedence that a project cannot weaken.
- Configuration inspection and health/status reporting must not activate a server.

## Plan

- [ ] Revalidate issue #2520, its parent/child relationships, current Claude/MCP references, and
      exact owner boundaries against the current tree.
- [ ] Define the provider-neutral typed approval, provenance, definition fingerprint, status/audit,
      and activation-admission contracts without duplicating MCP configuration ownership.
- [ ] Implement fail-closed project/plugin admission on top of workspace authority and integrate all
      activation paths so no transport or lower client can bypass it.
- [ ] Add approval, rejection, revocation, stale-definition, self-approval, plugin-provenance,
      inspection-without-activation, and trusted-activation regression coverage.
- [ ] Expose command effects and generic CLI status/confirmation projection, update affected specs,
      and run package, type, build, boundary, and harness verification.

## Completion Criteria

- [ ] TC-01: Observable: project/plugin definitions are visible as pending or rejected without
      connect/spawn.
- [ ] TC-02: Observable: untrusted workspaces cannot activate checked-in approvals or definitions.
- [ ] TC-03: Observable: exact definition, provenance, and security identity changes invalidate approval.
- [ ] TC-04: Observable: all activation routes reach the same admission port before activation.
- [ ] TC-05: Command: affected tests, typechecks, builds, and harness scans exit zero.

## Test Plan

Exercise the user-visible status and approval flow with a clean untrusted checkout and an installed
plugin fixture, then repeat with trusted workspace access. Assert that inspection produces pending or
rejected status without spawning/connect attempts, that approvals bind definition/provenance/identity,
that changed definitions and revocation fail closed, and that every activation route shares the same
admission port. Run affected package tests, typecheck, build, and repository boundary scans.

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

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-09-09

**Status upgrade:** scenario drafted → scenario written

- Ordering: PASS — this is the first DONE-GATE-STAGE-1 entry for the two authored MCP activation scenarios.
- Field completeness: PASS — both scenarios provide agent executability, canonical public SDK example
  surface, exact commands, prerequisites, observable type/rationale, expected result, cleanup, and
  durable evidence paths.
- Product surface: PASS — each command invokes the maintained `verify-mcp-activation-admission.ts`
  public SDK example and observes its process-visible result; no test runner is used as the user
  surface.
- Credential boundary: PASS — both scenarios use isolated in-memory fixtures and require no network,
  provider credential, TTY, or external service.
- Expected-value consistency: PASS — status inspection must report an untrusted request with zero
  activation attempts; lifecycle execution admits exactly one approved request and denies the changed
  and revoked requests before any additional activation.

<!-- checkpoint-evidence:v1:start -->
```json
{
  "version": 1,
  "form": "doneGateStageOne",
  "outcome": "automatable",
  "scenarios": [
    {
      "name": "Scenario 1: status inspection denies untrusted project MCP activation",
      "surface": "public-sdk-example",
      "surfaceRationale": "shipped-interface=public-sdk-example",
      "invocation": "pnpm exec tsx examples/verify-mcp-activation-admission.ts --status",
      "observableType": "sdk-result",
      "observable": "result=status=untrusted; activationAttempts=0",
      "observableRationale": "source=public-sdk-return",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "Node.js and pnpm are installed; run from `packages/agent-tool-mcp`; the example creates an isolated in-memory untrusted workspace fixture; no network or provider credential is required.",
      "action": {
        "kind": "command",
        "value": "pnpm exec tsx examples/verify-mcp-activation-admission.ts --status"
      },
      "expectedObservable": "result=status=untrusted; activationAttempts=0",
      "cleanup": "the example uses only in-memory state and exits without leaving files or connections.",
      "evidence": "`packages/agent-tool-mcp/examples/verify-mcp-activation-admission.ts` (pending until implementation)"
    },
    {
      "name": "Scenario 2: exact approval, change, and revocation control activation",
      "surface": "public-sdk-example",
      "surfaceRationale": "shipped-interface=public-sdk-example",
      "invocation": "pnpm exec tsx examples/verify-mcp-activation-admission.ts --lifecycle",
      "observableType": "sdk-result",
      "observable": "result=approved=true; changedDefinitionDenied=true; revokedDenied=true; activationAttempts=1",
      "observableRationale": "source=public-sdk-return",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "Node.js and pnpm are installed; run from `packages/agent-tool-mcp`; the example creates trusted and mutated in-memory request fixtures; no network or provider credential is required.",
      "action": {
        "kind": "command",
        "value": "pnpm exec tsx examples/verify-mcp-activation-admission.ts --lifecycle"
      },
      "expectedObservable": "result=approved=true; changedDefinitionDenied=true; revokedDenied=true; activationAttempts=1",
      "cleanup": "the example uses only in-memory state and exits without leaving files or connections.",
      "evidence": "`packages/agent-tool-mcp/examples/verify-mcp-activation-admission.ts` (pending until implementation)"
    }
  ]
}
```
<!-- checkpoint-evidence:v1:end -->
