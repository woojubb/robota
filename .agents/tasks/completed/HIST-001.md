# HIST-001: 대화 히스토리 append-only — Task Breakdown

Spec: `.agents/spec-docs/done/HIST-001-append-only-conversation-history.md`

## Plan

- [x] TC-01: default (unbounded) `ConversationStore` retains 150 messages (oldest preserved)
- [x] TC-02: default `ConversationHistory` manager path is unbounded (150 retained)
- [x] TC-03: explicit positive cap (3) still trims (opt-in bounded buffer preserved)
- [x] TC-04: agent-core build + test + `pnpm typecheck` + `harness:scan` pass (no regressions)
- [x] `DEFAULT_MAX_MESSAGES_PER_CONVERSATION` 100 → 0 (unbounded/append-only)
- [x] `ConversationStore` constructor default 100 → 0

## Test Plan

The live agent conversation history silently dropped the oldest messages once chat-message count
exceeded 100 (`SimpleConversationHistory.applyMessageLimit` on every `addMessage`), losing context
independent of token usage — contradicting the documented append-only design and `feedback_history_
append_only`. Fix: default the live conversation store/manager to unbounded (0 = no count cap), so
history records everything and context size is managed solely by size-based compaction (which
summarizes via `clearHistory()` + `[Context Summary]`, auto at 83.5% or manual). The `applyMessageLimit`
mechanism is preserved for explicit `maxMessages > 0` opt-in (bounded buffers). Verified by unit tests
(150-message retention on the default store and the default manager path; explicit cap still trims) and
build/test/typecheck/scan across agent-core and its dependents — no regressions.
