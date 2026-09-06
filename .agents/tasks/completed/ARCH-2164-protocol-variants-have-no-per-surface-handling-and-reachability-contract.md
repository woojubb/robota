---
title: 'ARCH-2164: protocol variants have no per-surface handling and reachability contract'
issue: https://github.com/woojubb/robota/issues/2164
status: done
completed: 2026-09-06
created: 2026-09-06
priority: medium
urgency: soon
area: transport protocol reachability
depends_on: []
---

# ARCH-2164: protocol variants have no per-surface handling and reachability contract

## Objective

Give every server-message variant an explicit GUI disposition and make the user-relevant command,
error, and usage-report families reachable through the desktop product instead of accepting them on
the wire and silently dropping them. Deliver this dependency as part of AGREEMENT-2577 while keeping
the transport protocol, presentation reducer, and Electron product boundaries separate.

## Source Constraints

- The protocol union remains owned by `agent-transport-protocol`; GUI code consumes its browser-safe
  decoder entrypoint and does not duplicate wire contracts.
- Every `TServerMessage['type']` has an exhaustive, compiler-checked GUI handling classification.
- User-relevant failures and command outcomes are visible and dismissible; a session error finalizes
  partial output and clears transient streaming/tool state so the next turn is not contaminated.
- Usage-report request/reply families are reachable from the desktop UI, including aggregate-to-session
  drill-down, without exposing persisted prompt or response content.
- The loopback sidecar rejects an unadmitted renderer before any report or session data is delivered.

## Plan

- [x] Add an exhaustive per-server-message GUI disposition registry and regression test.
- [x] Route slash commands, command results, session/protocol errors, current-session usage, and stored-session usage through the reducer and desktop surface.
- [x] Publish a browser-safe protocol decoder entrypoint so the renderer never bundles Node-only protocol implementation code.
- [x] Exercise successful usage drill-down, command/error recovery, privacy, and rejected admission through deterministic product scenarios.
- [x] Synchronize affected package specifications and run package, type, build, and repository gates.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: automatable | 3`

### Scenario 1: command and error recovery remain visible

- **executability:** agent-executable
- **product surface:** robota-browser-ui
- **surface rationale:** shipped-interface=robota-browser-ui
- **prerequisites:** build the Electron product; launch it through the durable E2E runner against the deterministic real-WebSocket sidecar; no live provider credential or external service is required
- **browser steps:** submit `/help` and observe its command-result notice; submit `please fail` and observe the scripted partial reply plus error; submit `recover` and observe a clean assistant reply
- **observable type:** ui-state
- **expected observable:** visible=/help: ok, Partial reply before failure., Scripted provider failure, and Hello from the scripted agent.
- **observable rationale:** source=rendered-product-ui
- **cleanup:** the runner closes Electron and terminates the fixture sidecar
- **evidence:** `node apps/agent-app/e2e/usage-dashboard.mjs` exited 0 on 2026-09-06 after driving these exact accessible controls and observing each command/error/recovery state; its durable implementation is `apps/agent-app/e2e/usage-dashboard.mjs`.

### Scenario 2: usage report families are reachable

- **executability:** agent-executable
- **product surface:** robota-browser-ui
- **surface rationale:** shipped-interface=robota-browser-ui
- **prerequisites:** use the same built Electron product and admitted sidecar fixture; no live provider credential or external service is required
- **browser steps:** activate Usage, change period and breakdown, open session `usage-e2e-session`, then activate Current session trace
- **observable type:** ui-state
- **expected observable:** visible=aggregate dashboard, 42-token stored-session detail, and 42-token current-session trace; persisted content sentinel absent
- **observable rationale:** source=rendered-product-ui
- **cleanup:** the runner closes Electron and terminates the fixture sidecar
- **evidence:** the same durable E2E command exited 0 with `SCREEN-2577 usage dashboard scenario passed`, observed both report families through rendered regions, and asserted that `PROMPT_CONTENT_MUST_NOT_APPEAR` was absent.

### Scenario 3: rejected admission is content-free

- **executability:** agent-executable
- **product surface:** robota-browser-ui
- **surface rationale:** shipped-interface=robota-browser-ui
- **prerequisites:** the durable runner launches Electron against a deliberately mismatched sidecar admission token; no live provider credential or external service is required
- **browser steps:** wait for the admission-failure alert and verify the seeded usage model is absent
- **observable type:** ui-state
- **expected observable:** visible=Personal Usage is unavailable; absent=scripted-model
- **observable rationale:** source=rendered-product-ui
- **cleanup:** the runner closes the rejected Electron instance and terminates its fixture sidecar
- **evidence:** the rejection half of the durable E2E command exited 0 with `ARCH-2164 rejected-admission scenario passed` after observing the fatal/unavailable alert and confirming seeded usage data was not rendered.

## Result

Every server-message variant now has an exhaustive GUI disposition, user-relevant command/error/current
and stored usage families reach the desktop surface, and the renderer consumes a browser-safe protocol
entrypoint. Deterministic Electron coverage proves visible command/error recovery, report reachability,
privacy, and rejection before authenticated report access.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-09-06

**Status upgrade:** scenario drafted → scenario written

- Ordering: PASS — DONE-GATE-STAGE-1 has no prior gate.
- Field completeness: PASS — `scenarioEntries` found three consecutively numbered scenarios and
  `scenarioContract` parsed all three for the declared `automatable | 3` outcome. Each scenario has one
  executability, canonical product surface and rationale, prerequisite, browser action, observable and
  rationale, cleanup, and evidence field.
- Scenario 1: guardian-observable-verdict=product-behavior;
  surface=robota-browser-ui; surface-rationale=shipped-interface=robota-browser-ui;
  invocation=submit `/help`, `please fail`, and `recover` in order and observe each result;
  observable-type=ui-state; observable-rationale=source=rendered-product-ui;
  expected-observable=`visible=/help: ok, Partial reply before failure., Scripted provider failure,
