---
title: 'ARCH-017: the documented permissionHandler/askHandler injection seams on session options are dead surface (silently discarded on every construction path), and the permission-resolved InteractionEvent it should feed has zero emitters'
status: todo
created: 2026-08-13
priority: high
urgency: soon
area: packages/agent-framework, packages/agent-interface-transport
depends_on: [ARCH-018]
---

# ARCH-017: permission/ask handler seams are dead

## Problem

`TInteractiveSessionOptions` declares `permissionHandler` and `askHandler` and the SPEC documents them
as the way a consumer "intercepts tool permission requests with custom UI". Neither is honored: on the
standard path the constructor overwrites them with prompt-registry-backed closures; on the injected-
session path they are never read. And the `permission-resolved` InteractionEvent the framework SPEC
says is emitted has no emitter, so a channel that renders it gets nothing.

## Evidence (adversarially verified 2026-08-13, PARTIAL — consequences confirmed, one mechanism detail corrected)

- `packages/agent-framework/src/interactive/interactive-session.ts:177-183` — the handler assignment
  is guarded by `if (!('session' in options && options.session))` (i.e. conditional, NOT
  unconditional as first stated). On the STANDARD path the guard body assigns registry-backed closures
  over `stdOptions.permissionHandler`/`askHandler` with no preservation of a caller value, and that
  mutated object is what init consumes (`interactive-session-init.ts:216-217` →
  `create-session-projection.ts:43,45`). On the INJECTED-session path the handlers declared on
  `IInteractiveSessionInjectedOptions` (`interactive-session-options.ts:173,185`) are read nowhere
  (init never runs). Either way the two documented option fields are dead surface — demonstrated by
  `createQuery` (`query.ts:53`), whose `permissionHandler` is clobbered and whose prompts then fail
  closed via `session-prompt-registry.ts:52`.
- `permission-resolved` (`agent-interface-transport/src/interaction-contracts.ts:18`) has ZERO
  emitters repo-wide, though `agent-framework/docs/SPEC.md:377` documents it as a pushed event; live
  resolution flows through the separate `prompt_resolved` session event, never translated into the
  InteractionEvent member. (Also raised as interface-cluster F3.)
- SPEC anchors describing the dead seams: `agent-framework/docs/SPEC.md:334-336,381,429-431,854`
  (the last also mislocates `PermissionPrompt.tsx` in agent-transport; it lives in
  agent-transport-tui).

## Direction

Remove `permissionHandler` and `askHandler` from the session option contracts and remove the stale
`InteractionEvent.permission-resolved` member. REMOTE-007's prompt registry is the sole settlement
owner: requests are `permission_request` / `ask_request`, drivers settle them through
`resolvePermission` / `resolveAsk`, and `prompt_resolved` is the only settlement event. Leaf convenience
factories may preserve callback ergonomics by subscribing to request events and resolving through that
same registry; they must not introduce a second session-level settlement path.

## Recommendation Gate

- 2026-08-15 — `DEPTH: LOCAL`; the superseded session-level seams and duplicate dead event are the
  defects, while the REMOTE-007 prompt registry is the current settlement SSOT.
- 2026-08-15 — independent review endorsed removal plus leaf request-event adapters with fail-closed
  callback rejection; no legacy option or settlement event is restored.

REVIEW VERDICT: ENDORSE

## Scenario Plan Gate

- 2026-08-15 — offline public-SDK permission/ask request-resolution scenario reviewed as executable.

DONE-GATE-STAGE-1: PASS

## Test Plan

- Red-first type tests assert the obsolete session option fields and `permission-resolved` event are gone.
- Prompt-registry integration asserts leaf callback convenience subscribes to a request and settles it
  through `resolvePermission` / `resolveAsk`, producing exactly one `prompt_resolved` event.
- `pnpm harness:verify -- --scope packages/agent-framework` green.

## User Execution Test Scenarios

### Scenario: a public SDK consumer settles permission and ask prompts canonically

- **Agent executability:** `agent-executable`. The public-SDK example is non-interactive and drives a
  real `InteractiveSession` with the deterministic scripted provider; it requires no live key,
  network service, browser, or TTY.
- **Prerequisites:** Node.js 22.14.0 and the workspace dependencies installed. This work authors the
  maintained example `packages/agent-framework/examples/verify-prompt-request-resolution.ts`; the
  example creates an isolated temporary workspace and subscribes through the public session event API.
- **Command:**

  ```bash
  volta run --node 22.14.0 pnpm exec tsx --conditions=source packages/agent-framework/examples/verify-prompt-request-resolution.ts
  ```

- **Expected observable:** exit code `0` and one JSON object on stdout. It reports one
  `permission_request` settled by `resolvePermission`, one `ask_request` settled by `resolveAsk`,
  exactly two `prompt_resolved` events with matching request ids, the allowed tool result and ask
  answer observed by their callers, and `cleanupRemoved: true`. The emitted event names are the
  canonical `permission_request`, `ask_request`, and `prompt_resolved` surface only.
- **Cleanup:** the example shuts down the session and recursively removes its temporary workspace in
  `finally`.
- **Evidence (2026-08-15):** exit `0`; stdout
  `{"scenario":"ARCH-017","requestEvents":["permission_request","ask_request","prompt_resolved"],"permissionRequestCount":1,"askRequestCount":1,"resolvedRequestIds":["p1","a2"],"allowedToolResult":"ARCH_017_ALLOWED","askAnswer":["registry"],"responses":["permission complete","ask complete"],"cleanupRemoved":true}`.

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-08-15

**Status upgrade:** scenario-written → scenario-verified

- Direct execution: the exact scenario command above ran twice against the completed implementation;
  both runs exited `0` and produced the same JSON object.
- Expected result: each run observed one `permission_request`, one `ask_request`, exactly two matching
  `prompt_resolved` request ids (`p1`, `a2`), `ARCH_017_ALLOWED`, the `registry` answer, and the two
  expected provider responses.
- Cleanup: each run reported `cleanupRemoved: true`; no scenario workspace remained.
- Durable evidence: `packages/agent-framework/examples/verify-prompt-request-resolution.ts` exists and
  the package-owned scenario output matched
  `packages/agent-framework/examples/scenarios/framework-offline-scenarios.record.json`.
