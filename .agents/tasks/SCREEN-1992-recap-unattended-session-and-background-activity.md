---
title: 'SCREEN-1992: Recap unattended session and background activity'
issue: https://github.com/woojubb/robota/issues/1992
status: in-progress
created: 2026-09-14
priority: high
urgency: now
area: packages/agent-interface-execution, packages/agent-executor, packages/agent-framework, packages/agent-ui-terminal, packages/agent-cli
depends_on: [STRUCT-012, REFACTOR-025]
---

# SCREEN-1992: Recap unattended session and background activity

## Objective

Model terminal attention intervals and project existing structured execution events into a one-line recap
when attention returns. Retain the existing background status, peek and schedule projection; add bounded,
provider-neutral headlines and a live next-iteration countdown without making recap correctness depend on
a model response.

## Plan

- [x] TC-01, TC-06: Attention tracker with focus-event and input-idle sources, the stdin filter, the
      focus-reporting gate and its DECSET/DECRST writer bracketed with raw mode and handoff.
- [x] TC-02, TC-07: Interval recap accumulator (turns by source, needs-input, terminal entries), the
      recap notice, `turn_source` on the channel, and the row's state word + headline rendering.
- [x] TC-03, TC-05: Contract fields `state`/`headline`/`nextFireAt` and `pendingRequest`, the
      framework projection with the total mapping, the parked-prompt seam and its workspace emit.
- [x] TC-04, TC-08: Live countdown from `nextFireAt` and the executor fix that lets a one-shot
      schedule reach `completed`.
- [x] TC-09, TC-10: The PTY scenario on the built CLI and engineering verification.

## Test Plan

Use structured event fixtures and fake timers for interval and cadence behavior, then execute a PTY scenario
that backgrounds work, marks the surface unattended, emits activity and confirms exactly one recap on return.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

### Scenario 1: return to a session that ran a scheduled wake while unattended

- executability: agent-executable
- product surface: robota-tui
- surface rationale: shipped-entrypoint=robota
- prerequisites: affected packages are built; an isolated temporary HOME holds an `openai`-type provider profile (`currentProvider: stub`; `providers.stub = { type: openai, model: stub-model, apiKey: stub-key, baseURL }`) whose `baseURL` points at a local stub HTTP server started by the driver `scratch/src/screen-1992-recap-scenario.mts` (Node `http`, answering `POST /v1/chat/completions` with one short canned assistant message — SSE chunks when the request carries `stream: true`, JSON otherwise — and recording every request); a 100×32 xterm-256color PTY with `NO_COLOR=1` runs the command; the driver submits `hello` and waits for the canned reply, submits `/schedule in 1m say hello`, samples the background row for the countdown, writes `ESC [ O` to simulate focus loss, waits for the wake turn to reach the stub, writes `ESC [ I` to simulate focus return, then writes a second `ESC [ O` / `ESC [ I` pair with no activity in between; no live credential or external service is required
- command: `pnpm exec robota --name recap-scenario`
- observable type: ui-state
- observable rationale: source=rendered-product-ui
- expected observable: visible=after `/schedule in 1m say hello` the background row shows `working` with a countdown that decreases at least twice (e.g. `in 58s` then `in 55s`); after `ESC [ O` and the wake firing, `ESC [ I` renders exactly one line starting `While away` that names 1 turn finished (1 wake); the main-thread row read `working` during the wake turn and the schedule row reads `completed` after its fire; a second `ESC [ O` then `ESC [ I` with no activity renders no further `While away` line
- cleanup: exit the Robota process normally with Ctrl+C and confirm it exited, stop the stub server, then remove only the isolated HOME, project and captured transcript directories
- evidence: recorded — strict driver run, exit 0: countdown samples `[58,57,56,55,54,53,52]`, `● working Main thread` read through the switcher during the held wake turn, exactly one `While away <1m: 1 turn finished (1 wake) · 1 completed` line on `ESC [ I`, the schedule row `✓ completed`, zero `While away` lines for the empty second interval — in `.agents/evals/scenarios/screen-1992-attention-recap-agent-run.md` (2026-09-19)

