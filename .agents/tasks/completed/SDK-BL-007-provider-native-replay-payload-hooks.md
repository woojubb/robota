# Provider Native Replay Payload Hooks

- **Status**: completed
- **Created**: 2026-05-05
- **Branch**: feat/provider-native-replay-payload-hooks
- **Scope**: packages/agent-core, packages/agent-provider-\*, packages/agent-sessions, packages/agent-sdk, packages/agent-cli

## Objective

Capture exact provider-native SDK response and stream payloads for replay-grade session logs without adding provider-specific branches to `agent-core`.

## Plan

- [x] Update package specs before implementation.
- [x] Define a provider-owned raw payload callback contract in the shared provider API.
- [x] Pipe provider raw payload callbacks into `agent-core` execution events without importing concrete SDK types.
- [x] Implement provider-native raw response and stream event emission in each chat provider package that owns SDK-specific objects.
- [x] Keep media-only providers out of chat replay capture unless they implement the chat provider contract.
- [x] Ensure payloads are redacted and externalized through the existing `FileSessionLogger` policy.
- [x] Add validation coverage proving native raw payload events pair with provider request/normalized response events.
- [x] Add a command-module validator command through SDK common APIs, not `agent-cli` direct file logic.
- [x] Run targeted builds/tests and harness verification.
- [x] Prepare PR into `develop` and archive the task as completed.

## Decisions

- Native SDK payload capture must be provider-owned. Core can define and route the callback contract, but concrete payload selection and sanitization belong to each provider package.
- The callback payload shape should be provider-neutral at the boundary (`provider`, `apiSurface`, `payloadKind`, `sequence`, `payload`, `metadata`) while allowing provider packages to decide which native SDK object is the replay payload.
- The event name should be `provider_native_raw_payload`. Existing `provider_response_raw` remains as the provider-normalized Robota message snapshot; replay validation now requires both normalized and native payload coverage.
- The CLI-facing validator belongs in `@robota-sdk/agent-command-session` and consumes SDK common APIs like a third-party command module. `agent-cli` should only render the command result.

## Progress

- Created after completing `SDK-BL-005` because provider-neutral replay is now in place, but exact SDK-native payload capture needs provider-owned hooks.
- 2026-05-05: Started implementation on `feat/provider-native-replay-payload-hooks`; applying spec-first workflow because this changes provider/core/session/CLI contracts.
- 2026-05-05: Chose per-call `IChatOptions.onProviderNativeRawPayload` over provider instance mutation so shared provider instances stay concurrency-safe and `agent-core` remains provider-neutral.
- 2026-05-05: Updated affected package specs for core callback contract, provider-owned payload capture, session replay validation, SDK common API, and session command ownership.
- 2026-05-05: Added core/session/command/provider tests and implemented native payload emission for OpenAI, Qwen, Gemma, Gemini/Google inheritance path, and Anthropic chat providers. ByteDance remains media-only and is documented out of chat replay scope.
- 2026-05-05: Updated package READMEs, content guide docs, and changeset metadata for the public replay payload and `/validate-session` behavior.
- 2026-05-05: Verification passed with root build, affected package tests/lint/typecheck, scenario verification, docs build, SPEC scan, and full harness scan.

## Test Plan

- Add provider-package unit tests that assert raw non-streaming SDK responses emit native replay payload events before provider normalization.
- Add provider-package streaming tests that assert raw SDK stream events emit ordered native replay payload events without losing visible text deltas.
- Add `agent-core` contract tests proving provider-owned raw payload callbacks are forwarded to `onExecutionEvent` without provider-name branching.
- Add `agent-sessions` validation tests proving native raw payload events satisfy replay validation and invalid external payload references are reported.
- Add CLI/built-in command tests for the validator command once the user-facing command adapter is implemented.

## Blockers

- None.

## Result

Completed provider-owned native replay payload capture across chat providers without adding provider branches to `agent-core`. Session replay validation now requires provider-native raw response or stream payload coverage, and `/validate-session` is exposed through the session command module using SDK common APIs. Media-only ByteDance remains outside chat replay hooks until it implements the chat provider contract.
