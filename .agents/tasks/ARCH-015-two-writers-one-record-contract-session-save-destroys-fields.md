---
title: "ARCH-015: agent-session's persistSession rebuilds the record from nine fields and destroys every other contract field on re-save — a latent public-API data-loss hazard against interactive records, plus a near-duplicate store port"
status: todo
created: 2026-08-13
priority: medium
urgency: soon
area: packages/agent-session, packages/agent-interface-transport
depends_on: []
---

# ARCH-015: the Session-level record writer is non-preserving

## Problem

`agent-session`'s `persistSession` rebuilds the persisted record from nine fields, carrying forward
only `name`/`createdAt` from the loaded record — so every other field of the shared
`IInteractiveSessionRecord` contract (goal, plan, activeBranch, backgroundTasks, memoryEvents,
contextReferences, sandboxSnapshotId) is destroyed when a `Session`-level save re-persists a record
that the framework writer had enriched. It is not a live first-party bug today, but it is a real
latent hazard on genuinely public API, and it sits beside a near-duplicate store port that seeds the
same drift.

## Evidence (adversarially verified 2026-08-13, PARTIAL — mechanism confirmed, live-path citation corrected)

- `packages/agent-session/src/session-history-ops.ts:154-173` — `persistSession` loads `existing` but
  rebuilds from 9 fields, carrying only `name`/`createdAt`; no `...existing` spread. Because
  `ISessionRecord` is a literal alias of `IInteractiveSessionRecord` (`session-store.ts:35`, TYPE-003),
  a `Session`-level save of an interactive record drops the optional contract fields the framework
  writer preserves (`agent-framework/src/interactive/interactive-session-persistence.ts:54-134`).
- **Correction (verifier):** the original "live public API" citation was wrong. `agent-framework`'s
  `assembly/create-session.ts` is INTERNAL (`agent-framework/src/index.ts:663-668` marks
  `createSession()` "INTERNAL (not exported)"; only the `ICreateSessionOptions` TYPE is exported), and
  no in-repo wiring gives a raw `Session` a `sessionStore` — the interactive projection
  (`create-session-projection.ts:29-97`) omits it, so `InteractiveSession`'s inner `Session` never
  persists (`session.ts:206-207` no-op), and every first-party store consumer routes the store only to
  `InteractiveSession`. The two writers therefore never touch the same record in-repo.
- The hazard is a genuinely public surface: `@robota-sdk/agent-session` exports `Session`
  (`index.ts:4`), `ISessionOptions.sessionStore` (`session-types.ts:95`), and `SessionStore`
  (`index.ts:69`) with default dir `~/.robota/sessions` — an external consumer wiring a raw `Session`
  with a store to the same dir + id as an interactive record hits the field-destruction.
- Adjacent drift seed (interface-cluster F12): `ISessionStore` (`session-store.ts:38-45`, +optional
  `getFilePath`) is a near-duplicate of the SSOT `IInteractiveSessionStore`
  (`agent-interface-transport/src/session-contracts.ts:550-556`); neither doc acknowledges the other,
  and a store built to the SSOT contract silently loses `transcript_path` in every hook input.

## Direction

1. Make `persistSession` non-destructive: spread `...existing` (or all optional fields) into the
   rebuilt record so a `Session`-level save preserves fields it does not own.
2. Reconcile the store ports: fold `getFilePath` into the SSOT `IInteractiveSessionStore` and alias
   `ISessionStore` to it (mirroring TYPE-003's record alias), or document the SPI split explicitly in
   both SPECs.

## Test Plan

- Red-first: persist an interactive-shaped record (with goal/plan/activeBranch set) via
  `agent-session`'s `Session` + `SessionStore`, reload, re-save, reload — assert the optional fields
  survive. Fails today.
- Typecheck asserts `ISessionStore` and `IInteractiveSessionStore` are one type (or the SPI split is
  documented).
- `pnpm harness:verify -- --scope packages/agent-session` green.

## User Execution Test Scenarios

**Applies — via the public `@robota-sdk/agent-session` SDK surface.**

- Prerequisites: built workspace; a scratch SDK consumer using `Session` + `SessionStore` against a
  record that carries a `plan`/`goal`.
- Steps: save a record with a plan set; reload; re-save via `Session`; reload again.
- Expected (after fix): the plan/goal survive the round-trip.
- Expected (before fix, contrast): the second reload shows the plan/goal gone.
- Cleanup: delete the scratch store dir.
- Evidence (fill in after implementation): the two reloads' record contents.
