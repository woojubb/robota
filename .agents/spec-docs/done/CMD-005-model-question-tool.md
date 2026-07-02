---
status: done
type: FLOW
tags: [tools, interaction, tui, cli]
---

# CMD-005: model-invocable question tool (`AskUserQuestion`) on the CMD-004 ask seam

> Consumes the CMD-004 action/UI separation (done). CMD-004 deliberately deferred the model path:
> `IToolExecutionContext.ask` exists but is never populated, and `createUserInteractionPort` resolves
> model-invoked **command** asks as `cancelled`, noting "letting the model issue an interactive ask is
> CMD-005's separate design".

## Problem

The agent (model) cannot solicit a structured answer from the user mid-conversation. When a task hits
a genuine decision point (ambiguous requirement, destructive choice, product direction), the model can
only guess or dump prose questions into the transcript — there is no dialog, no structured answer, no
multi-select, no free-text capture.

Reproduction: in the TUI, prompt the model with an ambiguous request ("delete the old configs" with
several candidates); it either proceeds on a guess or asks in prose and the turn ends. Nothing renders
the existing ask dialog (`PendingActionPrompt`), because no tool issues an `IActionRequest`.

Everything below the tool already exists (CMD-004): the `IActionRequest`/`TActionResponse` SSOT
(agent-core `interfaces/interaction.ts`), the `askUser` channel seam rendered by the TUI as an Ink
dialog (queued — works mid-turn, same mechanism as permission prompts), the programmatic
`queueUserAction` pre-answer, and the typed-but-unpopulated `IToolExecutionContext.ask` port.

## Architecture Review

### Affected Scope

- **New (tool):** `packages/agent-tools/src/builtins/ask-user-question-tool.ts` — a built-in tool
  (sibling of `shell-tool.ts`) whose executor consumes `context.ask`. Pure: no new deps; maps its
  schema onto the existing `IActionRequest` (SSOT — no parallel taxonomy).
