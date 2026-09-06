---
status: done
type: AGREEMENT
tags: [cli, desktop, json-schema, typescript]
lane: L2
---

# AGREEMENT-2577: Coordinate cross-session usage reporting across CLI and GUI

Paired with `.agents/tasks/completed/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md`.
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

**Delivery mode:** `sequenced`

**Continuation artifacts:** `.agents/spec-docs/done/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md`, `.agents/tasks/completed/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md`, `.agents/tasks/completed/DATA-2577-persist-canonical-usage-identity-and-model-provider-surface-attribution.md`, `.agents/tasks/completed/OBSERVABILITY-2577-aggregate-versioned-cross-session-personal-usage-reports.md`, `.agents/tasks/completed/FLOW-2577-expose-cross-session-usage-through-robota-usage-text-and-json.md`, `.agents/tasks/completed/SCREEN-2577-render-the-shared-personal-usage-dashboard-in-robota-gui.md`

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

- [x] TC-01: DATA-2577 proves one started-turn observation for zero-usage/success/failure/`interrupted`,
      none for never-run `coalesced`/`dropped`/`cancelled`; invocation-scoped `usageObservationId`
      deduplicates repeated fragments but not separately observed invocations or equal distinct usage;
      actual optional provider/model/per-turn surface round-trips; legacy records remain readable without
      guessed attribution.
- [x] TC-02: OBSERVABILITY-2577 produces deterministic 7/30-day inclusive-start/exclusive-end reports
      with complete buckets, explicit timezone, summary/breakdowns/activity/drill-down, confidence, and
      coverage across valid, legacy, duplicate, corrupt, unsupported, empty, DST, and partial-day fixtures.
- [x] TC-03: `robota usage --period 7d` and `robota usage --period 30d --timezone UTC --format json`
      exit 0 on the canonical fixture; JSON declares `schemaVersion: 1`, and invalid period/timezone exits
      non-zero through the standard CLI error contract.
