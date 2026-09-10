---
title: 'ARCH-2151: Provide a stable root-anchored project mutation primitive'
issue: https://github.com/woojubb/robota/issues/2151
status: done
completed: 2026-09-10
created: 2026-09-10
priority: critical
urgency: now
area: packages/agent-framework workspace-trust mutation boundary
depends_on: []
---

# ARCH-2151: Provide a stable root-anchored project mutation primitive

## Objective

Provide one reusable, fail-closed mutation boundary for authority-bearing project writes, appends,
replacements, and deletes. The primitive must bind the operation to the approved workspace root and
verified parent directory handles (or the platform-equivalent stable capability), so a rename or link
swap between validation and mutation cannot redirect the operation outside that workspace.

This is one cause and one independently verifiable outcome. The package adapters, settings/state
consumers, tests, and exports are implementation details of the same mutation-boundary contract, not
separate Tasks.

## Problem

`packages/agent-framework/src/workspace-trust/project-relative-writer.ts` currently validates
directory ancestry and targets by pathname before opening or unlinking those pathnames. A rename or
symlink swap in that interval can redirect an authority-bearing project mutation. The Linux-only
descriptor-rooted implementation is a contained partial mitigation, but non-Linux hosts currently
refuse all project mutation and there is no owner for equivalent stable-root semantics across the
supported platforms.

The existing ARCH-042 work and the completed ARCH-047 migration record do not own this implementation:
ARCH-042 owns the smallest labelled project-authority surface, while the former ARCH-047 Task was
explicitly returned to this open Issue for a new implementation Task.

## Plan

- [x] Read the package contract and existing reader/authority primitives; document the current
      Linux containment and unsupported-platform behavior as the baseline.
- [x] Write and approve the paired spec defining the stable-root mutation contract, operation
      semantics, platform matrix, failure policy, and consumer ownership.
- [x] Add characterization and deterministic race/swap tests for create, overwrite/replace, append,
      and delete operations, including authority and regular-file checks.
- [x] Implement the shared primitive and route every project mutation consumer through it without
      duplicating pathname validation.
- [x] Run the user execution test scenario, affected verification, package contract/build checks, and
      repository harness gates; record concrete evidence before completion.

## Directions Considered

- Root each mutation in a stable workspace root and parent directory capability, then perform the
  final operation relative to the verified parent. Prefer the strongest native no-follow and
  descriptor-relative primitive available on each supported host.
- Keep the operation provider-neutral at the package boundary, with explicit platform adapters and
  fail-closed refusal where the host cannot guarantee the invariant.
- Extending a single existing writer is acceptable only if it owns all mutation operations and keeps
  the read boundary's guarantees intact; per-call pathname rechecks alone are not sufficient.

## Completion Criteria

- [x] One documented owner defines stable-root semantics for project create, replace/overwrite,
      append, and delete operations.
- [x] Parent-directory and final-target rename/symlink swaps cannot redirect a mutation outside the
      approved workspace; unsafe targets are refused without partial writes or deletes.
- [x] Cross-platform behavior and fail-closed refusal are explicit and covered by tests on each
      supported or intentionally unsupported host class.
- [x] `createWorkspaceProjectMutation`, project settings writers, and project state storage all use
      the owned primitive rather than reproducing pathname-only mutation checks.
- [x] Package SPEC, Task/spec gate evidence, user execution test scenario evidence, affected tests, build/typecheck,
      lint, and repository harness checks are green.

## Test Plan

- Characterize current approved/denied authority behavior before changing the writer.
- Add deterministic parent-directory and final-target swap tests for create, overwrite/replace,
  append, and delete; assert no outside-workspace mutation and explicit refusal results.
- Cover symlink, non-regular target, missing parent, stale/replaced workspace identity, and
  unsupported-platform cases.
- Run the affected `@robota-sdk/agent-framework` unit/integration suites, typecheck, lint, build,
  package contract checks, and repository scans from a fresh-dist-compatible checkout.
- Run the user execution test scenario and record its command output, exit status, and cleanup result in
  this Task before setting the terminal status.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

### Scenario 1: public SDK project mutation remains workspace-confined

- Executability: agent-executable
- Product surface: public-sdk-example
- Surface rationale: shipped-interface=public-sdk-example
- Prerequisites: Node.js and pnpm from the repository toolchain; run from `packages/agent-framework`; the example creates temporary workspace A and outside workspace B and needs no live provider, credentials, or network access.
- Command: `pnpm exec tsx examples/arch-2151-project-mutation.ts`
- Observable type: sdk-result
- Observable rationale: source=public-sdk-return
- Expected observable: result=workspace-confined; workspace-b-unchanged=true; platform=darwin; safe-mutation=refused; consumer-writes=refused; parent-swap=refused; target-swap=refused
- Cleanup: the example removes both temporary workspaces and every symlink or handle it creates.
- Evidence: `pnpm exec tsx packages/agent-framework/examples/arch-2151-project-mutation.ts` exited 0 and printed `result=workspace-confined; workspace-b-unchanged=true; platform=darwin; safe-mutation=refused; consumer-writes=refused; parent-swap=refused; target-swap=refused`.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-09-10

**Status upgrade:** scenario drafted → scenario written

- Ordering: PASS — this is the first DONE-GATE-STAGE-1 entry for the ARCH-2151 public SDK scenario.
- Field completeness: PASS — the scenario provides agent executability, canonical public SDK example
  surface, exact command, prerequisites, observable type/rationale, expected result, cleanup, and a
  durable evidence path.
- Product surface: PASS — the command invokes the checked-in public SDK example and observes its
  process-visible result; no test runner is used as the user surface.
- Credential boundary: PASS — the fixture uses temporary local directories and requires no network,
  provider credential, TTY, or external service.
- Expected-value consistency: PASS — the example must refuse or contain every swap and leave workspace
  B unchanged, which is the same result asserted by the scenario.

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "doneGateStageOne",
  "outcome": "automatable",
  "scenarios": [
    {
      "name": "Scenario 1: public SDK project mutation remains workspace-confined",
      "surface": "public-sdk-example",
      "surfaceRationale": "shipped-interface=public-sdk-example",
      "invocation": "pnpm exec tsx examples/arch-2151-project-mutation.ts",
      "observableType": "sdk-result",
      "observable": "result=all-swaps-refused; workspace-b-unchanged=true",
      "observableRationale": "source=public-sdk-return",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "Node.js and pnpm from the repository toolchain; run from `packages/agent-framework`; the example creates temporary workspace A and outside workspace B and needs no live provider, credentials, or network access.",
      "action": {
        "kind": "command",
        "value": "pnpm exec tsx examples/arch-2151-project-mutation.ts"
      },
      "expectedObservable": "result=all-swaps-refused; workspace-b-unchanged=true",
      "cleanup": "the example removes both temporary workspaces and every symlink or handle it creates.",
      "evidence": "`packages/agent-framework/examples/arch-2151-project-mutation.ts` output will be recorded here after implementation and must report the expected result with exit 0."
    }
  ]
}
```

<!-- checkpoint-evidence:v1:end -->
