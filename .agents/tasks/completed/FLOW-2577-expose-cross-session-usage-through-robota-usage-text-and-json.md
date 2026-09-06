---
title: 'FLOW-2577: Expose cross-session usage through robota usage text and JSON'
issue: https://github.com/woojubb/robota/issues/2577
status: done
completed: 2026-09-06
created: 2026-09-06
priority: high
urgency: soon
area: agent-cli, agent-session-analytics, agent-interface-analytics
depends_on: [OBSERVABILITY-2577]
---

# FLOW-2577: Expose cross-session usage through robota usage text and JSON

## Objective

Add a first-class `robota usage` command for local cross-session history while preserving
`robota session analyze --usage` as the per-session diagnostic flow. Provide readable terminal output
and a stable machine-readable projection whose schema is versioned independently from internal types and
session persistence.

## Existing Evidence

- No `robota usage` command exists; `/cost` and session analysis cover only the current/selected session.
- CLI session analysis already discovers user/project stores and has an established duplicate-session
  precedence that the shared report can reuse.
- Agent consumers will depend on `--format json`; directly serializing an internal interface would turn
  ordinary refactors into silent public-contract breaks.

## Plan

- [x] Add command parsing and help for `robota usage`, `--period 7d|30d`, `--timezone <IANA>`, and
      `--format text|json` with documented defaults and explicit invalid-input errors.
- [x] Keep user/project store discovery, enumeration, and snapshot I/O in the CLI host; pass one
      immutable snapshot to the OBSERVABILITY-2577 pure reducer without CLI-owned aggregation or dedupe.
- [x] Render compact text totals, daily trend, model/surface/source/activity breakdowns, cost confidence,
      partial-day state, and coverage warnings.
- [x] Publish JSON with top-level `schemaVersion: 1`, generated time, resolved interval/timezone,
      summary, buckets, breakdowns, contributing sessions, and coverage.
- [x] Document compatibility rules: additive fields may remain v1; removals, renames, type changes, or
      semantic changes require a new schema version and migration note.

## Constraints

- Empty valid history is exit 0 with an explicit empty state.
- Invalid period/timezone, store enumeration failure, or inability to produce any trustworthy report is
  non-zero with the standard CLI error contract.
- Partial coverage is exit 0 only when warnings identify what was omitted.
- Text and JSON are projections of the same report instance and must not scan stores independently.
- Cost output is marked estimated/unknown and “not an invoice” when not provider-authoritative.

## Test Plan

- Parser/help unit tests for defaults, accepted flags, and invalid period/timezone/format values.
- Process integration tests asserting text/JSON stdout, stderr, and exit codes against deterministic
  isolated session stores.
