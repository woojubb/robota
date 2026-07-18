---
status: in-progress
type: DATA
tags: [memory, auto-capture, session-lifecycle, agent-framework, selfhost, selfhost-008]
---

# SELFHOST-008 P2: wire the auto-capture pipeline into the live turn (per-turn, async, queue-by-default)

## Problem

Continues the SELFHOST-008 epic ([spec](../done/SELFHOST-008-durable-semantic-memory.md), P1 DONE — PR #1218)
toward [VISION.md](../../../VISION.md)'s "memory that **grows with you**". P1 landed the neutral `IMemoryStore`
port + fs reference adapter and routed BOTH memory consumers (startup injection + the `AutomaticMemoryController`
capture path) through it. But the capture path is **DORMANT**: `AutomaticMemoryController.capture()` is invoked
**nowhere** in any live session (`grep` across `packages/`+`apps/` finds zero non-test callers), and the
interactive turn loop (`interactive-session-execution-controller.ts` `executePrompt` → `onComplete`) never triggers
it. Concrete symptom: the extractor (`memory-candidate-extractor.ts`) + policy evaluator + sensitive-content filter
all ship and pass tests, yet after a real user↔assistant turn **no candidate is ever extracted, evaluated, queued,
or saved** — the auto-curated half of the differentiator does not fire. Only manual `/memory add` writes anything.
When Robota develops Robota, durable facts observed during a turn are silently lost. P2 wires the trigger — without
moving curation POLICY or any capture prompt into `packages/` (the neutrality guard, TC-06 of P1 + `HARNESS-029`).

## Prior Art Research

**Scope:** wiring an automatic post-turn memory-capture pipeline into a live coding-agent session — extract salient
durable facts after each turn, evaluate against a curation policy (auto-save / queue-for-approval / skip), persist
through a store, emit memory events. Robota already _ships_ the extractor + policy-evaluator + safety filter
(SELFHOST-008 P1) but they are **dormant**; P2's question is the _trigger + gating shape_.

### References consulted (product documentation)

- **Windsurf Cascade "Memories"** — auto-generated workspace memories: "During conversation, Cascade can
  automatically generate and store memories if it encounters context that it believes is useful to remember."
  Automatic, **no approval step**; model decides; workspace-scoped. Docs steer _durable_ knowledge to
  version-controlled Rules/AGENTS.md instead. No PII/secret-exclusion guidance.
  https://docs.windsurf.com/windsurf/cascade/memories
- **Cursor "Memories"** — "created by a background model that proposes a memory for you to approve before it's
  saved," project-scoped, reviewable in Settings — the one coding-IDE peer that chose **human-approval gating**.
  Memories was later **removed (v2.1.x) in favor of static Rules** (evidence that low-precision auto-capture erodes
  trust in a coding context). https://docs.cursor.com/en/context/memories · https://cursor.com/docs/context/rules
- **Mastra memory** — working memory: "persist new messages after the model responds" (post-turn); observational
  memory: **token-threshold** trigger (default 30k), **background pre-compute** with a `blockAfter` synchronous
  backpressure fallback; extraction is model-judged. https://mastra.ai/docs/memory/working-memory ·
  https://mastra.ai/docs/memory/observational-memory
- **OpenAI Agents SDK Sessions** — pluggable raw-turn-history persistence; `OpenAIResponsesCompactionSession` "can
  automatically compact after each turn based on `should_trigger_compaction`" — turn-history mgmt, not curated
  salience (contrast case). https://openai.github.io/openai-agents-python/sessions/
- **Anthropic Claude memory tool** — client-side CRUD memory the _model_ drives via tool calls; threshold-triggered
  preservation warns Claude to save important info before context is cleared.
  https://docs.claude.com/en/docs/agents-and-tools/tool-use/memory-tool
- **Letta / MemGPT** — agent **self-edits** memory in-loop (`core_memory_append/replace`, synchronous, model-judged)
  - **sleep-time compute** (async idle reflection). https://docs.letta.com/letta-agent/memory
- **Mem0** — per-turn: extraction LLM → atomic facts → embed → retrieve top-k → LLM routes ADD/UPDATE/DELETE/NOOP;
  async, model-judged, dedup-by-similarity. https://docs.mem0.ai/core-concepts/memory-evaluation
- **Zep / Graphiti** — after `memory.add()`, **asynchronous** extraction of entities+facts as bi-temporal graph
  edges with conflict resolution. https://help.getzep.com/v2/concepts
- **Nous Hermes** — agent-curated memory + cross-session FTS recall. https://hermes-agent.nousresearch.com/docs/

### Observed common shape

- **(a) WHEN.** Two dominant families — **per-turn / per-episode** right after the assistant responds (Mastra
  working memory, Mem0, Zep, Letta), or **threshold-triggered** (Mastra observational, Claude, OpenAI compaction).
  **End-of-session is NOT the common trigger.**
- **(b) auto-save vs approval.** Agent-memory frameworks default to **auto-save** (model = curator); the one
  coding-IDE peer (Cursor) chose **human-approval** and then retreated to Rules — auto-save is riskier in a coding
  workflow.
- **(c) salience.** Overwhelmingly **model-judged** (extraction/observer LLM or agent tool calls). None of the
  surveyed products document a pure keyword-heuristic extractor — Robota's v1 is a deliberate, cheaper delta.
- **(d) secrets/PII.** A **gap in the prior art** (Windsurf/Mastra docs carry no redaction guidance); Robota's
  `containsSensitiveMemoryContent` pre-persistence filter is ahead of documented peers.
- **(e) sync vs async.** **Async/background is the norm**; synchronous appears only as an in-loop model tool call or
  a backpressure safety-valve. Consensus: **never block the turn on capture.**

### Robota constraints / delta

- **Library-neutrality (binding):** capture POLICY (heuristics/thresholds) + any model-facing capture prompt live
  in the surface, not `packages/`; the library ships only the neutral WIRING SEAM + a _reference default_ policy
  (`memory-candidate-extractor.ts` / `memory-policy-evaluator.ts`'s `AUTO_SAVE_CONFIDENCE_THRESHOLD`, already
  present). P2 wires the trigger without moving policy into the library.
- **v1 extractor is keyword-heuristic, not model-judged** — cheap + LLM-free, so the latency tradeoff that dominates
  the prior art is largely moot for v1; capture is an **awaited** async call (post-P1R the `IMemoryStore` port is async)
  run before the turn's persist + MUST be try/catch-guarded so a bug never breaks turn completion / event flush. The
  lower precision motivates the conservative queue-by-default gate.
- The controller is **dormant today** — no split-brain to migrate; a clean wiring.

### Recommendation (adopted below)

**Per-turn, AWAITED-before-persist + guarded (never _breaking_ the turn), queue-by-default, filter-before-persist.**
(1) Trigger on turn completion, not end-of-session — coding sessions are long-lived and crash-prone, so incremental
capture avoids losing facts. (2) `await` the capture in the **execution controller's post-turn `finally`, immediately
before `persistSession()`** (NOT inside `onComplete` — `executePromptTurn` does not await `onComplete`, so awaiting
there would not order before the persist), on the completed-turn path only, wrapped in **try/catch → skip** so a capture
error never _fails_ the turn. Post-P1R the `IMemoryStore` port is **async**, so capture is an awaited async call — but it
is NOT fire-and-forget: the decisive property is **await-before-persist** (in the controller's own awaited `finally`), so
the just-recorded `memoryEvents` land in THIS turn's persisted record. A detached/fire-and-forget offload (or awaiting
inside the unawaited `onComplete`) would race the `finally` `persistSession()` and DROP those events (and, on one-shot
`-p`/Ctrl-C exit, could lose the durable write entirely) — so it is rejected. The v1 extractor is keyword-heuristic (LLM-free, sub-millisecond) + the fs adapter's async methods
wrap sync fs work, so awaiting adds negligible latency vs seconds of model latency. "Never break the turn" is satisfied
by the try/catch; correctness is satisfied by awaiting before the persist. (A future model-judged extractor or a real
semantic backend behind the async port stays an **awaited** step here — never a persist-racing detachment.) (3) Default policy
= `approval_required` (QUEUE), auto-save only above the confidence threshold — Robota's existing three-way policy; the
default is a **surface setting**, not a library mechanism change. (4) Run `containsSensitiveMemoryContent` before
persistence on **every** path. (5) Always emit `IMemoryEvent` for saved+queued. (6) Capture is **opt-in / adapter-gated**:
with no `automaticMemory` policy supplied by the surface, capture stays OFF (zero behavior change) — the trigger,
threshold, and gate default are surface-owned, consistent with the P1 neutrality guard + `HARNESS-029`.

## Architecture Review

### Affected Scope

- **`agent-framework` interactive turn loop (the wiring seam):** ordering caveat first — `executePromptTurn` does **NOT
  await** `onComplete` (`interactive-session-prompt.ts:46,107`: `onComplete: (result) => void`, called unawaited), so
  `await`-ing capture _inside_ `onComplete` would NOT order before the persist — it would be the raced Alternative 2.
  Therefore the capture is triggered from **`SessionExecutionController.executePrompt`'s own `finally`** (which IS an
  awaited async scope), **immediately before `this.callbacks.persistSession()`** (`interactive-session-execution-controller.ts`
  ~line 306) — and only on the **completed-turn path** (stash the `result` handed to `onComplete`; run capture only if a
  completed result was stashed, never on interrupted/error). It **`await`s** an INJECTED capture callback **wrapped in
  try/catch** (built from the injected async `IMemoryStore` (P1R) + a surface-supplied curation policy config); the
  callback extracts candidates from the turn's user (`displayInput ?? input`) + assistant (`result.response`) text, runs
  the evaluator (sensitive-content filter first), curates through the port, and records `IMemoryEvent`s via the history
  tracker (`interactive-session-history-tracker.ts` already owns `memoryEvents`). Awaiting it in the `finally` BEFORE
  `persistSession()` is what puts the captured events in the SAME turn's persisted record (a fire-and-forget, or awaiting
  inside the unawaited `onComplete`, would race and drop them). This is the NEUTRAL mechanism only.
