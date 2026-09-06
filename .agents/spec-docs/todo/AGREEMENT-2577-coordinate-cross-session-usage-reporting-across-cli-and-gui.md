---
status: approved
type: AGREEMENT
tags: [cli, desktop, json-schema, typescript]
lane: L2
---

# AGREEMENT-2577: Coordinate cross-session usage reporting across CLI and GUI

Paired with `.agents/tasks/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md`.
Arising from [issue #2577](https://github.com/woojubb/robota/issues/2577).

## Problem

Robota persists per-turn usage and can inspect one current or selected session, but it cannot answer the
cross-session question “how have I used Robota over the last 7 or 30 days?” No canonical report merges
local user/project stores, defines calendar buckets, or breaks totals down by actual model, product
surface, execution source, tool, skill, and plugin. The problem reproduces in both product surfaces:
there is no `robota usage` command, and the GUI has no personal usage dashboard.

Adding charts alone would preserve the underlying accounting gaps. Current snapshots omit stable logical
usage identity and actual model/provider/per-turn surface; duplicate records and store copies need one
precedence rule; legacy/corrupt/unsupported coverage is not reported; and the declared GUI usage protocol
still lacks a complete production path under
[issue #2164](https://github.com/woojubb/robota/issues/2164).

## Prior Art Research

Research was revalidated on 2026-09-06 against product documentation and repository commit
`f322256413f9c7c476658435e6a9a81282da64ad`.

- [OpenAI Personal Analytics](https://help.openai.com/en/articles/20001478) exposes 7/30-day history,
  model/surface breakdowns, plugin/skill activity, high-usage drill-down, and explicit incomplete-data
  and non-invoice notices.
- [OpenAI API usage](https://help.openai.com/en/articles/10478918-api-usage-dashboard) and its
  [Usage API](https://platform.openai.com/docs/api-reference/usage/audio_transcriptions_object) use
  explicit periods, time buckets, grouping dimensions, export, and inclusive-start/exclusive-end bounds.
- [GitHub Copilot metrics](https://docs.github.com/en/copilot/reference/copilot-usage-metrics/copilot-usage-metrics)
  exposes daily model/mode dimensions from one vocabulary across dashboard, API, and export, while
  preserving missing-dimensional coverage.
- [Claude Code cost management](https://code.claude.com/docs/en/costs) keeps current-session usage
  distinct from provider billing, while [Agent SDK cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking)
  defines multiple accounting scopes and requires assistant-message-ID deduplication when repeated
  fragments carry identical usage.
- [Langfuse usage and cost tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking)
  and [custom dashboards](https://langfuse.com/docs/metrics/features/custom-dashboards) provide an
  open-source reference for canonical observations, time/dimension aggregation, exact-versus-inferred
  values, drill-down, and a versioned machine-readable metrics surface.

Observed common behavior: historical dashboards and single-session diagnostics are separate surfaces;
human and machine projections share one report vocabulary; usage scope and time boundaries are explicit;
missing attribution remains visible; directly measured values outrank estimates; deduplication occurs
before aggregation; and dashboards disclose coverage, freshness, and financial limits.

Constraint for Robota: the report must remain provider-neutral, local/offline, privacy-safe, and honest
about `unknown`/estimated data. It cannot depend on provider billing APIs, infer historical facts from
current configuration, or let CLI and GUI independently define accounting.

## Architecture Review

### Affected Scope

- `packages/agent-interface-analytics` — canonical usage identity/attribution and cross-session report
  contracts.
- `packages/agent-interface-session` — per-turn causal driver/surface contract where attribution belongs.
- `packages/agent-core`, `packages/agent-session`, and `packages/agent-framework` — provider-invocation
  identity, canonical usage/started-turn projection, persistence, codec compatibility, and
  nested/autonomous propagation.
- `packages/agent-session-analytics` — pure report reducer, period/timezone semantics, grouped totals,
  coverage, and drill-down IDs.
- `packages/agent-cli` — multi-store snapshot loading, `robota usage`, text output, versioned JSON, and
  admitted-owner GUI-sidecar report production.
- `packages/agent-transport-protocol` — distinct correlated post-admission cross-session report
  request/result/error family; existing per-session report messages stay unchanged.
- `packages/agent-transport-gui` — protocol-only report consumption plus pure cross-session dashboard
  view state/components; no store or analytics dependency.
- `apps/agent-app` — desktop navigation, dashboard mounting, and deterministic GUI verification.
- Governing `docs/SPEC.md` files and focused tests/fixtures in each affected package/app.

### Alternatives Considered

1. **Extend only `robota session analyze --usage --last N`.**
   - Pro: small CLI-only change using an existing command.
   - Con: session count is not a calendar period, no stable shared report emerges, and GUI parity remains
     unresolved.
2. **Aggregate independently in CLI and GUI or let the GUI read session files.**
   - Pro: each presentation can optimize its local shape.
   - Con: dedupe, timezone, confidence, and unknown semantics will drift; direct renderer access also
     violates the documented sidecar/presentation boundary.
3. **Query provider usage APIs or require OpenTelemetry/a second analytics database.**
   - Pro: provider consoles can reconcile billing and a dedicated store may scale large histories.
   - Con: multi-provider/BYO-key/local-model coverage is incomplete, Robota-specific dimensions are
     absent, credentials/network become mandatory, and
     [issue #2007](https://github.com/woojubb/robota/issues/2007) already owns remote export.
4. **Persist canonical attribution, then build one shared pure report with CLI and GUI projections.**
   - Pro: one accounting definition, offline support, explicit compatibility, reusable drill-down, and
     identical surface totals.
   - Con: requires sequenced contract, persistence, analytics, CLI, protocol, and GUI work.

### Decision

Choose alternative 4 and execute it as four child Tasks because persistence accuracy, report accounting,
CLI compatibility, and GUI reachability/presentation have independent failure and verification
boundaries. Protocol admission/privacy tests remain part of the GUI flow because they preserve the
already-ratified OWNER PRINCIPLE rather than introduce a new authorization cause. Protocol frames,
charts, and activity kinds remain implementation steps in their owners.

The shared contract defines `sessions`, started top-level interactive `turns`, tokens, cost confidence,
complete daily buckets, model/surface/execution-source/activity breakdowns, contributing session IDs, and
coverage. A turn observation is persisted after the execution claim is acquired and independently of
usage, so zero-usage, failed, and `interrupted` turns remain countable; never-run `coalesced`, `dropped`,
or `cancelled` submissions and nested/provider rounds are excluded. The `agent-core` execution-round
owner mints one `usageObservationId` before each provider invocation, reuses it for repeated fragments,
and assigns a new ID to a separately observed/billed invocation while correlating `turnId`, `executionId`,
and round. Provider-internal HTTP retries yielding one observed response remain one observation.
`modelRequests` is not a v1 headline unless canonical per-generation events exist. Surface is stored per
canonical usage/turn event; autonomous work remains `unknown`. CLI JSON is an external projection with
`schemaVersion: 1`, independent from internal TypeScript and the session-record envelope.

Validated recommendation:

- **Reachability:** observations originate in provider/session/driver execution and persist through the
  strict codec. Host adapters enumerate one immutable store snapshot; the pure analytics reducer performs
  no I/O. CLI renders the report directly, while the authenticated local sidecar serializes a distinct
  correlated cross-session report result for GUI presentation and drill-down into the existing per-session
  report.
  [Issue #2164](https://github.com/woojubb/robota/issues/2164) remains the GUI reachability prerequisite.
- **New-surface placement:** `robota usage` mirrors the existing root pre-session report command
  `robota session analyze` and is classified in the `agent-cli` product/UI shell's terminal-command
  family. Personal Usage deliberately expands `agent-transport-gui` from running-session-only
  presentation to pure shared cross-session view state/components, mirroring the existing
  `SessionMonitor`/`SessionSurface` composition; Electron navigation and dashboard mounting remain in
  `agent-app`. The shared CLI/runtime host exposes the post-admission report producer/route for every
  admitted transport, consumes `agent-interface-analytics` contracts, and invokes the
  `agent-session-analytics` core; GUI packages consume only the serialized protocol contract and never
  import or invoke analytics or depend on the CLI terminal product.
- **Protocol, admission, and availability:** add distinct cross-session request/result/error variants
  carrying `requestId`, period, and timezone. Malformed payloads are rejected and GUI selection is
  latest-request-wins. Pairing/admission remains the sole trust boundary: local, CLI-web, and paired
  remote drivers have equal owner authority under `local == remote`. Pre-admission failure rejects or
  closes the connection/channel before report-protocol reachability and emits no report data. An admitted
  malformed request receives a typed correlated error only when `requestId` validated; otherwise the
  existing uncorrelated protocol-error/close policy applies without echoing untrusted correlation data.
  Desktop-only dashboard navigation in v1 is product availability, not an authorization distinction.
- **Capability preservation:** `/cost` and `robota session analyze --usage` retain current-session and
  per-session ownership; existing records remain readable; project-over-user session precedence and
  exact/estimated/unknown cost meaning are preserved.
- **Adversarial pass:** repeated message fragments, equal-valued distinct turns, multi-driver sessions,
  nested/autonomous work, legacy records, corrupt/unsupported envelopes, DST, zero/current partial days,
  invalid timezone, missing pricing, renderer drift, and accidental content leakage are explicit test
  paths with fail-closed or visibly partial outcomes.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `robota session analyze` is the analogous CLI report command;
      `SessionMonitor`/`SessionSurface` are the analogous shared GUI presentation; session codec,
      sidecar protocol, desktop shell, [issue #2164](https://github.com/woojubb/robota/issues/2164),
      and [issue #2007](https://github.com/woojubb/robota/issues/2007) reviewed
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: `robota usage` is an `agent-cli` product-shell terminal command mirroring
      `robota session analyze`; Personal Usage adds pure cross-session presentation to
      `agent-transport-gui` and is mounted by `agent-app`. Only the CLI/local host depends on the shared
      analytics core; GUI packages depend on the serialized protocol contract, not a sibling product.

## Fallback & Degradation Declaration

Two intentional, visible degradations are allowed. Legacy or causally unattributed usage remains in
totals under `unknown` with coverage counters; it is not guessed. Corrupt/unsupported records may be
omitted only when other trustworthy records produce a partial report, and their count/identity or schema
version is exposed in coverage. Enumeration failure or absence of any trustworthy report is an explicit
error. Pre-admission failure closes/rejects before report reachability and emits no report data. An
admitted malformed request uses a typed correlated error only after `requestId` validates; otherwise it
uses the existing uncorrelated error/close behavior. No path may return a partial report, echo an untrusted
request ID, or silently catch to empty/success.

## Solution

1. `DATA-2577` adds persisted started-turn observations plus invocation-scoped
   `usageObservationId` and optional actual provider/model/per-turn surface at the canonical creation
   boundary owned by `agent-core`, projects them through session/framework persistence, normalizes
   repeated fragments, and evolves the strict codec without invalidating legacy records.
2. `OBSERVABILITY-2577` defines the provider-neutral cross-session request/report and pure reducer,
   accepting an immutable host snapshot and preserving project-over-user store precedence, complete local
   calendar buckets, started-turn scope, one canonical source per activity metric, confidence, privacy,
   coverage, and contributing-session drill-down IDs.
3. `FLOW-2577` adds `robota usage` with a 7-day default, 30-day and IANA-timezone controls, readable
   text, error/partial/empty states, and a separately versioned full JSON projection; it also owns store
   discovery/snapshot I/O for CLI and local sidecar hosts.
4. Convert [issue #2164](https://github.com/woojubb/robota/issues/2164) to its owning Task, add that exact
   dependency to `SCREEN-2577`, then add the distinct correlated wire family, pure shared GUI view, and
   app-shell navigation without GUI analytics imports or renderer aggregation. Preserve equal authority
   for every admitted owner and add content-free rejection for unpaired/unauthenticated/malformed input.
5. Keep [issue #2007](https://github.com/woojubb/robota/issues/2007) independent. A future exporter may
   consume the stable report, but local history has no dependency on collectors, credentials, or network
   access.

## Affected Files

- `.agents/tasks/AGREEMENT-2577-*.md`, `DATA-2577-*.md`, `OBSERVABILITY-2577-*.md`, `FLOW-2577-*.md`,
  `SCREEN-2577-*.md`
- `packages/agent-interface-analytics/src/usage-contracts.ts` and `docs/SPEC.md`
- `packages/agent-interface-session/src/{driver-contracts,event-contracts,session-contracts,turn-contracts}.ts`
  and `docs/SPEC.md`
- `packages/agent-core/src/services/execution-round*.ts`, execution event/usage contracts, focused tests,
  and `docs/SPEC.md`
- `packages/agent-session/src/session-record-codec/*`, canonical usage/session execution paths, focused
  fixtures/tests, and `docs/SPEC.md`
- `packages/agent-framework` usage projection/driver propagation paths, focused tests, and `docs/SPEC.md`
- `packages/agent-session-analytics/src/{usage,types,index}.ts`, focused tests/fixtures, and `docs/SPEC.md`
- `packages/agent-cli/src` command routing, store loading, output projection, sidecar producer, focused
  tests, and `docs/SPEC.md`
- `packages/agent-transport-protocol/src` cross-session report messages/capability/error contracts,
  focused tests, and inline/API contract documentation
- `packages/agent-transport-gui/src` report client/state/components/tests and `docs/SPEC.md`
- `apps/agent-app/src`, deterministic sidecar/E2E fixtures/tests, and `docs/SPEC.md`

## Completion Criteria

- [ ] TC-01: DATA-2577 proves one started-turn observation for zero-usage/success/failure/`interrupted`,
      none for never-run `coalesced`/`dropped`/`cancelled`; invocation-scoped `usageObservationId`
      deduplicates repeated fragments but not separately observed invocations or equal distinct usage;
      actual optional provider/model/per-turn surface round-trips; legacy records remain readable without
      guessed attribution.
- [ ] TC-02: OBSERVABILITY-2577 produces deterministic 7/30-day inclusive-start/exclusive-end reports
      with complete buckets, explicit timezone, summary/breakdowns/activity/drill-down, confidence, and
      coverage across valid, legacy, duplicate, corrupt, unsupported, empty, DST, and partial-day fixtures.
- [ ] TC-03: `robota usage --period 7d` and `robota usage --period 30d --timezone UTC --format json`
      exit 0 on the canonical fixture; JSON declares `schemaVersion: 1`, and invalid period/timezone exits
      non-zero through the standard CLI error contract.
- [ ] TC-04: the GUI 7/30-day dashboard consumes the distinct correlated sidecar report, applies
      latest-request-wins, renders accessible loading/empty/
      partial/error/unknown/estimated states, and drills into the existing per-session report after the
      converted [issue #2164](https://github.com/woojubb/robota/issues/2164) dependency is satisfied;
      admitted owner surfaces receive equivalent results; pre-admission failures never reach the report
      producer; malformed admitted requests get a content-free correlated error only with a validated
      `requestId`, otherwise the existing uncorrelated protocol error/close behavior.
- [ ] TC-05: one fixture corpus yields equal normalized totals, buckets, breakdowns, and coverage through
      the shared report, CLI JSON, and GUI view model, with no prompt/response/path/tool-payload fields.
- [ ] TC-06: all four declared child Tasks are `done`, the exact child projections below are current,
      and [issue #2577](https://github.com/woojubb/robota/issues/2577) retains or reaches a truthful
      terminal state only after the complete external outcome lands.

## Test Plan

| TC-ID | Test Type                         | Tool / Approach                                        | Notes                                     |
| ----- | --------------------------------- | ------------------------------------------------------ | ----------------------------------------- |
| TC-01 | Consumer-driven contract + codec  | Focused Vitest type/codec/session integration suites   | Includes RED proofs in DATA-2577          |
| TC-02 | Observability reducer contract    | Focused Vitest fixtures with injected clock/timezone   | Includes store, turn, and activity dedupe |
| TC-03 | CLI process integration           | Built `robota usage` against isolated fixture stores   | Assert stdout, stderr, schema, exit codes |
| TC-04 | WebSocket + GUI integration       | Sidecar fixtures plus Playwright/component E2E         | Admission parity + issue 2164 dependency  |
| TC-05 | Cross-consumer contract           | One fixture snapshot compared across three projections | Privacy allowlist assertion included      |
| TC-06 | Initiative lifecycle verification | Task lifecycle scan plus `pnpm harness:scan`           | Parent completes only after all children  |

## User Execution Test Scenarios

### Scenario 1 — CLI personal usage report

Prerequisites: build the CLI and install the canonical AGREEMENT-2577 fixture in isolated user/project session
stores, including legacy, duplicate, and partially attributed records. Run
`robota usage --period 7d --format json`, then
`robota usage --period 30d --timezone UTC`.

Expected: both commands exit 0 and show exact interval/timezone, sessions, top-level turns, tokens, cost
confidence, complete daily buckets, model/surface/source/activity breakdowns, contributing sessions, and
coverage. Duplicate canonical events count once, legacy facts are `unknown`, current day is partial, and
no stored content appears. Cleanup: remove only isolated fixture stores. Evidence: pending commands,
exit codes, and JSON/text snapshots.

### Scenario 2 — GUI parity and drill-down

Prerequisites: complete the converted [issue #2164](https://github.com/woojubb/robota/issues/2164)
dependency and start the deterministic GUI sidecar over the same fixture. Open Personal Usage, switch 7
days to 30 days, switch model to surface breakdown, inspect coverage, and open a contributing session.

Expected: normalized values equal CLI JSON for the same request; empty/partial/error/unknown/estimated
states are visible and accessible; drill-down opens the existing per-session report. Cleanup: stop the
sidecar and remove fixture stores. Evidence: pending automated GUI trace and screenshots.

### Scenario 3 — admission boundary and equal owner authority

Prerequisites: start the deterministic sidecar plus an unpaired client and authenticated desktop-local,
paired remote/WebRTC, and CLI-web owner clients over the same fixture. Request the cross-session report
from each client with unique request IDs.

Expected: every admitted owner receives an equivalent correlated report; the unpaired connection is
rejected/closed before report-protocol reachability and emits no report data. An admitted malformed request
with a validated request ID receives a correlated typed error; a missing/invalid ID follows the existing
uncorrelated error/close policy and never echoes the untrusted value. Desktop-only navigation does not
alter protocol authority. Cleanup: stop the clients and fixture sidecar. Evidence: pending automated
protocol output.

## Tasks

- [ ] DATA-2577 — todo — `.agents/tasks/DATA-2577-persist-canonical-usage-identity-and-model-provider-surface-attribution.md`
- [ ] OBSERVABILITY-2577 — todo — `.agents/tasks/OBSERVABILITY-2577-aggregate-versioned-cross-session-personal-usage-reports.md`
- [ ] FLOW-2577 — todo — `.agents/tasks/FLOW-2577-expose-cross-session-usage-through-robota-usage-text-and-json.md`
- [ ] SCREEN-2577 — todo — `.agents/tasks/SCREEN-2577-render-the-shared-personal-usage-dashboard-in-robota-gui.md`

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-09-06

**Status remains:** draft
**Failed criteria:**

- New-surface placement: the checklist names the existing CLI command family and the GUI packages that
  will contain the new surfaces, but it does not identify a concrete analogous existing CLI command and
  GUI screen/layer that the new command and dashboard mirror, nor explicitly state each surface's
  product-family classification and shared-contract dependency direction as required.
  **Required action:** In the Sibling scan or Decision, name the closest existing CLI and GUI analogues,
  classify `robota usage` and Personal Usage in the repository's product-family taxonomy, and state that
  both consume the shared analytics contract/core without depending on a sibling product.

**Judged at:** HEAD `3381a7d4ab37f4cae40eaea1bd0d8349b70fdfd7` · base `origin/develop@3381a7d4ab37f4cae40eaea1bd0d8349b70fdfd7` · document `.agents/spec-docs/draft/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md` blob `b9215b95809c749e075486825fe9a4feee812308` (untracked)

### [GATE-WRITE] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → review-ready

- Frontmatter: valid YAML opening, `status: draft`, `type: AGREEMENT`, tags, and L2 lane are present.
- Problem: names the missing CLI command and GUI dashboard, the two-surface reproduction condition, and
  the underlying attribution, dedupe, coverage, and reachability gaps without placeholders.
- Prior Art Research: cites product/API documentation and carries the observed accounting, boundary,
  privacy, and compatibility lessons into the alternatives and decision.
- Architecture Review: affected scope, checked sibling scan, four pro/con alternatives, shared-report
  trade-off, reachability, capability preservation, and adversarial paths are explicit.
- New-surface placement: `robota session analyze` and `SessionMonitor`/`SessionSurface` are the named
  analogues; the terminal-command and shared-GUI-presentation product families are explicit; both consume
  the analytics contract/core without a sibling-product dependency.
- Completion Criteria: 6 observable `TC-N` criteria cover the four child outcomes, cross-consumer parity
  and privacy, and initiative completion; no banned completion wording is used.
- Test Plan: 6 non-empty automated rows correspond one-for-one with TC-01 through TC-06; no manual-test
  exception requires justification.
- Structure: Tasks and Evidence Log sections are present, the Evidence Log preserves the initial FAIL and
  bounded correction history, and no body-level Status or Classification section exists.

**Judged at:** HEAD `3381a7d4ab37f4cae40eaea1bd0d8349b70fdfd7` · base `origin/develop@3381a7d4ab37f4cae40eaea1bd0d8349b70fdfd7` · document `.agents/spec-docs/draft/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md` blob `cc3152b2188507b0cb4564695c176ee6add6349c` (untracked)

### [GATE-WRITE] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → review-ready

- GATE-WRITE — File begins with `---` YAML frontmatter block: PASS — the file begins with a delimited `---` frontmatter block.
- GATE-WRITE — `status: draft` present in frontmatter: PASS — frontmatter declares `status: draft`.
- GATE-WRITE — `type:` is exactly one permitted value: PASS — `type: AGREEMENT` is one of the 11 allowed values.
- GATE-WRITE — `tags:` field present in frontmatter: PASS — `tags:` is present with four values.
- GATE-WRITE — Contains a concrete symptom: PASS — Robota has neither a `robota usage` cross-session command nor a GUI personal usage dashboard, and current usage snapshots lack required attribution and coverage.
- GATE-WRITE — Contains a reproduction condition: PASS — the Problem identifies asking for 7- or 30-day history from either the CLI or GUI as the condition where the missing behavior appears.
- GATE-WRITE — Does not contain `TBD`, `TODO`, or a vague single-sentence Problem: PASS — the Problem contains neither placeholder and describes the missing surfaces and accounting gaps across two paragraphs.
- GATE-WRITE — `## Prior Art Research` or `## Research` section present: PASS — `## Prior Art Research` is present.
- GATE-WRITE — Prior Art Research is substantiated by a source, no-comparable-reference result, or waiver: PASS — the section cites OpenAI, GitHub Copilot, Claude, and Langfuse product/API documentation.
- GATE-WRITE — Explicit `Waived: <reason>` alternative is satisfied: PASS as N/A — substantiated documentation research is present, so the alternative waiver route is not used.
- GATE-WRITE — Research findings or waiver feed Alternatives Considered and Decision: PASS — the observed shared vocabulary, explicit interval, missing-attribution, dedupe, coverage, and local/privacy constraints directly support the shared canonical report over independent surfaces or provider APIs.
- GATE-WRITE — All Architecture Review checklist items are checked: PASS — all five displayed checklist items are `[x]`.
- GATE-WRITE — Sibling scan is checked with completion evidence or an explicit N/A reason: PASS — the checked item names `robota session analyze`, `SessionMonitor`/`SessionSurface`, the session codec, sidecar protocol, desktop shell, [issue #2164](https://github.com/woojubb/robota/issues/2164), and [issue #2007](https://github.com/woojubb/robota/issues/2007).
- GATE-WRITE — Alternatives Considered has at least two entries with Pro and Con: PASS — four numbered alternatives each state an explicit Pro and Con.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — it chooses one offline provider-neutral accounting definition and identical projections while accepting sequenced contract, persistence, analytics, CLI, protocol, and GUI work.
- GATE-WRITE — New-surface placement conditional: PASS — `robota usage` mirrors `robota session analyze` in the `agent-cli` terminal-command family; Personal Usage mirrors `SessionMonitor`/`SessionSurface` in shared GUI presentation; both consume the analytics contract/core without depending on a sibling product.
- GATE-WRITE — Every Completion Criterion has a `TC-NN` prefix: PASS — all six criteria are prefixed `TC-01:` through `TC-06:`.
- GATE-WRITE — At least one criterion exists per distinct feature or sub-item: PASS — TC-01 through TC-04 cover the four child outcomes, TC-05 covers cross-consumer parity and privacy, and TC-06 covers initiative completion and truthful issue state.
- GATE-WRITE — Each criterion uses Command or Observable behavior form: PASS — every criterion requires inspectable dedupe, round-trip, report, process exit, GUI-state, projection, privacy, or lifecycle outcomes.
- GATE-WRITE — No criterion uses a forbidden vague phrase: PASS — none contains `works correctly`, `no errors`, `implemented`, or `displays correctly`.
- GATE-WRITE — `## Test Plan` section present: PASS — the section is present.
- GATE-WRITE — One Test Plan row exists for each Completion Criterion: PASS — six rows match the six completion criteria.
- GATE-WRITE — Every Test Plan row has a non-empty Test Type and Tool/Approach without `TBD`: PASS — all six rows satisfy the required fields.
- GATE-WRITE — Manual Test Plan rows explain why automation is impossible: PASS — there are zero manual rows.
- GATE-WRITE — `## Tasks` section present with placeholder: PASS — the section records four unchecked todo child Task paths.
- GATE-WRITE — `## Evidence Log` was present and empty before this first gate run: PASS — the preserved first GATE-WRITE entry was appended to the initially empty section; this corrected rerun retains the complete history.
- GATE-WRITE — No body `## Status` or `## Classification` section: PASS — neither body section exists.

**Judged at:** HEAD `3381a7d4ab37f4cae40eaea1bd0d8349b70fdfd7` · base `origin/develop@3381a7d4ab37f4cae40eaea1bd0d8349b70fdfd7` · document `.agents/spec-docs/draft/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md` blob `e4c8a1135b8aa2d50c1bf9f0c380d4beb96056e2` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-06

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인합니다."
**Given:** 2026-09-06, this conversation
**Review fingerprint:** ac854102d16c (review c95c12fc, type/tags 162187dc)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-06, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (ac854102d16c) equals the document's current fingerprint

**Judged at:** HEAD `ecf1a6c90a8c` · base `origin/develop@3381a7d4ab37` · document `.agents/spec-docs/backlog/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md` blob `6e5c1a010aa7` (tracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-06

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인합니다. 구현 완료는 origin/develop에 머지까지 하는게 완료입니다."
**Given:** 2026-09-06, this conversation
**Review fingerprint:** 20ee395b855a (review 399aff37, type/tags 162187dc)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-06, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (20ee395b855a) equals the document's current fingerprint
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — Route DIRECT records the user's explicit `"승인합니다. 구현 완료는 origin/develop에 머지까지 하는게 완료입니다."` for AGREEMENT-2577 in this conversation; it confirms the design and authorizes implementation.
- GATE-APPROVAL — The item is inside the class as the registry defines it: PASS as N/A — Route DIRECT is used, so no delegated class boundary applies.
- GATE-APPROVAL — Independent architecture validation conditional: PASS — the independent read-only `proposal-reviewer` ENDORSED the corrected recommendation after explicitly reviewing the new-surface placement: `agent-core` owns canonical usage identity, `agent-cli` owns the terminal command and shared CLI/runtime report host, `agent-transport-protocol` owns the admitted wire contract, `agent-transport-gui` owns pure shared GUI presentation, and `agent-app` owns only desktop navigation/dashboard mounting; it also confirmed equal authority for admitted local, CLI-web, and paired-remote owners and the separate #2164/#2007 boundaries. Exact terminal verdict: `REVIEW VERDICT: ENDORSE`. The retained architecture-audit-fanout structure channel independently covered the eight named placement/dependency/admission cells and returned `AUDIT-DIM-COMPLETE: dim=structure shard=1/1 blocker=0 high=0 medium=0 low=0 coverage=8/8 uncovered=none`.

**Judged at:** HEAD `ae11b1d97951` · base `origin/develop@b080d2087bf7` · document `.agents/spec-docs/backlog/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md` blob `fcdefdbd4786` (tracked)
