---
title: 'PLUGIN-001: Resolve exported-but-nonfunctional File*Storage stubs (+ close stub-marker scan gap)'
status: todo
created: 2026-06-27
priority: high
urgency: soon
area: packages/agent-plugin, scripts/harness
depends_on: []
---

# Resolve exported-but-nonfunctional File\*Storage stubs

## What

`agent-plugin` publicly exports three file-backed storage classes that are **non-functional
stubs** — they log "File storage not fully implemented yet" and return `undefined`/empty
instead of persisting:

- `FileHistoryStorage` — `conversation-history/index.ts:3` →
  `conversation-history/storages/file-storage.ts` (all 5 methods stub, lines ~17-86; comment
  L20 "placeholder for actual file system operations").
- `FileUsageStorage` — `usage/index.ts:4` → `usage/storages/file-storage.ts` (all 6 methods
  stub).
- `FileLogStorage` — `logging/index.ts:3` → `logging/storages/file-storage.ts` (write/flush/
  close stub). Also `usage/storages/remote-storage.ts:114` and
  `logging/storages/remote-storage.ts:59` have stub `flush`.

A consumer that picks `FileHistoryStorage` to persist history gets silent data loss — a
no-fallback / no-deprecated-stub violation, made worse because these are public exports.

Per the project rules (pre-1.0, no backward-compat, "delete or migrate, don't leave stubs"):
either **implement** the file storage, or **remove the export** until it's real (and stop
advertising a storage that doesn't store).

Secondary: the `check-stub-markers.mjs` scan claims to fail publishable packages containing
stub markers, yet `harness:scan` is green with these files present — so its `STUB_MARKERS`
list misses "not fully implemented" / "placeholder". Extend the marker set (or the scan) to
catch this phrasing so a nonfunctional export can't ship again.

## Why

Silent persistence failure from a public API is among the worst failure modes (data loss with
no error), and it reveals a hole in the very scan meant to prevent shipped stubs.

## Done When

- The File\*Storage (and stub `flush`) methods are implemented, OR the nonfunctional classes are
  removed from the public exports (decide per class; present the trade-off, don't unilaterally
  delete a consumed export).
- `check-stub-markers.mjs` catches "not fully implemented"/"placeholder"; running it now fails
  on the current stubs (proving the gap), then passes after they're implemented/removed.
- `pnpm --filter @robota-sdk/agent-plugin test` + `pnpm harness:scan` pass.

## Test Plan

- For implemented storages: round-trip test (save → load) actually persists.
- For removed exports: grep shows the symbol is gone from `*/index.ts` and SPEC/README updated.
- Run the extended stub-marker scan before the fix → fails on the stub files; after → passes.

## User Execution Test Scenarios

1. Configure a plugin with `FileHistoryStorage` and write history → it actually persists to
   disk and reloads (or the class is no longer offered). Evidence: _to fill._
