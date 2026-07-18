---
status: review-ready
type: DATA
tags: [memory, recall, session-lifecycle, agent-framework, selfhost-008]
---

# SELFHOST-008 P3: wire per-turn durable-memory recall into the turn (ephemeral, push, deduped)

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
- **The ephemeral-injection seam (the key design point, verified against code).** History records
  `displayInput ?? input` (`interactive-session-prompt.ts:60`), while the model receives
  `preparedPrompt.modelInput` via `session.run(modelInput, hookInput)` (`:85`); `Session.run(message, rawInput?)`
  (`agent-session/src/session.ts:176`) **persists `message` into the session history** and has **no per-call
  ephemeral-context argument**. Therefore neither prepending to `modelInput` (persists → history bloat / "fake
  history") nor a per-turn `rebuildSystemMessage` (prompt-cache invalidation) satisfies the requirement. P3 adds a
  **minimal ephemeral per-turn context seam**: `Session.run(message, rawInput?, options?: { ephemeralSystemContext?: string })`
  includes the provided context in THIS turn's model call (as a transient system-role addendum, positioned to preserve
  the cached static prefix) and **never writes it to the session history**. This is a layer-appropriate addition — the
  session layer owns model-call assembly; a per-turn transient context is a session-layer concern — and is reusable by
  any future dynamic per-turn context.
- **The recall block (neutral mechanism).** The controller calls `getMemoryStore().recall(input, budget)` →
  `renderRetrievedMemory()` → **dedup** against the startup `<project-memory>` content (by topic/reference) → pass the
  result as `ephemeralSystemContext`. The `budget` (topK/char) and the enable flag are **surface-supplied** (a
  `recallMemory?` policy on the interactive session options, adapter-gated like `automaticMemory`); absent ⇒ recall is
  OFF (zero behavior change — memory keeps loading only at startup as today).
- **NOT the library's job.** Whether to enable per-turn recall, the budget, and any content are surface decisions;
  `packages/` gains only the neutral seam + wiring. No memory CONTENT or prompt is added (HARNESS-029-fenced).
- **Capability preservation.** Startup `<project-memory>` injection, manual `/memory`, and P2 capture are unchanged;
  per-turn recall is additive + opt-in. This realizes the dead `recall()`/`renderRetrievedMemory()` path as a live one
  and is the path the P4 semantic decorator will upgrade.

### Alternatives Considered

1. **Per-turn recall (query = input) computed in the execution controller, injected as an EPHEMERAL block via a new
   `Session.run` `ephemeralSystemContext` option (not persisted, not a system rebuild), deduped vs startup memory,
   surface-budgeted + adapter-gated (CHOSEN).**
   - ✅ Matches prior-art (per-turn, labeled block, not-in-history, push); keeps the cached static system prefix intact
     (no per-turn `rebuildSystemMessage`); no history bloat (ephemeral); neutral (budget/enable surface-owned,
     adapter-gated OFF); reuses the P2 controller store-access pattern; the new seam is a clean, reusable session-layer
     primitive. Makes the dead recall path live — the P4 semantic decorator then upgrades a real path.
   - ❌ Adds one small API to `agent-session` (`run` options) — a two-package change, but tightly scoped and
     layer-clean (session owns model-call assembly).
2. **Prepend the rendered recall block to `modelInput` (no new seam).**
   - ✅ Zero agent-session change; simplest.
   - ❌ `Session.run` persists `message` into session history → the recalled text becomes permanent "fake history" and
     bloats every subsequent turn's context (the exact Mem0/Zep anti-pattern). REJECTED (correctness + bloat).
3. **Rebuild the system message each turn with a `<recalled-memory>` section via `rebuildSystemMessage`.**
   - ✅ Puts recall in the system role (LangChain-style); no agent-session change.
   - ❌ Mutating the system message every turn invalidates the prompt cache for the whole conversation prefix (prior-art
     (e)); also conflates the static startup section with dynamic recall. REJECTED (cache + separation).
