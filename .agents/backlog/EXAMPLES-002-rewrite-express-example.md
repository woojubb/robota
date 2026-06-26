---
title: 'EXAMPLES-002: Rewrite the express example against the current SDK API (quarantined from CI)'
status: todo
created: 2026-06-27
priority: medium
urgency: soon
area: examples/express
depends_on: []
---

# Rewrite the express example against the current SDK API

Surfaced by EXAMPLES-001 (which added `examples:typecheck` against local source and immediately
caught this drift).

## What

`examples/express/src/server.ts` uses a removed/old API and fails typecheck:

- imports `createFunctionTool` from `@robota-sdk/agent-core` — no longer a top-level export
  (it is now a method on the tool-integration interface; the 4-arg
  `createFunctionTool(name, description, schema, fn)` signature is gone).
- builds a `Robota` agent via an `aiProviders`/`defaultModel`/`tools` config that no longer
  matches `IAgentConfig` (e.g. `aiProviders` must be a mutable `IAIProvider[]`).

Because it is broken, it is **quarantined** from the `examples:typecheck` gate
(`package.json` filter `!robota-example-express`). Rewrite it against the current API (e.g.
`createQuery` / `createAgentRuntime` with the current tool-registration mechanism — see the
passing `examples/cli` and `examples/websocket-chat` for the current provider/streaming
pattern), then remove the quarantine filter so CI typechecks it too.

## Why

A shipped example that doesn't compile against the current SDK misleads users; the CI gate now
exists, so this example just needs to be brought current and re-included.

## Done When

- `examples/express` typechecks against local source (the express server still demonstrates an
  HTTP + streaming + tool-use flow with the current API).
- The `!robota-example-express` quarantine is removed from `package.json` `examples:typecheck`.
- `pnpm examples:typecheck` passes with express included.

## Test Plan

- `pnpm build:deps && pnpm examples:typecheck` (express no longer filtered) → green.
- Optionally run the server and POST `/api/chat` to confirm the flow still works.

## User Execution Test Scenarios

1. `pnpm --filter robota-example-express run typecheck` → passes; the example compiles and the
   `/api/chat` SSE + tool-use path runs. Evidence: _to fill._
