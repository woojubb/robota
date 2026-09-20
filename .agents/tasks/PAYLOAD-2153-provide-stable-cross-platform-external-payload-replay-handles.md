---
title: 'PAYLOAD-2153: provide stable cross-platform external payload replay handles'
issue: https://github.com/woojubb/robota/issues/2525
status: todo
created: 2026-09-21
priority: high
urgency: now
area: packages/agent-session Node session-log external-payload filesystem authority
depends_on: [ARCH-042]
---

# PAYLOAD-2153: provide stable cross-platform external payload replay handles

## Objective

Deliver the unresolved outcome of [issue #2153](https://github.com/woojubb/robota/issues/2153): a public Node replay path that reads externalized session payloads safely on Linux, macOS, and Windows. The present Linux-only descriptor-rooted read must gain an equally strong supported-host mechanism without reintroducing a check-then-open pathname race.

## Source Constraints

- A stable external handle is an authority-bearing object, not a raw pathname or `file://` reference exposed to callers.
- Parent-directory or final-target replacement, traversal, and symlink substitution must not redirect a read outside the approved payload root.
- Any platform on which an equally strong primitive cannot be established must fail visibly with an explicit capability contract; silent fallback to ambient pathname reads is forbidden.
- The replay API preserves externalized payload bytes on every supported host while retaining the secret-redaction and containment guarantees established by `ARCH-042`.

## Plan

- [ ] Revalidate `session-log-sources`, the external-payload resolver, their public consumers, and native filesystem capabilities on Linux, macOS, and Windows.
- [ ] Specify and implement one supported-host stable-handle contract at the lowest reusable filesystem-authority owner.
- [ ] Preserve root containment, no-follow/replacement resistance, error classification, and secret-free diagnostics across every host implementation.
- [ ] Add native-host replacement, missing-file, malformed-reference, and successful replay coverage.
- [ ] Update the owning package contract and record the public replay scenario evidence.

## Completion Criteria

- [ ] TC-01: The public Node replay factory resolves a valid external payload on Linux, macOS, and Windows without an ambient pathname-read fallback.
- [ ] TC-02: Parent-directory and final-target replacement fixtures cannot redirect a replay read outside the payload root.
- [ ] TC-03: Missing, malformed, unsupported, and unsafe payload references fail visibly without payload or credential leakage.
- [ ] TC-04: Native-host tests, `@robota-sdk/agent-session` tests/typecheck/build, and the recorded public replay scenario pass.

## Test Plan

Use focused `agent-session` unit and integration tests for stable-root reads, replacement attempts, containment, and error redaction. Run native macOS, Linux, and Windows coverage rather than platform-name mocks alone; then run package typecheck/build and the affected repository scans.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

### Scenario 1: public replay preserves an external payload without following a replacement

- Executability: agent-executable on each supported host
- Product surface: public-sdk-example
- Surface rationale: shipped-interface=public Node replay factory
- Prerequisites: this Task adds `packages/agent-session/examples/verify-external-payload-replay.ts` and `scenario:verify:external-payload-replay`; the example creates an isolated log root, payload sidecar, and replacement fixture without network or provider credentials.
- Command: `pnpm --filter @robota-sdk/agent-session run scenario:verify:external-payload-replay` <!-- allow-undeclared-script: PAYLOAD-2153 creates this package script during implementation before this user execution test scenario is executed. -->
- Observable type: sdk-result
- Observable rationale: source=public replay result and containment refusal
- Expected observable: `result=replay-preserved; replacementDenied=true; cleanupRemoved=true`
- Cleanup: the example removes every temporary log, payload sidecar, and replacement fixture before exit.
- Evidence: pending implementation and native-host execution.