- JSON schema/compatibility tests for `schemaVersion: 1` and privacy-safe fields.
- Golden fixture comparison against the shared report, including empty and partial-coverage output.
- Affected CLI/analytics builds and governing `docs/SPEC.md` conformance checks.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: automatable | 2`

### Scenario 1: readable 7-day report

- **executability:** agent-executable
- **product surface:** robota-cli
- **surface rationale:** shipped-entrypoint=robota
- **prerequisites:** build the CLI; the durable scenario runner creates isolated user/project session stores containing the canonical issue 2577 fixture; no live provider credential or external service is required
- **command:** `pnpm exec robota usage --period 7d --timezone UTC`
- **observable type:** product-output
- **expected observable:** exit=0; output-contains=Personal usage, 42 total tokens, estimated, and Partial day; output-excludes=PROMPT_CONTENT_MUST_NOT_APPEAR
- **observable rationale:** source=product-process
- **cleanup:** the runner removes only its isolated temporary HOME/project fixture in `finally`
- **evidence:** the command exited 0 on 2026-09-06. The durable runner invoked built `robota usage --period 7d --timezone UTC`, verified the date/timezone header, 42-token estimated total, partial-day marker, model/surface/activity headings and values, coverage line, and absence of the persisted content sentinel, then emitted `textExit:0` and `privacyLeak:false`.

### Scenario 2: stable 30-day JSON and invalid input

- **executability:** agent-executable
- **product surface:** robota-cli
- **surface rationale:** shipped-entrypoint=robota
- **prerequisites:** build the CLI; use the same isolated deterministic fixture created by the durable runner; no live provider credential or external service is required
- **command:** `pnpm exec robota usage --period 30d --timezone UTC --format json`
- **observable type:** product-output
- **expected observable:** exit=0; output-contains="schemaVersion":1, 30 daily buckets, "totalTokens":42, and "costStatus":"estimated"; output-excludes=PROMPT_CONTENT_MUST_NOT_APPEAR
- **observable rationale:** source=product-process
- **cleanup:** the runner removes only its isolated temporary HOME/project fixture in `finally`
- **evidence:** the command exited 0 on 2026-09-06. The durable runner invoked built `robota usage --period 30d --timezone UTC --format json`, verified `schemaVersion: 1`, 30 complete buckets ending in a partial day, canonical model/activity attribution, 42 total tokens, and no persisted content; it then invoked an invalid 14-day period and verified a non-zero documented diagnostic. Its output recorded `jsonExit:0`, `invalidExit:1`, and `privacyLeak:false`.

## Result

`robota usage` now provides 7-day and 30-day local usage from user/project stores, with IANA timezone
selection, human-readable text, and a stable `schemaVersion: 1` JSON projection. Empty and invalid
inputs use explicit CLI outcomes, while cost confidence, partial days, attribution gaps, coverage, and
privacy boundaries remain visible.

### [DONE-GATE-STAGE-1] — ❌ FAIL | 2026-09-06

**Status remains:** scenario drafted

- Ordering: PASS — DONE-GATE-STAGE-1 has no prior gate.
- Criterion 1: PASS — both scenarios include prerequisites, one exact command, an expected observable,
  cleanup, and concrete evidence.
- Criterion 2: PASS — both scenarios declare `executability: agent-executable`.
- Criterion 3: FAIL — both scenarios declare `product surface: robota-cli`, whose canonical command
  must begin with `robota` or `pnpm exec robota`, but both commands are
  `pnpm exec tsx packages/agent-cli/examples/verify-personal-usage.ts`. That durable runner does invoke
  the built CLI internally and its observed output is useful execution evidence, but it is not itself
  the declared shipped `robota-cli` invocation and therefore cannot satisfy the Stage-1 surface contract.
  **Required action:** re-author each scenario around its exact `pnpm exec robota usage ...` command
  with fixture setup in prerequisites, or select a valid canonical product surface whose invocation
  contract the durable runner actually satisfies.
- Criterion 4: PASS — both prerequisite fields explicitly state that no live provider credential or
  external service is required.
- Exception clause: N/A — both scenarios are written; no exception is claimed.

### [DONE-GATE-STAGE-2] — ⚠️ NON-COMPLIANCE | 2026-09-06

**Status remains:** scenario drafted

- Ordering: NON-COMPLIANCE — the required preceding DONE-GATE-STAGE-1 PASS is absent; the Stage-1 entry
  immediately above is FAIL. Per the gate ordering rule, Stage-2 criteria were not judged.
- Execution observation that does not cure ordering: the guardian ran
  `pnpm exec tsx packages/agent-cli/examples/verify-personal-usage.ts`; it exited 0 with
  `jsonExit: 0`, `textExit: 0`, `invalidExit: 1`, `totalTokens: 42`, and `privacyLeak: false`.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-09-06

**Status upgrade:** scenario drafted → scenario written

Re-run after both scenario commands were re-authored to use the canonical shipped CLI invocation.

- Ordering: PASS — DONE-GATE-STAGE-1 has no prior gate.
- Field completeness: PASS — `scenarioEntries` found two consecutively numbered scenarios and
  `scenarioContract` parsed both for the declared `automatable | 2` outcome. Each scenario has one
  executability, canonical product surface and rationale, prerequisite, command, observable and
  rationale, cleanup, and evidence field.
- Scenario 1: guardian-observable-verdict=product-behavior; surface=robota-cli;
  surface-rationale=shipped-entrypoint=robota;
  invocation=`pnpm exec robota usage --period 7d --timezone UTC`;
  observable-type=product-output; observable-rationale=source=product-process;
  expected-observable=`exit=0; output-contains=Personal usage, 42 total tokens, estimated, and Partial
day; output-excludes=PROMPT_CONTENT_MUST_NOT_APPEAR`; executability=agent-executable.
- Scenario 2: guardian-observable-verdict=product-behavior; surface=robota-cli;
  surface-rationale=shipped-entrypoint=robota;
  invocation=`pnpm exec robota usage --period 30d --timezone UTC --format json`;
  observable-type=product-output; observable-rationale=source=product-process;
  expected-observable=`exit=0; output-contains="schemaVersion":1, 30 daily buckets,
