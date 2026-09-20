---
title: 'SCREEN-2670: Queue screen-reader frames with a pre-write cursor park'
issue: https://github.com/woojubb/robota/issues/2670
status: in-progress
created: 2026-09-14
priority: high
urgency: now
area: terminal UI package
depends_on: [STRUCT-012]
---

# SCREEN-2670: Queue screen-reader frames with a pre-write cursor park

## Objective

Add `ROBOTA_SCREEN_READER_PREPARK_MS` with a 50 ms default and 5000 ms bound, and provide Ink an owned
asynchronous stdout path that moves to column zero before each changed screen-reader frame. Preserve whole-frame
FIFO ordering, callbacks, backpressure, errors, dimensions, resize events and teardown; mode-off output stays byte-identical.

## Plan

One item per completion criterion of the paired spec, in id order; the design they implement is the spec's § Decision (per-COMMIT park, no injected cursor sequence, formation-time echo flag, control-only batches unparked).

- [x] TC-01: extend `resolvePacing` with `preparkMs` — default 50 (PROVISIONAL), bound 5000, exact `0`, refusal and clamp reported through the existing `resolveDuration` discipline.
- [x] TC-02: `screen-reader-stdout.ts` — batch the chunks of one synchronous run, park ONCE before the batch, release it contiguously.
- [x] TC-03: the echo flag — armed by text-mutating keys only (never submit/execute), stamped on the batch at formation, expired on `setImmediate`.
- [x] TC-04: ordering, callbacks, backpressure and dropped-batch settlement in the queue; a control-only batch adds no park.
- [x] TC-05: mode OFF passes no `stdout` key to `render()` at all.
- [x] TC-06: the proxy delegates `columns`/`rows`/`isTTY`/`resize`, is one stable object, and `flush()` drains before teardown.
- [x] TC-07: route the OSC 133 turn marks through the owned writer.
- [x] TC-08: engineering verification — build, test, typecheck, `pnpm harness:scan`, lint ceiling.
- [x] TC-09: the PTY scenario over the built CLI (`screen-2670-prepark.ptytest.ts`).
- [x] TC-10: prove the exemption FIRES through the composed render tree, and that the next non-composer commit is parked.
- [x] TC-11: the first batch of a session is released unparked; the second is parked.

## Test Plan

Prove the defect test RED on the unwrapped stdout, then GREEN with fake timers and a PTY frame capture. Run
the complete screen-reader, scrollback, fallback-render, terminal-capability and IME PTY suites.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

### Scenario 1: a transcript commit is paced before it is written, and a keystroke is not

- executability: agent-executable
- product surface: robota-tui
- surface rationale: shipped-entrypoint=robota
- prerequisites: affected packages are built (`pnpm build:deps`); no live credential and no external service are required — the turn is replayed from a session-log fixture through `--session-log`, the mechanism the SCREEN-006 and SCREEN-2002 scenarios already use. An isolated temporary HOME holds the fixture provider profile; the run is a 100x32 xterm-256color PTY with screen-reader mode on (`ROBOTA_SCREEN_READER=1`) and a park interval large enough to be unambiguous against the frame cadence (`ROBOTA_SCREEN_READER_PREPARK_MS=250`), driven by `src/__tests__/pty/screen-2670-prepark.ptytest.ts`
- command: `pnpm exec robota --name prepark-scenario`
- observable type: ui-state
- observable rationale: source=rendered-product-ui
- expected observable: visible=after submitting a prompt, the RAW byte stream shows each transcript COMMIT preceded by at least the configured interval, while the chunks within one commit are contiguous — the synchronized-output begin is immediately followed by its frame with no interval between them, and a `<Static>` erase is immediately followed by the frame it erased for; typing a character into the composer produces its echo with no preceding delay, so the input line is never held; the OSC 133 turn marks appear in order with the commit they belong to rather than inside a parked gap, and are not themselves delayed; the same run with `ROBOTA_SCREEN_READER_PREPARK_MS=0` injects no delay at all, and a run with the mode OFF is byte-identical to the pre-change binary
- cleanup: exit the Robota process normally with Ctrl+C and confirm it exited, then remove only the isolated HOME and project directories
- evidence: recorded — agent PTY run of `packages/agent-ui-terminal/src/__tests__/pty/screen-2670-prepark.ptytest.ts` against the workspace build, exit 0, 3 of 3 cases, repeated once with the same result (2026-09-20): with `ROBOTA_SCREEN_READER_PREPARK_MS=250` the `hello` echo landed within 190 ms of the keys while the turn's commit landed at least 190 ms after the echo burst and arrived whole — `\x1b[?2026h` … `REPLAYED_ANSWER_42` … `\x1b[?2026l` in one burst — with the OSC 133 prompt-start preceding the answer; with `=0` the answer followed the echo in under 190 ms; with the mode off likewise, and the snapshot kept the box-drawing chrome — full record in `.agents/evals/scenarios/screen-2670-prepark-agent-run.md`

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-09-20

