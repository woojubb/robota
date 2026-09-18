---
title: 'BEHAVIOR-2003: Configure contextual TUI key bindings'
issue: https://github.com/woojubb/robota/issues/2003
status: done
completed: 2026-09-19
created: 2026-09-14
priority: high
urgency: now
area: packages/agent-framework, packages/agent-command, terminal UI package
depends_on: [STRUCT-012, REFACTOR-025]
---

# BEHAVIOR-2003: Configure contextual TUI key bindings

Spec: `.agents/spec-docs/done/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md`

## Objective

Replace distributed physical-key checks with a typed context/action keybinding registry loaded from a
documented JSON file. Support hot reload, modifier aliases, uppercase semantics, chords and null unbinding,
while diagnosing unknown contexts/actions, reserved keys, duplicates and multiplexer conflicts.

## Plan

- [x] TC-01, TC-02: Define the sparse override document, context/action vocabulary, defaults, grammar,
      JSON Schema, reserved-key policy and error-versus-warning rules.
- [x] TC-06, TC-07: Build one Node keybinding source at the CLI composition boundary, inject it into the
      TUI and the `/keybindings` command, and dispose its directory watcher with the rendered app.
- [x] TC-03, TC-04: Resolve action keys and bounded chords through one registry across every current
      production input context while leaving printable text, paste, Korean IME composition and Ctrl+C
      on their preserved paths.
- [x] TC-05: Reject invalid replacement documents atomically, retain the last valid effective map,
      surface the diagnostic, and derive every active key hint from that effective map.
- [x] TC-08, TC-09, TC-10: Document the file path, action catalogue, schema, terminal/modal-editor limits
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
- evidence: recorded — raw (65,734 bytes) and stripped (40,478 chars) PTY transcripts, editor path record, and three bounded captures in `.agents/evals/scenarios/behavior-2003-keybindings-agent-run.md`

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

## Closeout Verification

