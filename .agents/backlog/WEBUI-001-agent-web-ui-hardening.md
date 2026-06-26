---
title: 'WEBUI-001: agent-web-ui hardening — tests, a11y, public surface'
status: todo
created: 2026-06-27
priority: medium
urgency: soon
area: packages/agent-web-ui
depends_on: []
---

# agent-web-ui hardening — tests, a11y, public surface

## What

`packages/agent-web-ui` (published React component library) has gaps its own SPEC notes:

1. **No tests.** SPEC "Test Strategy" says _"No test files exist currently"_ and there are
   zero `*.test.*`/`__tests__` in `src`. Add the unit tests the SPEC recommends:
   `createWsSessionClient` reconnect logic (mock WebSocket), `useWsSession` message
   reconstruction, and a `ConversationView` render test.
2. **Component a11y.** `SessionMonitor`/`ConversationView`/`AgentActivityPanel` have no
   `aria-*`/`role` markup. Add accessible names/roles to interactive and status elements.
3. **Public surface.** `AgentActivityPanel` is documented but not exported from
   `src/index.ts` (SPEC notes "not exported from package root"). Decide and align:
   export it (and update SPEC) or document it as intentionally internal.
4. **Build-output contract.** SPEC notes the `dist/browser` bundle is produced but the
   `exports` map declares only `node`/`default`, so the browser bundle is not
   consumer-resolvable. Add the `browser` export condition (or update the SPEC to match).

## Why

The user repeatedly values test coverage and accurate public-API/SPEC contracts; this is a
published package shipping with none of its recommended tests and a documented
surface/packaging mismatch.

## Done When

- Recommended unit tests exist and pass.
- Components carry accessible names/roles.
- `AgentActivityPanel` export state matches SPEC; `dist/browser` is resolvable or the SPEC
  is corrected.
- Package build + tests pass; SPEC.md updated for any contract change.

## Test Plan

- `pnpm --filter @robota-sdk/agent-web-ui build` + `test`.
- Resolve the `./*` / browser export in a smoke import.

## User Execution Test Scenarios

1. From a consumer, import the documented components (incl. `AgentActivityPanel`) and the
   browser bundle without reaching into `dist/`. Evidence: _to fill._