**Status upgrade:** scenario drafted → scenario written

First Stage-1 run, pre-implementation. Ordering check: exempt — the prior-gate map records "DONE-GATE-STAGE-1
has no prior gate". Input state matches: Task `status: todo` with no `## Plan` item ticked, author verdict
`SCENARIO DRAFTED: automatable | 1`, the one scenario `evidence: pending`; paired spec
`.agents/spec-docs/todo/SCREEN-2670-…` `status: approved`, `lane: L2`, with GATE-WRITE ✅ PASS and
GATE-APPROVAL ✅ PASS (2026-09-20) and no GATE-IMPLEMENT entry. Nothing this gate authorizes has run:
`git status --porcelain` carries no path outside `.agents/` (this Task and its untracked spec, the SCREEN-2002
spec/Task, the AGREEMENT-2670 spec/Task, the orchestrator and user-execution-scenario ledgers, one evals
scenario record, and the two auto-generated lessons files);
`packages/agent-ui-terminal/src/__tests__/pty/screen-2670-prepark.ptytest.ts` does not exist, and
`ROBOTA_SCREEN_READER_PREPARK_MS` has no reader under `packages/agent-ui-terminal/src` or
`packages/agent-cli/src` — `screen-reader-pacing.ts:9-14` still reads "THE PRE-WRITE PARK IS NOT SHIPPED".
Section identity: this Task's scenario content (author verdict through `evidence: pending`) is byte-identical
to the spec's `## User Execution Test Scenarios`. Mechanical: over this section `validateApplicableScenarioSection`
returns ok and `scenarioContract(body, "automatable")` returns a complete contract;
`productSurfaceInvocation('robota-tui', …)` returns `pnpm exec robota --name prepark-scenario` verbatim and
`null` for an `&&`-chained form. The JSON below is the `stageOneScenarioPayload` derivation from that contract.

Per criterion:

1. **Fields complete.** The scenario carries its ten canonical field lines exactly once: executability, product
   surface, surface rationale, prerequisites, command `pnpm exec robota --name prepark-scenario`, observable
   type, observable rationale, expected observable, cleanup, `evidence: pending`. The PTY driver the
   prerequisites name (`src/__tests__/pty/screen-2670-prepark.ptytest.ts`) does not exist yet; the spec's
   § Affected Files lists it as new and the Task `## Plan` item "Prove timing, coalescing, error/backpressure
   propagation, PTY byte order and CLI-062 cursor-order regression" folds building it into this unit — the
   rule's build-the-environment-inside-the-backlog route, not an unmet environment. Its substrate exists today:
   `pty-driver.ts` `spawnTui` spawns `packages/agent-cli/bin/robota.cjs` in a 100×32 xterm-256color PTY with
   an isolated HOME; `--session-log` is a real flag (`packages/agent-cli/src/utils/cli-args.ts:178`);
   `ROBOTA_SCREEN_READER` is read by `packages/agent-cli/src/startup/screen-reader-enablement.ts`; and
   `screen-reader-mode.ptytest.ts` TC-11/TC-12 already replay `fixtures/replay-conversation.jsonl` under that
   env through the same driver — met.