- [x] TC-04: the GUI 7/30-day dashboard consumes the distinct correlated sidecar report, applies
      latest-request-wins, renders accessible loading/empty/
      partial/error/unknown/estimated states, and drills into the existing per-session report after the
      converted [issue #2164](https://github.com/woojubb/robota/issues/2164) dependency is satisfied;
      admitted owner surfaces receive equivalent results; pre-admission failures never reach the report
      producer; malformed admitted requests get a content-free correlated error only with a validated
      `requestId`, otherwise the existing uncorrelated protocol error/close behavior.
- [x] TC-05: one fixture corpus yields equal normalized totals, buckets, breakdowns, and coverage through
      the shared report, CLI JSON, and GUI view model, with no prompt/response/path/tool-payload fields.
- [x] TC-06: all four declared child Tasks are `done`, the exact child projections below are current,
      and [issue #2577](https://github.com/woojubb/robota/issues/2577) retains or reaches a truthful
      terminal state only after the complete external outcome lands.

## Test Plan

| TC-ID | Test Type                         | Tool / Approach                                                                                                                                                     | Notes                                                                                                  |
| ----- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| TC-01 | Consumer-driven contract + codec  | `packages/agent-core/src/services/__tests__/provider-request-event.test.ts`; `packages/agent-framework/src/interactive/__tests__/interactive-session-usage.test.ts` | Started turns, invocation identity, codec                                                              |
| TC-02 | Observability reducer contract    | `packages/agent-session-analytics/src/__tests__/personal-usage.test.ts`                                                                                             | Store, turn, activity, timezone, coverage                                                              |
| TC-03 | CLI process integration           | `packages/agent-cli/examples/verify-personal-usage.ts`; `packages/agent-cli/src/usage/__tests__/usage-command.test.ts`                                              | Text/JSON/error/privacy process assertions                                                             |
| TC-04 | WebSocket + GUI integration       | `apps/agent-app/e2e/usage-dashboard.mjs`; `packages/agent-transport-protocol/src/__tests__/personal-usage-report.test.ts`                                           | Admission, correlation, dashboard, drill-down                                                          |
| TC-05 | Cross-consumer contract           | `packages/agent-cli/src/usage/__tests__/usage-command.test.ts`; `packages/agent-transport-gui/src/hooks/__tests__/use-session-client-broadcast.test.tsx`            | Shared totals and privacy allowlist                                                                    |
| TC-06 | Initiative lifecycle verification | `scripts/harness/check-task-archival.mjs`; `scripts/harness/scan-task-plan-items.mjs`                                                                               | Skip reason: lifecycle state is verified by the named harness scanners rather than a product test file |

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: automatable | 3`

### Scenario 1: CLI personal usage report

- **executability:** agent-executable
- **product surface:** robota-cli
- **surface rationale:** shipped-entrypoint=robota
- **prerequisites:** build the CLI and let the durable runner install the canonical fixture in isolated user/project stores; no live provider credential or external service is required
- **command:** `pnpm exec robota usage --period 30d --timezone UTC --format json`
- **observable type:** product-output
- **expected observable:** exit=0; output-contains="schemaVersion":1, 30 daily buckets, "totalTokens":42, and "costStatus":"estimated"; output-excludes=PROMPT_CONTENT_MUST_NOT_APPEAR
- **observable rationale:** source=product-process
- **cleanup:** remove only the isolated fixture stores
- **evidence:** `pnpm exec tsx packages/agent-cli/examples/verify-personal-usage.ts` exited 0 on 2026-09-06 with `jsonExit=0`, `textExit=0`, `invalidExit=1`, `totalTokens=42`, and `privacyLeak=false` after invoking the built product commands.

### Scenario 2: GUI parity and drill-down

- **executability:** agent-executable
- **product surface:** robota-browser-ui
- **surface rationale:** shipped-interface=robota-browser-ui
- **prerequisites:** build the Electron app and launch the durable Playwright runner against its deterministic admitted sidecar; no live provider credential or external service is required
- **browser steps:** wait for `.agent-gui-status[data-status="connected"]`; activate Usage; activate 30 days; activate By surface; activate the first Open session button; activate Current session trace
- **observable type:** ui-state
- **expected observable:** visible=Personal usage, 30 days, By surface, Partial day, estimated, desktop-app, 42-token stored-session detail, and 42-token current-session trace; absent=PROMPT_CONTENT_MUST_NOT_APPEAR
- **observable rationale:** source=rendered-product-ui
- **cleanup:** close Electron and terminate its fixture sidecar
- **evidence:** `node apps/agent-app/e2e/usage-dashboard.mjs` exited 0 on 2026-09-06 with `SCREEN-2577 usage dashboard scenario passed` after observing the accessible dashboard and both drill-down report families.

### Scenario 3: admission boundary

- **executability:** agent-executable
- **product surface:** robota-browser-ui
- **surface rationale:** shipped-interface=robota-browser-ui
- **prerequisites:** launch Electron through the durable runner against a sidecar configured with a mismatched admission token; no live provider credential or external service is required
- **browser steps:** wait for the Personal Usage unavailable alert; verify the seeded usage model is absent
- **observable type:** ui-state
- **expected observable:** visible=Personal Usage is unavailable; absent=scripted-model
- **observable rationale:** source=rendered-product-ui
- **cleanup:** close the rejected Electron instance and terminate its fixture sidecar
- **evidence:** the rejection half of `node apps/agent-app/e2e/usage-dashboard.mjs` exited 0 on 2026-09-06 with `ARCH-2164 rejected-admission scenario passed` and no seeded usage content rendered.

## Tasks

- [x] AGREEMENT-2577 — done — `.agents/tasks/completed/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md`
- [x] DATA-2577 — done — `.agents/tasks/completed/DATA-2577-persist-canonical-usage-identity-and-model-provider-surface-attribution.md`
- [x] OBSERVABILITY-2577 — done — `.agents/tasks/completed/OBSERVABILITY-2577-aggregate-versioned-cross-session-personal-usage-reports.md`
- [x] FLOW-2577 — done — `.agents/tasks/completed/FLOW-2577-expose-cross-session-usage-through-robota-usage-text-and-json.md`
- [x] SCREEN-2577 — done — `.agents/tasks/completed/SCREEN-2577-render-the-shared-personal-usage-dashboard-in-robota-gui.md`

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

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-06

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-06; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task carries 9 checkbox tasks for 6 criteria
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 953 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: automatable | 3`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "sequenced",
  "sequencedArtifacts": [
    ".agents/spec-docs/active/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md",
    ".agents/tasks/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md",
    ".agents/tasks/DATA-2577-persist-canonical-usage-identity-and-model-provider-surface-attribution.md",
    ".agents/tasks/OBSERVABILITY-2577-aggregate-versioned-cross-session-personal-usage-reports.md",
    ".agents/tasks/FLOW-2577-expose-cross-session-usage-through-robota-usage-text-and-json.md",
    ".agents/tasks/SCREEN-2577-render-the-shared-personal-usage-dashboard-in-robota-gui.md"
  ],
  "taskPath": ".agents/tasks/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md",
  "specPath": ".agents/spec-docs/todo/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md",
  "taskItems": [
    {
      "kind": "checkbox",
      "value": "DATA-2577 — todo — `.agents/tasks/DATA-2577-persist-canonical-usage-identity-and-model-provider-surface-attribution.md`"
    },
    {
      "kind": "checkbox",
      "value": "OBSERVABILITY-2577 — todo — `.agents/tasks/OBSERVABILITY-2577-aggregate-versioned-cross-session-personal-usage-reports.md`"
    },
    {
      "kind": "checkbox",
      "value": "FLOW-2577 — todo — `.agents/tasks/FLOW-2577-expose-cross-session-usage-through-robota-usage-text-and-json.md`"
    },
    {
      "kind": "checkbox",
      "value": "SCREEN-2577 — todo — `.agents/tasks/SCREEN-2577-render-the-shared-personal-usage-dashboard-in-robota-gui.md`"
    },
    {
      "kind": "checkbox",
      "value": "Complete DATA-2577 first so usage identity, actual model/provider, per-turn surface attribution, and legacy decoding are canonical before aggregation."
    },
    {
      "kind": "checkbox",
      "value": "Complete OBSERVABILITY-2577 over those records, including one store/event deduplication policy, 7/30-day calendar semantics, confidence, coverage, and drill-down IDs."
    },
    {
      "kind": "checkbox",
      "value": "Complete FLOW-2577 against the shared report and publish a separately versioned JSON projection."
    },
    {
      "kind": "checkbox",
      "value": "Convert/deliver [issue #2164](https://github.com/woojubb/robota/issues/2164)'s GUI reachability owner, then complete SCREEN-2577 against the same shared report without renderer-side aggregation."
    },
    {
      "kind": "checkbox",
      "value": "Verify one fixture corpus yields equivalent CLI JSON and GUI view-model totals before the parent can complete."
    }
  ],
  "plan": {
    "outcome": "automatable",
    "count": 3
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md",
    ".agents/tasks/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged at:** HEAD `7b29a4b01f49` · base `origin/develop@c651c769e27c` · document `.agents/spec-docs/todo/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md` blob `8a68a58b5b3b` (modified)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-06

**Command:** `pnpm exec vitest run packages/agent-core/src/services/__tests__/provider-request-event.test.ts packages/agent-framework/src/interactive/__tests__/interactive-session-usage.test.ts`
**Exit:** 0
**Output:** (last 10 of 11 line(s))

```

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-3

 ✓ packages/agent-framework/src/interactive/__tests__/interactive-session-usage.test.ts (7 tests) 3ms
 ✓ packages/agent-core/src/services/__tests__/provider-request-event.test.ts (2 tests) 15ms

 Test Files  2 passed (2)
      Tests  9 passed (9)
   Start at  16:59:22
   Duration  1.27s (transform 871ms, setup 0ms, collect 1.21s, tests 18ms, environment 0ms, prepare 261ms)
```

**Judged at:** HEAD `8634dd21c48f` · base `origin/develop@e20a85e1c6f5` · document `.agents/spec-docs/active/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md` blob `15beeaf99c56` (modified)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-06

**Command:** `pnpm exec vitest run packages/agent-session-analytics/src/__tests__/personal-usage.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
4:59:22 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-3

 ✓ packages/agent-session-analytics/src/__tests__/personal-usage.test.ts (7 tests) 25ms

 Test Files  1 passed (1)
      Tests  7 passed (7)
   Start at  16:59:22
   Duration  481ms (transform 91ms, setup 0ms, collect 118ms, tests 25ms, environment 0ms, prepare 80ms)
```

**Judged at:** HEAD `8634dd21c48f` · base `origin/develop@e20a85e1c6f5` · document `.agents/spec-docs/active/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md` blob `a60d093ac220` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-06

**Command:** `pnpm exec tsx packages/agent-cli/examples/verify-personal-usage.ts`
**Exit:** 0
**Output:** (last 1 of 1 line(s))

```
{"scenario":"personal-usage-cli","jsonExit":0,"textExit":0,"invalidExit":1,"totals":{"sessions":1,"turns":1,"promptTokens":30,"completionTokens":12,"totalTokens":42,"costUsd":0.0042,"costStatus":"estimated"},"privacyLeak":false}
```

**Judged at:** HEAD `8634dd21c48f` · base `origin/develop@e20a85e1c6f5` · document `.agents/spec-docs/active/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md` blob `c5b086724e35` (modified)

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-09-06

**Command:** `node apps/agent-app/e2e/usage-dashboard.mjs`
**Exit:** 0
**Output:** (last 2 of 2 line(s))

```
SCREEN-2577 usage dashboard scenario passed
ARCH-2164 rejected-admission scenario passed
```

**Judged at:** HEAD `8634dd21c48f` · base `origin/develop@e20a85e1c6f5` · document `.agents/spec-docs/active/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md` blob `d43ab12d978d` (modified)

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-09-06

**Command:** `pnpm exec vitest run packages/agent-cli/src/usage/__tests__/usage-command.test.ts packages/agent-transport-gui/src/hooks/__tests__/use-session-client-broadcast.test.tsx`
**Exit:** 0
**Output:** (last 10 of 11 line(s))

```

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-3

 ✓ packages/agent-cli/src/usage/__tests__/usage-command.test.ts (5 tests) 27ms
 ✓ packages/agent-transport-gui/src/hooks/__tests__/use-session-client-broadcast.test.tsx (6 tests) 41ms

 Test Files  2 passed (2)
      Tests  11 passed (11)
   Start at  16:59:22
   Duration  1.39s (transform 684ms, setup 0ms, collect 994ms, tests 68ms, environment 786ms, prepare 220ms)
```

**Judged at:** HEAD `8634dd21c48f` · base `origin/develop@e20a85e1c6f5` · document `.agents/spec-docs/active/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md` blob `5158498f6d9b` (modified)

### [GATE-COMPLETE: TC-06] — ✅ PASS | 2026-09-06

**Command:** `node scripts/harness/check-task-archival.mjs`
**Exit:** 0
**Output:** (last 2 of 2 line(s))

```
::examined:: 159 active task files
task-archival scan passed (159 active task file(s) examined, 1079 archived in .agents/tasks/completed/).
```

**Judged at:** HEAD `8634dd21c48f` · base `origin/develop@e20a85e1c6f5` · document `.agents/spec-docs/active/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md` blob `1b3e4e708490` (modified)

### [GATE-VERIFY] — ❌ FAIL | 2026-09-06

**Status remains:** in-progress
**Failed criteria:**

- Tests pass for all affected packages (`pnpm test`): FAIL — `pnpm test` exited 1. `apps/agent-server/src/__tests__/app.test.ts` failed `Agent Server HTTP routes > SEC-008 regression: /api/v1/remote/chat spends operator credit and must be authenticated > refuses a token signed with a different secret`; the assertion expected HTTP 401 but observed HTTP 404.
  **Required action:** resolve or establish the named failing test ground, rerun the full `pnpm test` successfully, and then re-run GATE-VERIFY.

**Criteria met:**

- Ordering: PASS — the document is under `.agents/spec-docs/active/` with `status: in-progress`, and its last GATE-IMPLEMENT entry is `✅ PASS` with `approved → in-progress`.
- Every item in the paired Task's `## Plan` is complete: PASS — all five Plan items are `[x]`; `node scripts/harness/scan-task-plan-items.mjs` exited 0 after examining 253 Task Plan sections.
- No Plan item is blocked or pending: PASS — the five checked Plan items contain no blocked or pending disposition.
- Build passes for all affected packages: PASS — `pnpm build` exited 0 and completed all package JavaScript builds plus all 11 type-build tiers.

**Judged at:** HEAD `8634dd21c48f` · base `origin/develop@e20a85e1c6f5` · document `.agents/spec-docs/active/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md` blob `ed1e0ff3decda081259d94b25b4a8d4ad955e28a` (modified)

### [GATE-VERIFY] — ❌ FAIL | 2026-09-06

**Status remains:** in-progress
**Failed criteria:**

- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): `pnpm build` → exit 0 ( ✓ done ⏎ ⏎ ✓ All build:types complete.); `env -u NO_COLOR pnpm test` → exit 1 ( ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @robota-sdk/agent-framework@3.0.0-beta.79 test: `vitest run --passWithNoTests` ⏎ Exit status 1 ⏎  ELIFECYCLE  Test failed. See above for more details.)
  **Required action:** make every verify command exit 0
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): `pnpm build` → exit 0 ( ✓ done ⏎ ⏎ ✓ All build:types complete.); `env -u NO_COLOR pnpm test` → exit 1 ( ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @robota-sdk/agent-framework@3.0.0-beta.79 test: `vitest run --passWithNoTests` ⏎ Exit status 1 ⏎  ELIFECYCLE  Test failed. See above for more details.)
  **Required action:** make every verify command exit 0

**Judged at:** HEAD `8634dd21c48f` · base `origin/develop@e20a85e1c6f5` · document `.agents/spec-docs/active/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md` blob `65d645ea6ad9` (modified)

### [GATE-VERIFY] — ❌ FAIL | 2026-09-06

**Status remains:** in-progress
**Failed criteria:**

- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): `pnpm build` → exit 0 ( ✓ done ⏎ ⏎ ✓ All build:types complete.); `env -u NO_COLOR pnpm run -r --workspace-concurrency=1 --if-present test` → exit 1 ( 134| ⏎ ⏎ ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯)
  **Required action:** make every verify command exit 0
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): `pnpm build` → exit 0 ( ✓ done ⏎ ⏎ ✓ All build:types complete.); `env -u NO_COLOR pnpm run -r --workspace-concurrency=1 --if-present test` → exit 1 ( 134| ⏎ ⏎ ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯)
  **Required action:** make every verify command exit 0

