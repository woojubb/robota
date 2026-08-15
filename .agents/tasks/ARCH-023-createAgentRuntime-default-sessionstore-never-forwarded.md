---
title: 'ARCH-023: createAgentRuntime computes a default sessionStore it never forwards to createSession — the runtime store is dead, stateless and default runtimes persist identically, and resume via the runtime default silently cannot restore'
status: todo
created: 2026-08-13
priority: medium
urgency: soon
area: packages/agent-framework
depends_on: [ARCH-015]
---

# ARCH-023: the runtime-level sessionStore is never inherited

## Problem

`createAgentRuntime` eagerly defaults a `sessionStore` and documents runtime fields as auto-inherited,
but `createSession()` forwards only the per-call `opts.sessionStore` — never the runtime-level store.
So the runtime default (and a runtime-configured store) is dead, `createStatelessRuntime`'s
`sessionStore: undefined` is behaviorally identical to the default runtime, and `resumeSessionId`
through the runtime default silently no-ops. This violates the factory context auto-forwarding rule
(`project-structure.md:123`).

## Evidence (adversarially verified 2026-08-13, CONFIRMED)

- `packages/agent-framework/src/runtime/agent-runtime.ts:85-86` — defaults
  `sessionStore = createProjectSessionStore(config.cwd)`; `:34` JSDoc "Runtime fields (cwd, provider,
  etc.) are inherited automatically."
- `agent-runtime.ts:98-123` — `createSession()` passes `sessionStore: opts.sessionStore` only; the
  runtime-level store appears solely as the exposed `runtime.sessionStore` property (`:95`), which no
  code in the repo reads back.
- No rescue path: `createAgentRuntime` callers (starter-nextjs route, `eval-command` via
  `createSessionRunFn`) never pass `opts.sessionStore`; the CLI's persistent flows bypass
  `createAgentRuntime` via `cli.ts:335` + `buildRuntimeSession`. `resumeSessionId` restore is gated on
  `options.sessionStore` (`interactive-session.ts:156,312`), so resume via the runtime default no-ops.
  `SessionStore` construction is lazy/side-effect-free, so stateless and default runtimes are
  indistinguishable for persistence.

## Direction

Forward the runtime-level store in `createSession`:
`sessionStore: 'sessionStore' in opts ? opts.sessionStore : sessionStore` (explicit override wins,
factory auto-forwarding rule) — OR stop computing/exposing the runtime default and document that
headless runtime sessions are unpersisted unless a store is passed per call. Pick one; today the field
is a promise the code does not keep.

## Test Plan

- Red-first: a `createAgentRuntime({ cwd })` whose `createSession()` (no per-call store) then
  `resumeSessionId` restores a prior session — fails today, passes after forwarding; OR (if the
  remove-the-default option is taken) a test asserting the stateless and default runtimes are
  documented as equivalent and the dead default is gone.
- `pnpm harness:verify -- --scope packages/agent-framework` green.

## User Execution Test Scenarios

**Applies** (via the public `createAgentRuntime` SDK surface).

- Prerequisites: built workspace; a scratch SDK consumer using `createAgentRuntime`.
- Steps: create a runtime with a cwd, run a session that produces history, then create a session with
  `resumeSessionId` pointing at it — without passing a per-call `sessionStore`.
- Expected (after the "forward" fix): the prior session's history is restored.
- Expected (before fix, contrast): resume finds nothing (the runtime default was never used to
  persist).
- Cleanup: delete the scratch store dir.
- Evidence (fill in after implementation): the resumed session's restored history, or (remove-default
  option) the doc/test asserting non-persistence.