4. **Pull-only: expose recall as a tool the model calls (like the SELFHOST-003 RAG tool), no auto-inject.**
   - ✅ Reuses the tool pattern; model decides when to recall.
   - ❌ Prior-art (c): durable distilled memory is push across peers; a pull-only durable memory relies on the model
     remembering to look, defeating "memory that grows with you." (Robota already HAS a pull RAG tool; this slice is the
     complementary push channel.) REJECTED for durable memory.
5. **End-of-P4 only: skip P3, wire recall together with the semantic decorator.**
   - ✅ One slice.
   - ❌ The reason for the split (owner decision): mixes the assembly/lifecycle concern (recall wiring) with the
     mechanism concern (semantic backend) in one slice, and delays any observable recall. REJECTED (layering + cadence).

### Decision

Adopt (1): compute per-turn recall in the execution controller (query = the turn `input`), render via the existing
`renderRetrievedMemory()`, **dedup** against the startup `<project-memory>` content, and inject it as an **ephemeral
per-turn block** through a new minimal `Session.run(message, rawInput?, options?: { ephemeralSystemContext?: string })`
seam that includes the block in that turn's model call but **never persists it** to session or interactive history and
does **not** rebuild the cached static system section. The keyword `IMemoryStore` is the recall backend (the P4 semantic
decorator upgrades it later behind the same port). Recall is **adapter-gated**: a surface-supplied `recallMemory?`
policy (enable + budget) turns it on; absent ⇒ OFF (startup-only injection, zero behavior change). Budget is small
(topK ~3–5 + char cap), surface-supplied. The concrete enable/budget/content decisions are surface-owned; `packages/`
gains only the neutral seam + wiring (HARNESS-029-fenced).

### Validated Recommendation

- **Reachability + ORDERING (verified against code):** the controller has `input` + `getMemoryStore()` at turn start;
  the model call is `session.run(modelInput, hookInput)` (`interactive-session-prompt.ts:85`); `Session.run`
  (`session.ts:176`) persists `message` and takes no ephemeral arg — hence the new option. Recall runs BEFORE
  `executePromptTurn`'s `session.run`, so the block is present for the turn; it is never pushed to `history`
  (which uses `displayInput ?? input`) nor to session history (the new seam excludes it).
- **Capability preservation:** startup injection + `/memory` + P2 capture unchanged; per-turn recall is additive +
  opt-in; the previously-dead `recall()`/`renderRetrievedMemory()` becomes a live, tested path.
- **Adversarial:** (a) recalled text bloating history → ephemeral seam keeps it out of both histories (asserted by a
  TC); (b) prompt cache thrash → no per-turn system rebuild; block rides the dynamic tail; (c) duplicate injection with
  startup memory → dedup vs the startup section before render; (d) recall failure breaking the turn → declared
  degradation (skip injection, turn proceeds); (e) content/prompt creeping into `packages/` → only the neutral seam +
  wiring land; budget/enable/content surface-owned; HARNESS-029 fences it.

### Architecture Review Checklist

- [x] 영향 패키지/레이어: `agent-session` (a minimal `Session.run` ephemeral-context option — model-call assembly is
      the session layer's job) + `agent-framework` (compute recall in the interactive execution controller, dedup vs
      startup, pass through the seam; thread a surface-supplied `recallMemory?` policy through the interactive session
      options like `automaticMemory`). NO memory content/prompt in `packages/`; enable/budget surface-owned.
- [x] Sibling scan 완료 — reuses the P2 controller store-access + options-threading precedent (`automaticMemory` →
      `recallMemory`), the existing `renderRetrievedMemory()`/`recall()` mechanisms, and the `<project-memory>` section
      convention; the sole degradation (recall-error → skip injection) is declared + `allow-fallback:`-annotated per
      HARNESS-028; the new `run` option is additive/optional (no existing caller changes).
