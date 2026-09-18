---
status: done
type: BEHAVIOR
tags: [cli, json-schema, async, a11y]
lane: L2
capability: true
user_execution: agent-run
user_execution_scenario: .agents/evals/scenarios/behavior-2003-keybindings-agent-run.md
---

# BEHAVIOR-2003: Configure contextual TUI key bindings

Paired with `.agents/tasks/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md`. Arising from
[issue #2003](https://github.com/woojubb/robota/issues/2003) under the
[issue #2670](https://github.com/woojubb/robota/issues/2670) delivery agreement.

## Problem

The terminal UI has no keybinding configuration surface. Fourteen production files register Ink
`useInput` handlers directly, 21 production files decide physical keys, and eight footer owners repeat
literal key labels independently from execution. Users therefore cannot resolve terminal or
multiplexer conflicts, the same physical key cannot be configured per context, and a changed handler
can silently disagree with its displayed hint.

The gap reproduces in any interactive session: `Ctrl+B`, arrows, Enter, Escape, Tab and prompt-editing
controls are fixed in source, and editing user settings while the session runs cannot alter them.

## Prior Art Research

[Claude Code keybindings](https://code.claude.com/docs/en/keybindings) documents a separate JSON file,
context/action identifiers, hot reload, chords, null unbinding, reserved shortcuts, conflict warnings
and editor schema completion. Robota adopts those user outcomes but keeps provider-neutral command and
session layers unaware of terminal keys. Its existing semantic input reducers and shared footer
formatter remain the execution foundations rather than being replaced.

Checklist disposition:

| Reference outcome                           | Robota verdict                                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Known JSON path created/opened by a command | Adopt: `/keybindings` creates the default sparse document when absent and opens it through terminal handoff.                         |
| Hot reload                                  | Adopt: watch the containing directory so atomic editor renames are observed.                                                         |
| Context/action vocabulary and defaults      | Adopt for every current production context; future screens add their actions when implemented.                                       |
| Modifier aliases and terminal limits        | Adopt with canonical serialization and warnings for combinations the current terminal cannot deliver.                                |
| Uppercase semantics                         | Adopt: bare uppercase implies Shift; modified letters are normalized without an implicit second Shift.                               |
| Chords and null unbinding                   | Adopt with bounded state, explicit prefix-conflict validation and sparse `null` removal of one action's defaults.                    |
| Reserved keys and multiplexer conflicts     | Adopt; reserved violations reject the snapshot, while environment conflicts are visible non-fatal warnings.                          |
| Visible and debug diagnostics               | Adopt through the TUI diagnostic projection and injected logger.                                                                     |
| JSON Schema URL                             | Adopt as the document's `$schema` and publish the schema with the product documentation.                                             |
| Modal editor interaction                    | Adapt as documentation: Robota does not implement a modal editor, and documents which terminal controls remain outside the registry. |

## Architecture Review

### Affected Scope

- `packages/agent-ui-terminal` — sole owner of the TUI keybinding contract, defaults, schema, resolver,
  watcher, effective-map snapshot and derived hints
- `packages/agent-command` — `/keybindings` command and its consumer-owned minimal file port
- `packages/agent-cli` — composition of one Node source into the command and renderer
- `packages/agent-ui-terminal/docs/SPEC.md`, relevant package READMEs and product guide — contract and
  user documentation

### Alternatives Considered

1. Keep per-component handlers and only add configurable values.
   - Pro: small initial diff.
   - Con: preserves competing owners for parsing, execution and hints; chords and context conflicts
     cannot be validated globally.
2. Put a generic keyboard registry in `agent-framework`.
   - Pro: both commands and presentation could import it.
   - Con: terminal presentation concepts and platform key limits leak into the shared runtime layer.
3. Own the complete registry in `agent-ui-terminal`, expose only a narrow file port to the command, and
   compose both in `agent-cli`.
   - Pro: one contract owner, no reverse dependency, and one watched source drives execution and editing.
   - Con: embeddings must inject the optional capability to expose `/keybindings`.

### Decision

Choose alternative 3. `agent-ui-terminal` owns path, schema, defaults, parsing, validation, watching,
effective resolution and hints. `agent-command` knows only `IKeybindingsFilePort.ensureFile()` and opens
the returned path through its existing terminal-handoff/editor boundary. `agent-cli` creates one source
and injects it into both. Hosts without that capability do not register a command that would falsely
claim success.

This is a new member of the existing built-in configuration-command product family: it mirrors the
current `settings` command module, default-command registration and `editor` terminal-handoff sibling,
while separating the TUI-owned file contract behind a consumer-owned command port. Reuse occurs only at
the shared command and terminal-handoff contracts; `/keybindings` does not depend on the sibling
`settings` product or make `agent-command` depend on `agent-ui-terminal`.

**Delivery mode:** `single`

The independent depth review returned `DEPTH VERDICT: ROOT-CAUSE ALIGNED`. The independent proposal
review returned `REVIEW VERDICT: ENDORSE` on 2026-09-15 after the design made text/chord precedence,
validation severity, watcher teardown, two-stage Ctrl+C behavior, effective hints and package ownership
explicit. Every current input owner remains reachable through an inventory-backed migration; no field
or action is silently dropped.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — current semantic reducers, input hooks, prompt components, footer SSOT, settings command and terminal handoff were inspected
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

The last valid effective keybinding map is intentionally retained when a later watched document is
invalid. This is not a silent fallback: the replacement is rejected atomically, the exact diagnostic
is shown in the TUI and sent to the injected logger, and the retained map remains visibly identified as
the active configuration.

## Solution

1. Define stable current context/action IDs, default bindings and a sparse versioned JSON document.
   Values are one binding, a list of bindings, or `null`; `null` removes all defaults for that exact
   context/action. Unknown context/action IDs, invalid syntax, reserved bindings, duplicates and
   single-key/chord-prefix collisions reject the whole replacement. Multiplexer conflicts and
   undeliverable modifier combinations are visible warnings but do not invalidate other bindings.
2. Normalize modifier aliases and uppercase input. In text-entry contexts, an unmodified printable key
   cannot begin a chord, so no typed character is buffered or replayed. Pending chords reset on context
   change, mismatch, Escape, snapshot replacement or a one-second timeout; a mismatch re-evaluates the
   current key once as a new input.
3. Preserve the reserved two-stage Ctrl+C contract: the first signal starts graceful shutdown and a
   second during shutdown exits 130. Raw IME controls and screen-reader numbered input remain reserved
   with documented reasons.
4. At `renderApp`, create a Node source that watches the keybindings file's parent directory, publishes
   immutable effective snapshots plus diagnostics, survives atomic rename, and disposes on every render
   exit or initialization failure. React components and resolvers perform no file I/O.
5. Route every current production handler through semantic actions. Printable text, paste and Korean
   IME composition continue through the existing text engine. Footer hints are generated only from
   effective bindings for active actions in the current context; unbound actions are omitted.
6. Add `/keybindings`. Its command module consumes only `IKeybindingsFilePort`; the CLI injects the
   TUI-owned Node implementation, which atomically creates but never overwrites the user document, and
   the command opens the returned path through the existing editor handoff.
7. Publish the schema and document file location, all action IDs/defaults, modifier delivery limits,
   chord-prefix rules, reserved keys, multiplexer warnings and the absence of an internal modal editor.

## Affected Files

- `.agents/tasks/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md`
- `.agents/spec-docs/draft/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md`
- `packages/agent-ui-terminal/src/keybindings/**`
- current `packages/agent-ui-terminal/src/**/*.{ts,tsx}` input and footer owners
- `packages/agent-ui-terminal/docs/SPEC.md`
- `packages/agent-command/src/keybindings/**` and default command composition
- `packages/agent-cli/src/cli.ts` and focused PTY scenario fixture
- product documentation and the published JSON Schema asset

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

## Test Plan

| TC-ID | Test Type                | Tool / Approach                                                                                                                                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | Unit / JSON Schema       | Vitest parser and generated-schema fixture tests                                                                                               | Exact normalized map assertions — Test written: `packages/agent-ui-terminal/src/keybindings/__tests__/keybinding-registry.test.ts > normalizes aliases and uppercase, reuses bindings by context, and applies null unbinding`                                                                                                                                                                                                                                 |
| TC-02 | Unit                     | Vitest validation matrix                                                                                                                       | Error and warning severity are separate assertions — Test written: `packages/agent-ui-terminal/src/keybindings/__tests__/keybinding-registry.test.ts > keeps multiplexer and undeliverable modifier conflicts as warnings` and the reserved/rejection cases in the same describe                                                                                                                                                                              |
| TC-03 | Async state              | Vitest fake-timer chord tests                                                                                                                  | Includes mismatch single re-evaluation — Test written: `packages/agent-ui-terminal/src/keybindings/__tests__/keybinding-registry.test.ts > resolves bounded chords and re-evaluates one mismatching stroke`, `> resets pending chords on timeout, context change, and snapshot replacement`                                                                                                                                                                   |
| TC-04 | Component / regression   | Existing reducer tests plus registry-routed Ink input tests                                                                                    | Covers the full production-handler inventory — Test written: `packages/agent-ui-terminal/src/__tests__/contextual-keybindings-input.test.tsx > InputArea contextual keybindings` plus the existing `src/__tests__/input-area*` reducer suites                                                                                                                                                                                                                 |
| TC-05 | Component                | Ink render tests over effective snapshots                                                                                                      | Footer must match executable actions — Test written: `packages/agent-ui-terminal/src/keybindings/__tests__/keybinding-registry.test.ts > derives user-facing hints only from effective active bindings`                                                                                                                                                                                                                                                       |
| TC-06 | Integration / async      | Temporary-directory `fs.watch` tests and render teardown tests                                                                                 | Exercises atomic rename and disposal — Test written: `packages/agent-ui-terminal/src/keybindings/__tests__/node-keybindings-source.test.ts > Node keybindings source` (3 tests: atomic create, atomic replacement + last-valid retention, shared start)                                                                                                                                                                                                       |
| TC-07 | Functional command       | Real command module with fake editor and temporary HOME                                                                                        | Existing files remain byte-identical — Test written: `packages/agent-command/src/keybindings/__tests__/keybindings-command-module.test.ts > /keybindings command`, `packages/agent-command/src/default/__tests__/default-command-modules.test.ts`                                                                                                                                                                                                             |
| TC-08 | Contract / docs          | JSON Schema validation and documentation conformance                                                                                           | Published schema asset resolves locally — Test written: `packages/agent-ui-terminal/src/keybindings/__tests__/keybinding-registry.test.ts > keeps the published JSON Schema aligned with every runtime context and action`; docs `content/guide/keybindings.md`                                                                                                                                                                                               |
| TC-09 | Process / PTY            | Agent-controlled PTY over `node packages/agent-cli/bin/robota.cjs --name keybindings-scenario --disable-update-check --no-session-persistence` | Product-surface evidence, not a unit-test substitute; any disposable orchestration script lives under `scratch/src/` and is not committed — Unit test skipped by design (product-surface evidence): agent-run PTY scenario, driver `scratch/src/behavior-2003-pty-scenario.mts`, evidence `.agents/evals/scenarios/behavior-2003-keybindings-agent-run.md`; the CLI-side regression is `packages/agent-cli/src/__tests__/robota-assembly-equivalence.test.ts` |
| TC-10 | Engineering verification | package build, test, typecheck and affected harness scans                                                                                      | Run after focused suites — Engineering verification, no test file: build/test/typecheck of the three delivered packages + `pnpm harness:scan` — see the `[GATE-COMPLETE: TC-10]` record; the suites named in TC-01..TC-08 are the regression set                                                                                                                                                                                                              |

## User Execution Test Scenarios

### Scenario 1: remap, hot-reload and reject an invalid replacement without restart

- executability: agent-executable
- product surface: robota-tui
- surface rationale: shipped-entrypoint=robota
- prerequisites: affected packages are built; an isolated temporary HOME contains a dummy provider setting that is never called; an agent-controlled 100×32 PTY starts the command; EDITOR is a temporary executable that records its single path argument and writes a sparse override binding chat-input.submit and autocomplete-menu.accept to ctrl+j; a second shell can atomically rename valid and invalid documents over HOME/.robota/keybindings.json; the PTY enters `/keybindings`, `/he`, Ctrl+J/Ctrl+J, applies the valid ctrl+k replacement, repeats `/he`, Ctrl+J/Ctrl+K, applies the invalid replacement, repeats those keys, and exits normally; no live credential, provider request or external service is required because every submitted value is the built-in /help command
- command: `pnpm exec robota --name keybindings-scenario`
- observable type: ui-state
- observable rationale: source=rendered-product-ui
- expected observable: visible=the editor receives the exact isolated HOME/.robota/keybindings.json path; the footer first shows ctrl+j for submit and /help renders Available commands; after the valid rename the footer shows ctrl+k, Ctrl+J still completes /help in the slash menu and Ctrl+K renders Available commands; after the invalid rename a diagnostic names the failing path, ctrl+k remains in the footer, /help still renders Available commands, and the TUI stays alive
- cleanup: exit the Robota process normally, confirm the watcher released the temporary directory, then remove only the isolated HOME, project and captured transcript directories
- evidence: recorded — raw (65,734 bytes) and stripped (40,478 chars) PTY transcripts, editor path record, and three bounded captures in `.agents/evals/scenarios/behavior-2003-keybindings-agent-run.md`

## Tasks

- [x] `.agents/tasks/completed/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md` — paired Task, done 2026-09-19

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-15

**Status upgrade:** draft → review-ready

- GATE-WRITE — Frontmatter: `status: draft`, valid `type: BEHAVIOR`, `tags` and `lane` are present.
- GATE-WRITE — Problem: a concrete symptom and reproduction condition are stated.
- GATE-WRITE — Prior Art Research: official product-document findings feed the alternatives and decision.
- GATE-WRITE — Architecture Review: four checked items, three alternatives and the deciding ownership trade-off are present.
- GATE-WRITE — New-surface placement: the existing `settings` command family and `editor` terminal-handoff sibling are named; reuse stays at shared contracts, with no sibling-product or reverse package dependency.
- GATE-WRITE — Completion Criteria: ten distinct observable outcomes are covered by `TC-01` through `TC-10`.
- GATE-WRITE — Test Plan: ten concrete rows correspond one-to-one with the ten completion criteria.
- GATE-WRITE — Structure: the Tasks section and Evidence Log are present and no forbidden body status section exists.
- GATE-WRITE — Mechanical evaluation: 20 criteria PASS and 0 FAIL.
- GATE-WRITE — Semantic evaluation: all 7 pending guardian criteria PASS.

**Judged at:** HEAD `2f096679b75fa09368b05c2a77a88c51657ff382` · base
`origin/develop@2f096679b75fa09368b05c2a77a88c51657ff382` · pre-entry document blob
`503c5185caa62435117bec59b3a8186987f2b2d6`.

**Independent review evidence:** `proposal-reviewer` returned `REVIEW VERDICT: ENDORSE` on
2026-09-15 after two bounded revision rounds; the endorsed ownership and interaction decisions are
recorded in Architecture Review above and in the paired Task's Recommendation Evidence.

### [GATE-APPROVAL] — ✅ PASS | 2026-09-15

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "BEHAVIOR-2003의 현재 사양과 구현을 직접 승인합니다."
**Given:** 2026-09-15, this conversation
**Review fingerprint:** bb0f1bb10095 (review 3f53b261, type/tags 3d15bfa9)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-15, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (bb0f1bb10095) equals the document's current fingerprint
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS; the user explicitly approved BEHAVIOR-2003's current specification and implementation in this conversation.
- GATE-APPROVAL — The item is inside the class as the registry defines it: PASS; route DIRECT applies, so the Route CLASS boundary criterion does not apply.
- GATE-APPROVAL — Independent architecture validation (conditional): PASS; the Evidence Log records the independent `proposal-reviewer` `REVIEW VERDICT: ENDORSE` from 2026-09-15 and the reviewed placement decisions.

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `2f096679b75f` · base `origin/develop@2f096679b75f` · document `.agents/spec-docs/backlog/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md` blob `79556f5ae652` (untracked)

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-09-15

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names 0/10 TC ids and carries 5 checkbox task(s)
  **Required action:** one task per TC-N
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : 1 path(s) outside the paired spec/Task: .agents/evals/scenarios/behavior-2003-keybindings-agent-run.md
  **Required action:** commit, stash, or remove them before this gate

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `2f096679b75f` · base `origin/develop@2f096679b75f` · document `.agents/spec-docs/todo/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md` blob `66475e25ecea` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-15

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-15; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (10)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 213 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: automatable | 1`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 4 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md",
  "specPath": ".agents/spec-docs/todo/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md",
  "taskItems": [
    {
      "kind": "tc-id",
      "value": "TC-01"
    },
    {
      "kind": "tc-id",
      "value": "TC-02"
    },
    {
      "kind": "tc-id",
      "value": "TC-03"
    },
    {
      "kind": "tc-id",
      "value": "TC-04"
    },
    {
      "kind": "tc-id",
      "value": "TC-05"
    },
    {
      "kind": "tc-id",
      "value": "TC-06"
    },
    {
      "kind": "tc-id",
      "value": "TC-07"
    },
    {
      "kind": "tc-id",
      "value": "TC-08"
    },
    {
      "kind": "tc-id",
      "value": "TC-09"
    },
    {
      "kind": "tc-id",
      "value": "TC-10"
    }
  ],
  "plan": {
    "outcome": "automatable",
    "count": 1
  },
  "worktreePaths": [
    ".agents/loop-runs/backlog-execution-orchestrator.jsonl",
    ".agents/loop-runs/user-execution-scenario.jsonl",
    ".agents/spec-docs/todo/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md",
    ".agents/tasks/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `2f096679b75f` · base `origin/develop@2f096679b75f` · document `.agents/spec-docs/todo/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md` blob `f260a7a4fe46` (untracked)

### [GATE-VERIFY] — ✅ PASS | 2026-09-19

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — ordering: prior gate GATE-IMPLEMENT PASS and status `in-progress`: the LAST `[GATE-IMPLEMENT]` entry in this Evidence Log is `✅ PASS | 2026-09-15` (`approved → in-progress`; the earlier `❌ FAIL | 2026-09-15` entry precedes it and is not the last); frontmatter `status: in-progress`; document under `.agents/spec-docs/active/`; `gate.mjs judge --gate GATE-VERIFY --dry-run` reports the same ordering PASS. The delivery merge `18a560fea` (PR #2739) is an ancestor of HEAD `e3f31aa15`.
- GATE-VERIFY — Every item in the `## Plan` section of `.agents/tasks/<ID>.md` is marked complete (`[x]`): `.agents/tasks/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md` `## Plan` (lines 20–33) holds exactly 5 items, covering `TC-01, TC-02` / `TC-06, TC-07` / `TC-03, TC-04` / `TC-05` / `TC-08, TC-09, TC-10` (all ten TC ids), all `- [x]`; 0 `- [ ]` boxes in that section. `node scripts/harness/scan-task-plan-items.mjs` → exit 0 (`task-plan-items scan passed.`, 315 Plan sections examined). Only the `## Plan` section was read — `## Test Plan`, `## User Execution Test Scenarios` and `## Recommendation Evidence` were not consulted for this criterion.
- GATE-VERIFY — No Plan item is blocked or pending: none of the 5 items carries `blocked`, `pending`, or any deferral marker (grep for blocked/pending/defer/merge/land/close/publish/release over the section returns nothing); none is a disposition item — "execute the live PTY hot-reload scenario and engineering checks" in the fifth item is implementation content, not a merge/land/close/publish disposition. Task frontmatter `status: in-progress`.
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): affected set is what the delivery merge changed — `git diff --name-only 18a560fea^1 18a560fea -- packages` touches agent-ui-terminal (30 files), agent-command (7), agent-cli (3) and nothing else (40 files, +1914/−197), matching the spec's `### Affected Scope`; the Task `area:` line also names `packages/agent-framework`, which the delivery did not touch (0 changed files), so it is not an affected package for this criterion. `pnpm --filter @robota-sdk/agent-ui-terminal --filter @robota-sdk/agent-command --filter @robota-sdk/agent-cli build` → exit 0, all three packages `build: Done` (recorded by `gate.mjs judge --verify-cmd` in the orchestrator's run and independently re-run by the guardian via `--dry-run` at HEAD `e3f31aa15`; only the pre-existing `INEFFECTIVE_DYNAMIC_IMPORT` rollup notice in agent-cli, no error).
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): `pnpm --filter @robota-sdk/agent-ui-terminal --filter @robota-sdk/agent-command --filter @robota-sdk/agent-cli test` → exit 0 (recorded by `gate.mjs judge --verify-cmd` and independently re-run directly by the guardian): agent-ui-terminal 98 files / 866 tests passed; agent-command 46 files / 342 passed, 5 skipped; agent-cli 69 files passed, 1 skipped / 508 passed, 18 skipped; 0 failures.

