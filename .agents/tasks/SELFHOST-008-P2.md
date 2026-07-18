# SELFHOST-008 P2 — wire the auto-capture pipeline into the live turn

Spec: [`.agents/spec-docs/todo/SELFHOST-008-P2-live-auto-capture.md`](../spec-docs/todo/SELFHOST-008-P2-live-auto-capture.md)
GATE-WRITE: PASS. GATE-APPROVAL: PASS (proposal-reviewer ENDORSE iteration 3; owner sign-off "P2 재개 (라이브 자동 캐프처)").
GATE-IMPLEMENT: in progress. Builds on the corrected async `IMemoryStore` port (P1R, #1220).

## Design (ENDORSED — option B)

The dormant `AutomaticMemoryController.capture()` is triggered per-turn from the execution controller's own awaited
`finally` (`SessionExecutionController.executePrompt`), **immediately before `this.callbacks.persistSession()`**, on the
**completed-turn path only** (stash the `result` handed to `onComplete`; run only if a completed result was stashed —
never on interrupted/error). `await`ed there (the `finally` is an awaited scope) so captured `memoryEvents` land in the
SAME turn's persisted record — NOT inside `onComplete`, which `executePromptTurn` does not await (awaiting there would
race the persist). Wrapped in try/catch → skip so a capture bug never breaks the turn. Adapter-gated: with no
`automaticMemory?: IAutomaticMemoryConfig` supplied by the surface, capture is OFF (zero behavior change).

## Slices (map to Completion Criteria)

- [ ] **TC-01 — capture fires on a completed turn.** With `automaticMemory` supplied, a completed turn extracts +
      evaluates + curates a durable fact through the injected async `IMemoryStore` and records a memory event.
- [ ] **TC-02a — guarded (never breaks the turn).** A capture callback that throws/rejects does not fail the turn
      (`'complete'` emitted; `submit()` resolves; no error escapes the controller's `finally`).
- [ ] **TC-02b — recorded in the SAME turn's persisted record, even on a deferred tick.** A capture that resolves on a
      later microtask/macrotask still has its `IMemoryEvent` in the state serialized by that turn's `persistSession()`;
      the test MUST fail against a detached/unawaited capture (asserts the await-before-persist edge).
- [ ] **TC-03 — adapter-gating.** No `automaticMemory` ⇒ capture OFF: no controller constructed, nothing
      extracted/queued/saved for a turn (memory behavior unchanged).
- [ ] **TC-04 — sensitive-content refusal.** A turn whose text contains a secret/PII yields NO save and NO queued
      candidate for that content (evaluator's `containsSensitiveMemoryContent` runs before persistence).
- [ ] **TC-05 — gating default non-destructive.** Under `approval_required` an extracted candidate is QUEUED (pending),
      not auto-saved; an above-threshold high-confidence candidate under `auto_save` is saved.
- [ ] **TC-06 — NEUTRALITY.** The trigger/policy default is surface-supplied; `packages/` gains only the wiring seam
      (no capture PROMPT/policy CONTENT); the mechanical floor stays the filed HARNESS-029 (gates P3/P4).

## Implementation notes

- `executePrompt` `finally` (`interactive-session-execution-controller.ts` ~:294-306) already `await`s
  `finalizeEditCheckpointTurn()` then `persistSession()` at ~:306. Stash the completed `result` in `onComplete`
  (`:281`); in the `finally`, before `persistSession()`, if a completed result is stashed and a capture callback is
  configured, `await captureCallback({ userMessage: displayInput ?? input, assistantMessage: result.response, ... })`
  inside try/catch.
- The capture callback is built in `interactive-session-init.ts` (reuse `AutomaticMemoryController` over the injected
  `memoryStore` + the `automaticMemory` config) and injected into the execution controller; gated on `automaticMemory`.
- `automaticMemory?: IAutomaticMemoryConfig` threads through `IInteractiveSessionStandardOptions` + `IInitOptions` like
  `memoryStore` (P1); forwarded in `interactive-session-init.ts:295`-style spread.
- Record events via the history tracker's `recordMemoryEvent` (already owns `memoryEvents`, persisted).

## Test Plan

- **vitest unit/functional** (agent-framework `interactive/__tests__/`): TC-01 capture fires (fake session + injected
  fake store + deterministic extractor); TC-02a throwing/rejecting callback doesn't fail the turn; TC-02b event in the
  same-turn persisted record even when capture resolves on a deferred tick (fails against a detached capture); TC-03
  no-config ⇒ OFF; TC-04 sensitive text ⇒ no save/queue; TC-05 approval_required ⇒ queue / auto_save+high-conf ⇒ save.
- **regression**: `pnpm --filter @robota-sdk/agent-framework typecheck` + agent-framework suite + `pnpm harness:scan`.
- **TC-06**: grep/review (no capture prompt/policy content in `packages/`); HARNESS-029 remains the mechanical floor.

## Affected Files

Per the spec Affected Files table: `interactive/interactive-session-execution-controller.ts` (stash result + capture in
finally before persist), `interactive/interactive-session-options.ts` (`automaticMemory?`), `interactive/interactive-session-init.ts`
(build + inject the capture callback, gated), `interactive/interactive-session-history-tracker.ts` (record events),
`interactive/__tests__/…` (new), `docs/SPEC.md`.
