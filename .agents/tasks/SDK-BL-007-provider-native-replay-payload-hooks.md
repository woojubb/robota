# Provider Native Replay Payload Hooks

- **Status**: todo
- **Created**: 2026-05-05
- **Branch**: TBD
- **Scope**: packages/agent-core, packages/agent-provider-\*, packages/agent-sessions, packages/agent-sdk, packages/agent-cli

## Objective

Capture exact provider-native SDK response and stream payloads for replay-grade session logs without adding provider-specific branches to `agent-core`.

## Plan

- [ ] Define a provider-owned raw payload callback contract in the shared provider API.
- [ ] Pipe provider raw payload callbacks into `agent-core` execution events without importing concrete SDK types.
- [ ] Implement provider-native raw response and stream event emission in each provider package that owns SDK-specific objects.
- [ ] Ensure payloads are serializable, redacted, and externalized through the existing `FileSessionLogger` policy.
- [ ] Add validation coverage proving native raw payload events pair with provider request/normalized response events.
- [ ] Add a CLI-facing validator command or built-in command adapter that reports missing native raw payloads, unmatched provider/tool events, and invalid external payload references.

## Decisions

- Native SDK payload capture must be provider-owned. Core can define and route the callback contract, but concrete payload selection and sanitization belong to each provider package.
- The callback payload shape should be provider-neutral at the boundary (`provider`, `apiSurface`, `kind`, `payload`, `payloadRef`) while allowing provider packages to decide how to serialize their native SDK objects.

## Progress

- Created after completing `SDK-BL-005` because provider-neutral replay is now in place, but exact SDK-native payload capture needs provider-owned hooks.

## Test Plan

- Add provider-package unit tests that assert raw non-streaming SDK responses emit native replay payload events before provider normalization.
- Add provider-package streaming tests that assert raw SDK stream events emit ordered native replay payload events without losing visible text deltas.
- Add `agent-core` contract tests proving provider-owned raw payload callbacks are forwarded to `onExecutionEvent` without provider-name branching.
- Add `agent-sessions` validation tests proving native raw payload events satisfy replay validation and invalid external payload references are reported.
- Add CLI/built-in command tests for the validator command once the user-facing command adapter is implemented.

## Blockers

- None.

## Result

- Pending.