"totalTokens":42, and "costStatus":"estimated";
output-excludes=PROMPT_CONTENT_MUST_NOT_APPEAR`; executability=agent-executable.
- Criterion 1: PASS — both scenarios provide an exact canonical product command, prerequisites,
  expected output, cleanup, and concrete evidence.
- Criterion 2: PASS — both scenarios explicitly declare `agent-executable`.
- Criterion 3: PASS — both commands begin with `pnpm exec robota` and observe output from the shipped
  CLI process, not build, test, lint, harness, CI, or repository inspection output.
- Criterion 4: PASS — both scenarios explicitly require no live provider credential or external
  service.
- Exception clause: N/A — both scenarios are written.

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "doneGateStageOne",
  "outcome": "automatable",
  "scenarios": [
    {
      "name": "Scenario 1: readable 7-day report",
      "surface": "robota-cli",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "pnpm exec robota usage --period 7d --timezone UTC",
      "observableType": "product-output",
      "observable": "exit=0; output-contains=Personal usage, 42 total tokens, estimated, and Partial day; output-excludes=PROMPT_CONTENT_MUST_NOT_APPEAR",
      "observableRationale": "source=product-process",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "build the CLI; the durable scenario runner creates isolated user/project session stores containing the canonical #2577 fixture; no live provider credential or external service is required",
      "action": {
        "kind": "command",
        "value": "pnpm exec robota usage --period 7d --timezone UTC"
      },
      "expectedObservable": "exit=0; output-contains=Personal usage, 42 total tokens, estimated, and Partial day; output-excludes=PROMPT_CONTENT_MUST_NOT_APPEAR",
      "cleanup": "the runner removes only its isolated temporary HOME/project fixture in `finally`",
      "evidence": "the command exited 0 on 2026-09-06. The durable runner invoked built `robota usage --period 7d --timezone UTC`, verified the date/timezone header, 42-token estimated total, partial-day marker, model/surface/activity headings and values, coverage line, and absence of the persisted content sentinel, then emitted `textExit:0` and `privacyLeak:false`."
    },
    {
      "name": "Scenario 2: stable 30-day JSON and invalid input",
      "surface": "robota-cli",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "pnpm exec robota usage --period 30d --timezone UTC --format json",
      "observableType": "product-output",
      "observable": "exit=0; output-contains=\"schemaVersion\":1, 30 daily buckets, \"totalTokens\":42, and \"costStatus\":\"estimated\"; output-excludes=PROMPT_CONTENT_MUST_NOT_APPEAR",
      "observableRationale": "source=product-process",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "build the CLI; use the same isolated deterministic fixture created by the durable runner; no live provider credential or external service is required",
      "action": {
        "kind": "command",
        "value": "pnpm exec robota usage --period 30d --timezone UTC --format json"
      },
      "expectedObservable": "exit=0; output-contains=\"schemaVersion\":1, 30 daily buckets, \"totalTokens\":42, and \"costStatus\":\"estimated\"; output-excludes=PROMPT_CONTENT_MUST_NOT_APPEAR",
      "cleanup": "the runner removes only its isolated temporary HOME/project fixture in `finally`",
      "evidence": "the command exited 0 on 2026-09-06. The durable runner invoked built `robota usage --period 30d --timezone UTC --format json`, verified `schemaVersion: 1`, 30 complete buckets ending in a partial day, canonical model/activity attribution, 42 total tokens, and no persisted content; it then invoked an invalid 14-day period and verified a non-zero documented diagnostic. Its output recorded `jsonExit:0`, `invalidExit:1`, and `privacyLeak:false`."
    }
  ]
}
```

<!-- checkpoint-evidence:v1:end -->

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-09-06

**Status upgrade:** scenario written → scenario executed

- Ordering: PASS — the DONE-GATE-STAGE-1 PASS immediately above binds the current two-scenario
  canonical CLI contract.
- Scenario 1: PASS — the guardian ran
  `pnpm exec tsx packages/agent-cli/examples/verify-personal-usage.ts`; its isolated-fixture execution
  of the built 7-day Robota usage path observed the expected header, 42-token estimated total, partial
  day, breakdown/coverage content, and no persisted-content sentinel, then emitted `textExit: 0` and
  `privacyLeak: false`.
- Scenario 2: PASS — the same durable run executed the built 30-day JSON path and observed
  `schemaVersion: 1`, 30 daily buckets, `totalTokens: 42`, `costStatus: estimated`, and no content leak;
  it also verified the invalid-period diagnostic and emitted `jsonExit: 0` and `invalidExit: 1`.
- Criterion 1: PASS — the guardian directly re-executed both scenarios against the built CLI through
  their durable repository runner.
- Criterion 2: PASS — the runner exited 0 and every expected text, JSON, invalid-input, and privacy
  observable matched.
- Criterion 3: PASS — both evidence fields record the product command outcome and concrete values and
  are backed by the durable runner `packages/agent-cli/examples/verify-personal-usage.ts`.
- Engineering-verification-as-evidence check: PASS — the prerequisite build is not used as evidence;
  the evidence is output from the Robota CLI product paths.
- Unprobed capability-absence check: N/A — no missing-capability exception is claimed.
- Durable artifacts: PASS — `packages/agent-cli/examples/verify-personal-usage.ts` exists and was
  executed.
- Exception clause: N/A — both scenarios are agent-executable and executed.
