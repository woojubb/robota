---
title: 'SECURITY-2465: complete the workspace trust boundary'
issue: https://github.com/woojubb/robota/issues/2465
status: in-progress
created: 2026-09-10
priority: critical
urgency: now
area: packages/agent-framework, packages/agent-session, packages/agent-core, packages/agent-cli
depends_on: []
---

# SECURITY-2465: complete the workspace trust boundary

## Problem

Issue #2465 is the successor for the unfinished SECURITY-001 outcome. Starting the CLI in an
untrusted checkout can still allow repository-controlled configuration to reach executable startup
contributions, weaken higher-trust policy, or redirect a provider while retaining a higher-trust
credential. Existing workspace-trust primitives do not yet establish one fail-closed boundary across
interactive and headless startup.

## Objective

Complete one end-to-end, provenance-aware workspace trust boundary: resolve canonical repository
identity before project-controlled executable contributions are applied; require an explicit,
revocable trust grant; enforce monotonic policy; isolate secret-bearing provider fields when endpoints
change; and expose safe provenance diagnostics in both startup modes.

## Existing Evidence

- `.agents/tasks/completed/SECURITY-001-untrusted-workspace-configuration-crosses-the-user-trust-boundary.md`
  is the historical #2018 record and was intentionally marked `skipped` when #2465 became the sole
  implementation owner.
- `packages/agent-framework/src/workspace-trust/` contains trust-service primitives, but the issue's
  eight end-to-end criteria remain open.
- The source issue's handoff comment is the canonical acceptance record:
  https://github.com/woojubb/robota/issues/2465#issuecomment-5458301582

## Constraints

- Untrusted project hooks, plugins, commands, skills, provider endpoints, and secrets must not affect
  executable startup before trust is established.
- A lower-trust layer must not raise trust, remove a higher-trust deny rule, or relax managed security
  restrictions.
- A lower-trust endpoint replacement must not inherit secret-bearing fields from a higher-trust layer.
- Grants bind to canonical repository identity, survive the declared restart scope, and are revocable.
- Symlink aliases, repository replacement at one path, nested repositories, worktrees, non-Git paths,
  and unavailable identity have explicit fail-closed behavior.
- Interactive and headless startup use the same policy; headless startup fails closed with an actionable
  diagnostic when a decision is required.
- Diagnostics may expose source/trust provenance but never credentials or other secrets.

## Independent completion criteria

- [ ] Fresh untrusted repositories cannot execute project `SessionStart` commands or load other
      executable project contributions before trust.
- [ ] Project configuration cannot raise a user/CLI trust level, remove a higher-trust deny rule, or
      override a managed security restriction.
- [ ] A lower-trust provider endpoint replacement never carries over higher-trust credentials or other
      secret-bearing fields.
- [ ] Grants bind to canonical repository identity, survive the intended restart scope, and support
      inspection and revocation.
- [ ] Symlink aliases and a different repository at the same textual path do not inherit a grant.
- [ ] Interactive and headless startup enforce the same policy, with headless failure when trust is
      required.
- [ ] Effective-configuration diagnostics expose security-bearing provenance without printing secrets.
- [ ] Governing package SPECs, CLI help/README, and user documentation describe the trust lifecycle
      and recovery path.

## Plan

- [ ] TC-01: Inventory current workspace-trust primitives, configuration layering, hook/plugin/skill loading,
      provider resolution, session construction, CLI startup, and all existing consumers.
- [ ] TC-02: Write the approved spec and red-first tests for identity, grant lifecycle, provenance,
      monotonic policy, executable-contribution gating, endpoint/credential isolation, and startup
      parity.
- [ ] TC-03: Implement the smallest owner-based boundary in the existing trust/config/session composition
      roots; do not add a parallel policy engine or compatibility bypass.
- [ ] TC-04: Update affected package SPECs, CLI help/README, and user documentation, then run package tests,
      builds, typechecks, framework functional tests, and repository gates.
- [ ] TC-05: Execute both product scenarios below and record exact outcomes before the done gate.
- [ ] TC-06: Record package and repository verification evidence in the paired spec.
- [ ] TC-07: Confirm headless startup and provider endpoint behavior through the built product.
- [ ] TC-08: Close out the Task only after the merged delivery and related-issue audit.

## Test Plan

- Red-first unit tests for absent, valid, revoked, mismatched, aliased, replaced, nested, worktree,
      and unavailable repository identities.
- Configuration tests proving lower-trust layers cannot raise trust, remove deny rules, add executable
      startup contributions, or pair a project endpoint with a user credential.
- Integration tests through real session/CLI assembly in interactive-capable and headless modes; trust
      boundary mocks are not the only coverage.
