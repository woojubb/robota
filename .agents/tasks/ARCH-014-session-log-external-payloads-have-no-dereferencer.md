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

Add a shared dereference helper (read `relativePath`, verify sha256) used by
`loadSessionLogEntries`/`replaySessionLogEntries` and `ReplayProvider.normalizeRecordedMessage`,
resolving refs back to their values before normalization. Until that lands, the validator must flag an
externalized `message`/`response` on the replay substrate as a replay-blocking issue rather than
passing it.

## Test Plan

- Red-first: write a session log containing a >32KiB assistant message and a >32KiB provider
  response, then `replaySessionLogEntries` + `ReplayProvider` — assert full-fidelity round-trip
  (message present with real content; responses aligned to calls). Fails today.
- Red-first: `validateSessionReplayLogEntries` flags an externalized replay-substrate payload when no
  dereferencer is available.
- `pnpm harness:verify -- --scope packages/agent-session` and `--scope packages/agent-provider-replay`
  green.

## User Execution Test Scenarios

**Applies** (session-log replay is a product surface: `robota --session-log`).

- Prerequisites: built CLI + a provider key; a session that produces at least one assistant message
  or tool result over 32KiB (a long file read — the fixture prompt is authored by this work).
- Steps: run a session with logging that emits a large message; then start a replay run from that log
  (`--session-log replay`) and compare the replayed conversation to the original.
- Expected (after fix): the large message/response replays intact and provider responses stay aligned
  to their calls.
- Expected (before fix, contrast): the large message is missing or shows a `{ external: … }` ref, and
  later responses are shifted.
- Cleanup: delete the log + `.payloads/` dir.
- Evidence (fill in after implementation): the original vs replayed transcript diff.