- **capture-config threading:** an optional `automaticMemory?: IAutomaticMemoryConfig` (the existing type) is threaded
  through the interactive session options like `memoryStore` (P1) — `IInteractiveSessionStandardOptions` + `IInitOptions`.
  ADAPTER-GATED: absent ⇒ capture is OFF (no controller constructed, zero behavior change). The surface owns the
  policy/threshold; the library's `DEFAULT_AUTOMATIC_MEMORY_CONFIG` (`approval_required`) is the _reference default_
  the surface may pass or override — it is NOT auto-enabled.
- **`AutomaticMemoryController` reuse:** the capture callback reuses the P1-refactored controller (already reads/writes
  through `IMemoryStore`); no new store construction. Only its `capture()` is invoked post-turn + its events recorded.
- **NOT the library's job:** the trigger _policy_ (fire every turn vs threshold), the queue-vs-auto default, and any
  model-facing capture prompt are surface decisions. `packages/` gains only the seam that INVOKES the injected policy.
- **Persistence guarantee:** captured events already persist via the session record's `memoryEvents`
  (`interactive-session-persistence.ts` / `-restore.ts`), and durable saves go to `<cwd>/.robota/memory/` through the
  port — so a fact captured in one turn is durably present for a fresh session's recall (closing the P1 "cross-session
  recall" loop with actually-captured content).

