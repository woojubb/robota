---
title: 'SCREEN-2577: Render the shared personal usage dashboard in Robota GUI'
issue: https://github.com/woojubb/robota/issues/2577
status: done
completed: 2026-09-06
created: 2026-09-06
priority: high
urgency: soon
area: agent-transport-protocol, agent-transport-gui, agent-app, agent-cli, agent-interface-analytics
depends_on: [OBSERVABILITY-2577, ARCH-2164]
---

# SCREEN-2577: Render the shared personal usage dashboard in Robota GUI

## Objective

Add a Personal Usage dashboard whose pure view state and reusable components live in the shared GUI
presentation core while desktop navigation and dashboard mounting remain in the app shell. The shared
CLI/runtime host exposes the report producer/route to every admitted transport. The CLI/local
host produces the OBSERVABILITY-2577 report; GUI code receives only its serialized protocol contract and
must not import analytics, access the filesystem, or aggregate independently. Drill-down reuses the
existing per-session report.

## Existing Evidence

- `agent-app` is a presentation shell over `agent-transport-gui` and receives state from a Robota
  sidecar; direct session-store access would violate that boundary.
- The protocol declares usage-report variants but
  [issue #2164](https://github.com/woojubb/robota/issues/2164) records that producer, route, reducer,
  and GUI consumer reachability is incomplete.
- The supplied reference shows useful 7/30-day, model/surface, daily usage, and tool/skill activity
  views, including unclassified and freshness/coverage disclosure.
- `agent-transport-gui` currently centers on running-session presentation; this Task deliberately expands
  it to shared cross-session presentation while keeping desktop navigation/dashboard mounting in
  `agent-app` and the shared post-admission producer/route in the CLI/runtime host.

## Plan

- [x] After [issue #2164](https://github.com/woojubb/robota/issues/2164) is converted, add its exact Task
      ID to `depends_on` and wait for the required usage-report producer/route/consumer reachability to
      land.
- [x] Add pure dashboard/view-state and reusable components to `agent-transport-gui`; mount the Personal
      Usage navigation entry and dashboard in `agent-app`.
- [x] Add a distinct cross-session request/result/error protocol family with `requestId`, period, and
      timezone rather than overloading existing per-session `get-usage-report` / `usage_report` messages.
- [x] Request and render the serialized report through the local sidecar; reject malformed responses and
      use latest-request-wins so stale correlated results cannot overwrite a newer selection.
- [x] Preserve the repository's OWNER PRINCIPLE: serve admitted local, CLI-web, and paired remote owners
      equivalently; keep unpaired/unauthenticated peers outside report-protocol reachability; for admitted
      malformed requests correlate typed errors only after `requestId` validates and otherwise preserve
      the existing uncorrelated error/close policy without report content.
- [x] Render loading, empty, partial/current-day, incomplete coverage, unknown attribution, estimated
      cost, and explicit error states accessibly.
- [x] Link populated buckets/breakdowns to contributing sessions and reuse the existing per-session
      trace/usage view.

## Constraints

- This Task cannot begin implementation until
  [issue #2164](https://github.com/woojubb/robota/issues/2164) has a converted Task dependency and its
  required route is available; the parent initiative may proceed through DATA/OBSERVABILITY/FLOW first.
- GUI and CLI totals for the same report request/fixture must be identical.
- Presentation preferences may be remembered, but they cannot change report semantics.
- No session-store access, pricing logic, dedupe, or analytics reducer may live in the renderer.
- GUI packages must not import or invoke `agent-session-analytics`; the CLI/local host owns store I/O and
  reducer execution, and the wire carries only the serialized report contract.
- Pairing/admission remains the sole trust boundary and surface attribution is never an authorization
  input. Desktop-only dashboard navigation is a v1 product-availability choice, not a protocol privilege
  difference for authenticated owners.
- Existing per-session usage protocol messages retain their names and semantics.
- The view must meet repository frontend, accessibility, reduced-motion, and deterministic E2E rules.

## Test Plan

- Component tests for 7/30-day controls, breakdown switches, empty/partial/error/unknown/estimated states,
  keyboard access, and privacy-safe rendering.
- Sidecar/protocol integration tests proving one authorized report request reaches the host producer and
  reducer, malformed/stale responses are contained, admitted owner surfaces are equivalent,
  pre-admission failures never reach the report producer, and invalid correlation values are not echoed.
- Deterministic GUI E2E with the canonical fixture, including session drill-down and screenshot evidence.
- Contract parity test comparing the GUI view model with FLOW-2577 JSON for the same report.
- Affected app/package builds and governing `docs/SPEC.md` conformance checks.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: automatable | 3`

### Scenario 1: dashboard history and breakdowns

- **executability:** agent-executable
- **product surface:** robota-browser-ui
- **surface rationale:** shipped-interface=robota-browser-ui
- **prerequisites:** build `agent-transport-gui` and `agent-app`; the durable runner launches the Electron product against the deterministic real-WebSocket sidecar; no live provider credential or external service is required
- **browser steps:** wait for `.agent-gui-status[data-status="connected"]`; activate Usage; observe the default model breakdown, partial-day and estimated-cost states; activate 30 days, By provider, then By surface
- **observable type:** ui-state
- **expected observable:** visible=Personal usage, scripted-model, Partial day, estimated, unknown, By surface, and desktop-app; persisted content sentinel absent
- **observable rationale:** source=rendered-product-ui
- **cleanup:** the runner closes Electron and the app terminates its fixture sidecar
- **evidence:** `node apps/agent-app/e2e/usage-dashboard.mjs` exited 0 on 2026-09-06 with `SCREEN-2577 usage dashboard scenario passed`. The durable runner observed every named state through accessible roles/text and asserted the stored prompt sentinel was absent.

### Scenario 2: stored and current session drill-down

- **executability:** agent-executable
- **product surface:** robota-browser-ui
- **surface rationale:** shipped-interface=robota-browser-ui
- **prerequisites:** use the same built Electron product and deterministic sidecar fixture; no live provider credential or external service is required
- **browser steps:** after selecting By surface, activate `Open session usage-e2e-session`; observe the Session usage detail region; activate Current session trace and observe its region
- **observable type:** ui-state
- **expected observable:** visible=42 tokens in stored-session detail and 42 tokens in current-session trace
- **observable rationale:** source=rendered-product-ui
- **cleanup:** the runner closes Electron and the app terminates its fixture sidecar
- **evidence:** the same durable E2E command exited 0 and observed 42 tokens in both the existing stored-session detail region and current-session trace region before printing `SCREEN-2577 usage dashboard scenario passed`.

### Scenario 3: rejected admission exposes no usage

- **executability:** agent-executable
- **product surface:** robota-browser-ui
- **surface rationale:** shipped-interface=robota-browser-ui
- **prerequisites:** the durable runner launches a second Electron product against a sidecar with a deliberately mismatched admission token; no live provider credential or external service is required
- **browser steps:** wait for the alert containing `Personal Usage is unavailable`; verify the seeded model/report content is absent
- **observable type:** ui-state
- **expected observable:** visible=Personal Usage is unavailable; absent=scripted-model
- **observable rationale:** source=rendered-product-ui
- **cleanup:** the runner closes the rejected Electron instance and terminates its fixture sidecar
- **evidence:** the rejection half of `node apps/agent-app/e2e/usage-dashboard.mjs` exited 0 on 2026-09-06 with `ARCH-2164 rejected-admission scenario passed` after observing the unavailable alert and confirming seeded usage content was absent.

## Result

The desktop app now exposes a protocol-fed Personal Usage dashboard with 7/30-day controls, daily
history, model/provider/surface/source/activity breakdowns, confidence and coverage states, contributing
session drill-down, and current-session trace. The renderer performs no store I/O or independent
aggregation, stale report responses cannot replace newer selections, and rejected admission exposes no
usage content.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-09-06

**Status upgrade:** scenario drafted → scenario written

- Ordering: PASS — DONE-GATE-STAGE-1 has no prior gate.
- Field completeness: PASS — `scenarioEntries` found three consecutively numbered scenarios and
  `scenarioContract` parsed all three for the declared `automatable | 3` outcome. Each scenario has one
  executability, canonical product surface and rationale, prerequisite, browser action, observable and
  rationale, cleanup, and evidence field.
- Scenario 1: guardian-observable-verdict=product-behavior;
  surface=robota-browser-ui; surface-rationale=shipped-interface=robota-browser-ui;
  invocation=wait for the connected state, activate Usage, observe the default breakdown and state
  badges, then activate 30 days, By provider, and By surface; observable-type=ui-state;
  observable-rationale=source=rendered-product-ui;
  expected-observable=`visible=Personal usage, scripted-model, Partial day, estimated, unknown, By
surface, and desktop-app; persisted content sentinel absent`; executability=agent-executable.
- Scenario 2: guardian-observable-verdict=product-behavior;
  surface=robota-browser-ui; surface-rationale=shipped-interface=robota-browser-ui;
  invocation=activate Open session usage-e2e-session and Current session trace after selecting By
  surface; observable-type=ui-state; observable-rationale=source=rendered-product-ui;
  expected-observable=`visible=42 tokens in stored-session detail and 42 tokens in current-session
trace`; executability=agent-executable.
- Scenario 3: guardian-observable-verdict=product-behavior;
  surface=robota-browser-ui; surface-rationale=shipped-interface=robota-browser-ui;
  invocation=wait for the Personal Usage unavailable alert and verify the seeded report model is absent;
  observable-type=ui-state; observable-rationale=source=rendered-product-ui;
  expected-observable=`visible=Personal Usage is unavailable; absent=scripted-model`;
  executability=agent-executable.
- Criterion 1: PASS — all three scenarios provide exact ordered browser interactions, prerequisites,
  expected UI state, cleanup, and evidence.
- Criterion 2: PASS — all three scenarios are explicitly agent-executable.
- Criterion 3: PASS — every observable is rendered product UI state from the shipped Electron surface,
  not build, test, lint, harness, CI, or repository inspection output.
- Criterion 4: PASS — every scenario explicitly requires no live provider credential or external
  service.
- Exception clause: N/A — all scenarios are written.

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "doneGateStageOne",
  "outcome": "automatable",
  "scenarios": [
    {
      "name": "Scenario 1: dashboard history and breakdowns",
      "surface": "robota-browser-ui",
      "surfaceRationale": "shipped-interface=robota-browser-ui",
      "invocation": "wait for `.agent-gui-status[data-status=\"connected\"]`; activate Usage; observe the default model breakdown, partial-day and estimated-cost states; activate 30 days, By provider, then By surface",
      "observableType": "ui-state",
      "observable": "visible=Personal usage, scripted-model, Partial day, estimated, unknown, By surface, and desktop-app; persisted content sentinel absent",
      "observableRationale": "source=rendered-product-ui",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "build `agent-transport-gui` and `agent-app`; the durable runner launches the Electron product against the deterministic real-WebSocket sidecar; no live provider credential or external service is required",
      "action": {
        "kind": "browserSteps",
        "value": "wait for `.agent-gui-status[data-status=\"connected\"]`; activate Usage; observe the default model breakdown, partial-day and estimated-cost states; activate 30 days, By provider, then By surface"
      },
      "expectedObservable": "visible=Personal usage, scripted-model, Partial day, estimated, unknown, By surface, and desktop-app; persisted content sentinel absent",
      "cleanup": "the runner closes Electron and the app terminates its fixture sidecar",
      "evidence": "`node apps/agent-app/e2e/usage-dashboard.mjs` exited 0 on 2026-09-06 with `SCREEN-2577 usage dashboard scenario passed`. The durable runner observed every named state through accessible roles/text and asserted the stored prompt sentinel was absent."
    },
    {
      "name": "Scenario 2: stored and current session drill-down",
      "surface": "robota-browser-ui",
      "surfaceRationale": "shipped-interface=robota-browser-ui",
      "invocation": "after selecting By surface, activate `Open session usage-e2e-session`; observe the Session usage detail region; activate Current session trace and observe its region",
      "observableType": "ui-state",
      "observable": "visible=42 tokens in stored-session detail and 42 tokens in current-session trace",
      "observableRationale": "source=rendered-product-ui",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "use the same built Electron product and deterministic sidecar fixture; no live provider credential or external service is required",
      "action": {
        "kind": "browserSteps",
        "value": "after selecting By surface, activate `Open session usage-e2e-session`; observe the Session usage detail region; activate Current session trace and observe its region"
      },
      "expectedObservable": "visible=42 tokens in stored-session detail and 42 tokens in current-session trace",
      "cleanup": "the runner closes Electron and the app terminates its fixture sidecar",
      "evidence": "the same durable E2E command exited 0 and observed 42 tokens in both the existing stored-session detail region and current-session trace region before printing `SCREEN-2577 usage dashboard scenario passed`."
    },
    {
      "name": "Scenario 3: rejected admission exposes no usage",
      "surface": "robota-browser-ui",
      "surfaceRationale": "shipped-interface=robota-browser-ui",
      "invocation": "wait for the alert containing `Personal Usage is unavailable`; verify the seeded model/report content is absent",
      "observableType": "ui-state",
      "observable": "visible=Personal Usage is unavailable; absent=scripted-model",
      "observableRationale": "source=rendered-product-ui",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "the durable runner launches a second Electron product against a sidecar with a deliberately mismatched admission token; no live provider credential or external service is required",
      "action": {
        "kind": "browserSteps",
        "value": "wait for the alert containing `Personal Usage is unavailable`; verify the seeded model/report content is absent"
      },
      "expectedObservable": "visible=Personal Usage is unavailable; absent=scripted-model",
      "cleanup": "the runner closes the rejected Electron instance and terminates its fixture sidecar",
      "evidence": "the rejection half of `node apps/agent-app/e2e/usage-dashboard.mjs` exited 0 on 2026-09-06 with `ARCH-2164 rejected-admission scenario passed` after observing the unavailable alert and confirming seeded usage content was absent."
    }
  ]
}
```

<!-- checkpoint-evidence:v1:end -->

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-09-06

**Status upgrade:** scenario written → scenario executed

- Ordering: PASS — the DONE-GATE-STAGE-1 PASS immediately above binds the current three-scenario
  contract.
- Scenario 1: PASS — the guardian ran `node apps/agent-app/e2e/usage-dashboard.mjs`; the admitted
  Electron flow observed Personal usage, scripted-model, Partial day, estimated cost, unknown provider,
  By surface, and desktop-app, found no persisted-content sentinel, and printed
  `SCREEN-2577 usage dashboard scenario passed`.
- Scenario 2: PASS — the same run opened `usage-e2e-session`, observed 42 tokens in the stored-session
  detail, loaded Current session trace, and observed 42 tokens in that rendered region.
- Scenario 3: PASS — the rejected-admission half observed `Personal Usage is unavailable`, confirmed
  `scripted-model` was absent, and printed `ARCH-2164 rejected-admission scenario passed`.
- Criterion 1: PASS — the guardian directly executed every scenario against the built Electron product
  through the durable runner.
- Criterion 2: PASS — the command exited 0 and every expected admitted/rejected rendered state matched.
- Criterion 3: PASS — each scenario's evidence field names the command, exit/success marker, concrete UI
  observations, and the durable runner `apps/agent-app/e2e/usage-dashboard.mjs`.
- Engineering-verification-as-evidence check: PASS — builds are prerequisites only; the evidence is
  rendered Electron product behavior.
- Unprobed capability-absence check: N/A — no missing-capability exception is claimed.
- Durable artifacts: PASS — `apps/agent-app/e2e/usage-dashboard.mjs` exists and was executed.
- Exception clause: N/A — all scenarios are agent-executable and executed.