**Judged at:** HEAD `8634dd21c48f` · base `origin/develop@e20a85e1c6f5` · document `.agents/spec-docs/active/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md` blob `463991601d0a` (modified)

### [GATE-VERIFY] — ❌ FAIL | 2026-09-06

**Status remains:** in-progress
**Failed criteria:**

- Tests pass for all affected packages (`pnpm test`): FAIL — the fresh `pnpm test` run exited 1. `packages/agent-transport-tui/src/__tests__/rendered-markdown-styling.test.tsx` failed two SCREEN-006 cases: `ToolDiffBlock keeps the added/removed diff colours` and `StreamingIndicator keeps the colours of a diff block in streamed text`; both rendered the diff text without the expected ANSI light-green/light-red sequences.
  **Required action:** resolve or establish the named failing-test ground, rerun the full `pnpm test` successfully, and then re-run GATE-VERIFY.

**Criteria met:**

- Ordering: PASS — the document is under `.agents/spec-docs/active/` with `status: in-progress`, and its last GATE-IMPLEMENT entry is `✅ PASS` with `approved → in-progress`.
- Every item in the paired Task's `## Plan` is complete: PASS — all five Plan items are `[x]`; `node scripts/harness/scan-task-plan-items.mjs` exited 0 after examining 253 Task Plan sections.
- No Plan item is blocked or pending: PASS — the five checked Plan items contain no blocked or pending disposition.
- Build passes for all affected packages: PASS — the fresh `pnpm build` run exited 0 and completed all package JavaScript builds plus all 11 type-build tiers.