### Alternatives Considered

1. **Per-turn AWAITED-before-persist + guarded capture in the controller's post-turn `finally` (immediately before
   `persistSession()`, completed-turn path only), try/catch → skip, opt-in via surface policy, queue-by-default,
   filter-before-persist (CHOSEN).**
   - ✅ Correct ordering: the controller's `finally` IS an awaited async scope, so `await`ing the capture there (records
     events + durable saves) runs BEFORE the turn's `persistSession()` — so
     captured `memoryEvents` land in the same turn's persisted record (no race, no lost-on-exit window). Post-P1R the
     `IMemoryStore` port is async, so capture is an awaited async call; the v1 extractor is keyword-heuristic (LLM-free)
     and the fs adapter wraps sync fs work, so awaiting adds negligible latency vs seconds of model latency — the "never
     block on an LLM call" concern does not apply. "Never _break_ the turn" is met by the try/catch. Reuses the dormant
     pipeline; adapter-gated (zero behavior change when not opted in); neutral (policy in the surface); non-destructive
     default (queue); sensitive filter stays a hard pre-persistence gate.
   - ❌ Keyword extractor is lower-precision than LLM peers (mitigated by queue-by-default + the deferred model-judged
     extractor in a later slice).
2. **Fire-and-forget — or awaiting capture inside `onComplete` (which `executePromptTurn` does NOT await).**
   - ✅ Literally matches the prior-art "go async, never block" consensus; zero added turn latency.
   - ❌ **RACES `persistSession()`.** `onComplete` is typed `=> void` and called unawaited (`interactive-session-prompt.ts:107`),
     and the controller's `finally` calls `persistSession()` after `executePromptTurn` resolves; so a detached capture —
     OR an `await` placed _inside_ the unawaited `onComplete` — records `memoryEvents` AFTER the persist serialized the
     record → captured events dropped from THIS turn's persisted state (survive only if a later turn re-persists; lost
     entirely on one-shot `-p`/Ctrl-C exit). The async port (P1R) does NOT justify detachment — the fix is to `await`
     capture in the controller's own `finally` before the persist (option 1). REJECTED (correctness).
