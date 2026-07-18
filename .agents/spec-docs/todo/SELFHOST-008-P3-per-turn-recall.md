---
status: approved
type: DATA
tags: [memory, recall, session-lifecycle, agent-framework, selfhost-008]
---

# SELFHOST-008 P3: wire per-turn durable-memory recall into the turn (ephemeral, push)

## Problem

Continues the SELFHOST-008 epic ([spec](../done/SELFHOST-008-durable-semantic-memory.md); P1 port DONE #1218,
P1R async remediation DONE #1220, P2 live auto-capture DONE #1221, HARNESS-029 neutrality floor DONE #1223) toward
[VISION.md](../../../VISION.md)'s "memory that **grows with you**". Durable memory is currently injected into the model
**only once, at session start**: `loadContext` (`context/context-loader.ts:119`) calls
`IMemoryStore.loadStartupMemory()` and its content becomes a STATIC `<project-memory>` system-prompt section assembled
once (`system-prompt-section-providers.ts:111` `createProjectMemorySection`). The **query-relevant recall** mechanism
exists but is **dead code**: `IMemoryStore.recall(query, budget)` + `AutomaticMemoryController.retrieve()` +
`renderRetrievedMemory()` (wraps text in `<project-memory>…</project-memory>`) have **zero live callers** (`grep`
across `packages/`+`apps/`, excluding tests/dist). Concrete symptom: as the durable store grows past what fits in the
startup budget, a fact relevant to the CURRENT turn is not surfaced unless it happened to be in the one-shot startup
slice — the "recall the right memory at the right moment" half of the differentiator never fires. This defect was
surfaced by the GATE-APPROVAL proposal-reviewer on the P4 (semantic-adapter) slice: a semantic backend would upgrade a
recall path that no running turn invokes. P3 wires per-turn recall FIRST (using the existing keyword store, immediately
observable); the semantic backend (P4) then lands on a live path. P3 keeps recall a NEUTRAL mechanism — the enable
decision + budget are surface-supplied, no memory CONTENT or prompt in `packages/` (the HARNESS-029-fenced invariant).

## Prior Art Research

**Topic:** wiring per-turn durable-memory RECALL (retrieve relevant memories per user turn and inject into model
context) vs. the current load-once-at-session-start static `<project-memory>` section.

### References consulted (product documentation)

- **Mem0 — Platform Overview / usage** (https://docs.mem0.ai/platform/overview, https://mem0.ai/): documented turn loop
  is "user turn → `memory.search(query=message, top_k=3)` → inject into the **system prompt** → call LLM → write turn
  back." Explicit guidance: inject as a **clearly-labeled system block, "not as fake history"**, and **cap injected
  memories to ~5–10**. Ships both a retriever **tool (pull)** and the **auto-inject (push)** pattern.
- **Zep — Retrieving Memory / Context Block** (https://help.getzep.com/retrieving-memory,
  https://help.getzep.com/retrieving-context.md): Context Block is **auto-assembled fresh each turn** via
  `thread.get_user_context()`, using the **last ~2 messages as the query**; explicit dedup — the long-term block is kept
  **separate from the last 4–6 raw messages** (short-term) to avoid overlap; regenerated per turn, **not persisted into
  history**; P95 <200ms.
- **Mastra — Semantic Recall / Memory class** (https://mastra.ai/docs/memory/semantic-recall,
  https://mastra.ai/reference/memory/memory-class): per-turn recall keyed on new messages; defaults `topK: 4`,
  `messageRange: {before:1, after:1}`; recalls past conversation _messages_ (outlier — injects into the message list),
  combined with the always-included recent window.
- **LangGraph / LangChain — Long-term memory** (https://docs.langchain.com/oss/python/langchain/long-term-memory,
  https://www.langchain.com/blog/semantic-search-for-langgraph-memory): "embed current query → `store.search(ns, query,
limit=k)` → inject top-k"; retrieved long-term facts **"almost always go into a SystemMessage, not a HumanMessage,"**
  framed as background context.
- **Letta / MemGPT — Memory management** (https://docs.letta.com/concepts/memory-management/): **core memory** =
  fixed-size, always in-context; **recall/archival** = out-of-context, retrieved **pull-style via tool calls**
  (`conversation_search`, `archival_memory_search`) — a two-tier always-in-context vs. searched-on-demand split.
- **Anthropic — Memory tool + Context editing** (https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool,
  https://platform.claude.com/docs/en/build-with-claude/context-editing): memory is **pull/tool-based**; when the tool is
  present the API auto-appends a system instruction to check memory first; context editing keeps active context small.
- **OpenAI Agents SDK — Sessions** (https://openai.github.io/openai-agents-python/sessions/): sessions auto-prepend prior
  conversation items each turn (recency, not semantic recall) — the "load full history" baseline.
- **Cursor — Memories** (https://docs.cursor.com/context/memories): two channels — a **recall tool (pull)** and
  **always-apply rules (push/static, injected at session start)**.

### Observed common shape

- **(a) Trigger + query.** For distilled durable memory, peers recall **every turn**, keyed on the **latest user
  message** (Mem0) or a **small last-N window** (Zep ~2). Threshold triggering is not the norm; pure-pull exceptions are
  Letta and Anthropic's memory tool.
- **(b) Injection placement.** Dominant pattern for retrieved _facts_ = a **labeled block in the system role,
  regenerated each turn and never written into message history** (Mem0 "system block, not fake history"; LangChain
  "SystemMessage not HumanMessage"; Zep fresh context block). Mastra (injects recalled _messages_) is the outlier.
  Tool-result placement is used only by the pull systems.
- **(c) Push vs pull.** For durable distilled memory peers lean **push/auto-inject** (Mem0, Zep, LangGraph, Cursor
  rules); pull is reserved for large/archival stores or agent-directed search. **Running both push-memory and a
  pull-RAG tool is an established pattern** (Mem0 ships both; Cursor recall-tool + rules).
- **(d) Dedup + budget.** Peers keep long-term recall **separate from always-present short-term/static content** (Zep
  long-term-block vs last-4–6-messages; Letta core-vs-recall). Budgets are **small** (Mem0 ~5–10; Mastra topK 4).
- **(e) Staleness/cache.** Per-turn injecters treat the block as **dynamic/regenerated, out of persisted history**;
  none mutate a _cached static_ system section each turn (prompt-cache friendliness).

### Recommendation for Robota (adopted below)

1. **Per-turn, query = latest user input.** Recall on every user turn, query = the turn's input (Mem0). No threshold.
2. **Ephemeral per-turn block, NOT a rebuilt system section.** Render via the existing `renderRetrievedMemory()` into a
   block that reaches the model for THIS turn only and is **not written to history** (neither the interactive history
   nor the session history) and **does not** mutate the cached startup `<project-memory>` section via
   `rebuildSystemMessage`. This satisfies "labeled block, not fake history" while keeping the static system prefix
   cache-friendly.
3. **Push for durable memory; keep the SELFHOST-003 RAG tool as pull.** Auto-inject the recall block; the on-demand
   codebase-retrieval tool stays a separate pull channel (running both is an endorsed pattern).
4. **Dedup with startup memory + small budget.** Exclude memory already present in the static startup section; budget
   small (topK ~3–5 + a char cap) through the existing `recall(query, budget)` signature.
5. **Prompt-cache/staleness.** Do not rebuild the system message per turn; the ephemeral block lives in the dynamic
   tail so the cached system prefix + early history stay valid, and recalled text never bloats history.

## Architecture Review

### Affected Scope

- **The recall query source + trigger (verified against code).** `executePromptTurn` (`interactive-session-prompt.ts:52`)
  receives the turn `input`; the execution controller's `executePrompt`
  (`interactive-session-execution-controller.ts:250`) already owns the store access pattern used by P2 capture
  (`getMemoryStore()` via callbacks) and runs before/after the turn. Per-turn recall is computed in the controller at
  the START of the turn (query = `input`), symmetric to the P2 capture callback at the end.
- **The ephemeral-injection seam (the key design point — corrected at GATE-APPROVAL, verified against code).** History
  records `displayInput ?? input` (`interactive-session-prompt.ts:60`), while the model receives
  `preparedPrompt.modelInput` via `session.run(modelInput, hookInput)` (`:85`). Crucially, **`agent-session` does NOT
  own model-call assembly — `agent-core` does**: `Session.run` (`agent-session/src/session.ts:176`) → `executeRun`
  (`session-run.ts:158` `ctx.robota.run(enrichedMessage, …)`) → `Robota.run` → `ExecutionService.execute`, which
  **persists the input via `conversationStore.addUserMessage(input, …)`** (`agent-core/src/services/execution-service.ts:160`);
  `IRunOptions` (`agent-core/src/interfaces/agent.ts:190`) has **no** system-context channel, and there is **no**
  existing transient/ephemeral system facility anywhere (the `<system-reminder>` path at `session-run.ts:119` _prepends
  to the message string → persisted_, so it is NOT an ephemeral precedent). Therefore neither prepending to `modelInput`
  (persists → "fake history"/bloat) nor a per-turn `rebuildSystemMessage`/`updateSystemPrompt` (cache invalidation)
  satisfies the requirement — and a `Session.run` option alone cannot, because the assembly + persistence live one layer
  deeper. **The primitive belongs on `agent-core`**: add `ephemeralSystemContext?: string` to `IRunOptions`, thread it
  `buildRunContext` (`core/robota-execution.ts:28`) → `IExecutionContext` → `ExecutionService.execute`, and inject it as
  a **transient system-role message in the provider request WITHOUT any `addUserMessage`/`addMessage`** — so it reaches
  the model for THIS call only, is never written to the conversation store, and does not mutate the cached static prefix.
  `agent-session.run(message, rawInput?, options?: { ephemeralSystemContext?: string })` becomes a **thin pass-through**
  of that primitive; the guarantee is owned by the layer that owns assembly. This is a **three-package** change
  (`agent-core` seam → `agent-session` pass-through → `agent-framework` wiring), deps one-way
  (`agent-framework → agent-session → agent-core`).
- **The recall block (neutral mechanism).** The controller calls `getMemoryStore().recall(input, budget)` →
  `renderRetrievedMemory()` → pass the result as `ephemeralSystemContext`. The `budget` (topK/char) and the enable flag
  are **surface-supplied** (a `recallMemory?` policy on the interactive session options, adapter-gated like
  `automaticMemory`); absent ⇒ recall is OFF (zero behavior change — memory keeps loading only at startup as today).
- **Dedup vs startup memory — DEFERRED for v1 (corrected at GATE-APPROVAL), with rationale.** The startup
  `<project-memory>` section is the rendered MEMORY.md **index** (`IStartupMemory.content` — topic summaries/links),
  whereas per-turn recall surfaces full topic **bodies** (`MemoryRetrievalService.retrieve` → per-topic `### name\n<body>`
  sections + a 1:1 `references[]` of `{topic, path, score, truncated}`). These are different granularities: title-level
  dedup of a recalled BODY because its summary/link appears in the index would suppress exactly the detail per-turn
  recall exists to provide (a near-no-op at best, actively wrong at worst). v1 therefore does **not** dedup against the
  startup index; the overlap is minimal (index summaries vs. bodies). A future body-level dedup (compare a recalled
  topic's full body against window content, filtering `references`/sections BEFORE `renderRetrievedMemory` since its
  whole-blob API cannot dedup post-hoc) is a documented deferral, not v1 scope.
- **NOT the library's job.** Whether to enable per-turn recall, the budget, and any content are surface decisions;
  `packages/` gains only the neutral seam + wiring. No memory CONTENT or prompt is added (HARNESS-029-fenced).
- **Capability preservation.** Startup `<project-memory>` injection, manual `/memory`, and P2 capture are unchanged;
  per-turn recall is additive + opt-in. This realizes the dead `recall()`/`renderRetrievedMemory()` path as a live one
  and is the path the P4 semantic decorator will upgrade.

### Alternatives Considered

1. **Per-turn recall (query = input) computed in the execution controller, injected as an EPHEMERAL block via a new
   `agent-core` `IRunOptions.ephemeralSystemContext` primitive (transient provider-request system message, NOT
   `addUserMessage`'d, no system rebuild), passed through `agent-session.run`, surface-budgeted + adapter-gated (CHOSEN).**
   - ✅ Matches prior-art (per-turn, labeled block, not-in-history, push); keeps the cached static system prefix intact
     (no per-turn system rebuild); no history bloat (ephemeral — never written to the conversation store); neutral
     (budget/enable surface-owned, adapter-gated OFF); reuses the P2 controller store-access pattern; the primitive lives
     in the layer that OWNS model-call assembly (`agent-core`), so the guarantee actually holds. Makes the dead recall
     path live — the P4 semantic decorator then upgrades a real path.
   - ❌ Three-package change (`agent-core` seam + `agent-session` pass-through + `agent-framework` wiring) — larger than
     first scoped, but correct: the ephemeral/cache-safe property is a model-assembly concern that only agent-core can
     honor. Deps stay one-way; the `IRunOptions` field is additive/optional (no existing caller changes).
2. **Add the seam to `agent-session.run` only (the first-draft placement) — REJECTED.**
   - ✅ Fewer packages touched.
   - ❌ FALSE-premise: `agent-session` is a thin caller; assembly + persistence live in `agent-core`
     (`ExecutionService.execute` → `addUserMessage`). A `Session.run` option could only fold the block into the
     persisted `input` (Alternative 3) or call `updateSystemPrompt` (Alternative 4) — neither ephemeral nor cache-safe.
     The GATE-APPROVAL review verified this against code. REJECTED (cannot deliver the guarantee at that layer).
3. **Prepend the rendered recall block to `modelInput` (no new seam).**
   - ✅ Zero agent-session change; simplest.
   - ❌ `Session.run` persists `message` into session history → the recalled text becomes permanent "fake history" and
     bloats every subsequent turn's context (the exact Mem0/Zep anti-pattern). REJECTED (correctness + bloat).
4. **Rebuild the system message each turn with a `<recalled-memory>` section via `rebuildSystemMessage`.**
   - ✅ Puts recall in the system role (LangChain-style); no agent-session change.
   - ❌ Mutating the system message every turn invalidates the prompt cache for the whole conversation prefix (prior-art
     (e)); also conflates the static startup section with dynamic recall. REJECTED (cache + separation).
5. **Pull-only: expose recall as a tool the model calls (like the SELFHOST-003 RAG tool), no auto-inject.**
   - ✅ Reuses the tool pattern; model decides when to recall.
   - ❌ Prior-art (c): durable distilled memory is push across peers; a pull-only durable memory relies on the model
     remembering to look, defeating "memory that grows with you." (Robota already HAS a pull RAG tool; this slice is the
     complementary push channel.) REJECTED for durable memory.
6. **End-of-P4 only: skip P3, wire recall together with the semantic decorator.**
   - ✅ One slice.
   - ❌ The reason for the split (owner decision): mixes the assembly/lifecycle concern (recall wiring) with the
     mechanism concern (semantic backend) in one slice, and delays any observable recall. REJECTED (layering + cadence).

### Decision

Adopt (1): compute per-turn recall in the execution controller (query = the turn `input`), render via the existing
`renderRetrievedMemory()`, and inject it as an **ephemeral per-turn block** through a new **`agent-core`
`IRunOptions.ephemeralSystemContext`** primitive — threaded `buildRunContext` → `IExecutionContext` →
`ExecutionService.execute` and emitted as a transient system-role message in the provider request **without any
`addUserMessage`/`addMessage`**, so it reaches the model for that call only, is **never persisted** to the conversation
store (nor pushed to the interactive history, which records `displayInput ?? input`), and does **not** rebuild the
cached static system section. `agent-session.run(message, rawInput?, options?: { ephemeralSystemContext?: string })` is
a thin pass-through of that primitive. The keyword `IMemoryStore` is the recall backend (the P4 semantic decorator
upgrades it later behind the same port). Recall is **adapter-gated**: a surface-supplied `recallMemory?` policy (enable

- budget) turns it on; absent ⇒ OFF (startup-only injection, zero behavior change). Budget is small (topK ~3–5 + char
  cap), surface-supplied. v1 does not dedup against the startup index (different granularity — see Affected Scope; a
  body-level dedup is a documented deferral). The concrete enable/budget/content decisions are surface-owned; `packages/`
  gains only the neutral seam + wiring (HARNESS-029-fenced).

### Validated Recommendation

- **Reachability + ORDERING + LAYER (verified against code):** the controller has `input` + `getMemoryStore()` at turn
  start; the model call is `session.run(modelInput, hookInput)` (`interactive-session-prompt.ts:85`) → `executeRun`
  (`session-run.ts:158`) → `Robota.run` → `ExecutionService.execute` → `conversationStore.addUserMessage`
  (`execution-service.ts:160`). Assembly + persistence are in **agent-core**, so the ephemeral primitive lives on
  `IRunOptions` (agent-core) — `agent-session.run` passes it through. Recall runs BEFORE the turn's `session.run`, so the
  block is present for the turn; it is never `addUserMessage`'d (absent from the conversation store) nor pushed to the
  interactive `history` (which uses `displayInput ?? input`).
- **Capability preservation:** startup injection + `/memory` + P2 capture unchanged; per-turn recall is additive +
  opt-in; the previously-dead `recall()`/`renderRetrievedMemory()` becomes a live, tested path.
- **Adversarial:** (a) recalled text bloating history → the agent-core primitive injects a transient provider-request
  message with no `addUserMessage`, so it is absent from the conversation store AND the interactive history (asserted by
  TC-02 + the agent-core TC-07); (b) prompt cache thrash → no per-turn system rebuild; the transient message rides the
  dynamic tail; (c) duplicate injection with startup memory → v1 does not dedup (index summaries vs recall bodies are
  different granularity; title-level dedup would suppress the value — deferred to a body-level dedup); (d) recall failure
  breaking the turn → declared degradation (skip injection, turn proceeds); (e) content/prompt creeping into `packages/`
  → only the neutral seam + wiring land; the `IRunOptions` field is a content-free string channel; budget/enable/content
  surface-owned; HARNESS-029 fences it.

### Implementation Notes (from GATE-APPROVAL ENDORSE)

- **Cache-safety claim scoped.** The unconditional guarantee is "**no per-turn rebuild of the cached static system
  section**" (the transient block is a separate per-call message, never a mutation of the static prefix). Whether the
  transient system message ALSO preserves provider prompt-cache depends on the provider (Anthropic-style APIs may hoist
  system content into a separate parameter and reposition it); the implementation verifies per-provider cache behavior
  and the spec does not over-claim beyond the no-rebuild guarantee.
- **Distinct recall label.** `renderRetrievedMemory()` currently wraps recall in `<project-memory>…</project-memory>` —
  the same tag as the static startup section. The per-turn recall block uses a **distinct label** (e.g.
  `<recalled-memory>`) so the model can tell the query-relevant bodies (tail) from the always-loaded index (head); this
  is a small render-parameter addition, a clarity nicety, not a correctness change.

### Architecture Review Checklist

- [x] 영향 패키지/레이어: **`agent-core`** (the `IRunOptions.ephemeralSystemContext` primitive — model-call assembly +
      persistence live here, so the ephemeral/cache-safe guarantee is owned at this layer) + `agent-session` (thin
      pass-through on `run`) + `agent-framework` (compute recall in the interactive execution controller, pass through
      the seam; thread a surface-supplied `recallMemory?` policy through the interactive session options like
      `automaticMemory`). Deps one-way (`agent-framework → agent-session → agent-core`). NO memory content/prompt in
      `packages/`; enable/budget surface-owned. (Corrected at GATE-APPROVAL: the first draft mislocated the seam in
      `agent-session`, which does not own assembly.)
- [x] Sibling scan 완료 — reuses the P2 controller store-access + options-threading precedent (`automaticMemory` →
      `recallMemory`), the existing `renderRetrievedMemory()`/`recall()` mechanisms, and the `<project-memory>` section
      convention; the sole degradation (recall-error → skip injection) is declared + `allow-fallback:`-annotated per
      HARNESS-028 (mirrors the blessed P2 capture degradation); the new `IRunOptions` field + `run` option are
      additive/optional (no existing caller changes).
- [x] 대안 최소 2개 — 6 considered (agent-core-seam CHOSEN; agent-session-only-seam REJECTED false-layer;
      prepend-to-modelInput REJECTED persist/bloat; per-turn system-rebuild REJECTED cache; pull-only REJECTED
      not-push-for-durable; skip-into-P4 REJECTED layering/cadence), each Pro+Con.
- [x] 결정 근거 — per-turn + labeled-block-not-history + push (prior-art (a)(b)(c)) + cache-safety (e) + dedup/budget
      (d) + neutrality (enable/budget surface-owned, adapter-gated OFF) + the owner "분할" decision (recall wiring is the
      assembly-layer concern, kept separate from the P4 mechanism-layer semantic backend). New-surface placement N/A —
      no new package/app/surface; additive seam + wiring within existing packages.

## Fallback & Degradation Declaration

**One sanctioned degradation:** per-turn recall is a **best-effort enhancement over the always-present startup memory**.
If `recall()` / rendering / dedup throws, the error is caught and the turn proceeds with **no ephemeral recall block**
(the turn still runs; startup `<project-memory>` is unaffected). Turn integrity is sacrosanct — a recall bug must never
fail the user's turn. This is a guarded degradation of an ancillary side task (declared here, `// allow-fallback: <reason>`-annotated
at the code site per HARNESS-028), NOT a silent alternative for core behavior. No other fallback is introduced.

## Solution

Add an ephemeral per-turn context primitive to **`agent-core`** — `IRunOptions.ephemeralSystemContext?: string`,
threaded through `buildRunContext` → `IExecutionContext` → `ExecutionService.execute` and emitted as a transient
system-role message in the provider request with **no `addUserMessage`/`addMessage`** (reaches the model for that call
only, never persisted) — expose it as a thin pass-through on `agent-session.run(message, rawInput?, options?)`, and wire
per-turn recall in the `agent-framework` interactive execution controller: at turn start, when the surface supplied a
`recallMemory?` policy, call `getMemoryStore().recall(input, budget)` → `renderRetrievedMemory()` → pass as
`ephemeralSystemContext` to the turn's `session.run`, wrapped in a try/catch that skips injection on error (never breaks
the turn). Adapter-gated: no `recallMemory` ⇒ recall OFF (startup-only injection, zero behavior change). v1 does not
dedup against the startup index (granularity mismatch — deferred). Keyword `IMemoryStore` is the backend; the P4
semantic decorator upgrades it behind the same port. The enable/budget/content are surface-owned; `packages/` gains only
the neutral seam + wiring.

## Affected Files

| File                                                                                                                 | Change                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agent-core/src/interfaces/agent.ts`                                                                        | add `ephemeralSystemContext?: string` to `IRunOptions` (content-free string channel; additive/optional)                                                                                      |
| `packages/agent-core/src/core/robota-execution.ts`                                                                   | thread `ephemeralSystemContext` through `buildRunContext` → `IExecutionContext`                                                                                                              |
| `packages/agent-core/src/services/execution-service.ts`                                                              | in `execute`, emit `ephemeralSystemContext` as a transient system-role message in the provider request — NO `addUserMessage`/`addMessage` (never persisted to the conversation store)        |
| `packages/agent-session/src/session.ts` (+ `session-run.ts`)                                                         | `run(message, rawInput?, options?: { ephemeralSystemContext?: string })` — thin pass-through to `IRunOptions.ephemeralSystemContext`                                                         |
| `packages/agent-framework/src/interactive/interactive-session-prompt.ts`                                             | thread an optional per-turn `ephemeralSystemContext` into the `session.run(...)` call (from the controller); interactive history still records `displayInput ?? input`                       |
| `packages/agent-framework/src/interactive/interactive-session-execution-controller.ts`                               | at turn start (gated on a supplied `recallMemory` policy), compute the budgeted recall block via `getMemoryStore().recall()` + `renderRetrievedMemory()`, try/catch → skip; pass to the turn |
| `packages/agent-framework/src/interactive/interactive-session-options.ts`                                            | thread a surface-supplied `recallMemory?` policy (enable + `IMemoryBudget`) through `IInteractiveSessionStandardOptions` (like `automaticMemory`)                                            |
| `packages/agent-core/src/__tests__/…` + `packages/agent-framework/src/interactive/__tests__/…` (new)                 | TC-01..07 — agent-core ephemeral-seam (reaches provider, not persisted), recall fires per turn, ephemeral, gating, guarded, budget, neutrality                                               |
| `packages/agent-core/docs/SPEC.md` + `packages/agent-session/docs/SPEC.md` + `packages/agent-framework/docs/SPEC.md` | document the ephemeral per-turn context primitive + pass-through + the opt-in per-turn recall wiring                                                                                         |

## Completion Criteria

- [ ] TC-01: with a `recallMemory` policy supplied, a turn calls `getMemoryStore().recall(input, budget)` and the
      rendered result reaches the model for that turn (functional test with a fake session/store — the recall block is
      present in the model call).
- [ ] TC-02: **ephemeral** — the recalled block is NOT written to the interactive history NOR the session history: after
      the turn, neither persisted history contains the recalled text (only `displayInput ?? input` + the assistant
      reply) (functional test — MUST fail if the block is prepended to `modelInput`).
- [ ] TC-03: **agent-core ephemeral seam** — a `run()` with `IRunOptions.ephemeralSystemContext` set reaches the
      provider request as a transient system-role message AND is absent from the conversation store after the run
      (`getHistory()` contains no such message); a `run()` without it is unchanged (unit test in agent-core).
- [ ] TC-04: **adapter-gating** — with NO `recallMemory` policy supplied, no per-turn recall runs (no `recall()` call,
      no block injected); memory behavior is exactly today's startup-only injection (unit test).
- [ ] TC-05: **guarded** — a `recall()`/render that THROWS does NOT fail the turn (the turn completes, model still
      called with no recall block) (unit test with a throwing store).
- [ ] TC-06: **budget respected** — recall is called with the surface-supplied `IMemoryBudget` (topK/char), and the
      rendered block honors the char cap (unit test).
- [ ] TC-07 (**NEUTRALITY**): `packages/` gains only the neutral seam + wiring — no memory CONTENT or capture/recall
      PROMPT added; enable/budget are surface-supplied; HARNESS-029 `memory-neutrality` scan green (scan + review).

## Test Plan

| TC    | Verification                                             | Type/Tool                       | Test reference                                                          |
| ----- | -------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------- |
| TC-01 | recall fires per turn; block reaches the model           | functional (fake session/store) | `interactive-session-recall.test.ts` › "TC-01 — per-turn recall fires"  |
| TC-02 | recalled block absent from interactive + session history | functional                      | same file › "TC-02 — ephemeral, not persisted" (fails if in modelInput) |
| TC-03 | ephemeralSystemContext reaches provider, not persisted   | vitest unit (agent-core)        | `execution-service` test › "TC-03 — ephemeral seam, not persisted"      |
| TC-04 | no `recallMemory` ⇒ no recall (startup-only, unchanged)  | vitest unit                     | same file › "TC-04 — adapter-gating"                                    |
| TC-05 | throwing recall does not fail the turn                   | vitest unit                     | same file › "TC-05 — guarded"                                           |
| TC-06 | recall called with the supplied budget; char cap honored | vitest unit                     | same file › "TC-06 — budget respected"                                  |
| TC-07 | no memory content/prompt in `packages/`                  | HARNESS-029 scan + review       | `pnpm harness:scan` (memory-neutrality) + file-set review               |

## Tasks

[`.agents/tasks/SELFHOST-008-P3.md`](../../tasks/SELFHOST-008-P3.md) — created at GATE-IMPLEMENT; slices S1–S6
(agent-core seam → agent-session pass-through → recall render label → controller wiring → ephemeral e2e → neutrality+docs)
mapped to TC-01..07 + the Test Plan.

## Evidence Log

_GATE entries appended by the pipeline._

### [GATE-WRITE] — ✅ PASS | 2026-07-18

**Status upgrade:** draft → review-ready

- Frontmatter: begins with `---`; `status: draft`; `type: DATA` (valid 11-prefix value); `tags:` present (`[memory, recall, session-lifecycle, agent-framework, selfhost-008]`).
- Problem: concrete symptom (dead code — `IMemoryStore.recall`/`AutomaticMemoryController.retrieve`/`renderRetrievedMemory` have zero live callers; startup-only static `<project-memory>` injection with cited file:line refs); reproduction condition (store grows past startup budget → current-turn-relevant fact never surfaced); no TBD/TODO/vague language.
- Prior Art Research: `## Prior Art Research` present; substantiated with ≥1 product-documentation citation (Mem0, Zep, Mastra, LangGraph/LangChain, Letta/MemGPT, Anthropic, OpenAI Agents SDK, Cursor — all product/API docs, not third-party source); findings (per-turn/query-latest, labeled-block-not-history, push-for-durable, dedup+small-budget, cache-friendliness) feed Alternatives + Decision as evidence-based recommendation.
- Architecture Review Checklist: all 4 items `[x]`; Sibling scan `[x]` with completion evidence (reuses P2 controller store-access + `automaticMemory` options-threading precedent, existing `renderRetrievedMemory()`/`recall()`, `<project-memory>` convention); Alternatives Considered has 5 entries each with Pro+Con (ephemeral-seam CHOSEN; prepend-to-modelInput / per-turn system-rebuild / pull-only / skip-into-P4 REJECTED); Decision references the driving trade-offs (prior-art (a)(b)(c)(d)(e) + neutrality + owner split decision). New-surface placement N/A — no new package/app/surface; additive seam + wiring within existing `agent-session`/`agent-framework`.
- Completion Criteria: TC-01..TC-07 all `TC-N`-prefixed, observable/command form, no banned vague phrasing.
- Test Plan: `## Test Plan` present; 7 rows (TC-01..TC-07) matching the 7 Completion Criteria; each row has non-empty Type/Tool and Test reference; no "manual"-only rows requiring extra Notes.
- Structure: Tasks section present with placeholder; Evidence Log present and empty at first run; no `## Status`/`## Classification` body sections.
- TC-N count: Completion Criteria (7) == Test Plan (7). Confirmed.
- Mechanical scans: `scan-spec-research.mjs` exit 0, `check-spec-doc-frontmatter.mjs` exit 0 (only expected non-blocking SELFHOST-008 duplicate-ID warn).

### [GATE-APPROVAL] — iteration 1: REVISE, applied | 2026-07-18

Independent `proposal-reviewer` verified all premises against code and returned REVISE with two load-bearing defects
(both fixed here, direction endorsed):

1. **False layer-ownership premise (central).** The spec claimed "the session layer owns model-call assembly," so the
   ephemeral seam belonged on `agent-session.run`. Verified FALSE: `Session.run` → `executeRun` → `Robota.run` →
   `ExecutionService.execute` → `conversationStore.addUserMessage` (`agent-core/src/services/execution-service.ts:160`);
   `IRunOptions` (agent-core) has no system-context channel and there is no existing transient-system facility (the
   `<system-reminder>` path prepends to the message string → persisted). A `Session.run` option alone could only persist
   the block (Alt 3) or mutate the cached system prompt (Alt 4) — neither ephemeral nor cache-safe. **Fix:** the
   primitive moves to **agent-core** (`IRunOptions.ephemeralSystemContext` → `buildRunContext` → `ExecutionService`,
   emitted as a transient provider-request system message with NO `addUserMessage`); `agent-session.run` is a thin
   pass-through. This is a **three-package** change (agent-core seam → agent-session pass-through → agent-framework
   wiring), deps one-way. Updated Affected Scope, Alternatives (added the mislocated-in-agent-session REJECTED entry, now
   6), Decision, Validated Recommendation, Checklist, Solution, Affected Files, and split the seam into agent-core TC-03.
2. **Dedup underspecified + granularity mismatch.** Startup `<project-memory>` is the MEMORY.md **index** (summaries);
   per-turn recall surfaces full topic **bodies** — title-level dedup would suppress the very detail recall exists to
   provide. **Fix:** v1 does NOT dedup against startup (rationale documented); a body-level dedup (filter references/
   sections before `renderRetrievedMemory`) is a documented deferral. Replaced the dedup TC-03 with the agent-core
   ephemeral-seam TC-03; adversarial (c) + Decision updated.

No-fallback compliance (recall-error → skip, mirrors the blessed P2 capture degradation), push-vs-pull coherence, and
the dead-code premise were verified TRUE. Re-review pending.

### [GATE-APPROVAL] — iteration 2: ENDORSE | 2026-07-18

Independent `proposal-reviewer` re-verified all premises against source and returned **ENDORSE**: (1a) agent-core owns
model-call assembly + persistence (`ExecutionService.execute` → `initializeConversationStore`/`addUserMessage`; round
loop builds the provider request from `conversationStore.getMessages()`), so the primitive is correctly located; (1b)
the insertion point is feasible — carry `ephemeralSystemContext` on `IExecutionContext` and build a derived
provider-message array at `executeRound` (persisted messages + transient block) with no `addMessage`, store never
mutated; `buildRunContext` is the exact spread-threading point; (1c) deps one-way, acyclic
(`agent-framework → agent-session → agent-core`; agent-core has no `@robota-sdk/*` deps). Dedup deferral is a sound v1
call, not a correctness hole. Dead-code / no-fallback / push-vs-pull / nothing-unreachable all re-confirmed TRUE; the
iteration-1 Evidence Log entry is accurate. Two minor non-blocking cautions folded into **Implementation Notes**
(cache-safety wording scoped to the no-rebuild guarantee; distinct `<recalled-memory>` label). Rule-alignment: dep
direction, HARNESS-029 neutrality (TC-07), HARNESS-028 no-fallback, SSOT/ownership, architecture-placement (N/A) — all
aligned. Awaiting owner sign-off to complete GATE-APPROVAL.

### [GATE-APPROVAL] — ✅ PASS | 2026-07-18

**Status upgrade:** review-ready → approved

- Prior-gate precondition: `### [GATE-WRITE] — ✅ PASS | 2026-07-18` entry present in this Evidence Log; frontmatter `status: review-ready` and file in `spec-docs/backlog/` — matches the expected input stage for GATE-APPROVAL. In order.
- Explicit approval in current conversation: the owner answered the GATE-APPROVAL question with **"승인 (추천)"** — a direct, unambiguous statement authorizing implementation of this P3 design ("승인" is a listed valid approval form).
- Approval directed at this spec: yes — it answers the GATE-APPROVAL question for SELFHOST-008 P3 (per-turn durable-memory recall), not a different item or a clarifying question.
- No Architecture Review / frontmatter type/tags modified after approval: the two proposal-reviewer iterations (REVISE→ENDORSE) and all Architecture Review edits predate the sign-off; nothing changed after approval.
- Independent design review (recorded): `proposal-reviewer` ran two iterations — iteration 1 **REVISE** (false layer-ownership premise → ephemeral seam relocated from `agent-session` to `agent-core` `IRunOptions.ephemeralSystemContext`; dedup granularity mismatch → v1 dedup deferred) and iteration 2 **ENDORSE** (agent-core owns model-call assembly/persistence, insertion point feasible with no conversation-store write, deps one-way acyclic, dead-code/no-fallback/push-vs-pull all TRUE; two minor cautions folded into Implementation Notes). Both iteration entries present above.
- Independent architecture validation (conditional): **N/A** — no new package / app / presentation surface and no layer/product-family reclassification (additive `IRunOptions` seam + pass-through + wiring within existing `agent-core`/`agent-session`/`agent-framework`). New-surface placement recorded N/A in the Architecture Review Checklist. Conditional criterion does not apply.
