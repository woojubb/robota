---
title: 'ARCH-014: the session logger externalizes payloads over 32KiB to sidecar files, but no reader dereferences them — large messages/responses are corrupted or silently dropped on replay, and the validator passes the broken log'
status: todo
created: 2026-08-13
priority: high
urgency: now
area: packages/agent-session, packages/agent-provider-replay
depends_on: []
---

# ARCH-014: session-log external payloads are write-only

## Problem

`FileSessionLogger` moves any log value over 32KiB into a `{sessionId}.payloads/` sidecar file and
writes an `IExternalPayloadReference` into the JSONL line. Nothing reads those files back. So every
reader that reconstructs history or replays provider responses either drops or corrupts any
externalized value — while the replay provider's header promises the opposite and the validator
passes the log as well-formed.

## Evidence (adversarially verified 2026-08-13, CONFIRMED)

- Writer: `packages/agent-session/src/session-logger.ts:164-205` — values over the 32KiB default
  (`:33-36`) are written to `{sessionId}.payloads/{sha256}.json` and replaced in the line by an
  `IExternalPayloadReference`. Externalization recurses bottom-up.
- No dereferencer exists repo-wide (`rg` for the ref type / `.payloads` finds only the writer, the
  shape-only validator, the type export, and a test that lists the dir to assert the write occurred).
  `session-log-replay.ts:31-40` `loadSessionLogEntries` just `JSON.parse`s lines.
- `session-log-replay.ts:118-123` `normalizeLogMessage` returns `undefined` when `role` is absent, so
  a fully-externalized `history_mutation` message is silently dropped (`:66-72`); the commoner
  nested case (e.g. externalized `content` while `role` survives) replays a raw ref object AS the
  message content — corrupted content.
- `packages/agent-provider-replay/src/replay-provider.ts:89-102` — a ref-shaped `response` is
  rejected by `normalizeRecordedMessage`, so `extractRecordedResponses` (:78-86) omits it and shifts
  every later response one slot earlier (cursor desync), while the file header (`:9-10`) promises a
  validated log "is guaranteed to carry a response for every recorded provider call". Production-wired
  via `agent-cli --sessionLog` → `loadReplayProvider` → `createReplayProviderFromLogFile`.
- `session-log-validation.ts:204-230` verifies only that the ref's fields are well-formed and counts
  a `provider_response_normalized` event as present regardless of its response being an unresolved
  ref — a correctly-externalized log passes validation.

## Direction

Own one bounded, fail-closed external-payload hydrator in `agent-session` at the persistence read
boundary. It recursively validates reference shape, lexical and real-path containment, declared byte
length, sha256, JSON content, cycle/depth, and aggregate-byte limits before returning values.
`loadSessionLogEntries` hydrates relative to the log directory. Raw-entry validation rejects unresolved
history messages and normalized provider responses and does not count an unresolved response as complete.

`ReplayProvider` reuses that resolver only for normalized responses it consumes. Direct construction
must supply an explicit base directory for unresolved values or receive a typed `UNRESOLVED_REFERENCE`;
unrelated observability/tool events remain ignored. The file factory partitions limits to the loader and
never hydrates twice.

## Recommendation Gate

### 2026-08-15 — endorsed after one revision

- Placement: the format writer and hydrator remain in `@robota-sdk/agent-session`; replay-provider gains
  no second filesystem reader or new production dependency.
- Public contract: a typed `SessionLogPayloadResolutionError` exposes stable invalid-limit/reference,
  unresolved, containment, I/O, integrity, JSON, depth, aggregate-byte, and cycle codes with structured
  metadata.
- Verification: unit matrices cover fidelity, corruption, containment, bounds, validator behavior, and
  direct-provider capability preservation. A mandatory scripted `InteractiveSession` functional test
  drives the real logger, replays a >32KiB response plus sentinel response, and is registered in the
  functional-coverage manifest.
- Scenario: deterministic and agent-executable with no network or provider key; the real JSONL artifact
  and replayed conversation are the observable product outputs.

REVIEW VERDICT: ENDORSE

## Test Plan

- Red-first: write a session log containing a >32KiB assistant message and a >32KiB provider
  response, then `replaySessionLogEntries` + `ReplayProvider` — assert full-fidelity round-trip
  (message present with real content; responses aligned to calls). Fails today.
- Red-first: `validateSessionReplayLogEntries` flags an externalized replay-substrate payload when no
  dereferencer is available.
- Framework functional red/green: add
  `packages/agent-provider-replay/src/__tests__/session-log-external-payload-replay-functional.test.ts` <!-- allow-missing-artifact: ARCH-014 will add this functional test during implementation. -->
  using `scriptedSession`, and register it as `session-log-external-payload-replay` in
  `scripts/harness/functional-coverage-manifest.json`.
- `pnpm harness:verify -- --scope packages/agent-session` and `--scope packages/agent-provider-replay`
  green.

## User Execution Test Scenarios

### Scenario 1 — a real session log replays a large response without corrupting the next response