3. **Awaited capture that lets errors propagate (no guard).**
   - ✅ Simplest; captured before persist.
   - ❌ A capture bug would then FAIL the user's turn — unacceptable. The try/catch in (1) is exactly the fix. REJECTED.
4. **End-of-session capture only.**
   - ✅ One capture per session; less frequent.
   - ❌ Prior art never makes end-of-session the sole trigger; long-lived crash-prone coding sessions would lose
     durable facts on crash/exit. REJECTED.
5. **Auto-enable capture in the library with a built-in auto-save default.**
   - ✅ Works out of the box with no surface wiring.
   - ❌ Moves the enable/gate POLICY into `packages/` (neutrality violation) and auto-saves low-precision keyword
     candidates unreviewed — the exact Cursor failure mode. REJECTED.

### Decision

Adopt (1): a post-turn, **awaited-before-persist, try/catch-guarded** capture trigger in the execution controller's
**post-turn `finally`, immediately before `persistSession()`** (completed-turn path only) — NOT inside `onComplete`
(which `executePromptTurn` does not await); the `finally` is the controller's own awaited scope, so awaiting capture
there lands the events in the same turn's persisted record — invoking an injected capture callback built from the
(now-async, P1R) `IMemoryStore` + a **surface-supplied** `automaticMemory?: IAutomaticMemoryConfig`, threaded through
the interactive session options exactly like `memoryStore` and **adapter-gated** (absent ⇒ OFF, zero behavior change).
The callback reuses the P1R-refactored async `AutomaticMemoryController.capture()` (extract → evaluate [sensitive-filter
first] → curate through the port), records `IMemoryEvent`s via the history tracker, and **never _breaks_ the turn**
(capture errors are caught and swallowed to a skip — the one sanctioned degradation, declared below). NOT
fire-and-forget: a detached capture would race the `finally` persist (see Alternative 2). Default policy = the library's existing `approval_required` reference default
(queue, not auto-save); the surface owns whether to enable and at what threshold. The sensitive-content filter runs
before persistence on every path.

### Validated Recommendation

- **Reachability + ORDERING (verified against code):** the assistant `result` is available at `onComplete`
  (`interactive-session-execution-controller.ts:281`), but `executePromptTurn` calls `onComplete` UNAWAITED
  (`interactive-session-prompt.ts:46` `=> void`, `:107` `ctx.onComplete(result)`), so capture must NOT be awaited there.
  The controller's `executePrompt` `finally` (~`:294-306`) IS an awaited async scope and runs `persistSession()` at
  `:306` — so the capture is triggered from that `finally`, immediately before `persistSession()` (stashing the
  completed `result` from `onComplete`), which is the point where an `await` genuinely orders before the persist. The
  history tracker owns `memoryEvents` (`interactive-session-history-tracker.ts:46-108`, `recordMemoryEvent` at `:268`)
  and persists them (`-persistence.ts`/`-restore.ts`); `memoryStore` is already threaded (P1). `automaticMemory` threads
  through the same options seam. (This corrects the iteration-1/P1R-realignment claim that awaiting inside `onComplete`
  suffices — it does not, because `onComplete` is unawaited; the GATE-APPROVAL re-review caught this.)
- **Capability preservation:** manual `/memory` + startup recall are unchanged (capture is additive + opt-in). The
  dormant controller is now reachable; nothing existing is removed. v1 keeps the keyword extractor; a model-judged
  extractor is a later slice.
