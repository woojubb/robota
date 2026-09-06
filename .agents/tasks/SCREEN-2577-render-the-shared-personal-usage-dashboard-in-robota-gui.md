---
title: 'SCREEN-2577: Render the shared personal usage dashboard in Robota GUI'
issue: https://github.com/woojubb/robota/issues/2577
status: todo
created: 2026-09-06
priority: high
urgency: soon
area: agent-transport-protocol, agent-transport-gui, agent-app, agent-cli, agent-interface-analytics
depends_on: [OBSERVABILITY-2577]
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

- [ ] After [issue #2164](https://github.com/woojubb/robota/issues/2164) is converted, add its exact Task
      ID to `depends_on` and wait for the required usage-report producer/route/consumer reachability to
      land.
- [ ] Add pure dashboard/view-state and reusable components to `agent-transport-gui`; mount the Personal
      Usage navigation entry and dashboard in `agent-app`.
- [ ] Add a distinct cross-session request/result/error protocol family with `requestId`, period, and
      timezone rather than overloading existing per-session `get-usage-report` / `usage_report` messages.
- [ ] Request and render the serialized report through the local sidecar; reject malformed responses and
      use latest-request-wins so stale correlated results cannot overwrite a newer selection.
- [ ] Preserve the repository's OWNER PRINCIPLE: serve admitted local, CLI-web, and paired remote owners
      equivalently; keep unpaired/unauthenticated peers outside report-protocol reachability; for admitted
      malformed requests correlate typed errors only after `requestId` validates and otherwise preserve
      the existing uncorrelated error/close policy without report content.
- [ ] Render loading, empty, partial/current-day, incomplete coverage, unknown attribution, estimated
      cost, and explicit error states accessibly.
- [ ] Link populated buckets/breakdowns to contributing sessions and reuse the existing per-session
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

### Scenario 1 — dashboard history and breakdowns

Prerequisites: launch the deterministic sidecar with the AGREEMENT-2577 fixture and start the desktop app/E2E
browser shell. Open Personal Usage, select 7 days then 30 days, and switch By model to By surface.

Expected: totals and complete daily buckets update from one report, the current day is partial, unknown
and coverage notices remain visible, chart controls are keyboard-accessible, and no raw session content
appears. Cleanup: stop the fixture sidecar. Evidence: pending automated trace and screenshots.

### Scenario 2 — drill-down and parity

Open a populated bucket/session link and compare the displayed values with the canonical FLOW-2577 JSON
fixture for the same timezone and period.

Expected: drill-down opens the existing session usage/trace surface, not a duplicate implementation, and
all normalized totals/breakdowns equal the CLI projection. Cleanup/evidence follow Scenario 1.

### Scenario 3 — admission parity

Connect an unpaired client and admitted desktop-local, CLI-web, and paired remote owner clients to the
deterministic sidecar, then send equivalent cross-session report requests with unique request IDs.

Expected: admitted owners receive equivalent reports; the unpaired connection closes/rejects before
report-protocol reachability with no report content. An admitted malformed request receives a correlated
typed error only when its request ID validated; otherwise the existing uncorrelated error/close behavior
applies. Rapid 7/30-day changes retain only the latest matching response. Cleanup and evidence follow
Scenario 1.