- **Agent executability:** `agent-executable`. This is a standalone public-SDK command, not a test
  runner. It injects the deterministic scripted provider into a real `InteractiveSession`, then injects
  the public replay provider into a second real `InteractiveSession`. It needs no TTY, network, external
  service, or provider key.
- **Prerequisite state and fixture:** install workspace dependencies with the repository's pinned Node
  and pnpm versions. This work must add the maintained owner-verification example
  `packages/agent-provider-replay/examples/verify-session-log-external-payload-replay.ts` <!-- allow-missing-artifact: ARCH-014 will add this standalone public-SDK example during implementation. -->
  and add `@robota-sdk/agent-framework` plus `tsx` as development-only dependencies of
  `agent-provider-replay`. The example creates two isolated temporary workspaces. Its only injected
  source provider is `createScriptedProvider` with response 1 equal to `ARCH_014_LARGE:` followed by
  40 KiB of `x`, and response 2 exactly `ARCH_014_SENTINEL`. No committed transcript or credential is
  required.
- **Exact command and ordered steps:**

  ```bash
  pnpm --filter @robota-sdk/agent-provider-replay build
  pnpm --filter @robota-sdk/agent-provider-replay exec tsx --conditions=source examples/verify-session-log-external-payload-replay.ts
  ```

  The standalone example must (1) create the source `InteractiveSession` with the scripted provider,
  submit two prompts, and await both public turn handles; (2) locate that session's real JSONL under its
  `.robota/logs/` directory; (3) recursively find the external-payload reference in the parsed JSONL and
  prove its relative path names an existing sidecar inside the log directory; (4) load the transcript
  through public `createReplayProviderFromLogFile`; (5) drive a second real `InteractiveSession` for two
  awaited turns; (6) compare the replayed assistant messages with both original values in order; (7)
  shut down both sessions, remove both temporary workspaces, prove both paths are absent; and only then
  print its result. Every mismatch throws and makes the process exit non-zero.

- **Expected observable result:** both commands exit `0`. After the first command's build output, the
  second command prints exactly one JSON document with this directly observable shape (the source
  session id portion of `relativePath` is dynamic):

  ```json
  {
    "externalPayload": {
      "present": true,
      "relativePath": "<source-session-id>.payloads/f41be56583d387c7fd3a79676507aea00115f6d3809e3eb8fd49bd3bc39a2879.json",
      "sidecarExists": true
    },
    "largeResponse": {
      "byteLength": 40975,
      "sha256": "42bc9897b0c5ebe94994f5ef0b494461e1133116821ed9141c0d2043a0168193",
      "matchesOriginal": true
    },
    "sentinel": {
      "callIndex": 2,
      "value": "ARCH_014_SENTINEL",
      "aligned": true
    },
    "cleanup": {
      "sourceWorkspaceRemoved": true,
      "replayWorkspaceRemoved": true
    }
  }
  ```

  This proves the first replayed assistant content is the full value rather than a reference or missing
  message, and the second recorded response remains aligned with replay call 2.

- **Cleanup/reset:** the example owns cleanup in a `finally` path as well as the success path, restricts
  deletion to the two exact temporary directories it created, shuts both sessions down, and removes the
  JSONL, `.payloads/`, and replay logs with those directories. The success output itself confirms both
  directories no longer exist.
- **Evidence:**

### [DONE-GATE-STAGE-1] — ❌ FAIL | 2026-08-15

**Status remains:** scenario drafted
**Failed criteria:**

- Product-surface scenario: the exact command is `pnpm --filter @robota-sdk/agent-provider-replay exec
vitest run src/__tests__/session-log-external-payload-replay-functional.test.ts`, and its observable is
  the Vitest result plus assertions made inside that test. The gate catalogue explicitly excludes a
  test run as a user-execution scenario, even when the test internally calls public SDK objects.
  **Required action:** provide an exact non-test product command or public SDK/example invocation whose
  process-visible output directly reports the durable JSONL reference, full hydrated large response,
  aligned sentinel response, exit code, and cleanup result; keep Vitest in the engineering test plan.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-08-15

**Status upgrade:** scenario drafted → scenario written

- Scenario completeness: PASS — Scenario 1 supplies explicit prerequisites and fixture values, exact
  ordered Bash commands and SDK steps, precise exit/output observables, bounded cleanup, and an evidence
  field reserved for post-implementation execution.
- Executability: PASS — the scenario is explicitly `agent-executable`, non-interactive, and invokes a
  maintained standalone example rather than a test runner.
- Product surface: PASS — the second command drives the public `InteractiveSession` and
  `createReplayProviderFromLogFile` SDK surfaces and directly emits the durable sidecar, hydrated large
  response, aligned sentinel, and cleanup observations as process-visible JSON; the build command only
  establishes its prerequisite artifact.
- Credentials and external services: PASS — the prerequisites explicitly state that the scripted
  provider requires no TTY, network, external service, provider key, or committed transcript.
- Expected-value consistency: PASS — independent calculation confirmed the specified 40 KiB payload is
  40975 bytes and has SHA-256
  `42bc9897b0c5ebe94994f5ef0b494461e1133116821ed9141c0d2043a0168193`.