and Hello from the scripted agent.`; executability=agent-executable.
- Scenario 2: guardian-observable-verdict=product-behavior;
  surface=robota-browser-ui; surface-rationale=shipped-interface=robota-browser-ui;
  invocation=activate Usage, change period and breakdown, open usage-e2e-session, and activate Current
  session trace; observable-type=ui-state; observable-rationale=source=rendered-product-ui;
  expected-observable=`visible=aggregate dashboard, 42-token stored-session detail, and 42-token
current-session trace; persisted content sentinel absent`; executability=agent-executable.
- Scenario 3: guardian-observable-verdict=product-behavior;
  surface=robota-browser-ui; surface-rationale=shipped-interface=robota-browser-ui;
  invocation=wait for the admission-failure alert and verify the seeded usage model is absent;
  observable-type=ui-state; observable-rationale=source=rendered-product-ui;
  expected-observable=`visible=Personal Usage is unavailable; absent=scripted-model`;
  executability=agent-executable.
- Criterion 1: PASS — all three scenarios provide exact ordered browser interactions, prerequisites,
  expected UI state, cleanup, and evidence.
- Criterion 2: PASS — all three scenarios explicitly declare `agent-executable`.
- Criterion 3: PASS — every observable is rendered product behavior from the shipped Electron UI, not
  build, test, lint, harness, CI, or repository inspection output.
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
      "name": "Scenario 1: command and error recovery remain visible",
      "surface": "robota-browser-ui",
      "surfaceRationale": "shipped-interface=robota-browser-ui",
      "invocation": "submit `/help` and observe its command-result notice; submit `please fail` and observe the scripted partial reply plus error; submit `recover` and observe a clean assistant reply",
      "observableType": "ui-state",
      "observable": "visible=/help: ok, Partial reply before failure., Scripted provider failure, and Hello from the scripted agent.",
      "observableRationale": "source=rendered-product-ui",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "build the Electron product; launch it through the durable E2E runner against the deterministic real-WebSocket sidecar; no live provider credential or external service is required",
      "action": {
        "kind": "browserSteps",
        "value": "submit `/help` and observe its command-result notice; submit `please fail` and observe the scripted partial reply plus error; submit `recover` and observe a clean assistant reply"
      },
      "expectedObservable": "visible=/help: ok, Partial reply before failure., Scripted provider failure, and Hello from the scripted agent.",
      "cleanup": "the runner closes Electron and terminates the fixture sidecar",
      "evidence": "`node apps/agent-app/e2e/usage-dashboard.mjs` exited 0 on 2026-09-06 after driving these exact accessible controls and observing each command/error/recovery state; its durable implementation is `apps/agent-app/e2e/usage-dashboard.mjs`."
    },
    {
      "name": "Scenario 2: usage report families are reachable",
      "surface": "robota-browser-ui",
      "surfaceRationale": "shipped-interface=robota-browser-ui",
      "invocation": "activate Usage, change period and breakdown, open session `usage-e2e-session`, then activate Current session trace",
      "observableType": "ui-state",
      "observable": "visible=aggregate dashboard, 42-token stored-session detail, and 42-token current-session trace; persisted content sentinel absent",
      "observableRationale": "source=rendered-product-ui",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "use the same built Electron product and admitted sidecar fixture; no live provider credential or external service is required",
      "action": {
        "kind": "browserSteps",
        "value": "activate Usage, change period and breakdown, open session `usage-e2e-session`, then activate Current session trace"
      },
      "expectedObservable": "visible=aggregate dashboard, 42-token stored-session detail, and 42-token current-session trace; persisted content sentinel absent",
      "cleanup": "the runner closes Electron and terminates the fixture sidecar",
      "evidence": "the same durable E2E command exited 0 with `SCREEN-2577 usage dashboard scenario passed`, observed both report families through rendered regions, and asserted that `PROMPT_CONTENT_MUST_NOT_APPEAR` was absent."
    },
    {
      "name": "Scenario 3: rejected admission is content-free",
      "surface": "robota-browser-ui",
      "surfaceRationale": "shipped-interface=robota-browser-ui",
      "invocation": "wait for the admission-failure alert and verify the seeded usage model is absent",
      "observableType": "ui-state",
      "observable": "visible=Personal Usage is unavailable; absent=scripted-model",
      "observableRationale": "source=rendered-product-ui",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "the durable runner launches Electron against a deliberately mismatched sidecar admission token; no live provider credential or external service is required",
      "action": {
        "kind": "browserSteps",
        "value": "wait for the admission-failure alert and verify the seeded usage model is absent"
      },
      "expectedObservable": "visible=Personal Usage is unavailable; absent=scripted-model",
      "cleanup": "the runner closes the rejected Electron instance and terminates its fixture sidecar",
      "evidence": "the rejection half of the durable E2E command exited 0 with `ARCH-2164 rejected-admission scenario passed` after observing the fatal/unavailable alert and confirming seeded usage data was not rendered."
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
  Electron flow rendered `/help: ok`, the partial response and scripted failure, and a clean recovery
  response before reaching its success marker.
- Scenario 2: PASS — the same flow rendered the aggregate dashboard, opened the 42-token stored-session
  detail and 42-token current-session trace, found no persisted-content sentinel, and printed
  `SCREEN-2577 usage dashboard scenario passed`.
- Scenario 3: PASS — the rejected-admission half rendered `Personal Usage is unavailable`, confirmed
  `scripted-model` was absent, and printed `ARCH-2164 rejected-admission scenario passed`.
- Criterion 1: PASS — the guardian directly executed all three scenarios against the built Electron
  product through the durable runner.
- Criterion 2: PASS — the command exited 0 and every expected command/error/recovery, report, and
  rejected-admission UI state matched.
- Criterion 3: PASS — every evidence field names concrete rendered observations and the durable runner
  `apps/agent-app/e2e/usage-dashboard.mjs`.
- Engineering-verification-as-evidence check: PASS — the prerequisite build is not used as evidence;
  the evidence is rendered Electron product behavior.
- Unprobed capability-absence check: N/A — no missing-capability exception is claimed.
- Durable artifacts: PASS — `apps/agent-app/e2e/usage-dashboard.mjs` exists and was executed.
- Exception clause: N/A — all scenarios are agent-executable and executed.