### [DONE-GATE-STAGE-1] — ❌ FAIL | 2026-09-19

**Status remains:** scenario drafted
**Ordering check:** exempt — `gate-catalogue.md` § Prior-gate map declares DONE-GATE-STAGE-1 has no prior
gate. Input state observed: Task `status: todo` in `.agents/tasks/`, author verdict
`SCENARIO DRAFTED: automatable | 1`, Scenario 1 `evidence: pending`; spec at
`.agents/spec-docs/todo/…` (status approved, untracked); no GATE-IMPLEMENT entry and no implementation
commits on `feat/screen-1992-attention-recap` beyond `origin/develop` `960af3e10` — consistent with a
pre-implementation Stage-1 run.

**Failed criterion:**

- Complete canonical field set (catalogue criterion 1 / `backlog-execution.md` § Scenario Design
  Preference Order, "canonical single-line fields"): the Scenario 1 body is not limited to canonical
  fields. The 15-line free-text paragraph beginning `Executability proof (PLAN mode, 2026-09-19, …)`
  (Task lines 60–74) sits inside the `### Scenario 1` entry, and the rule-owned parser
  (`scripts/harness/user-execution-scenario-contract.mjs` → `scenarioContract`) rejects any scenario
  body containing a non-field line — verified: `scenarioContract(body, 'automatable')` returns `null`
  for the entry as written, and returns a complete contract when only the ten `- <label>:` lines are
  parsed. Because `scan-user-execution-plan-order.mjs` binds the `doneGateStageOne` checkpoint to that
  parser (`authored scenario does not satisfy the canonical product contract`), a PASS recorded now
  would be contradicted by the mechanical floor at the planning checkpoint. The proof content itself is
  sound (driver exists at `scratch/src/screen-1992-recap-scenario.mts`, 403 lines; quoted product
  strings `Type a message or /help` and `Scheduled wake (once at …)` exist in
  `packages/agent-ui-terminal/src/InputArea.tsx` and `packages/agent-command/src/schedule/schedule-command.ts`)
  — it is the placement inside the scenario entry that fails. **Required action:** relocate the
  executability-proof paragraph outside the `### Scenario 1` entry (e.g. under `## Test Plan` or another
  section the Task uses for engineering evidence) so the scenario body consists solely of its canonical
  fields; do not alter the field values.

**Criteria met (recorded for the re-run):**

- Written with exact command, prerequisites, expected observable and evidence field: yes —
  `command: pnpm exec robota --name recap-scenario`; `prerequisites:` names the built packages, the
  isolated HOME provider profile (`currentProvider: stub`, type `openai`, `baseURL` → local stub), the
  100×32 `xterm-256color` PTY with `NO_COLOR=1`, the driver path and the exact input sequence
  (`hello`, `/schedule in 1m say hello`, `ESC [ O`, `ESC [ I`, second pair); `expected observable:`
  present; `cleanup:` present; `evidence: pending`.
- Executability decision: `executability: agent-executable`; corroborated by the driver file and by
  `packages/agent-cli/bin/robota.cjs` existing as the driver's target.
- Canonical surface and invocation: `product surface: robota-tui`, `surface rationale:
shipped-entrypoint=robota`, invocation begins `pnpm exec robota`; `observable type: ui-state`,
  `observable rationale: source=rendered-product-ui` (allowed pairing for TUI). The observable is the
  rendered background row, state word, countdown and `While away` recap line of the running TUI —
  product behaviour, not build/typecheck/lint/test/harness/CI or repository-text inspection.
  guardian-observable-verdict=product-behavior.
- Credential/external-service prerequisite: stated explicitly — "no live credential or external service
  is required"; the OpenAI-compatible stub is a Node `http` server the driver itself starts on
  `127.0.0.1` (verified in the driver source).