2. **Executability decision.** `executability: agent-executable`. Not `manual-only`, so the
   `automation barrier:` / `unavailable capability:` / `attempted automation:` trio is **N/A** — asserting them
   would invent a barrier that is not claimed. The invocation shape was attempted, not assumed:
   `pnpm exec robota --version` exits 0 and `node packages/agent-cli/bin/robota.cjs --version` prints
   `robota 3.0.0-beta.79`, the workspace build the driver spawns. PTY-driven TUI scenarios have been executed
   at Stage 2 in this repository (SCREEN-1993, SCREEN-2002) — met.
3. **Canonical surface, canonical invocation, product behaviour.** `product surface: robota-tui` with
   `surface rationale: shipped-entrypoint=robota`; `observable type: ui-state` with
   `observable rationale: source=rendered-product-ui`, an allowed TUI pairing; the expected value is in the
   type-correct `visible=` shape. The observable is the product's own byte stream: the OSC 133 marks are
   emitted by `packages/agent-ui-terminal/src/terminal-marks.ts:31`, the `<Static>` transcript is
   `AppPresentation.tsx:29`, and the synchronized-output begin/end and erase chunks are Ink's screen-reader-mode
   commit (`ink.js:371-412`, per the spec's § Decision). Two control clauses — the same run with
   `ROBOTA_SCREEN_READER_PREPARK_MS=0`, and a mode-OFF run byte-identical to the pre-change binary — are A/B
   observations of the same canonical surface under the same command with the same prerequisites, held in the
   single `visible=` observable rather than substituted into the invocation field; Stage 2 must execute those
   control runs as well, the mode-OFF one against a build of the planning-checkpoint commit. Neither observable
   is a build, typecheck, lint, test run, harness check, CI check, or an inspection of repository text —
   `guardian-observable-verdict=product-behavior` — met.
4. **Credential / external-service prerequisite.** The prerequisites state it explicitly — "no live credential
   and no external service are required" — and name the substitute: a session-log replay through
   `--session-log` from an isolated temporary HOME. An executor learns from the scenario, not from a failure,
   that nothing external is needed — met.

Field-completeness result: 1 of 1 scenarios complete under the canonical contract; 0 unwritten scenarios, so
the written-is-impossible exception is not invoked.

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "doneGateStageOne",
  "outcome": "automatable",
  "scenarios": [
    {
      "name": "Scenario 1: a transcript commit is paced before it is written, and a keystroke is not",
      "surface": "robota-tui",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "pnpm exec robota --name prepark-scenario",
      "observableType": "ui-state",
      "observable": "visible=after submitting a prompt, the RAW byte stream shows each transcript COMMIT preceded by at least the configured interval, while the chunks within one commit are contiguous — the synchronized-output begin is immediately followed by its frame with no interval between them, and a `<Static>` erase is immediately followed by the frame it erased for; typing a character into the composer produces its echo with no preceding delay, so the input line is never held; the OSC 133 turn marks appear in order with the commit they belong to rather than inside a parked gap, and are not themselves delayed; the same run with `ROBOTA_SCREEN_READER_PREPARK_MS=0` injects no delay at all, and a run with the mode OFF is byte-identical to the pre-change binary",
      "observableRationale": "source=rendered-product-ui",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "affected packages are built (`pnpm build:deps`); no live credential and no external service are required — the turn is replayed from a session-log fixture through `--session-log`, the mechanism the SCREEN-006 and SCREEN-2002 scenarios already use. An isolated temporary HOME holds the fixture provider profile; the run is a 100x32 xterm-256color PTY with screen-reader mode on (`ROBOTA_SCREEN_READER=1`) and a park interval large enough to be unambiguous against the frame cadence (`ROBOTA_SCREEN_READER_PREPARK_MS=250`), driven by `src/__tests__/pty/screen-2670-prepark.ptytest.ts`",
      "action": {
        "kind": "command",
        "value": "pnpm exec robota --name prepark-scenario"
      },
      "expectedObservable": "visible=after submitting a prompt, the RAW byte stream shows each transcript COMMIT preceded by at least the configured interval, while the chunks within one commit are contiguous — the synchronized-output begin is immediately followed by its frame with no interval between them, and a `<Static>` erase is immediately followed by the frame it erased for; typing a character into the composer produces its echo with no preceding delay, so the input line is never held; the OSC 133 turn marks appear in order with the commit they belong to rather than inside a parked gap, and are not themselves delayed; the same run with `ROBOTA_SCREEN_READER_PREPARK_MS=0` injects no delay at all, and a run with the mode OFF is byte-identical to the pre-change binary",
      "cleanup": "exit the Robota process normally with Ctrl+C and confirm it exited, then remove only the isolated HOME and project directories",
      "evidence": "pending"
    }
  ]
}
```

<!-- checkpoint-evidence:v1:end -->

### [DONE-GATE-STAGE-1] — ✅ PASS (guardian confirmation) | 2026-09-20

Guardian confirmation of the author-written record above (`### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-09-20`),
judged by `backlog-gate-guard` and re-derived at source rather than taken from that record. This heading is
deliberately NOT in the canonical dated-PASS form so `canonicalRawPassEntries` in
`scripts/harness/scan-user-execution-plan-order.mjs` still counts exactly one Stage-1 PASS entry (the
author's, which carries the `checkpoint-evidence:v1` block); the verdict is the guardian's, the machine
record stays single.

**Ordering check: exempt.** `.agents/specs/gate-catalogue.md` prior-gate map: "DONE-GATE-STAGE-1 has no
prior gate". Input state verified on disk at judgement time: Task `status: todo`, `## Plan` TC-01..TC-11 all
`- [ ]`; paired spec `.agents/spec-docs/todo/SCREEN-2670-…md` (untracked) `status: approved`, the folder
`spec-workflow.md:256` maps `approved` to; its LAST `[GATE-APPROVAL]` entry is `✅ PASS | 2026-09-20` and
no `[GATE-IMPLEMENT]` entry exists. Nothing this gate authorizes has run: `git status --porcelain` lists six
paths, all under `.agents/`; `screen-reader-stdout.ts`, `screen-reader-pacing-context.tsx`,
`screen-reader-stdout.test.ts` and `pty/screen-2670-prepark.ptytest.ts` do not exist;
`ROBOTA_SCREEN_READER_PREPARK_MS` has no reader under `packages/agent-ui-terminal/src` or
`packages/agent-cli/src`; `screen-reader-pacing.ts:9` still reads "THE PRE-WRITE PARK IS NOT SHIPPED".

**Verified at source (not from the record):**

- Section identity: the Task's `## User Execution Test Scenarios` body (author verdict through
  `evidence: pending`, 16 lines) and the spec's are byte-identical — sha256
  `f764b7e810fcab6ffcfed54d3fb628245d39acae0dc1efdf0d3cb3ea62ef34bb` for both.
