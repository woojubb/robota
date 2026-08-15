---
title: 'CORE-036: runStream() never applies config.systemMessage — the streaming path builds provider messages straight off the conversation store and skips the session initialization that the round path uses to attach the system prompt, so the same agent obeys its persona through run() and ignores it through runStream()'
status: todo
created: 2026-08-16
priority: high
urgency: now
area: packages/agent-core
depends_on: []
---

# CORE-036: runStream() drops the configured system prompt

Reported by an external user in [issue #1736](https://github.com/woojubb/robota/issues/1736)
(`@robota-sdk/agent-core` 3.0.0-beta.78, re-confirmed against `develop`).

## Problem

`Robota.run()` and `Robota.runStream()` receive an identical `executionConfig`, but only the round
path ever reads `config.systemMessage`. The streaming path takes the conversation store's messages
as-is, so an agent whose entire behavior is defined by its system prompt streams as if it had none.

The failure is silent and mis-attributable: the model answers fluently, just not under its
instructions, which reads as a model-quality problem rather than a dropped prompt.

## Evidence (verified against `develop`, 2026-08-16)

- `packages/agent-core/src/services/execution-service-helpers.ts:189-192` — the round path's
  `initializeConversationStore()` attaches the prompt:
  `const hasSystemMessage = session.getMessages().some((m) => m.role === 'system'); if
(config.systemMessage && !hasSystemMessage) { session.setSystemPrompt(config.systemMessage, {
executionId }); }`
- `packages/agent-core/src/services/execution-stream.ts:72` — the streaming path never calls that
  helper; it goes straight to `conversationHistory.getConversationStore(context.conversationId)`.
- `packages/agent-core/src/services/execution-stream.ts:106-114` — provider messages are the store's
  messages plus, optionally, the _ephemeral_ per-run block only:
  `const conversationMessages = conversationStore.getMessages(); … ephemeralSystemContext …`
- `grep -n "systemMessage" packages/agent-core/src/services/execution-stream.ts` returns no hit —
  the only system-message reference on that path is `ephemeralSystemContext` (SELFHOST-008 P3).
- Both entry points build the config identically (`packages/agent-core/src/core/robota-execution.ts`
  — `robotaRun` and `robotaRunStream`), so the divergence is entirely in the service layer.

Reporter's reproduction: one `Robota` constructed with a `systemMessage` that demands a fixed string
returns that string from `run('hi')` and an unrelated greeting from `runStream('hi')`. Passing a
`signal` makes no difference.

## Impact

Any streaming agent whose behavior is defined by a system prompt behaves as if unconfigured. The
reporter's multi-agent app renders every persona through `runStream()`; it also explains a workaround
they had accumulated — duplicating behavioral rules into the _user_ prompt because
"system-message-only instructions didn't stick".

`runStream()` is the default surface for interactive/TUI usage, so this is a correctness defect on
the most-used path, not an edge case.

## Direction

> **Contained — [CORE-042](CORE-042-the-execution-turn-is-implemented-twice.md)
> ([#1748](https://github.com/woojubb/robota/issues/1748)).** `finding-depth-triager` returned
> `DEPTH: FOUNDATIONAL` on this item's problem statement (2026-08-16). The cause is that agent-core
> implements one declared execution-turn contract twice: `executeStream` re-derives store setup,
> provider resolution, chat options, validation, commit and error classification inline instead of
> entering a shared seam, so every turn capability must be built twice and the forgotten copy fails
> silently. **This is the seventh instance** — six earlier commits are the identical "streaming
> dropped X, copy X in" patch (CORE-016, CORE-017, CORE-018, CORE-020, BEHAVIOR-005,
> SELFHOST-008 P3), two of them external reports against published betas.
>
> The Direction below is nevertheless what lands, as **labelled containment** rather than a fix for
> the cause: this is a live correctness defect in a published beta, so it must land first, it is the
> smallest change that keeps the tree honest, and it introduces no new abstraction — it routes the
> streaming path through the helper that already exists. The seam itself is CORE-042's work, planned
> with CORE-032 and CORE-033.

Do not add a second copy of the prompt-injection logic to `execution-stream.ts` — that is exactly how
the two paths drifted. Route the streaming path through the same session initialization the round
path uses (`initializeConversationStore`, or a shared extraction of it), so `config.systemMessage`,
the "inject once per session" rule (CORE-009/CORE-010) and the ephemeral-block contract are owned in
one place. Confirm the interaction with `Robota.updateSystemPrompt` (`core/robota.ts:317`) is
unchanged.

Related but distinct: CORE-032 (`runStream` is a single-round engine) covers the same file; check
whether the two are better delivered together against one shared session-preparation seam.

## Test Plan

- Unit/integration test asserting the provider receives a `system` message carrying
  `config.systemMessage` for **both** `run()` and `runStream()` — a shared table-driven test over the
  two entry points, so a future divergence fails rather than passing quietly.
- Test covering the resume case: a store that already holds a system message is not given a second
  one by the streaming path (the round path's `hasSystemMessage` guard must hold identically).
- Test covering `ephemeralSystemContext` on the streaming path still being appended to the derived
  provider-message array only, never written to the store.
- `pnpm harness:verify -- --scope packages/agent-core` green.
- `packages/agent-core/docs/SPEC.md` § System Prompt states the guarantee holds for both paths.

## User Execution Test Scenarios

Applies — this changes observable SDK behavior.

**Scenario 1 — the same system prompt survives streaming**

- Prerequisites: a provider API key (or an OpenAI-compatible gateway `baseURL`) exported in the
  environment; a workspace build (`pnpm build`).
- Environment: uses the existing examples surface — no new fixture required. Confirm at implementation
  time which example under `apps/`/`examples/` is the shortest streaming path; if none exists, the
  work adds a minimal script under the examples surface.
- Steps: construct one `Robota` with
  `systemMessage: 'Reply with exactly the string OK-APPLIED and nothing else.'`; call `run('hi')`,
  print the result; construct an identical agent, iterate `runStream('hi')`, concatenate the chunks,
  print the result.
- Expected observable result: both prints are `OK-APPLIED`. (Before the fix, only the first is.)
- Cleanup: none — no state is persisted.
- Evidence: _to be filled after implementation_ (paste both printed outputs).
