---
title: 'PLUGIN-002: DatabaseHistoryStorage is a consumed, nonfunctional stub (silent data loss)'
status: todo
created: 2026-06-27
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
   _to fill._