- Expected observable is concrete: `visible=` names literal strings (`working`, `in 58s` then `in 55s`
  as a decreasing countdown, exactly one line starting `While away` naming `1 turn` / `1 wake`,
  schedule row `completed`, no further `While away` after the second focus pair).

No `doneGateStageOne` checkpoint block is recorded: the rule-owned form is the PASS record, and the
scenario it would bind does not currently satisfy the canonical contract.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-09-19

**Status upgrade:** scenario drafted → scenario written

Re-run after the FAIL above. Ordering check: exempt (no prior gate per the catalogue); Task still
`status: todo`, author verdict `SCENARIO DRAFTED: automatable | 1`, Scenario 1 `evidence: pending`,
no GATE-IMPLEMENT entry, no implementation commits beyond `origin/develop` `960af3e10`. The
executability-proof paragraph now lives under `## Recommendation Evidence`; the `### Scenario 1`
body is its ten canonical field lines only, unchanged in value since the FAIL run.
`scripts/harness/user-execution-scenario-contract.mjs` → `validateApplicableScenarioSection` returns
ok and `scenarioContract(body, "automatable")` returns a complete contract (the criterion that failed).

Per criterion: (1) exact command `pnpm exec robota --name recap-scenario`, prerequisites naming the
built packages, the isolated-HOME `openai`-type stub profile, the driver
`scratch/src/screen-1992-recap-scenario.mts` (exists, 403 lines, targets `packages/agent-cli/bin/robota.cjs`),
the 100×32 PTY and the exact input sequence, an expected observable, cleanup and an evidence field — met.
(2) `executability: agent-executable` — met. (3) canonical `robota-tui` /
`shipped-entrypoint=robota` identity with an invocation beginning `pnpm exec robota`; observable type
`ui-state` / `source=rendered-product-ui`, an allowed TUI pairing; the observable is the running TUI's
rendered background row, state word, countdown and `While away` recap — product behaviour, not
build/typecheck/lint/test/harness/CI or repository-text inspection;
guardian-observable-verdict=product-behavior — met. (4) credential/external-service prerequisite stated
explicitly: "no live credential or external service is required"; the stub is a Node `http` server the
driver itself starts on `127.0.0.1` (verified in the driver source) — met. (5) expected observable is
concrete: `visible=` names `working`, a decreasing countdown (`in 58s` then `in 55s`), exactly one
line starting `While away` naming 1 turn / 1 wake, schedule row `completed`, and no further
`While away` after the second focus pair — met.

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "doneGateStageOne",
  "outcome": "automatable",
  "scenarios": [
    {
      "name": "Scenario 1: return to a session that ran a scheduled wake while unattended",
      "surface": "robota-tui",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "pnpm exec robota --name recap-scenario",
      "observableType": "ui-state",
      "observable": "visible=after `/schedule in 1m say hello` the background row shows `working` with a countdown that decreases at least twice (e.g. `in 58s` then `in 55s`); after `ESC [ O` and the wake firing, `ESC [ I` renders exactly one line starting `While away` that names 1 turn finished (1 wake); the main-thread row read `working` during the wake turn and the schedule row reads `completed` after its fire; a second `ESC [ O` then `ESC [ I` with no activity renders no further `While away` line",
      "observableRationale": "source=rendered-product-ui",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "affected packages are built; an isolated temporary HOME holds an `openai`-type provider profile (`currentProvider: stub`; `providers.stub = { type: openai, model: stub-model, apiKey: stub-key, baseURL }`) whose `baseURL` points at a local stub HTTP server started by the driver `scratch/src/screen-1992-recap-scenario.mts` (Node `http`, answering `POST /v1/chat/completions` with one short canned assistant message — SSE chunks when the request carries `stream: true`, JSON otherwise — and recording every request); a 100×32 xterm-256color PTY with `NO_COLOR=1` runs the command; the driver submits `hello` and waits for the canned reply, submits `/schedule in 1m say hello`, samples the background row for the countdown, writes `ESC [ O` to simulate focus loss, waits for the wake turn to reach the stub, writes `ESC [ I` to simulate focus return, then writes a second `ESC [ O` / `ESC [ I` pair with no activity in between; no live credential or external service is required",
      "action": {
        "kind": "command",
        "value": "pnpm exec robota --name recap-scenario"
      },
      "expectedObservable": "visible=after `/schedule in 1m say hello` the background row shows `working` with a countdown that decreases at least twice (e.g. `in 58s` then `in 55s`); after `ESC [ O` and the wake firing, `ESC [ I` renders exactly one line starting `While away` that names 1 turn finished (1 wake); the main-thread row read `working` during the wake turn and the schedule row reads `completed` after its fire; a second `ESC [ O` then `ESC [ I` with no activity renders no further `While away` line",
      "cleanup": "exit the Robota process normally with Ctrl+C and confirm it exited, stop the stub server, then remove only the isolated HOME, project and captured transcript directories",
      "evidence": "pending"
    }
  ]
}
```

<!-- checkpoint-evidence:v1:end -->

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-09-19

**Status upgrade:** scenario written → scenario executed

Ordering: the last `[DONE-GATE-STAGE-1]` entry is ✅ PASS (2026-09-19), frozen with its
`doneGateStageOne` JSON in the planning checkpoint `ec79030f5`, which is an ancestor of HEAD
`52431286f`; the implementation commit `52431286f` is the only commit after the checkpoint on
`feat/screen-1992-attention-recap` above `origin/develop` `960af3e10`. Task `status: in-progress`;
every `## Plan` item is ticked. Scenario 1's `expected observable` field is byte-identical to the
checkpoint's `expectedObservable` (compared against `git show ec79030f5:<Task>`); the only Task
changes since the checkpoint are the five Plan ticks and the `- evidence:` line. Build freshness:
`packages/agent-ui-terminal/dist` was older than `src/attention/interval-recap.ts` (and the
`agent-cli` bundle inlines ui-terminal), so the guardian ran `pnpm --filter @robota-sdk/agent-ui-terminal
build` then `pnpm --filter @robota-sdk/agent-cli build` (exit 0) before the run; `agent-framework`,
`agent-executor` and `agent-interface-execution` dists were already newer than their newest `src/`
file. The guardian then re-executed the scenario itself:
`RECAP_SCENARIO_STRICT=1 pnpm --dir scratch exec tsx src/screen-1992-recap-scenario.mts` → exit 0,
report `command: node …/packages/agent-cli/bin/robota.cjs --name recap-scenario --disable-update-check
--no-session-persistence`, `scheduleDelay: 1m`, `exitCode: 0`, stub requests `hello` then `say hello`
(both `stream: true`), `harness.cliStarted: true`, `harness.wakeFired: "say hello"`.