- Ten canonical fields, each exactly once and no other field line: executability, product surface, surface
  rationale, prerequisites, command, observable type, observable rationale, expected observable, cleanup,
  evidence (10 field lines total).
- `validateApplicableScenarioSection` → `ok: true`; `scenarioContract(body, 'automatable')` → complete;
  `productSurfaceInvocation('robota-tui', …)` → `pnpm exec robota --name prepark-scenario` verbatim, and
  `null` for both an `&&`-chained form and a `node packages/agent-cli/bin/robota.cjs …` substitution.
- The `checkpoint-evidence:v1` block is exactly one; top keys `version/form/outcome/scenarios`;
  `outcome: automatable` binds the author count `1`; the 14 scenario keys are in the rule's `scenarioKeys`
  order with no conditional key (correct: agent-executable, not `product-state-file`); every value equals
  the contract-derived field — name, surface, surfaceRationale, invocation, observableType,
  observable = expectedObservable, observableRationale, executability, prerequisite,
  `action: {kind: command, value: <invocation>}`, cleanup, `evidence: pending` — and
  `guardianObservableVerdict = product-behavior`. Matches `stageOneScenarioPayload` field-for-field.
- Executability proven, not asserted: `pnpm exec robota --version` → exit 0;
  `node packages/agent-cli/bin/robota.cjs --version` → `robota 3.0.0-beta.79`, exit 0; `--name` is in
  `--help`; `--session-log` is parsed at `packages/agent-cli/src/utils/cli-args.ts:178` and consumed at
  `:287` (it is not listed in `--help`, which is why the source line is the right citation);
  `screen-reader-mode.ptytest.ts:69,119` already pass `['--session-log', REPLAY_FIXTURE]` through
  `spawnTui`, which spawns `packages/agent-cli/bin/robota.cjs` under `process.execPath` with an isolated
  `HOME` and `TERM=xterm-256color` (`pty-driver.ts:18,113-130`); `ROBOTA_SCREEN_READER` is read at
  `screen-reader-enablement.ts:132`.