- **Adversarial:** (a) capture blocking/slowing the turn → v1 capture is an awaited async call over sub-millisecond
  regex+fs work (no LLM call), negligible vs model latency, and try/catch-guarded so a bug can't break the turn —
  verified that AWAITING it before the `finally` persist is required to avoid dropping events (a detached fire-and-forget
  would race `persistSession()`);
  (b) secrets reaching the store → sensitive filter is a hard pre-persistence gate on every path; (c) low-precision
  auto-save eroding trust → queue-by-default, auto-save only above threshold, opt-in; (d) policy/prompt creeping into
  `packages/` → only the wiring seam lands in the library, the policy is surface-supplied (the `HARNESS-029` mechanical
  floor will fence this once P3/P4 inject prompt/content).

### Architecture Review Checklist

- [x] 영향 패키지/레이어: `agent-framework` only — the neutral post-turn wiring seam in the interactive execution
      controller + capture-config threading through the interactive session options (like `memoryStore`), reusing the
      P1-refactored `AutomaticMemoryController` + `IMemoryStore`. NO policy/prompt/content added to `packages/`. Surface
      (`agent-cli`/`apps/agent-app`) owns the enable decision + policy.
- [x] Sibling scan 완료 — mirrors the P1 `memoryStore` threading precedent (interactive options → controller) + the
      existing `IAutomaticMemoryConfig`/`AutomaticMemoryController` mechanism; adds no new escape hatch; the sole
      sanctioned degradation (capture-error → skip) is declared + `allow-fallback:`-annotated per HARNESS-028.
- [x] 대안 최소 2개 — 5 considered (per-turn AWAITED-before-persist+guarded CHOSEN; fire-and-forget REJECTED
      persist-race; awaited-unguarded REJECTED breaks-turn; end-of-session REJECTED loses facts; library-auto-enable
      REJECTED neutrality/trust), each Pro+Con.
- [x] 결정 근거 — per-turn trigger (prior-art) + AWAIT-before-persist guarded execution (post-P1R the IMemoryStore port
      is async; awaiting the capture before `persistSession()` puts events in the same record — a detached fire-and-forget
      would race it) + coding-context evidence (Cursor retreat → queue-by-default) + neutrality (policy surface-owned,
      adapter-gated OFF). GATE-APPROVAL iteration-1 REVISE (async→await-before-persist, race fix) + P1R async-port
      re-alignment applied. Re-review pending.

## Fallback & Degradation Declaration

**One sanctioned degradation:** post-turn capture is **awaited but MUST NOT break the turn** — the awaited capture call
**in the controller's post-turn `finally` (immediately before `persistSession()`)** is wrapped in try/catch, so if extraction / evaluation /
persistence throws (or rejects), the error is caught and the turn still completes normally (the candidate is skipped).
Turn integrity is sacrosanct: a memory-capture bug must never fail the user's turn. This is a guarded-degradation of an
ancillary, best-effort side task, NOT a silent alternative for core behavior. It is declared here, justified, and the
code site carries `// allow-fallback: <reason>` per HARNESS-028. No other fallback is introduced. (Note: capture is
awaited BEFORE the turn's `persistSession()`, so a caught error loses only that one turn's candidate — not the persisted
record; a detached fire-and-forget would instead race the persist, which is why it was rejected.)

## Solution

Add a neutral post-turn capture seam that, when the surface has opted in via `automaticMemory?: IAutomaticMemoryConfig`,
runs from the execution controller's post-turn `finally`, immediately before `persistSession()` (completed-turn path
only; NOT inside the unawaited `onComplete`), where it **`await`s a try/catch-guarded** capture callback built from the
injected async `IMemoryStore` (P1R) + the supplied policy: it extracts candidates from the turn's user+assistant text, evaluates them
(sensitive-content filter first, then policy → save/queue/skip), curates through the port, and records `IMemoryEvent`s
via the history tracker — a caught error skips the candidate but never breaks the turn. Adapter-gated: no `automaticMemory` ⇒ capture
OFF (zero behavior change). Reuses the P1R-refactored async `AutomaticMemoryController`; the policy/threshold/enable decision
is surface-owned (the library ships only the neutral seam + the existing `approval_required` reference default).

## Affected Files

