---
title: 'BEHAVIOR-2003: Configure contextual TUI key bindings'
issue: https://github.com/woojubb/robota/issues/2003
status: in-progress
created: 2026-09-14
priority: high
urgency: now
area: packages/agent-framework, packages/agent-command, terminal UI package
depends_on: [STRUCT-012, REFACTOR-025]
---

# BEHAVIOR-2003: Configure contextual TUI key bindings

## Objective

Replace distributed physical-key checks with a typed context/action keybinding registry loaded from a
documented JSON file. Support hot reload, modifier aliases, uppercase semantics, chords and null unbinding,
while diagnosing unknown contexts/actions, reserved keys, duplicates and multiplexer conflicts.

## Plan

- [ ] TC-01, TC-02: Define the sparse override document, context/action vocabulary, defaults, grammar,
      JSON Schema, reserved-key policy and error-versus-warning rules.
- [ ] TC-06, TC-07: Build one Node keybinding source at the CLI composition boundary, inject it into the
      TUI and the `/keybindings` command, and dispose its directory watcher with the rendered app.
- [ ] TC-03, TC-04: Resolve action keys and bounded chords through one registry across every current
      production input context while leaving printable text, paste, Korean IME composition and Ctrl+C
      on their preserved paths.
- [ ] TC-05: Reject invalid replacement documents atomically, retain the last valid effective map,
      surface the diagnostic, and derive every active key hint from that effective map.
- [ ] TC-08, TC-09, TC-10: Document the file path, action catalogue, schema, terminal/modal-editor limits
      and multiplexer warnings, then execute the live PTY hot-reload scenario and engineering checks.

## Test Plan

Prove parsing, validation, chords, null unbinding, context isolation and atomic hot reload with pure tests;
then modify the keybindings file during a live PTY session and observe a remapped action without restart.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

### Scenario 1: remap, hot-reload and reject an invalid replacement without restart

- executability: agent-executable
- product surface: robota-tui
- surface rationale: shipped-entrypoint=robota
- prerequisites: affected packages are built; an isolated temporary HOME contains a dummy provider setting that is never called; an agent-controlled 100×32 PTY starts the command; EDITOR is a temporary executable that records its single path argument and writes a sparse override binding chat-input.submit and slash-menu.accept to ctrl+j; a second shell can atomically rename valid and invalid documents over HOME/.robota/keybindings.json; the PTY enters `/keybindings`, `/he`, Ctrl+J/Ctrl+J, applies the valid ctrl+k replacement, repeats `/he`, Ctrl+J/Ctrl+K, applies the invalid replacement, repeats those keys, and exits normally; no live credential, provider request or external service is required because every submitted value is the built-in /help command
- command: `pnpm exec robota --name keybindings-scenario`
- observable type: ui-state
- observable rationale: source=rendered-product-ui
- expected observable: visible=the editor receives the exact isolated HOME/.robota/keybindings.json path; the footer first shows ctrl+j for submit and /help renders Available commands; after the valid rename the footer shows ctrl+k, Ctrl+J still completes /help in the slash menu and Ctrl+K renders Available commands; after the invalid rename a diagnostic names the failing path, ctrl+k remains in the footer, /help still renders Available commands, and the TUI stays alive
- cleanup: exit the Robota process normally, confirm the watcher released the temporary directory, then remove only the isolated HOME, project and captured transcript directories
- evidence: pending — record the raw and stripped PTY transcript, the editor path record and three bounded captures in `.agents/evals/scenarios/behavior-2003-keybindings-agent-run.md`

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-09-15

**Status upgrade:** scenario drafted → scenario written

The independent backlog-gate guardian confirmed that Scenario 1 is agent-executable, invokes the
shipped Robota TUI, carries the complete canonical field set, observes rendered product behavior and
requires no provider call, credential or external service.

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "doneGateStageOne",
  "outcome": "automatable",
  "scenarios": [
    {
      "name": "Scenario 1: remap, hot-reload and reject an invalid replacement without restart",
      "surface": "robota-tui",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "pnpm exec robota --name keybindings-scenario",
      "observableType": "ui-state",
      "observable": "visible=the editor receives the exact isolated HOME/.robota/keybindings.json path; the footer first shows ctrl+j for submit and /help renders Available commands; after the valid rename the footer shows ctrl+k, Ctrl+J still completes /help in the slash menu and Ctrl+K renders Available commands; after the invalid rename a diagnostic names the failing path, ctrl+k remains in the footer, /help still renders Available commands, and the TUI stays alive",
      "observableRationale": "source=rendered-product-ui",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "affected packages are built; an isolated temporary HOME contains a dummy provider setting that is never called; an agent-controlled 100×32 PTY starts the command; EDITOR is a temporary executable that records its single path argument and writes a sparse override binding chat-input.submit and slash-menu.accept to ctrl+j; a second shell can atomically rename valid and invalid documents over HOME/.robota/keybindings.json; the PTY enters `/keybindings`, `/he`, Ctrl+J/Ctrl+J, applies the valid ctrl+k replacement, repeats `/he`, Ctrl+J/Ctrl+K, applies the invalid replacement, repeats those keys, and exits normally; no live credential, provider request or external service is required because every submitted value is the built-in /help command",
      "action": {
        "kind": "command",
        "value": "pnpm exec robota --name keybindings-scenario"
      },
      "expectedObservable": "visible=the editor receives the exact isolated HOME/.robota/keybindings.json path; the footer first shows ctrl+j for submit and /help renders Available commands; after the valid rename the footer shows ctrl+k, Ctrl+J still completes /help in the slash menu and Ctrl+K renders Available commands; after the invalid rename a diagnostic names the failing path, ctrl+k remains in the footer, /help still renders Available commands, and the TUI stays alive",
      "cleanup": "exit the Robota process normally, confirm the watcher released the temporary directory, then remove only the isolated HOME, project and captured transcript directories",
      "evidence": "pending — record the raw and stripped PTY transcript, the editor path record and three bounded captures in `.agents/evals/scenarios/behavior-2003-keybindings-agent-run.md`"
    }
  ]
}
```

<!-- checkpoint-evidence:v1:end -->

## Recommendation Evidence

- `DEPTH VERDICT: ROOT-CAUSE ALIGNED` — 2026-09-15. Current production input handling has 14 direct
  `useInput` owners and 21 physical-key decision files, while eight footer owners repeat key strings;
  no configuration, schema or reload owner exists.
- `REVIEW VERDICT: ENDORSE` — 2026-09-15, after two bounded revisions. The endorsed design keeps the
  TUI contract in `agent-ui-terminal`, gives `agent-command` only a consumer-owned file port, and lets
  `agent-cli` inject one Node source into both surfaces without leaking presentation concepts into
  `agent-framework`.
- User direction (verbatim): “브랜치 정리와 부분 완료 기록을 수행하고 #2670의 다음 제품 Task를 계속 진행하세요.”
