---
title: 'TRANS-006: artifact and handoff ingestion decode before they commit'
issue: https://github.com/woojubb/robota/issues/2097
status: done
created: 2026-08-22
completed: 2026-08-23
priority: high
urgency: now
area: packages/agent-session, packages/agent-framework, packages/agent-interface-transport
depends_on: []
---

# TRANS-006: artifact and handoff ingestion decode before they commit

Execution leaf [issue #2097](https://github.com/woojubb/robota/issues/2097) under tracker
[issue #2067](https://github.com/woojubb/robota/issues/2067). Plan:
[`.agents/spec-docs/active/TRANS-006-artifact-and-handoff-ingestion-decode-before-they-commit.md`](../../spec-docs/done/TRANS-006-artifact-and-handoff-ingestion-decode-before-they-commit.md).

## Objective

Two ingresses accept a complete session record from outside this process and commit it without
decoding it. The artifact importer checks an envelope version and that `record.id` is a string, then
returns everything else unchecked. The handoff destination verifies the payload digest and byte
length, then casts and stages — and integrity is not validity: a digest proves the bytes that
arrived are the bytes that were sent, not that they are a session record.

Route both through the decoder TRANS-005 shipped, and give the handoff a refusal that can express
"the bytes were whole and the shape was not a record" — a failure that must never be retried, unlike
the integrity failure it would otherwise be reported as. Store and JSONL replay are out of scope
(issue #2096, issue #2098).

## Plan

- [x] TC-01 — artifact: malformed corpus throws, message carries the offending field path.
- [x] TC-02 — artifact: a valid maximal record still round-trips, with revived `Date`s.
- [x] TC-03 — artifact: an unreadable `schemaVersion` throws naming both versions, no field issues.
- [x] TC-04 — handoff: intact-but-undecodable payload refuses `payload-undecodable`, not `staged`.
- [x] TC-05 — handoff: an integrity failure still refuses `integrity-failed`; the two conditions are
      disjoint and neither refusal is reachable by the other's input.
- [x] TC-06 — handoff: after that refusal nothing is committable.
- [x] TC-07 — handoff: non-JSON bytes are refused, not thrown out of `receiveChunk`.
- [x] TC-08 — handoff: the valid path still stages and commits, with revived `Date`s.
- [x] TC-09 — one version constant: the incumbent name and value survive on the public surface, the
      TRANS-005 duplicate is gone, and no alias bridges them.
- [x] TC-10 — `pnpm build` then `pnpm -w typecheck`, in that order.
- [x] TC-11 — `run-all-scans` green, `interface-runtime` included.
- [x] TC-12 — all three packages' `docs/SPEC.md` updated; `check-spec-public-surface` passes.

## Test Plan

Unit tests in `packages/agent-session/src/__tests__/session-artifact.test.ts` (extended) and a new
handoff decode suite under `packages/agent-framework/src/handoff/__tests__/`, run by
`pnpm --filter @robota-sdk/agent-session test` and `pnpm --filter @robota-sdk/agent-framework test`.

The artifact suite is table-driven over a malformed corpus built from the maximal record fixture:
each case mutates one member into an invalid shape and asserts both that it throws and that the
message names the field path, so a decoder wired in but not actually consulted would still fail.

The handoff suite drives the destination through manifest → chunks → integrity verdict using the
existing composition, with the digest computed over the ACTUAL bad bytes so integrity genuinely
passes and only the decode fails. TC-05 is the pairing that matters: one input fails integrity and
one passes it and fails decoding, asserted to produce different refusals — that pairing is what
proves the two classes did not collapse into one.

Gate commands: `pnpm build`, `pnpm -w typecheck`, `pnpm --filter @robota-sdk/agent-session test`,
`pnpm --filter @robota-sdk/agent-framework test`, `node scripts/harness/run-all-scans.mjs`,
`node scripts/harness/check-spec-public-surface.mjs`, and `pnpm harness:verify` before the pull
request. Build precedes typecheck: a stale `dist/` reports phantom cross-package type errors.