| File                                                                                   | Change                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agent-framework/src/interactive/interactive-session-execution-controller.ts` | stash the completed `result` from `onComplete`; in the `executePrompt` `finally`, `await` the injected capture callback IMMEDIATELY BEFORE `persistSession()` (completed-turn path only), wrapped in try/catch → skip (turn never breaks) |
| `packages/agent-framework/src/interactive/interactive-session-options.ts`              | thread `automaticMemory?: IAutomaticMemoryConfig` through `IInteractiveSessionStandardOptions` + `IInitOptions` (like `memoryStore`)                                                                                                      |
| `packages/agent-framework/src/interactive/interactive-session-init.ts`                 | build the capture callback (reuse `AutomaticMemoryController` over the injected `memoryStore`) + wire it into the execution controller; gated                                                                                             |
| `packages/agent-framework/src/interactive/interactive-session-history-tracker.ts`      | record captured `IMemoryEvent`s (reuse the existing `memoryEvents` accumulator/recorder)                                                                                                                                                  |
| `packages/agent-framework/src/interactive/__tests__/…` (new)                           | TC-01..06 unit/functional tests on the capture wiring + gating + never-fail + sensitive filter                                                                                                                                            |
| `packages/agent-framework/docs/SPEC.md`                                                | document the opt-in post-turn capture seam + `automaticMemory` option                                                                                                                                                                     |

## Completion Criteria

- [ ] TC-01: with `automaticMemory` supplied, a completed turn triggers the capture path — a durable fact in the
      user+assistant text is extracted, evaluated, and curated through the injected `IMemoryStore`, and a memory event
      is recorded (functional test with a fake session/turn + fake store).
- [ ] TC-02a: capture is **guarded** — a capture callback that THROWS or REJECTS does NOT fail the turn (`'complete'`
      still emitted; the turn `submit()` resolves; no error escapes the controller's `finally`) (unit test with a
      throwing/rejecting callback).
- [ ] TC-02b: capture is recorded **in the same turn's persisted record — even when it resolves on a deferred tick** —
      a capture whose async work completes on a later microtask/macrotask still has its `IMemoryEvent` present in the
      session state serialized by THAT turn's `persistSession()`. The test MUST fail against a detached/unawaited capture
      (i.e. it asserts the await-before-persist edge, not incidental microtask ordering) (unit/functional test).
- [ ] TC-03: **adapter-gating** — with NO `automaticMemory` supplied, capture is OFF: no controller is constructed and
      no candidate is extracted/queued/saved for a turn (memory behavior unchanged) (unit test).
- [ ] TC-04: **sensitive-content refusal on the capture path** — a turn whose text contains a secret/PII yields NO
      durable save and NO queued candidate for that content (the evaluator's `containsSensitiveMemoryContent` gate runs
      before persistence) (unit test).
- [ ] TC-05: **gating default is non-destructive** — under the library reference default (`approval_required`), an
      extracted candidate is QUEUED (pending), not auto-saved; an above-threshold high-confidence candidate under
      `auto_save` policy is saved (unit test).
- [ ] TC-06 (**NEUTRALITY**): the capture trigger/policy default is surface-supplied; `packages/` gains only the wiring
      seam — no capture PROMPT/policy CONTENT added to the library (targeted grep/review; the mechanical floor remains
      the filed `HARNESS-029`, which gates the P3/P4 slice that first injects a capture prompt).

## Test Plan

| TC    | Verification                                                      | Type/Tool                       |
| ----- | ----------------------------------------------------------------- | ------------------------------- |
| TC-01 | completed turn → extract/evaluate/curate through the port + event | functional (fake session)       |
| TC-02 | throwing capture callback does NOT fail the turn                  | vitest unit                     |
| TC-03 | no `automaticMemory` ⇒ capture OFF (nothing captured)             | vitest unit                     |
| TC-04 | secret/PII in turn text ⇒ no save/queue (filter before persist)   | vitest unit                     |
| TC-05 | approval_required ⇒ queue; auto_save+high-confidence ⇒ save       | vitest unit                     |
| TC-06 | no capture prompt/policy content in `packages/`                   | grep/review (HARNESS-029 floor) |

## Tasks

[`.agents/tasks/SELFHOST-008-P2.md`](../../tasks/SELFHOST-008-P2.md) — created at GATE-IMPLEMENT; TC-01..06 slices +
option-B design notes + Test Plan.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-07-18

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft`; `type: DATA` (valid 11-prefix value); `tags:` present (non-empty array).
- Problem: concrete symptom — `AutomaticMemoryController.capture()` invoked nowhere (grep across `packages/`+`apps/` = zero non-test callers), extractor/policy/filter ship + pass tests yet no candidate is extracted/evaluated/queued/saved after a real turn; reproduction condition — after any live user↔assistant turn via `interactive-session-execution-controller.ts` `onComplete`; no TBD/TODO/vague single-sentence.
- Prior Art Research: `## Prior Art Research` present and substantiated — 9 product-doc citations (Windsurf Cascade, Cursor Memories, Mastra, OpenAI Agents SDK, Anthropic memory tool, Letta/MemGPT, Mem0, Zep/Graphiti, Nous Hermes) all with URLs; observed common shape (when/auto-vs-approval/salience/PII/sync-vs-async) feeds Alternatives + the adopted Recommendation (evidence-based, not asserted).
- Architecture Review Checklist: all 4 items `[x]`; Sibling scan `[x]` (mirrors P1 `memoryStore` threading precedent, sole degradation declared + HARNESS-028 annotated); Alternatives Considered = 4 entries each with Pro+Con; Decision references the trade-offs (per-turn+async+never-block consensus, Cursor retreat → queue-by-default, neutrality). New-surface placement N/A — no new package/app/surface; wiring seam within existing `agent-framework`.
- Completion Criteria: TC-01..TC-06 all TC-N prefixed; each observable/functional (extract/evaluate/curate, throwing-callback-does-not-fail-turn, adapter-gating OFF, sensitive-content refusal, non-destructive queue default, neutrality grep); no banned vague phrasing.
- Test Plan: `## Test Plan` present; 6 rows TC-01..TC-06 — count matches the 6 Completion Criteria; each row has non-empty Type/Tool (functional/vitest unit/grep-review), no "TBD".
- Structure: `## Tasks` present with placeholder; `## Evidence Log` was empty before this run; no `## Status`/`## Classification` body sections.
- Note: shared SELFHOST-008 ID prefix (P1 in spec-docs/done/) produces a non-blocking duplicate-ID warning; `harness:scan` 55/55 green.