- Scenario 1 — `pnpm exec robota --name recap-scenario` (100×32 xterm-256color PTY, `NO_COLOR=1`,
  isolated HOME with the `openai`-type stub profile, local stub on 127.0.0.1): exit 0. Matched clause by
  clause against `expected observable` from the guardian's own strict run (`todo[].observed`):
  (a) background row shows `working` with a countdown decreasing at least twice — observed
  `[58,57,56,55,54,53,52]` and rows `└ ⟳ working Scheduled: say hello · sleeping · scheduled · ↻ wake
"say hello" · say hello · in 55s` … `in 52s`; (b) after `ESC [ O` and the wake firing, `ESC [ I`
  renders exactly one line starting `While away` naming 1 turn finished (1 wake) — observed
  `["While away <1m: 1 turn finished (1 wake) · 1 completed"]`; (c) main-thread row read `working`
  during the wake turn — observed `["│ > ● working Main thread · active · 5 history entries · user │"]`
  (read through the Ctrl+B switcher while the stub held the wake reply); (d) schedule row reads
  `completed` after its fire — observed `└ ✓ completed Scheduled: say hello · completed · scheduled · …`;
  (e) a second `ESC [ O` / `ESC [ I` with no activity renders no further `While away` line — observed
  `[]`, asserted after the first recap had rendered (driver lines 350–379), so not vacuous. All six
  strict checks `matched: true`.
