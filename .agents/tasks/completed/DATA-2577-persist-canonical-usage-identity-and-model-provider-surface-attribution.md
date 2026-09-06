---
title: 'DATA-2577: Persist canonical usage identity and model provider surface attribution'
issue: https://github.com/woojubb/robota/issues/2577
status: done
completed: 2026-09-06
created: 2026-09-06
priority: high
urgency: soon
area: agent-interface-analytics, agent-interface-session, agent-core, agent-session, agent-framework
depends_on: []
---

# DATA-2577: Persist canonical usage identity and model provider surface attribution

## Objective

Make each canonical usage event retain the stable logical identity and actual attribution needed for
correct historical reporting. Record optional provider/model and causal per-turn product surface where
those facts are known, persist one started top-level turn observation independently of usage, deduplicate
repeated fragments before persistence, and keep existing session records readable with absent dimensions
represented as `unknown` by downstream consumers.

## Existing Evidence

- `packages/agent-interface-analytics/src/usage-contracts.ts` showed that `IUsageSnapshot` carried
  tokens, cost, and execution source but no logical event identity,
  provider/model, or surface.
- Main and child usage paths sum usage-bearing assistant messages without a shared message-ID
  idempotency rule.
- Persisted usage alone cannot count started top-level turns that return no usage, fail, or are
  interrupted, so turn count requires its own canonical observation.
- A session can be driven by more than one attached surface, so session-level surface attribution
  would misclassify turns and background work.
- The session-record codec has strict declared keys and explicit valid/corrupt/unsupported outcomes;
  shape evolution must update the codec and fixtures together.

## Plan

- [x] Define a canonical started-turn observation plus usage identity and optional
      provider/model/per-turn surface fields in the owning interface contracts; keep execution source
      distinct from product surface.
- [x] Have the execution-round owner mint `usageObservationId` once before each provider invocation;
      reuse it for all repeated fragments from that invocation, assign a new ID to each separately
      observed provider invocation, and correlate it with `turnId`, `executionId`, and round without using
      content equality.
- [x] Persist exactly one top-level started-turn observation after the execution claim is acquired for
      success, failure, and `interrupted` outcomes, including zero-usage results; exclude submissions that
      never ran and ended `coalesced`, `dropped`, or `cancelled`, plus nested/provider rounds.
- [x] Persist and round-trip the new optional fields through the strict versioned session-record codec.
- [x] Preserve old valid records without eager rewrite and expose absent attribution for downstream
      `unknown` buckets.
- [x] Add regression fixtures for repeated usage fragments, mixed legacy/current records, autonomous
      work, and multi-driver sessions.

## Constraints

- Different turns with equal token values are legitimate and must not be deduplicated.
- `usageObservationId` is observed-invocation-scoped: retransmitted/streamed fragments reuse it;
  provider-internal HTTP retries that yield one observed response do not manufacture another observation.
- Top-level turn start is recorded independently from provider usage so zero-usage and non-success
  outcomes remain countable without inventing token observations.
- The ID is owned at the `agent-core` provider-call boundary. Provider-internal HTTP retries that produce
  one observed response retain one observation; a separately observed/billed model invocation receives a
  distinct ID.
- Provider/model values are historical facts; never infer them from name prefixes or current settings.
- Surface is attributed only when causal driver data exists; autonomous/background work remains unknown.
- Any envelope-version decision must prevent older executables from partially decoding and overwriting
  a newer record.

## Test Plan

- Type-level tests for the provider-neutral usage and turn attribution contracts.
- Unit tests proving repeated fragments sharing one `usageObservationId` emit one canonical usage event,
  separately observed invocations receive distinct IDs, provider-internal one-response retry remains one,
  and distinct IDs with equal values remain distinct.
- Lifecycle tests proving exactly one started-turn observation for zero-usage, success, failure, and
  `interrupted`, and none for never-run `coalesced`/`dropped`/`cancelled` submissions or nested/provider
  rounds counted as top-level turns.
- Session codec round-trip and field-preservation tests for current, legacy, corrupt, and unsupported
  records.
- Framework/session integration tests for TUI, headless, GUI/remote driver, nested, and autonomous paths.
- Affected package builds and governing `docs/SPEC.md` conformance checks.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This Task establishes an internal persisted-data contract and deliberately exposes no
standalone user command or screen; its behavior becomes user-observable only through FLOW-2577 and
SCREEN-2577, whose scenarios exercise the exact persisted path.

## Result

Canonical provider-round identities and actual provider/model/source attribution now persist through
the strict session codec. The framework records exactly one started top-level observation for success,
failure, interruption, and zero-usage outcomes while excluding work that never acquired execution.
Legacy records remain readable and missing attribution stays explicit for downstream reporting.