## Evidence Log

- 2026-07-18 — **Drafted + GATE-WRITE PASS.** Prior-art (per-turn / async-norm / queue-by-default / filter-before-persist)
  substantiated by prior-art-researcher (9 product-doc refs). Grounded in the dormant capture pipeline
  (`AutomaticMemoryController.capture()` zero non-test callers) + the `onComplete` turn boundary.
- 2026-07-18 — **GATE-APPROVAL iteration 1: REVISE, applied.** Independent proposal-reviewer caught a load-bearing
  correctness defect: the literal "async fire-and-forget at `onComplete`" mechanism RACES the `finally`'s
  `persistSession()` and DROPS the just-recorded `memoryEvents` from the turn's persisted record (and can lose the
  durable write on one-shot `-p`/Ctrl-C exit). The prior-art async consensus is premised on an LLM/network-bound
  capture step, which does NOT hold for Robota's synchronous regex+fs v1. Fix applied: **synchronous, try/catch-guarded
  capture run INSIDE the awaited turn (before the persist)** — "never break the turn" via the try/catch, not deferral.
  Restructured Alternatives (async→REJECTED persist-race; sync-unguarded→REJECTED breaks-turn; sync-guarded CHOSEN),
  Decision, Adversarial (a), Fallback declaration, Solution, Affected Files, and split TC-02 into TC-02a (guarded throw)
  - TC-02b (event in the SAME turn's persisted record). Re-review pending.
- 2026-07-18 — **Architecture audit (mid-point, owner-requested).** `architecture-auditor` flagged the SHARED port
  (SELFHOST-008 P1, merged): (#1 HIGH) the `/memory` command path (`createCommandMemoryStores`) bypasses the injected
  `IMemoryStore` → split-brain when a surface swaps the store; (#2 HIGH) the sync-only port contradicts the async
  sandbox/retrieval precedents and can't host the async `ISemanticMemoryAdapter` without a breaking change → schedules,
  not avoids, the break. Recommended addressing async (#2) + command-wiring (#1) BEFORE P2 (which adds more callers on
  the same port). **P2 is HELD pending an owner course-correction decision on a port-remediation slice.**
- 2026-07-18 — **P1R async-port re-alignment (before GATE-APPROVAL re-review).** SELFHOST-008 P1R (PR #1220, merged)
  made `IMemoryStore` async. P2 reframed accordingly: capture is now an **awaited** async call at `onComplete` (not a
  synchronous call), but the load-bearing property is unchanged — it is **awaited BEFORE the `finally`'s
  `persistSession()`**, so captured `memoryEvents` land in the same turn's record; a detached fire-and-forget (rejected
  Alternative 2) would race the persist. `AutomaticMemoryController.capture()` is async post-P1R, so the seam awaits it.
  Recommendation/Alternatives/Decision/Adversarial/Fallback/Solution/Affected-Files/TC-02a updated sync→awaited. P2 is
  UNBLOCKED (the corrected async port is on develop). Re-review pending.
- 2026-07-18 — **GATE-APPROVAL re-review: REVISE, applied (REJECT-severity ordering defect).** The proposal-reviewer
  verified against code that `executePromptTurn` calls `onComplete` **UNAWAITED** (`interactive-session-prompt.ts:46`
  `=> void`, `:107`), so awaiting capture _inside_ `onComplete` would NOT order before `persistSession()` — it would be
  the raced Alternative 2 the spec rejects (events dropped from the turn's persisted record; total loss on `-p`/Ctrl-C).
  Fix (reviewer option B): trigger capture from the execution controller's own **`finally`** (an awaited async scope),
  **immediately before `persistSession()`** (`interactive-session-execution-controller.ts` ~:306), on the completed-turn
  path only (stash the `result` from `onComplete`). No `interactive-session-prompt.ts` contract change needed.
  Recommendation/Alternatives(1,2)/Decision/Affected-Scope/Validated-Reachability/Affected-Files/TC-02a/TC-02b updated;
  TC-02b strengthened to fail against a detached/deferred capture (asserts the await-before-persist edge). Re-review pending.

### [GATE-APPROVAL] — ✅ PASS | 2026-07-18

**Status upgrade:** review-ready → approved

- Prior-gate precondition: GATE-WRITE PASS present in the Evidence Log (dated 2026-07-18, `draft → review-ready`); frontmatter `status: review-ready`, file in `spec-docs/backlog/` — matches the expected input stage for GATE-APPROVAL.
- Independent design review (ENDORSE): the `proposal-reviewer` ran THREE iterations — (1) REVISE (async fire-and-forget races the `finally` `persistSession()` and drops the turn's `memoryEvents`); (2) REVISE (awaiting inside `onComplete` does not order before the persist because `executePromptTurn` calls `onComplete` UNAWAITED); (3) **ENDORSE**. Final verdict ENDORSE: the await-before-persist ordering genuinely holds via option B (capture in the execution controller's own awaited `finally`, immediately before `persistSession()`, completed-turn path only); all premises verified TRUE against code; no internal contradiction remains.
- Independent architecture validation (conditional): N/A — no new package/app/surface introduced and no layer/product-family reclassification; the change is a neutral post-turn wiring seam within the existing `agent-framework` package (new-surface placement recorded N/A at GATE-WRITE).
- No Architecture Review or frontmatter `type`/`tags` modified after approval.
- Owner sign-off (explicit approval, verbatim): **"P2 재개 (라이브 자동 캐프처)"** — the owner approved resumption + implementation of P2 live auto-capture (lifting the prior HELD-pending-owner-course-correction state), a direct authorization of this spec's design.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-18

**Status upgrade:** approved → in-progress

- Prior-gate precondition: GATE-APPROVAL PASS present in the Evidence Log (dated 2026-07-18, `review-ready → approved`); frontmatter `status: approved` — matches the expected input stage for GATE-IMPLEMENT.
- Tasks file created: `.agents/tasks/SELFHOST-008-P2.md` exists (verified on disk; untracked/new).
- Path recorded in spec: `## Tasks` section links `.agents/tasks/SELFHOST-008-P2.md` (created at GATE-IMPLEMENT; TC-01..06 slices + option-B design notes + Test Plan).
- Tasks map to Completion Criteria: task file `## Slices` carry one slice per TC-N — TC-01, TC-02a, TC-02b, TC-03, TC-04, TC-05, TC-06 — matching all Completion Criteria (incl. the split TC-02a/TC-02b).
- Test Plan present: task file has a `## Test Plan` section well over 50 chars (vitest unit/functional coverage for TC-01..06 + regression `typecheck`/suite/`harness:scan` + TC-06 grep/review).
- No implementation commits: latest touch to `interactive-session-execution-controller.ts` is REMOTE-014 (#1125, unrelated); no P2 source changes committed; only the new untracked tasks file and the backlog→todo spec move are pending.