- Evidence record: `.agents/evals/scenarios/screen-1992-attention-recap-agent-run.md` § Observed
  (2026-09-19), committed in `52431286f`; its `checks[].observed` values equal the guardian's run
  (countdown `[58,57,56,55,54,53,52]`, the same `working` rows, the same single `While away` line,
  `✓ completed`, `[]`). The `- evidence:` field cites that record and quotes product output only;
  referenced paths `scratch/src/screen-1992-recap-scenario.mts` and `packages/agent-cli/bin/robota.cjs`
  exist. No exception (`manual-only`) or capability-absence claim was made, so none needed a probe.
  The record's `### Supporting test suites` list is engineering verification and was not counted as
  user-execution evidence. Observation for the orchestrator, not a criterion of this gate: the record's
  `**Spec:**` header names `.agents/spec-docs/done/…` while the spec currently sits in
  `.agents/spec-docs/active/`; the sibling record named `active/` at this stage and was retargeted in
  the completion commit that moves the spec.

## Recommendation Evidence

**Scenario executability proof (PLAN mode, 2026-09-19):** the driver above was run
against the built CLI (`robota 3.0.0-beta.79`, built from `origin/develop`) with
`RECAP_SCENARIO_DELAY=10s` and with the default `1m`. Harness observed: the TUI started in the PTY and
rendered `Type a message or /help`; `hello` reached the stub as `POST /v1/chat/completions` with
`stream: true` and the canned reply rendered; `/schedule in 1m say hello` printed
`Scheduled wake (once at …): "say hello" — task process_1.` and the background panel rendered
`└ ⟳ Scheduled: say hello · sleeping · scheduled · ↻ wake "say hello" · next: 59s · say hello`
(`next: 9s` on the 10s run) and the text never changed until the fire; the wake reached the stub 60 s
later with last user content `say hello` and the canned reply rendered while unattended; Ctrl+C
exited 0. Observables awaiting
implementation (driver TODO checks, reported not thrown until `RECAP_SCENARIO_STRICT=1`): the
countdown (today `next: Nm` is baked and never ticks), the `working` state word, the `While away`
line (today `ESC [ O` / `ESC [ I` are typed into the composer as `[O[I`), the schedule row's
`completed` (today it stays `running · scheduled · <cwd>`). The "no second recap" check matched
vacuously today (no recap exists at all) and only carries weight once the first recap renders.

- `DEPTH VERDICT: LOCAL` — 2026-09-19 (`finding-depth-triager`): the premises hold against the code
  (no attention model, no interval accumulator, baked `next: Xm`, no focus handling, events reaching the
  TUI only as a projection); the gap is a missing capability, not a symptom of a mis-shaped seam.
- `REVIEW VERDICT: ENDORSE` — 2026-09-19 (`proposal-reviewer`, round 3, after round 1 REVISE with 10
  findings and round 2 REVISE with 4): Alternative 1 with the amendments recorded in the spec's Decision
  (`turn_source` on the channel, stdin-level focus filter, focus-authoritative precedence, parked-prompt
  seam for main-thread needs-input, total five-word state mapping, baked subtitle removed, TUI-originated
  recap notice, injected focus override, handoff hooks, coordinator file, executor one-shot fix re-planned
  into scope).
- Root items recorded on the umbrella (issue #2670 comment), not filed as issues: background
  `needs-input` is declared but unreachable (no path fires `background_task_permission_request`);
  `ROBOTA_*` environment literals in `agent-ui-terminal/src/terminal-capabilities.ts` (NEUT-009 family).
- Standing authorization: the session goal of 2026-09-19 — "GitHub 이슈 `#2670`의 남은 범위를 모두 구현하고,
  PR을 origin/develop에 병합한 뒤 관련 이슈를 닫아줘".