Recorded here rather than under `## User Execution Test Scenarios`: the delivery landed (PR #2739)
before this stage was recorded, and the post-merge completion closeout contract freezes that section
between the source and the archived Task. The entry is the guardian's own verdict, unchanged.

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-09-19

**Status upgrade:** scenario written → scenario executed

Ordering: the last `[DONE-GATE-STAGE-1]` entry is ✅ PASS (2026-09-15, recorded in the delivery
commit `18a560fea`, PR #2739); the Task is `status: in-progress`, every Plan item is ticked, and
`18a560fea` is an ancestor of this branch's head `e3f31aa15`. The `expected observable` field is
byte-identical to the `expectedObservable` frozen in the Stage-1 checkpoint JSON, and `git diff
18a560fea HEAD` on this file is empty (the working-tree copy is unmodified), so the observable was
not rewritten after the Stage-1 verdict. The built CLI (`node packages/agent-cli/bin/robota.cjs`,
`robota 3.0.0-beta.79`; `agent-cli`/`agent-ui-terminal`/`agent-command` dist artifacts dated after
the `e3f31aa15` commit time with no source newer than them, and the active `agent-cli` bundle
containing the reserved-key diagnostic) was re-run by the guardian with the same driver
(`node_modules/.bin/tsx scratch/src/behavior-2003-pty-scenario.mts`) in a fresh `mktemp` HOME, with
`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`GOOGLE_API_KEY` unset and only a dummy `openai` provider
setting present; the driver exited 0 with strippedCharacters 39384 and rawBytes 63229, against the
record's original run of 40478 / 65734 — the delta being the shorter temp-directory names and the
record's longer initial capture window, not a change in what was rendered.

- Scenario 1 — `pnpm exec robota --name keybindings-scenario` (driven as `node
packages/agent-cli/bin/robota.cjs --name keybindings-scenario --disable-update-check
--no-session-persistence` in a 100×32 xterm-256color PTY): exit 0. Matched, clause by clause:
  the editor record `editorPath` equals `expectedEditorPath`
  (`<scenario-home>/.robota/keybindings.json`, byte-identical); the footer first rendered
  `Ctrl+J Submit` and `/he` → `Ctrl+J Complete` → Ctrl+J rendered `Available commands:`; after the
  atomic rename to the `ctrl+k` document the footer rendered `Ctrl+K Submit`, `/he` still completed
  with Ctrl+J, and Ctrl+K rendered `Available commands:`; after the atomic rename to the reserved
  `ctrl+c` document the diagnostic `Keybindings <scenario-home>/.robota/keybindings.json
$.bindings.chat-input.submit: Ctrl+C is reserved for two-stage shutdown.` named the full failing
  path, `Ctrl+K Submit` remained in the footer, `/he` + Ctrl+J + Ctrl+K rendered `Available
commands:` again, and the process was still alive to take the Ctrl+C exit (exit code 0).
- Evidence record: `.agents/evals/scenarios/behavior-2003-keybindings-agent-run.md` § Observed
  (2026-09-19, committed in `18a560fea`) — the original run; the scenario's `evidence:` field points
  at that path and the path exists (`check-done-evidence` passes). The guardian's closeout re-run on
  `e3f31aa15` is recorded here rather than in that file, because the post-merge completion closeout
  contract admits only the Task/spec pair into this commit: driver exit 0; `editorPath` ==
  `expectedEditorPath`; strippedCharacters 39384 (rawBytes 63229; the record's original run reads
  40478 / 65734 — the delta is the shorter temp-directory names); bounded captures in order —
  `Opened keybindings: <scenario-home>/.robota/keybindings.json`, `Ctrl+J Submit`,
  `Available commands:`, `Ctrl+K Submit`, `Available commands:`, `Keybindings
<scenario-home>/.robota/keybindings.json $.bindings.chat-input.submit: Ctrl+C is reserved for
two-stage shutdown.`, `Ctrl+K Submit`, `Available commands:`. The evidence counted is product
  output only — the command, exit code, editor path record and the bounded PTY captures; the record's
  "Supporting test suites" lines are engineering verification and were not counted. No
  capability-absence exception is claimed. Observation, not decisive for this gate: the record's
  `**Spec:**` line still names the pre-archive `.agents/spec-docs/active/…` path; the next change
  that may touch that file updates it.

## Completion Criteria

- [x] TC-01: The versioned sparse JSON parser accepts documented aliases, uppercase rules, chords,
      per-action `null` unbinding and context reuse, and emits one immutable effective map.
- [x] TC-02: Parse/schema/unknown/reserved/duplicate/prefix conflicts reject the whole replacement with
      an exact path diagnostic; multiplexer and undeliverable-modifier warnings preserve valid bindings.
- [x] TC-03: Text contexts never buffer unmodified printable characters as chord prefixes, and chord
      state resets on timeout, mismatch, Escape, context change and snapshot replacement.
- [x] TC-04: Every current production input context resolves semantic actions through the registry while
      printable text, paste, IME composition and the two-stage Ctrl+C shutdown contract are preserved.
- [x] TC-05: Every active footer derives keys from the current context's effective actions and omits
      unbound or inactive actions.
- [x] TC-06: A parent-directory watcher accepts atomic replacement, hot-reloads without restart, retains
      the last valid map on visible invalid replacement, and disposes on all render exit paths.
- [x] TC-07: `/keybindings` is registered only with the injected capability, atomically creates a schema-
      linked sparse document when absent, never overwrites an existing file and opens the exact path.
- [x] TC-08: The JSON Schema and documentation enumerate current contexts/actions/defaults, grammar,
      reserved keys, terminal/modal-editor limits and multiplexer warnings.
- [x] TC-09: The real scripted-provider CLI in a PTY demonstrates context reuse, remapped submit, live
      atomic reload, derived hint refresh and last-valid preservation after an invalid replacement.
- [x] TC-10: Focused unit/integration/PTY suites, affected package builds, typecheck and harness scans pass.

## Result

- [Pull Request #2739](https://github.com/woojubb/robota/pull/2739) landed implementation head
  `6349d990d1069aeb577268ea0f2924576967b900` on `origin/develop` as
  `18a560fea5fc25d0ff7b4870eea2a27f033ed723` (squash merge, subject
  `feat(tui): configure contextual TUI key bindings (#2739)`).
- The PR carried `ACTIONABLE FINDINGS: 0` and its merge decision
  ([PR #2739 merge decision](https://github.com/woojubb/robota/pull/2739)) bound base
  `2f096679b75fa09368b05c2a77a88c51657ff382` to that head with green CI.
- Closeout verification on `origin/develop` `e3f31aa15c21d7d5b9285b8c9b666d0554aa3e0d`: the guardian's
  own re-run of Scenario 1 against the built CLI matched every clause (DONE-GATE-STAGE-2 PASS); GATE-VERIFY
  PASS (agent-ui-terminal 98 files / 866 tests, agent-command 46 / 342 passed, 5 skipped, agent-cli 69
  passed, 1 skipped / 508 passed, 18 skipped; three-package build and typecheck green); GATE-COMPLETE
  9/9 PASS with TC-01..TC-10 records; `pnpm harness:scan` 157 passed, 5 skipped.
- Issue #2003 was already closed (2026-09-12 consolidation) and received delivery completion record
  [#5733539999](https://github.com/woojubb/robota/issues/2003#issuecomment-5733539999) tying that
  closure to the verified merge.

## Recommendation Evidence

- `DEPTH VERDICT: ROOT-CAUSE ALIGNED` — 2026-09-15. Current production input handling has 14 direct
  `useInput` owners and 21 physical-key decision files, while eight footer owners repeat key strings;
  no configuration, schema or reload owner exists.
- `REVIEW VERDICT: ENDORSE` — 2026-09-15, after two bounded revisions. The endorsed design keeps the
  TUI contract in `agent-ui-terminal`, gives `agent-command` only a consumer-owned file port, and lets
  `agent-cli` inject one Node source into both surfaces without leaking presentation concepts into
  `agent-framework`.
- User direction (verbatim): “브랜치 정리와 부분 완료 기록을 수행하고 Issue #2670의 다음 제품 Task를 계속 진행하세요.”