- **Wired (context injection):** the session's per-tool-call context assembly (the same seam that
  injects `eventService`/`executionId`, framework → session → `ToolExecutionService.execute`) also
  injects `ask` from the session's CMD-004 `askHandler`. Headless/print mode injects no handler →
  `context.ask` stays `undefined` (already the contract's documented absence semantics).
- **Unchanged:** `agent-transport-tui` (the queued `PendingActionPrompt` already renders every
  `IActionRequest` kind — single/multi/free-text/masked); `agent-transport` programmatic channel
  (`queueUserAction` pre-answers); the command-path model-invocation guard in
  `user-interaction-port.ts` stays (commands remain non-interactive when model-invoked — the tool is
  the one model path).
- **Assembly:** `create-tools.ts` registers the tool + `DEFAULT_TOOL_DESCRIPTIONS` entry; agent-cli
  needs no changes beyond the default composition.

### Contract (tool schema → IActionRequest mapping)

```ts
// Tool args (Zod), provider-neutral:
{
  questions: Array<{
    // 1–4 per call; rendered sequentially by the existing ask queue
    question: string; // → IActionRequest.title
    header?: string; // → description prefix (short chip label)
    options?: Array<{ label: string; description?: string }>; // → IActionOption (value = label);
    // omitted/empty ⇒ pure free-text question (IActionRequest "Empty/omitted ⇒ free-text" semantics)
    multiSelect?: boolean; // → maxSelect: options.length, minSelect 1 | default single
    allowFreeText?: boolean; // → allowFreeText (default true — reference-UX "Other")
  }>;
}
// Tool result (JSON string): [{ question, values: string[], text?: string } | { question, cancelled: true }]
```

- `id` is generated per ask (`ask_<uuid>`); first-answer-wins semantics owned by the port (CMD-004).
- Cancellation is data, not an exception: a cancelled question returns `{ cancelled: true }` so the
  model can proceed gracefully. Dismissing one question marks the remaining unasked questions of the
  same call `cancelled` too (the user declined the interaction; they are not re-prompted per item).
- `context.ask === undefined` (headless, no pre-answer): the tool returns a structured
  `{ unavailable: true, reason: 'no interactive user attached' }` result — never a silent guess, and
  not a thrown error (the model should be able to continue autonomously).

### Alternatives Considered

1. **Tool in `agent-tools` builtins over `context.ask` (proposed).** Pro: the seam CMD-004 built for
   exactly this; pure; testable with a stubbed context; tool lives with its siblings (Shell etc.).
   Con: needs the context-injection wiring (one seam touch in the execution pipeline).
2. **A command (`/ask`) projected to the model as a command-tool.** Pro: zero new tool surface. Con:
   the command path deliberately blocks model-invoked asks (deadlock guard); would need to carve an
   exception through `createUserInteractionPort`, weakening CMD-004's invariant; command args are a
   worse fit for a structured schema than a Zod tool.
3. **Framework-level "interaction tool" package.** Pro: keeps agent-tools UI-free in spirit. Con: the
   tool has no UI — it emits an action through a port; `agent-tools` already holds host-facing
   builtins; a new package for one tool violates proper-foundation-without-fragmentation.

### Decision (proposed — requires GATE-APPROVAL)

Alternative 1. Additionally (product-direction points held for approval):

- **D1 — name:** `AskUserQuestion` (descriptive, reference-UX parity; not a vendor name).
- **D2 — batching:** accept **1–4 questions per call**, rendered sequentially by the existing ask
  queue; answers returned as an array (reference parity; the queue already serializes rendering).
- **D3 — availability:** registered as a **default built-in tool** in `create-tools.ts` (all presets);
  permission-free (it has no side effects — it only asks).
- **D4 — headless:** structured `unavailable` result (not a tool error, not auto-cancel-as-answer);
  programmatic clients pre-answer via `queueUserAction`.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-tools (tool), agent-core/session/framework (context
      injection seam), assembly descriptions; TUI/transport unchanged.
- [x] Sibling scan 완료 — `shell-tool.ts` builtin pattern; `PendingActionPrompt` queue renders all
      IActionRequest kinds; `queueUserAction` programmatic pre-answer; permission prompts already
      render mid-turn.
- [x] 대안 최소 2개 검토 완료 — 3개 (builtin-tool / command-projection / new-package).
- [x] 결정 근거 문서화 완료 — SSOT reuse (IActionRequest), CMD-004 invariant preserved (command guard
      stays), held for product approval (D1–D4).

## Solution

Phased (post-approval): (A) tool + unit tests over a stubbed `context.ask` (mapping, batching,
cancellation, unavailable). (B) context injection: session askHandler → per-call
`IToolExecutionContext.ask`; functional test via TEST-003 scripted session (model calls the tool →
dialog answered programmatically → answer lands in the tool result). (C) assembly registration +
descriptions + docs (SPEC/README/content 3-layer). (D) PTY E2E: real binary, model asks, drive the Ink
dialog by keys, assert the model receives the picked answer (extends the tui-e2e gate).

## Affected Files

- New: `packages/agent-tools/src/builtins/ask-user-question-tool.ts` (+ tests).
- Edited: tool-execution context assembly (inject `ask`), `create-tools.ts`,
  `DEFAULT_TOOL_DESCRIPTIONS`, three-layer docs.

## Completion Criteria

- [x] TC-01: the `AskUserQuestion` tool exists in agent-tools builtins; schema ↔ `IActionRequest`
      mapping unit-tested (single, multi, free-text, 1–4 batch, cancelled, unavailable).
- [x] TC-02: `context.ask` is populated from the session askHandler in interactive sessions and
      absent headless; injection covered by a functional (scripted-session) test where the model's
      tool call receives a programmatically-queued answer.
- [x] TC-03: TUI renders a model-issued question mid-turn and the answer returns as the tool result —
      real-binary PTY test (tui-e2e gate).
- [x] TC-04: headless print mode: the tool resolves `unavailable` without hanging or guessing
      (integration test on the headless channel).
- [x] TC-05: typecheck / lint / affected suites / `pnpm harness:scan` green; 3-layer docs updated.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                        | Notes                      |
| ----- | --------- | ------------------------------------------------------ | -------------------------- |
| TC-01 | UNIT      | stubbed `context.ask`; mapping + batching + edge cases | agent-tools                |
| TC-02 | BEHAVIOR  | TEST-003 scripted session + `queueUserAction`          | agent-framework functional |
| TC-03 | E2E       | PTY real binary; keys drive the Ink dialog             | tui-e2e gate               |
| TC-04 | BEHAVIOR  | headless channel run; tool returns `unavailable`       | agent-transport            |
| TC-05 | INFRA     | typecheck/lint/tests/harness:scan exit 0               | gates                      |

## Tasks

- [x] `.agents/tasks/CMD-005.md` — 작성 완료 (2026-07-02).

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-07-02

draft → review-ready. Frontmatter present; Problem with symptom + reproduction; Architecture Review
(Affected Scope, contract mapping, 3 Alternatives Pro/Con, proposed Decision D1–D4, 4/4 checklist);
5 TC = 5 Test Plan rows; Tasks placeholder; empty Evidence Log. Mechanical: rg confirmed 8/8 headings,
4/4 checklist, 3 alternatives, TC 5=5. Grounded in code reading: `IActionRequest`/`TActionResponse`
SSOT + `IToolExecutionContext.ask` (typed, unpopulated) in agent-core; `createUserInteractionPort`
model-guard note naming CMD-005; TUI `askUser` queue (`PendingActionPrompt`, mid-turn capable);
headless channel injects no askHandler; legacy `requestAction` fully deleted (#887) so no migration
remains. **Held at review-ready for GATE-APPROVAL** — product-direction decisions D1 (tool name),
D2 (1–4 question batching), D3 (default-enabled, permission-free), D4 (headless `unavailable` result).

### [GATE-APPROVAL] — ✅ PASS | 2026-07-02

review-ready → approved. User approved all four proposed decisions verbatim (AskUserQuestion dialog):
D1 tool name **AskUserQuestion**; D2 **1–4 questions per call** (sequential rendering via the existing
ask queue); D3 **default built-in registration, permission-free**; D4 headless → **structured
`unavailable` result** (programmatic clients pre-answer via `queueUserAction`). No post-approval drift.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-02

approved → in-progress. `.agents/tasks/CMD-005.md` created (phases A–D cover TC-01..TC-05, TC map
included); spec Tasks section updated; approved D1–D4 recorded in the tasks file.

### [GATE-VERIFY] — ✅ PASS | 2026-07-02

Tasks file: all phases `[x]` (A tool+unit, B injection+functional, C assembly+docs, D E2E+gates).
Build: full `pnpm build` → 0 errors (264 targets). Tests (2026-07-02): agent-core 752/54,
agent-session 74/15, agent-tools 172/13, agent-framework 1033/116, agent-transport-tui 393/53 +
PTY 11/8, agent-cli 146/18 — all green. Lint 0 errors on touched packages.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-07-02

Tool + mapping. Test: `packages/agent-tools/src/__tests__/ask-user-question-tool.test.ts` (9 cases:
name, single-select mapping incl. `ask_` id + value=label, bare-string options, multiSelect widening,
free-text-only, 1–4 batch order, dismissal cancels the rest, headless unavailable, batch bounds throw).

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-07-02

Injection chain. Test: `packages/agent-framework/src/testing/__tests__/ask-user-question-functional.test.ts`
— REAL InteractiveSession via the TEST-003 harness's new `askHandler` option: the scripted model's tool
call reaches the handler as a mapped `IActionRequest` and the programmatic answer lands in the tool
result; the no-handler run yields `unavailable` (headless absence semantics).

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-07-02

Real-binary dialog. Test: `packages/agent-transport-tui/src/__tests__/pty/ask-user-question.ptytest.ts`
(tui-e2e gate) — INFRA-018 replay fixture; the dialog renders mid-turn (PICK_A_COLOR, Red/Blue), Enter
answers, the follow-up assistant text renders. (`--name` suppresses auto-naming which would consume the
replayed tool-call response.) LIVE evidence (real claude-sonnet-4-6, real key): the model invoked
AskUserQuestion unprompted-schema (first with bare-string options — now accepted), the Ink dialog
rendered mid-turn, Enter picked Crimson, and the model replied "Great choice! You've selected
**Crimson**…" — full ask → dialog → answer → turn-continue loop on the real product.

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-07-02

Headless. Unit (`unavailable` case) + functional (no-handler run) above; plus a real print-mode run of
the built binary with the ask fixture: completed `FINAL_AFTER_ANSWER`, exit 0, no hang, no guess.

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-07-02

typecheck green on all touched packages; lint 0 errors; suites green (see GATE-VERIFY);
`pnpm harness:scan` 39/39. Docs: agent-tools SPEC + README (tool rows + semantics), agent-core SPEC
(TKnownToolName), agent-framework SPEC (model-question seam), content/README (stale count fixed).

### [GATE-COMPLETE] — ✅ PASS | 2026-07-02

All 5 TCs verified with test references (no skips). Tasks archived to
`.agents/tasks/completed/CMD-005.md`; spec `active/` → `done/`; frontmatter `status: done`.