- [x] 대안 최소 2개 — 5 considered (ephemeral-seam CHOSEN; prepend-to-modelInput REJECTED persist/bloat; per-turn
      system-rebuild REJECTED cache; pull-only REJECTED not-push-for-durable; skip-into-P4 REJECTED layering/cadence),
      each Pro+Con.
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

Add a minimal ephemeral per-turn context seam to `agent-session` (`Session.run(message, rawInput?, options?:
{ ephemeralSystemContext?: string })` — included in the turn's model call, never persisted to history) and wire per-turn
recall in the `agent-framework` interactive execution controller: at turn start, when the surface supplied a
`recallMemory?` policy, call `getMemoryStore().recall(input, budget)` → `renderRetrievedMemory()` → dedup against the
startup `<project-memory>` content → pass as `ephemeralSystemContext` to the turn's `session.run`, wrapped in a
try/catch that skips injection on error (never breaks the turn). Adapter-gated: no `recallMemory` ⇒ recall OFF
(startup-only injection, zero behavior change). Keyword `IMemoryStore` is the backend; the P4 semantic decorator
upgrades it behind the same port. The enable/budget/content are surface-owned; `packages/` gains only the neutral seam +
wiring.

## Affected Files

| File                                                                                   | Change                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agent-session/src/session.ts`                                                | add optional `run(message, rawInput?, options?: { ephemeralSystemContext?: string })` — include the context in this turn's model call, NEVER persist to history                                      |
| `packages/agent-framework/src/interactive/interactive-session-prompt.ts`               | thread an optional per-turn `ephemeralSystemContext` into the `session.run(...)` call (from the controller); history still records `displayInput ?? input`                                           |
| `packages/agent-framework/src/interactive/interactive-session-execution-controller.ts` | at turn start (gated on a supplied `recallMemory` policy), compute the deduped/budgeted recall block via `getMemoryStore().recall()` + `renderRetrievedMemory()`, try/catch → skip; pass to the turn |
| `packages/agent-framework/src/interactive/interactive-session-options.ts`              | thread a surface-supplied `recallMemory?` policy (enable + `IMemoryBudget`) through `IInteractiveSessionStandardOptions` (like `automaticMemory`)                                                    |
| `packages/agent-framework/src/interactive/__tests__/…` (new)                           | TC-01..07 — recall fires per turn, ephemeral (absent from persisted history), dedup vs startup, gating, guarded, budget, neutrality                                                                  |
| `packages/agent-session/docs/SPEC.md` + `packages/agent-framework/docs/SPEC.md`        | document the ephemeral per-turn context seam + the opt-in per-turn recall wiring                                                                                                                     |

## Completion Criteria

- [ ] TC-01: with a `recallMemory` policy supplied, a turn calls `getMemoryStore().recall(input, budget)` and the
      rendered result reaches the model for that turn (functional test with a fake session/store — the recall block is
      present in the model call).
- [ ] TC-02: **ephemeral** — the recalled block is NOT written to the interactive history NOR the session history: after
      the turn, neither persisted history contains the recalled text (only `displayInput ?? input` + the assistant
      reply) (functional test — MUST fail if the block is prepended to `modelInput`).
- [ ] TC-03: **dedup with startup memory** — a memory already present in the static startup `<project-memory>` section is
      NOT injected again by per-turn recall (unit test with overlapping startup + recall content).
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
| TC-03 | startup-duplicated memory not re-injected                | vitest unit                     | same file › "TC-03 — dedup vs startup"                                  |
| TC-04 | no `recallMemory` ⇒ no recall (startup-only, unchanged)  | vitest unit                     | same file › "TC-04 — adapter-gating"                                    |
| TC-05 | throwing recall does not fail the turn                   | vitest unit                     | same file › "TC-05 — guarded"                                           |
| TC-06 | recall called with the supplied budget; char cap honored | vitest unit                     | same file › "TC-06 — budget respected"                                  |
| TC-07 | no memory content/prompt in `packages/`                  | HARNESS-029 scan + review       | `pnpm harness:scan` (memory-neutrality) + file-set review               |

## Tasks

_Created at GATE-IMPLEMENT._

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
