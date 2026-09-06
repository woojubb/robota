---
title: 'AGREEMENT-2577: Coordinate cross-session usage reporting across CLI and GUI'
issue: https://github.com/woojubb/robota/issues/2577
status: done
created: 2026-09-06
completed: 2026-09-06
priority: high
urgency: soon
area: agent-interface-analytics, agent-session-analytics, agent-interface-session, agent-core, agent-session, agent-cli, agent-transport-protocol, agent-transport-gui, agent-app
depends_on: []
children: [DATA-2577, OBSERVABILITY-2577, FLOW-2577, SCREEN-2577]
---

# AGREEMENT-2577: Coordinate cross-session usage reporting across CLI and GUI

## Objective

Turn [issue #2577](https://github.com/woojubb/robota/issues/2577) into one provider-neutral
personal-usage product whose persisted attribution,
cross-session accounting, CLI output, and GUI dashboard agree. The issue is an initiative rather than
one executable Task because four independently failing causes need separate recommendation,
verification, and completion decisions.

The parent owns the shared vocabulary, sequencing, compatibility boundary, and the rule that both
surfaces consume one report instead of recomputing metrics.

## Existing Evidence

- `agent-interface-analytics` defines per-turn and per-session usage contracts, but no time-bucketed
  cross-session report or model/surface dimensions.
- `agent-session-analytics` has a pure per-session reducer; it does not own multi-store merge,
  calendar buckets, coverage diagnostics, or dashboard projections.
- `robota session analyze --usage` inspects one selected session, while no `robota usage` command
  exists.
- Persisted tool and skill/plugin activity is structured, but each metric needs one canonical event
  source to avoid double counting.
- [Issue #2164](https://github.com/woojubb/robota/issues/2164) owns the existing GUI protocol-variant
  reachability gap; [issue #2007](https://github.com/woojubb/robota/issues/2007) separately owns
  OpenTelemetry export.

## Children

- [x] DATA-2577 — done — `.agents/tasks/completed/DATA-2577-persist-canonical-usage-identity-and-model-provider-surface-attribution.md`
- [x] OBSERVABILITY-2577 — done — `.agents/tasks/completed/OBSERVABILITY-2577-aggregate-versioned-cross-session-personal-usage-reports.md`
- [x] FLOW-2577 — done — `.agents/tasks/completed/FLOW-2577-expose-cross-session-usage-through-robota-usage-text-and-json.md`
- [x] SCREEN-2577 — done — `.agents/tasks/completed/SCREEN-2577-render-the-shared-personal-usage-dashboard-in-robota-gui.md`

## Plan

- [x] Complete DATA-2577 first so usage identity, actual model/provider, per-turn surface attribution,
      and legacy decoding are canonical before aggregation.
- [x] Complete OBSERVABILITY-2577 over those records, including one store/event deduplication policy,
      7/30-day calendar semantics, confidence, coverage, and drill-down IDs.
- [x] Complete FLOW-2577 against the shared report and publish a separately versioned JSON projection.
- [x] Convert/deliver [issue #2164](https://github.com/woojubb/robota/issues/2164)'s GUI reachability
      owner, then complete SCREEN-2577 against the same shared report without renderer-side aggregation.
- [x] Verify one fixture corpus yields equivalent CLI JSON and GUI view-model totals before the parent
      can complete.

## Constraints

- `turns` means top-level interactive executions that acquired the execution claim and started, not
  never-run submissions, provider requests, content blocks, or tool rounds; metrics with different scopes
  remain separately named.
- Product surface is a per-turn attribution. A session-level field is insufficient because one
  persisted session may have multiple attached drivers and autonomous work.
- Missing historical attribution remains in totals under `unknown`; it is never dropped or guessed.
- Prompt/response content, paths, tool arguments/results, and activation errors must not enter the
  aggregate report, and no analytics is uploaded by default.
- Pairing remains the sole trust boundary: authenticated paired remote drivers and local/CLI-web owners
  retain equal authority under the repository's `local == remote` OWNER PRINCIPLE. Desktop-only
  navigation in v1 is product availability, not a lower privilege for other owners.
- Local estimated cost is visibly distinct from authoritative provider billing.
- Keyword-based “direction of work” inference is out of v1 because it requires a new classification
  policy and content inspection. Explicit user-authored categories may be proposed separately.

## Test Plan

- Each child runs its package-level unit/integration/type tests, affected builds, and required
  spec-code conformance checks.
- The parent runs a consumer-driven contract fixture through the shared report, CLI JSON projection,
  and GUI view-model projection and compares normalized totals, buckets, breakdowns, and coverage.
- Calendar-boundary fixtures cover local timezone, explicit IANA timezone, DST, empty periods, and
  the current partial day.
- Persistence fixtures cover legacy records, duplicate logical usage IDs, duplicate session IDs across
  stores, corrupt records, and unsupported envelopes.
- Protocol privacy fixtures prove equal admitted-owner access, transport-level rejection/close before
  report reachability for unpaired/unauthenticated peers, and content-free malformed-request handling
  without changing existing paired-driver authority.
- `pnpm harness:scan` and `pnpm harness:verify-like-ci` must be green before delivery.

## Result

Delivered one provider-neutral, local-first personal usage report across `robota usage` and the Robota
GUI. The implementation persists canonical usage attribution, aggregates 7/30-day cross-session data,
exposes versioned text/JSON CLI projections, serves the same report over the admitted GUI protocol,
and renders dashboard breakdowns with coverage, confidence, and session drill-down. Deterministic CLI
and Electron scenarios plus the repository build and full test suite passed.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: automatable | 3`

**Executability probe:** `pnpm exec robota --version` exited 0 with `robota 3.0.0-beta.72`, and
`pnpm exec robota session analyze` exited 0 with the current per-session report. These runs prove the
repository-local shipped CLI entrypoint and analogous pre-session report routing; `robota usage` was not
run because it is the behavior this Task has not implemented yet. The existing browser automation entry
point is `apps/agent-app/e2e/run-e2e.mjs`, which launches the built Electron product through Playwright
and drives rendered controls by accessible role/name. Its Linux wrapper
`pnpm --filter @robota-sdk/agent-app test:e2e` was also probed and exited 1 on this macOS host because
`xvfb-run` is unavailable. Direct `node apps/agent-app/e2e/run-e2e.mjs` reached Electron launch but did
not finish within the 30-second probe and was terminated; no Personal Usage behavior is claimed from
either probe. SCREEN-2577 must add the exact direct automation entry point
`node apps/agent-app/e2e/usage-dashboard.mjs` with its deterministic fixture and controls.

### Scenario 1: CLI 30-day personal usage JSON

- **executability:** agent-executable
- **product surface:** robota-cli
- **surface rationale:** shipped-entrypoint=robota
- **prerequisites:** build the Robota CLI; install the shipped issue 2577 deterministic corpus in isolated user and project session stores; run from that isolated project with HOME pointing at its isolated user store; no live provider credential or external service is required
- **command:** `pnpm exec robota usage --period 30d --timezone UTC --format json`
- **observable type:** product-output
- **expected observable:** exit=0; output-contains="schemaVersion": 1
- **observable rationale:** source=product-process
- **cleanup:** remove only the isolated user and project fixture stores
- **evidence:** `pnpm exec tsx packages/agent-cli/examples/verify-personal-usage.ts` exited 0 on 2026-09-06. The durable runner at `packages/agent-cli/examples/verify-personal-usage.ts` invoked the built `robota usage --period 30d --timezone UTC --format json` product path and observed `jsonExit=0`, `schemaVersion=1`, `sessions=1`, `turns=1`, `totalTokens=42`, `costStatus=estimated`, and `privacyLeak=false`; it also observed the text path exit 0 and invalid-period path exit 1.

### Scenario 2: Personal Usage dashboard and session drill-down

- **executability:** agent-executable
- **product surface:** robota-browser-ui
- **surface rationale:** shipped-interface=robota-browser-ui
- **prerequisites:** build the Robota desktop app; complete issue 2164; install the shipped issue 2577 deterministic corpus in isolated stores; SCREEN-2577 has added `node apps/agent-app/e2e/usage-dashboard.mjs` as the direct Playwright/Electron launcher with the admitted sidecar fixture; no live provider credential or external service is required
- **browser steps:** wait for `.agent-gui-status[data-status="connected"]`; click `getByRole('button', { name: 'Usage' })`; click `getByRole('button', { name: '30 days' })`; click `getByRole('button', { name: 'By surface' })`; click `getByRole('button', { name: /Open session/ }).first()`
- **observable type:** ui-state
- **expected observable:** visible=Personal Usage, 30 days, By surface, Partial today, Unknown, Estimated, and the selected existing session usage/trace view after activating Open session
- **observable rationale:** source=rendered-product-ui
- **cleanup:** close the desktop app, stop its fixture sidecar, and remove only the isolated fixture stores
- **evidence:** after `pnpm --filter @robota-sdk/agent-transport-gui build` and `pnpm --filter @robota-sdk/agent-app build`, `node apps/agent-app/e2e/usage-dashboard.mjs` exited 0 on 2026-09-06 with `SCREEN-2577 usage dashboard scenario passed`. The durable Playwright runner at `apps/agent-app/e2e/usage-dashboard.mjs` drove the shipped Electron renderer by the controls above, observed the 30-day surface breakdown and `desktop-app`, opened session `usage-e2e-session`, observed 42 tokens in the existing session-detail region, loaded the current-session trace, and asserted that the seeded prompt secret was absent.

### Scenario 3: Pre-admission failure exposes no usage history

- **executability:** agent-executable
- **product surface:** robota-browser-ui
- **surface rationale:** shipped-interface=robota-browser-ui
- **prerequisites:** build the Robota desktop app; SCREEN-2577 has added `node apps/agent-app/e2e/usage-dashboard.mjs` with a rejection-sidecar mode that refuses the app's admission credential; launch that mode through the direct Playwright/Electron path; no live provider credential or external service is required
- **browser steps:** wait for `getByRole('alert')`; inspect the rendered alert state; verify the Personal Usage navigation and report totals are not rendered
- **observable type:** ui-state
- **expected observable:** visible=Personal Usage unavailable, with no sessions, turns, token totals, buckets, attribution, or contributing-session links rendered
- **observable rationale:** source=rendered-product-ui
- **cleanup:** close the desktop app, stop the rejection-sidecar fixture, and remove its isolated temporary state
- **evidence:** the rejection half of `node apps/agent-app/e2e/usage-dashboard.mjs` exited 0 on 2026-09-06 with `ARCH-2164 rejected-admission scenario passed`. The durable runner launched the shipped Electron renderer against a sidecar rejecting its admission token, observed the alert `Personal Usage is unavailable`, and asserted that the seeded model/report content was absent.

### [DONE-GATE-STAGE-1] — ❌ FAIL | 2026-09-06

**Status remains:** scenario drafted
**Failed criteria:**

- Scenario completeness (catalogue criterion 1): the three scenarios state prerequisites, expected
  behavior, cleanup, and pending evidence in prose, but Scenario 2 has no exact GUI startup/invocation
  or exact browser steps and Scenario 3 has no exact client commands or UI steps. None uses the
  canonical one-line `prerequisites:`, `invocation:`, `expected observable:`, and `evidence:` fields.
  **Required action:** rewrite each retained scenario with the exact canonical fields and an exact
  reproducible command or ordered browser interaction sequence.
- Executability decision (criterion 2): no scenario carries `executability: agent-executable` or
  `executability: manual-only: <specific technical reason>`.
  **Required action:** declare one allowed executability value on every scenario and, for any
  `manual-only` scenario, record the required barrier and confirmation fields.
- Canonical product surface and observable (criterion 3): no scenario declares `product surface:`,
  `surface rationale:`, `observable type:`, or `observable rationale:`. Scenario 1 combines two CLI
  invocations instead of supplying a canonical single invocation beginning with `robota` or
  `pnpm exec robota`; Scenario 2 does not identify the `robota-browser-ui` surface with exact browser
  steps and a `ui-state` observable; Scenario 3 is currently a protocol-integration verification, not
  a canonical shipped-product invocation.
  **Required action:** bind each user execution test scenario to one allowed product surface and matching invocation,
  use the observable's required machine-readable expected shape, and keep transport-only coverage in
  the engineering Test Plan unless it can be observed through an allowed shipped surface.

**Criteria met:**

- Credentials and external services (criterion 4): PASS — the scenarios use deterministic local
  fixtures and a local sidecar and do not require live credentials or an external service.
- Exception path: not applicable; three scenarios are present, so no unwritten-scenario exception is
  being claimed.
- Ordering: PASS — DONE-GATE-STAGE-1 has no prerequisite gate in the catalogue.

### [DONE-GATE-STAGE-1] — ✅ PASS (superseded by scenario re-authoring) | 2026-09-06

**Status upgrade:** scenario drafted → scenario written

Re-run after the retained FAIL above. Judged by `backlog-gate-guard` against
`.agents/specs/gate-catalogue.md` § DONE-GATE-STAGE-1 and `backlog-execution.md` > Scenario Design
Preference Order.

- Ordering: PASS — DONE-GATE-STAGE-1 has no prior gate. The Task remains under `.agents/tasks/` at
  `status: todo`, and the scenarios describe not-yet-implemented behavior rather than claiming an
  execution result.
- Field completeness: PASS — `scenarioEntries` found exactly three consecutively numbered scenarios
  and `scenarioContract` parsed all three as the author-declared `automatable` outcome. Every scenario
  has one nonempty executability, surface, rationale, prerequisite, action, observable, observable
  rationale, cleanup, and pending evidence field.
- Scenario 1: guardian-observable-verdict=product-behavior;
  surface=robota-cli; surface-rationale=shipped-entrypoint=robota;
  invocation=`pnpm exec robota usage --period 30d --timezone UTC --format json`;
  observable-type=product-output; observable-rationale=source=product-process;
  expected-observable=`exit=0; output-contains="schemaVersion": 1`; executability=agent-executable.
- Scenario 2: guardian-observable-verdict=product-behavior;
  surface=robota-browser-ui; surface-rationale=shipped-interface=robota-browser-ui;
  invocation=wait for `.agent-gui-status[data-status="connected"]`, activate Personal Usage, 30 days,
  By surface, and the first Open session link by the exact authored accessible selectors;
  observable-type=ui-state; observable-rationale=source=rendered-product-ui;
  expected-observable=`visible=Personal Usage, 30 days, By surface, Partial today, Unknown, Estimated,
and the selected existing session usage/trace view after activating Open session`;
  executability=agent-executable.
- Scenario 3: guardian-observable-verdict=product-behavior;
  surface=robota-browser-ui; surface-rationale=shipped-interface=robota-browser-ui;
  invocation=wait for `getByRole('alert')`, inspect it, and verify Personal Usage navigation and report
  totals are absent; observable-type=ui-state; observable-rationale=source=rendered-product-ui;
  expected-observable=`visible=Personal Usage unavailable, with no sessions, turns, token totals,
buckets, attribution, or contributing-session links rendered`; executability=agent-executable.
- Criterion 1: PASS — Scenario 1 has one exact canonical product command; Scenarios 2 and 3 have exact
  ordered browser steps. All three include prerequisites, expected observable, cleanup, and evidence.
- Criterion 2: PASS — every scenario declares `executability: agent-executable`. The author probed the
  repository-local CLI and Electron/Playwright entry paths and assigned the missing deterministic
  launcher and fixture to the child work that must supply them before Stage 2.
- Criterion 3: PASS — the CLI output comes from the shipped `robota` process and the GUI states come
  from the rendered product UI. No scenario uses build, test, lint, harness, CI, or repository-text
  inspection as its observable.
- Criterion 4: PASS — every prerequisite explicitly states that no live provider credential or
  external service is required.
- Exception clause: N/A — all three scenarios are written.

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "doneGateStageOne",
  "outcome": "automatable",
  "scenarios": [
    {
      "name": "Scenario 1: CLI 30-day personal usage JSON",
      "surface": "robota-cli",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "pnpm exec robota usage --period 30d --timezone UTC --format json",
      "observableType": "product-output",
      "observable": "exit=0; output-contains=\"schemaVersion\": 1",
      "observableRationale": "source=product-process",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "build the Robota CLI; install the shipped #2577 deterministic corpus in isolated user and project session stores; run from that isolated project with HOME pointing at its isolated user store; no live provider credential or external service is required",
      "action": {
        "kind": "command",
        "value": "pnpm exec robota usage --period 30d --timezone UTC --format json"
      },
      "expectedObservable": "exit=0; output-contains=\"schemaVersion\": 1",
      "cleanup": "remove only the isolated user and project fixture stores",
      "evidence": "pending implementation"
    },
    {
      "name": "Scenario 2: Personal Usage dashboard and session drill-down",
      "surface": "robota-browser-ui",
      "surfaceRationale": "shipped-interface=robota-browser-ui",
      "invocation": "wait for `.agent-gui-status[data-status=\"connected\"]`; click `getByRole('link', { name: 'Personal Usage' })`; click `getByRole('button', { name: '30 days' })`; click `getByRole('button', { name: 'By surface' })`; click `getByRole('link', { name: /Open session/ }).first()`",
      "observableType": "ui-state",
      "observable": "visible=Personal Usage, 30 days, By surface, Partial today, Unknown, Estimated, and the selected existing session usage/trace view after activating Open session",
      "observableRationale": "source=rendered-product-ui",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "build the Robota desktop app; complete #2164; install the shipped #2577 deterministic corpus in isolated stores; SCREEN-2577 has added `node apps/agent-app/e2e/usage-dashboard.mjs` as the direct Playwright/Electron launcher with the admitted sidecar fixture; no live provider credential or external service is required",
      "action": {
        "kind": "browserSteps",
        "value": "wait for `.agent-gui-status[data-status=\"connected\"]`; click `getByRole('link', { name: 'Personal Usage' })`; click `getByRole('button', { name: '30 days' })`; click `getByRole('button', { name: 'By surface' })`; click `getByRole('link', { name: /Open session/ }).first()`"
      },
      "expectedObservable": "visible=Personal Usage, 30 days, By surface, Partial today, Unknown, Estimated, and the selected existing session usage/trace view after activating Open session",
      "cleanup": "close the desktop app, stop its fixture sidecar, and remove only the isolated fixture stores",
      "evidence": "pending implementation"
    },
    {
      "name": "Scenario 3: Pre-admission failure exposes no usage history",
      "surface": "robota-browser-ui",
      "surfaceRationale": "shipped-interface=robota-browser-ui",
      "invocation": "wait for `getByRole('alert')`; inspect the rendered alert state; verify the Personal Usage navigation and report totals are not rendered",
      "observableType": "ui-state",
      "observable": "visible=Personal Usage unavailable, with no sessions, turns, token totals, buckets, attribution, or contributing-session links rendered",
      "observableRationale": "source=rendered-product-ui",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "build the Robota desktop app; SCREEN-2577 has added `node apps/agent-app/e2e/usage-dashboard.mjs` with a rejection-sidecar mode that refuses the app's admission credential; launch that mode through the direct Playwright/Electron path; no live provider credential or external service is required",
      "action": {
        "kind": "browserSteps",
        "value": "wait for `getByRole('alert')`; inspect the rendered alert state; verify the Personal Usage navigation and report totals are not rendered"
      },
      "expectedObservable": "visible=Personal Usage unavailable, with no sessions, turns, token totals, buckets, attribution, or contributing-session links rendered",
      "cleanup": "close the desktop app, stop the rejection-sidecar fixture, and remove its isolated temporary state",
      "evidence": "pending implementation"
    }
  ]
}
```

<!-- checkpoint-evidence:v1:end -->

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-09-06

**Status upgrade:** scenario drafted → scenario written

Re-recorded after Scenario 2's product selectors and all three evidence fields were re-authored before
the successful execution rerun. The prior PASS remains above as superseded audit history; this entry is
the sole canonical PASS binding the current scenario text.

- Ordering: PASS — DONE-GATE-STAGE-1 has no prior gate. The three scenarios remain under the exact
  Task's `## User Execution Test Scenarios` section.
- Field completeness: PASS — `scenarioEntries` found exactly three consecutively numbered scenarios;
  `scenarioContract` parsed all three against the author verdict `automatable | 3`. Each has one exact
  executability, product surface, surface rationale, prerequisite, command/browser-steps action,
  observable type, expected observable, observable rationale, cleanup, and evidence field.
- Scenario 1: guardian-observable-verdict=product-behavior;
  surface=robota-cli; surface-rationale=shipped-entrypoint=robota;
  invocation=`pnpm exec robota usage --period 30d --timezone UTC --format json`;
  observable-type=product-output; observable-rationale=source=product-process;
  expected-observable=`exit=0; output-contains="schemaVersion": 1`; executability=agent-executable.
- Scenario 2: guardian-observable-verdict=product-behavior;
  surface=robota-browser-ui; surface-rationale=shipped-interface=robota-browser-ui;
  invocation=wait for `.agent-gui-status[data-status="connected"]`, then activate the exact Usage,
  30 days, By surface, and first Open session buttons named in `browser steps:`;
  observable-type=ui-state; observable-rationale=source=rendered-product-ui;
  expected-observable=`visible=Personal Usage, 30 days, By surface, Partial today, Unknown, Estimated,
and the selected existing session usage/trace view after activating Open session`;
  executability=agent-executable.
- Scenario 3: guardian-observable-verdict=product-behavior;
  surface=robota-browser-ui; surface-rationale=shipped-interface=robota-browser-ui;
  invocation=wait for the alert, inspect it, and verify Personal Usage navigation and report totals are
  absent; observable-type=ui-state; observable-rationale=source=rendered-product-ui;
  expected-observable=`visible=Personal Usage unavailable, with no sessions, turns, token totals,
buckets, attribution, or contributing-session links rendered`; executability=agent-executable.
- Criterion 1: PASS — every scenario supplies exact product command or exact ordered browser steps,
  prerequisites, expected observable, cleanup, and concrete evidence.
- Criterion 2: PASS — every scenario declares `executability: agent-executable`.
- Criterion 3: PASS — the observables are output from the shipped Robota CLI process and state rendered
  by the shipped Electron UI, not build, test, lint, harness, CI, or repository inspection.
- Criterion 4: PASS — every prerequisite explicitly says no live provider credential or external
  service is required.
- Exception clause: N/A — all scenarios are fully written.

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "doneGateStageOne",
  "outcome": "automatable",
  "scenarios": [
    {
      "name": "Scenario 1: CLI 30-day personal usage JSON",
      "surface": "robota-cli",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "pnpm exec robota usage --period 30d --timezone UTC --format json",
      "observableType": "product-output",
      "observable": "exit=0; output-contains=\"schemaVersion\": 1",
      "observableRationale": "source=product-process",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "build the Robota CLI; install the shipped #2577 deterministic corpus in isolated user and project session stores; run from that isolated project with HOME pointing at its isolated user store; no live provider credential or external service is required",
      "action": {
        "kind": "command",
        "value": "pnpm exec robota usage --period 30d --timezone UTC --format json"
      },
      "expectedObservable": "exit=0; output-contains=\"schemaVersion\": 1",
      "cleanup": "remove only the isolated user and project fixture stores",
      "evidence": "`pnpm exec tsx packages/agent-cli/examples/verify-personal-usage.ts` exited 0 on 2026-09-06. The durable runner at `packages/agent-cli/examples/verify-personal-usage.ts` invoked the built `robota usage --period 30d --timezone UTC --format json` product path and observed `jsonExit=0`, `schemaVersion=1`, `sessions=1`, `turns=1`, `totalTokens=42`, `costStatus=estimated`, and `privacyLeak=false`; it also observed the text path exit 0 and invalid-period path exit 1."
    },
    {
      "name": "Scenario 2: Personal Usage dashboard and session drill-down",
      "surface": "robota-browser-ui",
      "surfaceRationale": "shipped-interface=robota-browser-ui",
      "invocation": "wait for `.agent-gui-status[data-status=\"connected\"]`; click `getByRole('button', { name: 'Usage' })`; click `getByRole('button', { name: '30 days' })`; click `getByRole('button', { name: 'By surface' })`; click `getByRole('button', { name: /Open session/ }).first()`",
      "observableType": "ui-state",
      "observable": "visible=Personal Usage, 30 days, By surface, Partial today, Unknown, Estimated, and the selected existing session usage/trace view after activating Open session",
      "observableRationale": "source=rendered-product-ui",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "build the Robota desktop app; complete #2164; install the shipped #2577 deterministic corpus in isolated stores; SCREEN-2577 has added `node apps/agent-app/e2e/usage-dashboard.mjs` as the direct Playwright/Electron launcher with the admitted sidecar fixture; no live provider credential or external service is required",
      "action": {
        "kind": "browserSteps",
        "value": "wait for `.agent-gui-status[data-status=\"connected\"]`; click `getByRole('button', { name: 'Usage' })`; click `getByRole('button', { name: '30 days' })`; click `getByRole('button', { name: 'By surface' })`; click `getByRole('button', { name: /Open session/ }).first()`"
      },
      "expectedObservable": "visible=Personal Usage, 30 days, By surface, Partial today, Unknown, Estimated, and the selected existing session usage/trace view after activating Open session",
      "cleanup": "close the desktop app, stop its fixture sidecar, and remove only the isolated fixture stores",
      "evidence": "after `pnpm --filter @robota-sdk/agent-transport-gui build` and `pnpm --filter @robota-sdk/agent-app build`, `node apps/agent-app/e2e/usage-dashboard.mjs` exited 0 on 2026-09-06 with `SCREEN-2577 usage dashboard scenario passed`. The durable Playwright runner at `apps/agent-app/e2e/usage-dashboard.mjs` drove the shipped Electron renderer by the controls above, observed the 30-day surface breakdown and `desktop-app`, opened session `usage-e2e-session`, observed 42 tokens in the existing session-detail region, loaded the current-session trace, and asserted that the seeded prompt secret was absent."
    },
    {
      "name": "Scenario 3: Pre-admission failure exposes no usage history",
      "surface": "robota-browser-ui",
      "surfaceRationale": "shipped-interface=robota-browser-ui",
      "invocation": "wait for `getByRole('alert')`; inspect the rendered alert state; verify the Personal Usage navigation and report totals are not rendered",
      "observableType": "ui-state",
      "observable": "visible=Personal Usage unavailable, with no sessions, turns, token totals, buckets, attribution, or contributing-session links rendered",
      "observableRationale": "source=rendered-product-ui",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "build the Robota desktop app; SCREEN-2577 has added `node apps/agent-app/e2e/usage-dashboard.mjs` with a rejection-sidecar mode that refuses the app's admission credential; launch that mode through the direct Playwright/Electron path; no live provider credential or external service is required",
      "action": {
        "kind": "browserSteps",
        "value": "wait for `getByRole('alert')`; inspect the rendered alert state; verify the Personal Usage navigation and report totals are not rendered"
      },
      "expectedObservable": "visible=Personal Usage unavailable, with no sessions, turns, token totals, buckets, attribution, or contributing-session links rendered",
      "cleanup": "close the desktop app, stop the rejection-sidecar fixture, and remove its isolated temporary state",
      "evidence": "the rejection half of `node apps/agent-app/e2e/usage-dashboard.mjs` exited 0 on 2026-09-06 with `ARCH-2164 rejected-admission scenario passed`. The durable runner launched the shipped Electron renderer against a sidecar rejecting its admission token, observed the alert `Personal Usage is unavailable`, and asserted that the seeded model/report content was absent."
    }
  ]
}
```

<!-- checkpoint-evidence:v1:end -->

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-09-06

**Status upgrade:** scenario written → scenario executed

- Ordering: PASS — the sole canonical DONE-GATE-STAGE-1 PASS immediately above binds the current
  re-authored three-scenario contract, including its current selectors and evidence fields.
- Scenario 1: PASS — the guardian ran
  `pnpm exec tsx packages/agent-cli/examples/verify-personal-usage.ts`; it exited 0 and printed
  `jsonExit: 0`, `schemaVersion: 1`, `sessions: 1`, `turns: 1`, `totalTokens: 42`,
  `costStatus: estimated`, and `privacyLeak: false`. The runner invokes the built Robota CLI usage
  command with an isolated deterministic session store and removes that store in `finally`.
- Scenario 2: PASS — the guardian ran `node apps/agent-app/e2e/usage-dashboard.mjs`; it exited 0 and
  printed `SCREEN-2577 usage dashboard scenario passed`. Its admitted half drove the exact Usage,
  30 days, By surface, and Open session buttons through the shipped Electron renderer, observed the
  partial/estimated/unknown usage state and `desktop-app`, opened `usage-e2e-session` with 42 tokens,
  loaded the current-session trace, and found no seeded prompt secret.
- Scenario 3: PASS — the same direct Electron run printed
  `ARCH-2164 rejected-admission scenario passed`. Its rejection half observed the product alert
  `Personal Usage is unavailable` before any report sentinel was rendered and confirmed the seeded
  model/report content was absent.
- Criterion 1: PASS — the guardian directly re-executed all three scenarios against the current built
  implementation through the two durable repository runners named in their evidence fields.
- Criterion 2: PASS — both commands exited 0 and the observed CLI values and rendered admitted/rejected
  UI states matched their expected product observables.
- Criterion 3: PASS — concrete commands, exit results, totals, privacy result, UI sentinels, session
  drill-down, and rejection alert are recorded under the corresponding scenario evidence fields.
- Engineering-verification-as-evidence check: PASS — package builds are prerequisites only. The gate
  evidence is the Robota CLI process output and the rendered Electron product state, not build, test,
  lint, harness, CI, or repository inspection output.
- Unprobed capability-absence check: N/A — no missing-capability exception is claimed.
- Durable artifacts: PASS — `packages/agent-cli/examples/verify-personal-usage.ts` and
  `apps/agent-app/e2e/usage-dashboard.mjs` both exist in the repository and are the runners executed by
  the guardian.
- Exception clause: N/A — all scenarios are agent-executable and were executed.
