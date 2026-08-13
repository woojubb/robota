---
title: 'ARCH-017: the documented permissionHandler/askHandler injection seams on session options are dead surface (silently discarded on every construction path), and the permission-resolved InteractionEvent it should feed has zero emitters'
status: todo
created: 2026-08-13
priority: high
urgency: soon
area: packages/agent-framework, packages/agent-interface-transport
depends_on: []
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

Decide (one design fact, both symptoms):

- **Honor injection:** make the prompt registry fall back to a caller-supplied `permissionHandler`/
  `askHandler` when one is provided (both paths), OR
- **Remove the dead fields** from `TInteractiveSessionOptions`/`IInteractiveSessionInjectedOptions`
  and rewrite the SPEC's Extension Points / ask-seam / Permission System sections around the real
  mechanism (`permission_request`/`ask_request` + `resolvePermission`/`resolveAsk`).

Then either emit `permission-resolved` from the prompt-registry settle path (it carries exactly
`id`/`granted`) or remove the union member and the SPEC row. Today both halves are false.

## Test Plan

- Red-first: a session constructed with a custom `permissionHandler` — assert it is invoked on a tool
  permission request (fails today; the registry default runs instead). If the remove-fields option is
  chosen, a typecheck asserting the fields are gone + SPEC updated.
- Red-first: assert `permission-resolved` is either emitted on resolution or absent from the union.
- `pnpm harness:verify -- --scope packages/agent-framework` green.

## User Execution Test Scenarios

**Applies** (via the public SDK — a consumer supplying a custom permission handler).

- Prerequisites: built workspace; a scratch SDK consumer constructing an interactive session with a
  custom `permissionHandler` that auto-denies a specific tool.
- Steps: run a turn that triggers that tool.
- Expected (after the "honor" fix): the custom handler decides (the tool is denied by it).
- Expected (before fix, contrast): the custom handler never runs; the built-in registry prompt (or
  fail-closed deny) applies instead.
- If "remove fields" is chosen: Not applicable — record the API removal + SPEC rewrite in the Test
  Plan; the scenario becomes "consumer uses the documented `permission_request` path".
- Evidence (fill in after implementation): the consumer source + turn transcript showing which handler
  decided.
