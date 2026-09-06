---
title: 'AGREEMENT-2577: Coordinate cross-session usage reporting across CLI and GUI'
issue: https://github.com/woojubb/robota/issues/2577
status: todo
created: 2026-09-06
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

- [ ] DATA-2577 — todo — `.agents/tasks/DATA-2577-persist-canonical-usage-identity-and-model-provider-surface-attribution.md`
- [ ] OBSERVABILITY-2577 — todo — `.agents/tasks/OBSERVABILITY-2577-aggregate-versioned-cross-session-personal-usage-reports.md`
- [ ] FLOW-2577 — todo — `.agents/tasks/FLOW-2577-expose-cross-session-usage-through-robota-usage-text-and-json.md`
- [ ] SCREEN-2577 — todo — `.agents/tasks/SCREEN-2577-render-the-shared-personal-usage-dashboard-in-robota-gui.md`

## Plan

- [ ] Complete DATA-2577 first so usage identity, actual model/provider, per-turn surface attribution,
      and legacy decoding are canonical before aggregation.
- [ ] Complete OBSERVABILITY-2577 over those records, including one store/event deduplication policy,
      7/30-day calendar semantics, confidence, coverage, and drill-down IDs.
- [ ] Complete FLOW-2577 against the shared report and publish a separately versioned JSON projection.
- [ ] Convert/deliver [issue #2164](https://github.com/woojubb/robota/issues/2164)'s GUI reachability
      owner, then complete SCREEN-2577 against the same shared report without renderer-side aggregation.
- [ ] Verify one fixture corpus yields equivalent CLI JSON and GUI view-model totals before the parent
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

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: automatable | 3`

### Scenario 1 — CLI personal usage history

Prerequisites: all four child Tasks' deterministic usage fixture is installed in isolated user and
project session stores, including legacy, duplicate, and partially attributed records. Build the Robota
CLI and set the fixture home/project exactly as FLOW-2577 documents.

Steps: run `robota usage --period 7d --format json`, then `robota usage --period 30d --timezone UTC`.

Expected: both commands exit 0; output declares `schemaVersion: 1`, exact interval and timezone, complete
daily buckets, totals, model/surface/source/activity breakdowns, contributing session IDs, and structured
coverage. Duplicate canonical events are counted once, legacy attribution appears as `unknown`, and no
prompt/response/path/payload content appears.

Cleanup: remove only the isolated fixture stores. Evidence: pending implementation; record commands,
exit codes, and JSON snapshots before completion.

### Scenario 2 — GUI parity and drill-down

Prerequisites: start the deterministic GUI sidecar with the same fixture corpus and complete
[issue #2164](https://github.com/woojubb/robota/issues/2164)'s required producer/route/consumer path.

Steps: open Personal Usage, switch 7 days to 30 days, switch model to surface breakdown, inspect the
coverage notice, and open a contributing session from a populated bucket.

Expected: chart and summary values equal the CLI JSON projection for the same interval/timezone, the
current day is marked partial, unknown/estimated values remain visible, and drill-down opens the existing
per-session report. Cleanup: stop the sidecar and remove the isolated fixture stores. Evidence: pending;
record the automated GUI scenario output and screenshots before completion.

### Scenario 3 — owner admission and equal paired authority

Prerequisites: start the sidecar with one unpaired client and authenticated desktop-local, paired remote,
and CLI-web owner clients against the same fixture. Request the cross-session report from each client.

Expected: all admitted owners receive the same correlated report; the unpaired connection is rejected or
closed before report-protocol reachability without totals, buckets, attribution, or session identifiers.
An admitted malformed request is correlated only when its request ID validated; otherwise existing
uncorrelated error/close behavior applies. Desktop-only navigation does not alter protocol authority.
Cleanup: stop the clients and isolated sidecar. Evidence: pending automated protocol integration output.