- Regression tests for trusted projects and declared non-Git behavior.
- Affected package build, typecheck, tests, SPEC-code conformance, framework functional testing,
      `pnpm harness:scan`, and `pnpm harness:verify-like-ci` before merge.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: automatable | 2`

### Scenario 1: headless startup refuses untrusted executable project configuration

- Executability: agent-executable
- Product surface: robota-cli
- Surface rationale: shipped-entrypoint=robota
- Prerequisites: Node.js 22 with workspace dependencies installed and the local Robota CLI built; current directory is an isolated temporary Git repository containing a project SessionStart sentinel fixture; use an isolated temporary HOME; no API key, network, or TTY is required.
- Command: pnpm exec robota -p "workspace trust probe" --output-format text
- Observable type: product-output
- Observable rationale: source=product-process
- Expected observable: exit=1; output-contains=Workspace trust is required
- Cleanup: remove the isolated temporary HOME, repository, sentinel, and trust store after the command; leave no tracked repository changes.
- Evidence: record exit code 1, the actionable diagnostic substring, and sentinel absence here after DONE-GATE-STAGE-2 execution.

### Scenario 2: endpoint replacement cannot redirect a credential

- Executability: agent-executable
- Product surface: robota-cli
- Surface rationale: shipped-entrypoint=robota
- Prerequisites: Node.js 22 with the local Robota CLI built; current directory is an isolated trusted Git repository with a higher-trust provider credential and a lower-trust project endpoint configured; use an isolated temporary HOME and a local capture server; the dummy credential is SECURITY_2465_DUMMY_SECRET; no external network or live model key is required.
- Command: pnpm exec robota diagnose
- Observable type: product-output
- Observable rationale: source=product-process
- Expected observable: exit=0; output-contains=provider endpoint quarantined
- Cleanup: stop the local capture server and remove the isolated temporary HOME, repository, settings, and trust store; verify the dummy credential is absent from captured output.
- Evidence: record exit code 0, the capture-server request result, the redacted diagnostic substring, and absence of SECURITY_2465_DUMMY_SECRET here after DONE-GATE-STAGE-2 execution.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-09-10

**Status upgrade:** scenario drafted → scenario written

<!-- checkpoint-evidence:v1:start -->
```json
{
  "version": 1,
  "form": "doneGateStageOne",
  "outcome": "automatable",
  "scenarios": [
    {
      "name": "Scenario 1: headless startup refuses untrusted executable project configuration",
      "surface": "robota-cli",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "pnpm exec robota -p \"workspace trust probe\" --output-format text",
      "observableType": "product-output",
      "observable": "exit=1; output-contains=Workspace trust is required",
      "observableRationale": "source=product-process",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "Node.js 22 with workspace dependencies installed and the local Robota CLI built; current directory is an isolated temporary Git repository containing a project SessionStart sentinel fixture; use an isolated temporary HOME; no API key, network, or TTY is required.",
      "action": {
        "kind": "command",
        "value": "pnpm exec robota -p \"workspace trust probe\" --output-format text"
      },
      "expectedObservable": "exit=1; output-contains=Workspace trust is required",
      "cleanup": "remove the isolated temporary HOME, repository, sentinel, and trust store after the command; leave no tracked repository changes.",
      "evidence": "record exit code 1, the actionable diagnostic substring, and sentinel absence here after DONE-GATE-STAGE-2 execution."
    },
    {
      "name": "Scenario 2: endpoint replacement cannot redirect a credential",
      "surface": "robota-cli",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "pnpm exec robota diagnose",
      "observableType": "product-output",
      "observable": "exit=0; output-contains=provider endpoint quarantined",
      "observableRationale": "source=product-process",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "Node.js 22 with the local Robota CLI built; current directory is an isolated trusted Git repository with a higher-trust provider credential and a lower-trust project endpoint configured; use an isolated temporary HOME and a local capture server; the dummy credential is SECURITY_2465_DUMMY_SECRET; no external network or live model key is required.",
      "action": {
        "kind": "command",
        "value": "pnpm exec robota diagnose"
      },
      "expectedObservable": "exit=0; output-contains=provider endpoint quarantined",
      "cleanup": "stop the local capture server and remove the isolated temporary HOME, repository, settings, and trust store; verify the dummy credential is absent from captured output.",
      "evidence": "record exit code 0, the capture-server request result, the redacted diagnostic substring, and absence of SECURITY_2465_DUMMY_SECRET here after DONE-GATE-STAGE-2 execution."
    }
  ]
}
```
<!-- checkpoint-evidence:v1:end -->
