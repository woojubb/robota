---
title: 'PLG-020: four of the eight official plugins are registered against lifecycle hooks the core host never dispatches — LimitsPlugin, WebhookPlugin, ConversationHistoryPlugin, ErrorHandlingPlugin are silent no-ops on a real agent'
status: skipped
completed: 2026-08-29
returned_to_issue: https://github.com/woojubb/robota/issues/2460#issuecomment-5457939546
created: 2026-08-13
priority: high
urgency: now
area: packages/agent-plugin, packages/agent-core
depends_on: []
---

# PLG-020: official plugins can't observe the runtime

## Problem

agent-core's plugin hook dispatcher fires exactly five hooks; four of the eight official plugins
implement only hooks that are NOT in that set, so registering them on a `Robota` agent enforces and
notifies nothing. The SPEC and README present all four as working cross-cutting concerns.

## Evidence (adversarially verified 2026-08-13, CONFIRMED)

- `packages/agent-core/src/services/plugin-hook-dispatcher.ts:20-64` — `HOOK_HANDLERS` = exactly
  `beforeRun`, `afterRun`, `beforeProviderCall`, `afterProviderCall`, `onError`; `:76-79` silently
  returns for any other hook name. Every production dispatch site
  (`execution-service.ts:174`, `execution-pipeline.ts:228`, `execution-round.ts:93,183`,
  `execution-stream.ts:78,283,301`) uses only those five. The `onModuleEvent` path
  (`agent-core/src/core/robota-initializer.ts:136-137`) needs opt-in options + an `onModuleEvent`
  impl — none of the four plugins has one.
- `packages/agent-plugin/src/limits/limits-plugin.ts:94,117` — implements only
  `beforeExecution`/`afterExecution` (both dead) → enforces no token/request/cost limit and no
  SELFHOST-004 `maxRunCost` run-budget cap.
- `packages/agent-plugin/src/webhook/webhook-plugin.ts:148,161,174` —
  `afterExecution`/`afterConversation`/`afterToolExecution` (all dead); only `onError` (:197) is
  live. The validated `execution.start` event (:122) has no emitter at all.
- `packages/agent-plugin/src/conversation-history/conversation-history-plugin.ts:270` — sole override
  is `dispose()`; a registered instance never receives a message (capture is only via an explicit
  `addMessage()` that has zero production callers).
- `packages/agent-plugin/src/error-handling/error-handling-plugin.ts:243,259` — only
  `getStats`/`dispose`; no `onError`, so a registered instance never sees an agent error (recovery
  only via explicit `executeWithRetry()`).
- The four plugin classes are not referenced in production outside `packages/agent-plugin/src`.

## Direction

Make the official plugins observable through the plugin architecture — either dispatch/re-target the
missing hooks from the execution services (map beforeRun/afterRun onto beforeExecution/afterExecution,
tool-batch events onto afterToolExecution, message-added onto ConversationHistory, and route errors
into ErrorHandling's onError which IS dispatched), or rewrite the four plugins against the five hooks
the host actually calls. Also reconcile agent-core's SPEC Plugin Contract table
(`SPEC.md:628-635`), which documents `beforeToolExecution`/`afterToolExecution`/`onStreamChunk` —
none dispatched, and `onStreamChunk` does not exist under that name (contract has `onStreamingChunk`,
also undispatched). Add a functional test that registers each official plugin on a real `Robota` and
asserts it observes a turn.

## Test Plan

- Red-first: a test registering LimitsPlugin/WebhookPlugin/ConversationHistoryPlugin/
  ErrorHandlingPlugin on a real `Robota`, running one turn (and one error turn), asserting each
  observed it. Fails today.
- Red-first: LimitsPlugin `maxRunCost` actually caps a run (SELFHOST-004).
- `pnpm harness:verify -- --scope packages/agent-plugin` green; agent-core Plugin Contract table
  reconciled.

## User Execution Test Scenarios

**Applies** (SDK plugins are public product surface).

- Prerequisites: built workspace; a scratch SDK consumer (`@robota-sdk/agent-core` +
  `@robota-sdk/agent-plugin`) — authored by this work.
- Steps: construct a `Robota` with `plugins: [new LimitsPlugin({ maxRequests: 1 }), new
WebhookPlugin({ url }), new ConversationHistoryPlugin({ storage: 'memory' }), new
ErrorHandlingPlugin()]`; run two turns; force a provider error.
- Expected (after fix): the second turn is rate-limited; the webhook receives lifecycle posts; the
  history plugin holds the messages; the error plugin's stats show the caught error.
- Expected (before fix, contrast): all four do nothing.
- Cleanup: delete the scratch project.
- Evidence (fill in after implementation): webhook server log, history dump, limit rejection, error
  stats.
