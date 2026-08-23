---
title: 'TRANS-005: give the persisted interactive-session record one versioned total decoder'
issue: https://github.com/woojubb/robota/issues/2081
status: done
created: 2026-08-22
completed: 2026-08-23
priority: high
urgency: now
area: packages/agent-session
depends_on: []
---

# TRANS-005: give the persisted interactive-session record one versioned total decoder

Execution leaf [issue #2081](https://github.com/woojubb/robota/issues/2081) under tracker
[issue #2067](https://github.com/woojubb/robota/issues/2067). Plan:
[`.agents/spec-docs/done/TRANS-005-versioned-total-decoder-for-the-persisted-session-record.md`](../../spec-docs/done/TRANS-005-versioned-total-decoder-for-the-persisted-session-record.md).

## Objective

`IInteractiveSessionRecord` is persisted and transferred but exists only at compile time, so every
ingress casts into it: the store `JSON.parse(...) as`, the artifact decoder checks an envelope
version and a string `id`, and handoff verifies bytes and then casts. Two consequences are reachable
today — a resumed record carries `string` where the contract declares `Date` (`messages[].timestamp`,
`history[].timestamp`, with no revival anywhere on the load path), and a corrupt file is collapsed
into "missing" and silently replaced by a field-stripped replay reconstruction.

Add the single owner-owned runtime decoder for a complete persisted record. It lives in
`agent-session`, beside the persistence paths that will consume it: the record TYPE is declared by
`agent-interface-transport`, but an `agent-interface-*` package publishes contracts and
discriminators rather than mechanisms (`scan-interface-runtime`), and a decoder is a mechanism. No store, artifact, handoff, or log consumer is migrated here — those are
issue #2096, issue #2097 and issue #2098.

## Plan

- [x] TC-01 — `decode-outcome.ts`: the outcome/issue contract and issue-collecting helpers; every
      non-record input returns `corrupt` and nothing throws.
- [x] TC-02 — `scalars.ts` + `record-decoder.ts`: a maximal record round-trips through
      `JSON.parse(JSON.stringify(...))` to `valid`, with revived `Date` timestamps.
- [x] TC-03 — `message-decoders.ts`, `tool-schema-decoders.ts`, `background-decoders.ts`,
      `event-decoders.ts`, `goal-plan-branch-decoders.ts`: all 15 nested contract families decoded
      totally, each reporting a field-path on failure.
- [x] TC-04 — date revival: ISO-8601 string or `Date` in, `Date` out; unparseable values are issues.
- [x] TC-05 — string timestamp fields (`createdAt`, `updatedAt`, …) validated as parseable dates.
- [x] TC-06 — unknown keys rejected on declared objects, permitted inside the five contract-open maps.
- [x] TC-07 — `decodeVersionedInteractiveSessionRecord` reports `unsupported` with the version seen,
      without nested field issues.
- [x] TC-08 — issue accumulation: independent defects are reported together, not one at a time.
- [x] TC-09 — key-parity test, so a contract field added without a decoder branch fails the build.
- [x] TC-10 — package builds; declared dependencies unchanged (`agent-core` only).
- [x] TC-11 — every new production file ≤ 300 lines; no new file-size baseline entry.
- [x] TC-12 — `docs/SPEC.md` updated (Public API Surface, Type Ownership, codec section).

## Test Plan

Unit tests in `packages/agent-session/src/__tests__/session-record-codec.test.ts`, run by
`pnpm --filter @robota-sdk/agent-session test`.

One maximal fixture record — every optional field populated, every nested contract family present —
is the base for two table-driven suites. The first feeds a malformed corpus (`null`, `undefined`,
`42`, `'{}'`, `[]`, `{}`, and truncations) and asserts a `corrupt` outcome with no throw. The second
mutates exactly one field per case from the valid base and asserts both the `corrupt` status and the
reported `path`, which is the property "no single-field mutation of a valid record decodes as valid".
Date handling, the unknown-key policy, version rejection, and issue accumulation each get their own
focused cases; the key-parity test compares the runtime decoder's key set against
`keyof IInteractiveSessionRecord` so a later contract field cannot be added silently.

Gate commands: `pnpm --filter @robota-sdk/agent-session build`, `pnpm harness:scan:deps`,
`pnpm harness:scan:file-size`, `pnpm harness:scan:spec-public-surface`, and `pnpm harness:verify`
before the pull request.
