---
title: 'DATA-007: include effective model effort in execution cache identity'
issue: https://github.com/woojubb/robota/issues/1987
status: todo
created: 2026-08-29
priority: critical
urgency: now
area: agent-core execution cache
depends_on: [FLOW-008, API-001]
---

# DATA-007: effort-sensitive execution cache identity

## Objective

Prevent a cached response produced at one effective effort from satisfying a request at another.
`CacheKeyBuilder` currently keys messages, model, provider, temperature, and max tokens, while provider
calls always carry effort. This makes changing effort observationally ineffective whenever execution
caching hits.

## Plan

1. Extend the cache-key contract with the resolved effective effort/outcome that affects the provider
   request, not an arbitrary raw source value.
2. Thread the same value through lookup and store, including default and clamped outcomes.
3. Add red/green regression coverage for equal prompts at different effective levels and stable hits
   at the same level.
4. Document compatibility/versioning consequences for existing cache entries.

## Completion Criteria

- Different effective effort values generate different cache keys.
- Equivalent requests that resolve to the same native/effective outcome retain cache hits.
- Lookup and store cannot disagree about the effort component.
- Existing entries have an explicit invalidation or versioning disposition.

## Test Plan

- Cache-key unit tests for differing, equal, default, and clamped effective efforts.
- Execution-cache integration test proving a second effort invokes the provider and the same effort
  reuses the cache.
- Affected package build/tests, `pnpm harness:scan`, and CI-equivalent verification before merge.

## User Execution Test Scenarios

Prerequisites: the child adds the public-SDK example
`packages/agent-core/examples/verify-effort-cache-identity.ts`. The example must use only exported
Robota/cache/provider contracts, enable `cache: { enabled: true, maxEntries: 10, ttlMs: 60000 }`, count
provider calls, and run one identical prompt at low, low, then high; it must not import an internal test
fixture.

Run
`pnpm --filter @robota-sdk/agent-core exec tsx examples/verify-effort-cache-identity.ts`.

Expected: the example prints `lowCalls=1`, `lowCacheHits=1`, `highCalls=1`, and exits 0. Cleanup: the
example uses an in-memory cache and removes any temporary session directory before exit. Evidence:
pending implementation with the exact output and exit code.