- `node scripts/harness/scan-spec-user-execution-section.mjs` → exit 0 (451 governed documents).

**Binary resolution — a Stage-2 matter, not a Stage-1 defect.** On this host `pnpm exec robota` at the
workspace root falls through to PATH (`~/.volta/bin/robota`, 3.0.0-beta.72; there is no
`node_modules/.bin/robota` at the root), not the workspace 3.0.0-beta.79. Stage 1 judges the canonical
form, which `backlog-execution.md` requires begin with `robota` or `pnpm exec robota` — the scenario had no
other canonical choice — and the prerequisites bind the run to the PTY driver, which spawns the workspace
binary by path. Stage 2 must show its evidence came from the workspace build (the `robota.cjs` spawn, or
`pnpm exec robota` from a cwd where it resolves to the workspace bin); a run against beta.72 would not
exercise the implemented code path and would be a Stage-2 FAIL.

**Stale citation, not a defect.** The author's criterion-1 text cites the Plan item "Prove timing,
coalescing, error/backpressure propagation, PTY byte order and CLI-062 cursor-order regression", which the
Task's `## Plan` no longer carries — it was rewritten to TC-01..TC-11 after the record was written. TC-09
"the PTY scenario over the built CLI (`screen-2670-prepark.ptytest.ts`)" now folds the driver's
construction into this unit, so the build-the-environment-inside-the-backlog route still holds.

Per criterion (gate-catalogue § DONE-GATE-STAGE-1):

1. **Every scenario written with exact command, prerequisites, expected observable, evidence field** — PASS.
   Exact command `pnpm exec robota --name prepark-scenario`; prerequisites name the build step, the replay
   fixture mechanism, the isolated HOME, the 100x32 xterm-256color PTY, `ROBOTA_SCREEN_READER=1`,
   `ROBOTA_SCREEN_READER_PREPARK_MS=250` and the driver; expected observable in `visible=` form; cleanup;
   `evidence: pending`. 1 of 1 scenarios complete.
2. **Executability decision** — PASS. `executability: agent-executable`. The `automation barrier:` /
   `unavailable capability:` / `attempted automation:` trio is N/A: the contract requires their count be 0
   for an automatable scenario, and it is 0.
3. **Canonical surface, matching invocation, product behaviour** — PASS. `robota-tui` +
   `shipped-entrypoint=robota`; `ui-state` + `source=rendered-product-ui` (allowed TUI pairing). The
   observable is the product's raw PTY byte stream — OSC 133 marks emitted by
   `packages/agent-ui-terminal/src/terminal-marks.ts:31`, the `<Static>` transcript at
   `AppPresentation.tsx:29`, Ink's screen-reader-mode commit — not a build, typecheck, lint, test run,
   harness check, CI check or inspection of repository text. `guardian-observable-verdict=product-behavior`.
   The two control clauses (`ROBOTA_SCREEN_READER_PREPARK_MS=0`, and mode OFF byte-identical to the
   pre-change binary) are A/B observations of the same command under the same prerequisites held inside the
   single `visible=` value; Stage 2 must execute both, the mode-OFF one against a build of the
   planning-checkpoint commit.
4. **Live credential / external service stated explicitly** — PASS. "no live credential and no external
   service are required", with the substitute named (`--session-log` replay from an isolated HOME).

Exception clause: not invoked — 0 unwritten scenarios.

**Verdict:** the author's PASS record is confirmed on independent re-derivation; no criterion is unmet.
`GATE VERDICT: PASS`
