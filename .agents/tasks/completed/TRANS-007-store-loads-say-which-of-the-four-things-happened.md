---
title: 'TRANS-007: store loads say which of the four things happened'
issue: https://github.com/woojubb/robota/issues/2096
status: done
created: 2026-08-22
completed: 2026-08-23
priority: high
urgency: now
area: packages/agent-session, packages/agent-framework, packages/agent-interface-transport, apps/agent-server
depends_on: []
---

# TRANS-007: store loads say which of the four things happened

Execution leaf [issue #2096](https://github.com/woojubb/robota/issues/2096) under tracker
[issue #2067](https://github.com/woojubb/robota/issues/2067). Plan:
[`.agents/spec-docs/done/TRANS-007-store-loads-say-which-of-the-four-things-happened.md`](../../spec-docs/done/TRANS-007-store-loads-say-which-of-the-four-things-happened.md).

## Objective

`IInteractiveSessionStore.load` returns `record | undefined`, and `undefined` is one value for four
situations: never saved, damaged, written by a build this one cannot read, and read failed. Every
consumer guesses, and they guess differently.

The consequence is worse than an uninformative read. Three consumers use `load` as a
read-modify-write — they read the existing record to preserve fields they do not own, then save. When
the load returned `undefined` because the file was **corrupt rather than absent**, the save
overwrites the damaged file with a fresh, nearly empty record. A resume on a damaged session also
returns a fifteen-empty-member record with no indication anything is wrong, and a rename silently
does nothing.

Give the port a typed outcome, write the versioned envelope so `unsupported` is reachable at all, gate
the replay fallback to `missing`, stop a non-`valid` load from being treated as "no prior record" on
the write path, and stop `list` from hiding what it cannot read.

**Accepted cost, ruled by the owner on the issue:** no compatibility branch. Every session file
written before this loads as `unsupported`, so a beta user's in-progress session does not resume.
`code-quality.md:58-59` — pre-release, legacy disposable.

## Plan

- [x] TC-01 — `missing` is its own outcome, and the replay fallback runs for it and only it.
- [x] TC-02 — a truncated file is `corrupt` with a located issue, not `missing`.
- [x] TC-03 — a pre-envelope bare record is `unsupported`; this is the every-beta-user case.
- [x] TC-04 — a well-formed session round-trips to `valid` with revived `Date`s.
- [x] TC-05 — `persistSession` does not write over a `corrupt`/`unsupported` file; asserted on bytes.
- [x] TC-06 — resume on a corrupt session no longer returns the fifteen-empty-member record.
- [x] TC-07 — `setName` on an unreadable session does not silently succeed.
- [x] TC-08 — `list()` includes the unreadable entry rather than omitting it.
- [x] TC-09 — the resumable-summary projection still returns only `valid`, and reports the rest.
- [x] TC-10 — the bytes on disk are `{ "schemaVersion": 1, "record": … }`.
- [x] TC-11 — `pnpm build` then `pnpm -w typecheck`, in that order; all nine call sites migrated.
- [x] TC-12 — `run-all-scans` green, with both `allow-fallback` markers removed rather than moved.
- [x] TC-13 — a file whose NAME cannot be used as a session id is REPORTED by `list()`, in both
      stores. Added during implementation, not planned; see below.

## What the plan did not predict

TC-13 was not in the plan and is the best evidence in the change. It exists because a CodeQL
`js/path-injection` alert on `load` — a pre-existing one this work inherited by moving a line —
had to be answered, and answering it meant tracing every path from the parameter to the sink. The
second path was one the plan never considered: `list()` routed a filename read from `readdirSync`
through `assertSafeSessionId`, a guard that is correct for a caller-supplied id and wrong for a
directory entry. One `my session.json` in the sessions directory threw out of `list()` and took the
resume picker with it.

`WorkspaceSessionStore` had the mirror-image bug, pre-existing: `.filter(isSafeSessionId)` before
the map, so the same file silently disappeared from the listing.

**Those two are the argument for this whole change, arrived at from outside it.** One store threw
and the other silently dropped, over the same input — the store's answer was conditional on which
implementation the caller happened to hold, which is precisely what an outcome type exists to
remove. And the silent drop is the same disappearance this work removes on the CONTENT axis,
surviving on the NAME axis. A nullable return could only ever have made that disagreement quieter.
Both stores now report a `corrupt` outcome naming the unusable name; both fixes are mutation-verified
against the throw AND the silent drop.

## Decisions on the record

**`review-findings-acknowledged` was applied to PR #2231** for the blocking `js/path-injection`
finding, on three grounds: it is open code-scanning alert 398 on `develop` and `main` (2026-08-15) at the same
sink in the same function, reported as introduced only because `load` gained the outcome branches and
`review-gate` attributes by position; the verification was a by-hand trace that found a live defect
rather than coming back clean; and making the guard visible to the analyser would mean scattering
`assertSafeSessionId` to the sinks or sanitizing at the `join`, both of which undo SEC-006's
single-validation-point property. The decision was made by the pipeline orchestrator on that
evidence, not unilaterally by the implementer.

Two follow-ups filed rather than fixed here:

- **issue #2240** — the alert re-blocks every future PR that moves that line, so the cost recurs on
  whoever next refactors `load`. Options include a branded return type from `filePath`, which would
  preserve the single validation point; whether CodeQL follows a TypeScript brand must be MEASURED
  before that option is chosen.
- **issue #2241** — `pre-push-check` read this PR as merge-ready from a reviewer's
  `ACTIONABLE FINDINGS: 0` while `review-gate` had it BLOCKED with 13 findings, and refused the
  pushes that were narrowing them. Two documented overrides on this PR are the evidence.

## Test Plan

Unit tests in `packages/agent-session/src/__tests__/` (store outcomes, the write-path guard, the
bytes on disk) and `packages/agent-framework/src/interactive/__tests__/` (the replay gate, resume on a
corrupt session, `setName`, the summary projection), run by
`pnpm --filter @robota-sdk/agent-session test` and `pnpm --filter @robota-sdk/agent-framework test`.

Two of the cases are deliberately not written the easy way. TC-05 compares the **file bytes** before
and after the attempted save, because "the call did not throw" is not "the call did not write" — and
the defect being fixed is a write, not a read. TC-10 reads the file with `readFileSync` and parses it,
because asserting the loaded value round-trips proves the codec agrees with itself and says nothing
about what is on disk; the format change is the bytes.

TC-02 truncates a previously valid file rather than hand-writing a broken literal, so the input is
what a crash actually leaves. TC-03 writes the bare pre-envelope record directly, because that shape
is no longer producible by this build and a fixture is the only way to test the case every existing
user will hit.

Gate commands: `pnpm build`, `pnpm -w typecheck`, both package test suites,
`node scripts/harness/run-all-scans.mjs`, `node scripts/harness/check-spec-public-surface.mjs`, and
`pnpm harness:verify` before the pull request. Build precedes typecheck: a stale `dist/` reports
phantom cross-package type errors.