**Judged by:** `backlog-gate-guard` (semantic) + `gate.mjs` (mechanical)
**Judged at:** HEAD `e3f31aa15c21d7d5b9285b8c9b666d0554aa3e0d` · base `origin/develop@e3f31aa15c21d7d5b9285b8c9b666d0554aa3e0d` · document `.agents/spec-docs/active/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md` blob `15f670b40b72aa6fa586a05d34652171860b6b95` (tracked)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-19

**Command:** `pnpm --filter @robota-sdk/agent-ui-terminal exec vitest run src/keybindings/__tests__/keybinding-registry.test.ts -t 'normalizes aliases'`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
6:58:37 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-5/packages/agent-ui-terminal

 ✓ src/keybindings/__tests__/keybinding-registry.test.ts (14 tests | 13 skipped) 2ms

 Test Files  1 passed (1)
      Tests  1 passed | 13 skipped (14)
   Start at  06:58:37
   Duration  146ms (transform 26ms, setup 0ms, collect 31ms, tests 2ms, environment 0ms, prepare 28ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `e3f31aa15c21` · base `origin/develop@e3f31aa15c21` · document `.agents/spec-docs/active/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md` blob `6f87cd65ffb4` (modified)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-19

**Command:** `pnpm --filter @robota-sdk/agent-ui-terminal exec vitest run src/keybindings/__tests__/keybinding-registry.test.ts -t 'conflicts as warnings|reserved|rejects'`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
6:58:37 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-5/packages/agent-ui-terminal

 ✓ src/keybindings/__tests__/keybinding-registry.test.ts (14 tests | 6 skipped) 3ms

 Test Files  1 passed (1)
      Tests  8 passed | 6 skipped (14)
   Start at  06:58:37
   Duration  145ms (transform 26ms, setup 0ms, collect 31ms, tests 3ms, environment 0ms, prepare 28ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `e3f31aa15c21` · base `origin/develop@e3f31aa15c21` · document `.agents/spec-docs/active/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md` blob `9c7e8088a4b3` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-19

**Command:** `pnpm --filter @robota-sdk/agent-ui-terminal exec vitest run src/keybindings/__tests__/keybinding-registry.test.ts -t 'chords'`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
6:58:38 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-5/packages/agent-ui-terminal

 ✓ src/keybindings/__tests__/keybinding-registry.test.ts (14 tests | 12 skipped) 2ms

 Test Files  1 passed (1)
      Tests  2 passed | 12 skipped (14)
   Start at  06:58:38
   Duration  146ms (transform 26ms, setup 0ms, collect 31ms, tests 2ms, environment 0ms, prepare 28ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `e3f31aa15c21` · base `origin/develop@e3f31aa15c21` · document `.agents/spec-docs/active/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md` blob `abb3e45e0ccd` (modified)

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-09-19

**Command:** `pnpm --filter @robota-sdk/agent-ui-terminal exec vitest run src/__tests__/contextual-keybindings-input.test.tsx src/__tests__/input-area src/__tests__/use-input`
**Exit:** 0
**Output:** (last 10 of 13 line(s))

```

 ✓ src/__tests__/input-area-flow.test.ts (16 tests) 3ms
 ✓ src/__tests__/input-area-bottom-border.test.tsx (2 tests) 125ms
 ✓ src/__tests__/contextual-keybindings-input.test.tsx (1 test) 187ms
 ✓ src/__tests__/input-area-focus-handoff.test.tsx (4 tests) 318ms

 Test Files  4 passed (4)
      Tests  23 passed (23)
   Start at  06:58:39
   Duration  886ms (transform 357ms, setup 0ms, collect 1.60s, tests 632ms, environment 0ms, prepare 145ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `e3f31aa15c21` · base `origin/develop@e3f31aa15c21` · document `.agents/spec-docs/active/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md` blob `b3c25b2c8a57` (modified)

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-09-19

**Command:** `pnpm --filter @robota-sdk/agent-ui-terminal exec vitest run src/keybindings/__tests__/keybinding-registry.test.ts -t 'hints only from effective'`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
6:58:40 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-5/packages/agent-ui-terminal

 ✓ src/keybindings/__tests__/keybinding-registry.test.ts (14 tests | 13 skipped) 2ms

 Test Files  1 passed (1)
      Tests  1 passed | 13 skipped (14)
   Start at  06:58:40
   Duration  145ms (transform 26ms, setup 0ms, collect 30ms, tests 2ms, environment 0ms, prepare 27ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `e3f31aa15c21` · base `origin/develop@e3f31aa15c21` · document `.agents/spec-docs/active/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md` blob `5976ce059eaf` (modified)

### [GATE-COMPLETE: TC-06] — ✅ PASS | 2026-09-19

**Command:** `pnpm --filter @robota-sdk/agent-ui-terminal exec vitest run src/keybindings/__tests__/node-keybindings-source.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
6:58:41 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-5/packages/agent-ui-terminal

 ✓ src/keybindings/__tests__/node-keybindings-source.test.ts (3 tests) 132ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  06:58:41
   Duration  275ms (transform 23ms, setup 0ms, collect 28ms, tests 132ms, environment 0ms, prepare 28ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `e3f31aa15c21` · base `origin/develop@e3f31aa15c21` · document `.agents/spec-docs/active/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md` blob `242c65d6678a` (modified)

### [GATE-COMPLETE: TC-07] — ✅ PASS | 2026-09-19

**Command:** `pnpm --filter @robota-sdk/agent-command exec vitest run src/keybindings/__tests__/keybindings-command-module.test.ts src/default/__tests__/default-command-modules.test.ts`
**Exit:** 0
**Output:** (last 10 of 11 line(s))

```

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-5/packages/agent-command

 ✓ src/keybindings/__tests__/keybindings-command-module.test.ts (2 tests) 15ms
 ✓ src/default/__tests__/default-command-modules.test.ts (8 tests) 5ms

 Test Files  2 passed (2)
      Tests  10 passed (10)
   Start at  06:58:42
   Duration  643ms (transform 431ms, setup 0ms, collect 874ms, tests 20ms, environment 0ms, prepare 61ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `e3f31aa15c21` · base `origin/develop@e3f31aa15c21` · document `.agents/spec-docs/active/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md` blob `0af3c2fcf73d` (modified)

### [GATE-COMPLETE: TC-08] — ✅ PASS | 2026-09-19

**Command:** `pnpm --filter @robota-sdk/agent-ui-terminal exec vitest run src/keybindings/__tests__/keybinding-registry.test.ts -t 'published JSON Schema'`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
6:58:43 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-5/packages/agent-ui-terminal

 ✓ src/keybindings/__tests__/keybinding-registry.test.ts (14 tests | 13 skipped) 2ms

 Test Files  1 passed (1)
      Tests  1 passed | 13 skipped (14)
   Start at  06:58:43
   Duration  146ms (transform 26ms, setup 0ms, collect 30ms, tests 2ms, environment 0ms, prepare 28ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `e3f31aa15c21` · base `origin/develop@e3f31aa15c21` · document `.agents/spec-docs/active/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md` blob `eb7728c7444a` (modified)

### [GATE-COMPLETE: TC-09] — ✅ PASS | 2026-09-19

**Command:** `node_modules/.bin/tsx scratch/src/behavior-2003-pty-scenario.mts  # drives: node packages/agent-cli/bin/robota.cjs --name keybindings-scenario --disable-update-check --no-session-persistence in a 100x32 PTY`
**Exit:** 0
**Output:** (last 10 of 40 line(s))

```
      "Keybindings /var/folders/78/9lnqy12x2bn8x5c17zmvrsnr0000gn/T/robota-keybindings-scenario-KIQ3uB/home/.robota/keybindings.json $.bindings.chat-input.submit: Ctrl+C is reserved for two-stage shutdown.",
      "Ctrl+K Submit",
      "Ctrl+K Submit",
      "Ctrl+K Submit",
      "Ctrl+K Submit",
      "Available commands:",
      "Ctrl+K Submit"
    ]
  }
}
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `e3f31aa15c21` · base `origin/develop@e3f31aa15c21` · document `.agents/spec-docs/active/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md` blob `ef3f235b84c2` (modified)

### [GATE-COMPLETE: TC-10] — ✅ PASS | 2026-09-19

**Command:** `pnpm --filter @robota-sdk/agent-ui-terminal --filter @robota-sdk/agent-command --filter @robota-sdk/agent-cli build && pnpm --filter @robota-sdk/agent-ui-terminal --filter @robota-sdk/agent-command --filter @robota-sdk/agent-cli test && pnpm --filter @robota-sdk/agent-ui-terminal --filter @robota-sdk/agent-command --filter @robota-sdk/agent-cli typecheck && WORKTREE_CWD_GUARD_ALLOW_MAIN=1 pnpm harness:scan`
**Exit:** 0
**Output:** (last 10 of 612 line(s))

```
⚑ spec-whitebox-leakage: packages/agent-session/docs/SPEC.md: 354/829 lines (42.7%) outside the standard sections — consider extracting to docs/design/
⚑ dist: @robota-sdk/agent-core: dist/ may be STALE — src/interfaces/provider-definition.ts is 2h 15m newer than dist/browser/verdict-decoder-Dk_w2NG9.js.map
⚑ dist: @robota-sdk/agent-framework: dist/ may be STALE — src/workspace-trust/workspace-trust-service.ts is 23m 41s newer than dist/node/testing/index.js.map
⚑ dist: @robota-sdk/agent-provider-anthropic: dist/ may be STALE — src/anthropic/provider-definition.ts is 2h 15m newer than dist/node/index.js.map
⚑ dist: @robota-sdk/agent-provider-gemini: dist/ may be STALE — src/gemini/provider-definition.ts is 2h 15m newer than dist/node/index-PGQozwXD.d.ts.map
⚑ dist: @robota-sdk/agent-provider-openai: dist/ may be STALE — src/openai/provider-definition.ts is 2h 15m newer than dist/node/payload-logger-BaW0K8yI.d.ts.map
⚑ dist: 5 package(s) have a dist/ older than their src/. A cross-package type error seen only in a whole-workspace typecheck should be re-checked after the affected complete package build before it is treated as a branch defect.

157 scans passed, 5 skipped (162 declared what they examined)
scan receipt NOT written: working tree is not clean:  M .agents/evals/scenarios/behavior-2003-keybindings-agent-run.md,  M .agents/memory/MEMORY.md,  M .agents/spec-docs/active/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md,  M .agents/tasks/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md, ?? .agents/memory/hooks-run-from-the-app-worktree-copy.md
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `e3f31aa15c21` · base `origin/develop@e3f31aa15c21` · document `.agents/spec-docs/active/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md` blob `62ac9b028370` (modified)

### [GATE-COMPLETE] — ✅ PASS | 2026-09-19

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-09-19; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 10/10 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (10)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (10) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (10) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 10/10 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (10) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 5/5 tasks `[x]` in .agents/tasks/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `e3f31aa15c21` · base `origin/develop@e3f31aa15c21` · document `.agents/spec-docs/active/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md` blob `e7ada3dd721c` (modified)