**Judged at:** HEAD `8634dd21c48f` · base `origin/develop@e20a85e1c6f5` · document `.agents/spec-docs/active/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md` blob `4f9950f2851ba1ddb16095ec6ccb86df6e5587e7` (modified)

### [GATE-VERIFY] — ✅ PASS | 2026-09-06

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — Ordering: PASS — the document is under `.agents/spec-docs/active/` with `status: in-progress`, and its last GATE-IMPLEMENT entry is `✅ PASS` with `approved → in-progress`.
- GATE-VERIFY — Every item in the paired Task's `## Plan` is complete: PASS — all five Plan items are `[x]`; `node scripts/harness/scan-task-plan-items.mjs` exited 0 after examining 253 Task Plan sections.
- GATE-VERIFY — No Plan item is blocked or pending: PASS — the five checked Plan items contain no blocked or pending disposition.
- GATE-VERIFY — Build passes for all affected packages: PASS — the fresh `pnpm build` run exited 0 and completed all package JavaScript builds plus all 11 type-build tiers.
- GATE-VERIFY — Tests pass for all affected packages: PASS — the fresh `pnpm test` run exited 0; the complete recursive workspace test run finished successfully.

**Judged at:** HEAD `8634dd21c48f` · base `origin/develop@e20a85e1c6f5` · document `.agents/spec-docs/active/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md` blob `9548181c5a1f558c8a730d8564ed3a1c23c0911d` (modified)

### [GATE-COMPLETE] — ❌ FAIL | 2026-09-06

**Status remains:** verifying
**Failed criteria:**

- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : TC-06: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: TC-06: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: TC-06: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/completed/DATA-2577-persist-canonical-usage-identity-and-model-provider-surface-attribution.md`, which is not an active root Task path
  **Required action:** record the active Task at `.agents/tasks/<ID>.md` rather than an archived or nested path

**Judged at:** HEAD `8634dd21c48f` · base `origin/develop@e20a85e1c6f5` · document `.agents/spec-docs/active/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md` blob `5f4933b40019` (modified)

### [GATE-COMPLETE] — ✅ PASS | 2026-09-06

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-09-06; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 6/6 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (6)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (6) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (6) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 6/6 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (6) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 9/9 tasks `[x]` in .agents/tasks/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md

**Judged at:** HEAD `8634dd21c48f` · base `origin/develop@e20a85e1c6f5` · document `.agents/spec-docs/active/AGREEMENT-2577-coordinate-cross-session-usage-reporting-across-cli-and-gui.md` blob `2dcc3f5c73a0` (modified)
