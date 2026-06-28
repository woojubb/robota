---
title: 'PLUGIN-002: DatabaseHistoryStorage is a consumed, nonfunctional stub (silent data loss)'
status: done
created: 2026-06-27
completed: 2026-06-27
priority: medium
urgency: soon
area: packages/agent-plugin
depends_on: []
---

# DatabaseHistoryStorage is a consumed, nonfunctional stub

Surfaced while fixing PLUGIN-001 (which implemented the File/Remote `*Storage` classes).

## What

`packages/agent-plugin/src/conversation-history/storages/database-storage.ts` is a stub: every
method logs "Database storage not fully implemented yet" and returns a stub value (save persists
nothing, load returns `undefined`, etc.). It is **consumed** —
`conversation-history-helpers.ts:118` returns `new DatabaseHistoryStorage(connectionString)`
when a user selects the `database` history backend — so a user who configures database history
silently loses all conversation data, same failure class as the File storages PLUGIN-001 fixed.

Unlike the File/Remote storages, this one needs an external **DB driver decision** (Postgres
via `pg`? SQLite via `better-sqlite3`? a generic adapter interface?) which is a real product/
architecture choice, not a mechanical fill-in — hence a separate backlog.

## Why

A consumed storage that silently drops data is a data-loss bug; it must be implemented or the
`database` option removed so users can't select a no-op backend.

## Options (decide first)

1. Implement against a chosen driver (e.g. Postgres `pg`) — add the dep, schema, migrations.
2. Define a generic `IDatabaseDriver` adapter interface and let the consumer inject a driver
   (keeps agent-plugin driver-free, matches the repo's DI philosophy).
3. Remove the `database` backend option + `DatabaseHistoryStorage` export until a driver exists
   (the helper falls back to an explicit error, not a silent stub).

Recommended: option 2 (adapter interface) — keeps the package dependency-light and lets the
app/CLI own the concrete driver. Confirm before implementing.

## Done When

- `database` history is either functional (round-trip persistence test) or the option is
  removed and selecting it raises a clear error (no silent no-op).
- The `database-storage` stub markers are gone; stub-marker scan (now catches
  "placeholder for actual"; consider also extending for this phrasing) stays green.
- SPEC updated (the table currently marks it a stub pending this item).

## Test Plan

- Round-trip persistence test against the chosen driver (or an in-memory adapter fake), OR a
  test asserting the removed option errors clearly.

## User Execution Test Scenarios

1. Configure a plugin with `database` history, write and reload a conversation → it persists
   (or the user gets an explicit "not available" error instead of silent loss). Evidence:
   `database-storage.test.ts` "round-trips an entry through the driver with revived Dates" — an
   in-memory `IDatabaseDriver` fake saves and reloads a conversation (with `startTime`/`lastUpdated`
   Dates revived). Selecting `storage: 'database'` without a `databaseDriver` now throws a
   `ConfigurationError` (`conversation-history-plugin.test.ts` "throws when database storage is
   missing a databaseDriver (PLUGIN-002)") — no silent no-op path remains.

## Evidence Log (completed 2026-06-27)

**Decision:** Option 2 — adapter interface (user-confirmed: "어댑터 인터페이스 (권장)"). Keeps
agent-plugin driver-free; the app/CLI injects a concrete `IDatabaseDriver`.

**Changes:**

- `types.ts` — added `IDatabaseDriver` interface (`get`/`set`/`delete`/`list`/`clear`) and
  `databaseDriver?: IDatabaseDriver` option on `IConversationHistoryPluginOptions`; exported from
  `index.ts`.
- `storages/database-storage.ts` — rewritten to persist through the injected driver
  (`driver.set(key, JSON.stringify(entry))`, `driver.get` + `reviveHistoryEntry`, keyed by
  `conversation:` prefix). No more "not fully implemented yet" stub markers.
- `conversation-history-helpers.ts` — `storage: 'database'` without a `databaseDriver` now throws
  `ConfigurationError` instead of returning a silent stub; `createHistoryStorage` injects the driver.
- `conversation-history-plugin.ts` — threads `databaseDriver` through defaults
  (`Required<Omit<…,'databaseDriver'>> & { databaseDriver?: IDatabaseDriver }`).
- Tests: new `storages/__tests__/database-storage.test.ts` (in-memory driver round-trip + list/
  delete/clear); old silent-stub describe block removed from `history-storages.test.ts`.
- `docs/SPEC.md` updated to describe the injected-driver contract.

**Verification:** `agent-plugin` typecheck clean, build clean, 303 tests pass (21 files),
`pnpm harness:scan` 32/32 green.
