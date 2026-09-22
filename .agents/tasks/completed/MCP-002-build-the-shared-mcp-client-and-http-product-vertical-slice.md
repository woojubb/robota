---
title: 'MCP-002: build the shared MCP client and HTTP product vertical slice'
issue: https://github.com/woojubb/robota/issues/2521
status: done
created: 2026-09-03
completed: 2026-09-22
priority: critical
urgency: now
area: agent-mcp, agent-cli, publish-registry
depends_on: [MCP-001]
---

# MCP-002: build the shared MCP client and HTTP product vertical slice

## Objective

Deliver the independently verifiable outcome of [issue #2521](https://github.com/woojubb/robota/issues/2521)
through the approved spec `.agents/spec-docs/todo/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md`:
make the official `@modelcontextprotocol/sdk` client seam the canonical MCP client owner inside
`packages/agent-mcp` (client, catalog, connection supervision — the last absorbing MCP-003), remove the
hand-written 762-line path, compose it from `agent-cli` as the product vertical, and clear `agent-mcp`'s private status
per ADR-005. Scope was widened by owner decision (2026-09-22: `이 유닛에 다 넣기`) and then reduced the same day (`MCP-002에서 분리, 별도 제거 유닛`): the DAG node is out of scope and removed by `MCP-2817` (issue #2817). Twenty-seven completion criteria; the spec's Evidence Log records why each exists.

## Source Constraints

- The source Issue remains the complete historical problem and acceptance record.
- Closing it as `NOT_PLANNED` means only that GitHub no longer schedules it independently; this Task
  remains open until the product outcome is delivered.
- Preserve every security, data-correctness, dependency, and direct-replacement constraint from the
  source Issue; do not add compatibility shims unless a current runtime consumer proves necessity.
- ADR-005 (accepted) is the placement authority; this Task carries its named MCP-002 obligations.
- The DAG node is out of scope; `MCP-2817` (issue #2817) removes it, and `MCP-2816` is superseded.

## Plan

Spec: `.agents/spec-docs/done/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md`

One item per completion criterion; the TC id is the join key to the spec. Grouped by the spec's
Solution steps. Landing steps live in the spec's gate evidence, not here.

Client seam (`packages/agent-mcp/src/client/`):

- [x] TC-01 — `session.ts`: `initialize` against Streamable HTTP; store `protocolVersion`, `serverInfo`,
      capabilities; disconnect on an unsupported version
- [x] TC-02 — `discovery.ts`: caller-owned `nextCursor` loop; invalid cursor surfaces `-32602` as a named failure
- [x] TC-19 — `discovery.ts`: bounded page count with a named refusal; per-request timeout as its own class
- [x] TC-05 — `transport.ts`: admit-then-construct; URL admission through `egress-policy` before any connection
- [x] TC-06 — transport set is exactly Streamable HTTP in `src/`; stdio, SSE and WebSocket absent outside tests

Catalog (`packages/agent-mcp/src/catalog/`):

- [x] TC-03 — `naming.ts`: unconditional `<server>__<tool>` prefix, sanitisation, deterministic middle-truncation, residual-collision loser rejected
- [x] TC-04 — three-valued capability state: `unsupported` never called, `supported/empty`, `supported/N`
- [x] TC-07 — `rejected` bucket with reasons for SSE-only and WebSocket servers
- [x] TC-18 — provenance on every entry; `adopted` and `adapted` buckets populated with reasons
- [x] TC-08 — register discovered tools through the generic dynamic-tool contract; `agent-framework` diff stays empty
- [x] TC-30 — `build.ts` calls `narrowToUniversalSubset` at registration so the CORE-040 boundary keeps a caller; re-point `third-party-schema-enforcement.test.ts`

Supervisor (`packages/agent-mcp/src/supervisor/`, absorbed MCP-003):

- [x] TC-09 — open / reuse / close; `listChanged` marks the affected domain stale
- [x] TC-13 — classify transient / auth / config / not-found; retry only transient
- [x] TC-14 — bounded exponential backoff under a fake clock; pending → failed → manual-retry
- [x] TC-15 — refresh on `listChanged` without reconnecting; failed refresh keeps last-known-good with `stale` + error
- [x] TC-16 — four distinct typed timeouts, independently configurable
- [x] TC-17 — cancellation and shutdown leave no live request and no armed timer
- [x] TC-22 — last-known-good identity = server id + `protocolVersion` + `serverInfo.version`; mismatch invalidates
- [x] TC-10 — one failed value carries its classification (runtime half)
- [x] TC-23 — the failed member is required by the type (typecheck half, `tsgo --noEmit`)
- [x] TC-24 — package-local compiler-API test: exactly one connection-state union under `src/**`

Removal and activation:

- [x] TC-11 — delete `mcp-protocol.ts`, `mcp-tool.ts`, `relay-mcp-tool.ts` and `TMCPConnectionStatus`; their three suites go with them
- [x] TC-29 — `mcp-activation.ts`: invert `requiresTrustedWorkspace` to a not-required allowlist; untrusted workspace refused, rotated generation invalidates, unknown source requires trust

Product composition and manifests:

- [x] TC-21 — `agent-cli` composes the manager; `@robota-sdk/agent-mcp` in `devDependencies` (INFRA-028); no protocol logic in `agent-cli/src` Delivered end to end: `startup/mcp-definition-sources.ts` sources `mcpServers` from the layered settings files through MCP-001's `decodeSource` → `resolveByPrecedence` → `materializeDefinition`; `startup/mcp-workspace.ts` maps workspace trust (state + generation) onto `IMCPActivationWorkspace`; `startup/mcp-startup.ts` composes `createMcpClientComposition` and `cli.ts` binds its adapter to the `/mcp` port and its discovered tools to `additionalTools`. Verified from the built binary: `robota -p "/mcp list"` under an isolated HOME lists the configured server and reports its pending admission. Approval is in-memory in this unit, so a server approved mid-session connects on the next start.
- [x] TC-27 — clear `private` in `packages/agent-mcp/package.json`, move its row out of the Private table in `.agents/publish-registry.md`; registry scan exits 0
- [x] TC-20 — `examples/` scenario + `scenario:verify:mcp-client` script printing the single `result=` line; isolate `HOME` to a temp dir

Verification and docs:

- [x] TC-12 — package test + build green; affected scans report no NEW failure against the measured base (126 tests, expected floor 81 + new)
- [x] Update `packages/agent-mcp/docs/SPEC.md` (public surface, CORE-040 section, connection-state SSOT), `README.md`, `.agents/project-structure.md` and `ARCHITECTURE.md` one-line classification

## Test Plan

- Unit / protocol integration in `packages/agent-mcp/src/__tests__/` against the extended
  `mock-mcp-server.ts` (gains `tools/list` / `prompts/list` / `resources/list`, cursors, an invalid cursor,
  capability absent-vs-empty, `listChanged`, an unbounded cursor chain): TC-01, 02, 03, 04, 05, 07, 08,
  09, 10, 13, 14, 15, 16, 17, 18, 19, 22, 29, 30 (TC-29 also covers the deny-by-default inversion). Fake clock (`vi.useFakeTimers`) for 14 and 17.
- Type-level: TC-23 via `pnpm --filter @robota-sdk/agent-mcp typecheck` (`tsgo --noEmit`); red-proof by
  deleting the failed member. TC-24 via a vitest suite that parses `src/**` with the TypeScript compiler
  API; red-proof by adding a second union anywhere in the package.
- Absence / config assertions run exactly as the spec words them: TC-06, TC-11, TC-21, TC-27 —
  each proven red on the base before implementation (spec Evidence Log, 2026-09-22).
- Scenario: TC-20 (`pnpm scenario:verify:mcp-client` in `packages/agent-mcp`), fields only this unit
  can produce.
- Package gate: TC-12 — `pnpm --filter @robota-sdk/agent-mcp test && build`, then
  `HARNESS_BASE_REF=origin/integration/agreement-014 node scripts/harness/run-all-scans.mjs --affected --context pr`;
  base measured green (14 files / 126 tests; `scan-publish-registry` 90 packages), so any failure is NEW.
  Two advisories are pre-existing base state and named in the spec (`task-merged-citation` on
  SECRET-2664; `reference-kind-qualified` on INFRA-2772).

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

**Executability probe:** `pnpm scenario:verify` in `packages/agent-mcp`, with `HOME` pointed at a fresh
temporary directory, exited 0 on 2026-09-22 and printed MCP-001's three `result=` lines;
`pnpm exec tsx --version` → `tsx v4.23.1`. The runner this scenario uses — `tsx --conditions=source`
over `examples/` — is executable in this environment, and the new script follows the same shape.

### Scenario 1: discover and invoke a tool over Streamable HTTP through the shared client

- Executability: agent-executable
- Product surface: public-sdk-example
- Surface rationale: shipped-interface=public-sdk-example
- Prerequisites: Node.js and pnpm are installed and `pnpm install` has completed; `@robota-sdk/agent-core` and `@robota-sdk/agent-mcp` are built (`pnpm --filter @robota-sdk/agent-core build && pnpm --filter @robota-sdk/agent-mcp build`); run from `packages/agent-mcp`; the example starts the repository's in-process mock MCP server on loopback (`127.0.0.1`, an ephemeral port), exposing three tools, and admits it through an injected loopback-allowing `TEgressLookup`; before anything reads settings it points `HOME` at a fresh temporary directory, so no real `~/.robota` is read or written; no network beyond loopback, no MCP server other than the mock, no provider credential and no external service is required. The runner `examples/verify-mcp-client.ts` is built by this Task (Plan TC-20) and does not exist today.
- Command: `pnpm exec tsx examples/verify-mcp-client.ts`
- Observable type: sdk-result
- Observable rationale: source=public-sdk-return
- Expected observable: result=transport=streamable-http; discoveredTools=3; invoked=mock-mcp__echo; catalogSource=mock-mcp
- Cleanup: the example closes the mock server and the MCP session and removes its temporary `HOME` before exiting; it leaves no files, processes or connections.
- Evidence: pending implementation — recorded at DONE-GATE-STAGE-2 with the command, its exit code and the single printed `result=` line, plus the durable runner path `packages/agent-mcp/examples/verify-mcp-client.ts`.

### [DONE-GATE-STAGE-1] — ❌ FAIL | 2026-09-22

**Status remains:** scenario drafted

**Ordering:** N/A — DONE-GATE-STAGE-1 has no prior gate (`gate-catalogue.md` § Prior-gate map). Input
state verified independently for this run: the Task carries `## User Execution Test Scenarios` with the
author verdict `SCENARIO DRAFTED: automatable | 1`; no earlier `DONE-GATE-STAGE-1` entry exists on this
Task, so this is a first verdict and not a re-judgement; `git status --porcelain` on
`feat/mcp-002-shared-client-and-http-vertical` (HEAD `9eb7ea8fd`, judged document blob
`aea7ee9ee8b670765d36d08abf52681554bc0631`, modified) lists only planning artifacts — the paired
spec/Task, the MCP-2816 → MCP-2817 scope records, `ADR-005` and `.agents/memory/`. No path under
`packages/` is staged, modified or untracked, so no implementation this gate precedes has run.

**Per-criterion result (all four criteria checked):**

- DONE-GATE-STAGE-1 — every scenario is written with exact commands or UI steps, prerequisites, an
  expected observable result, and an evidence field: PASS on presence. Scenario 1 carries
  `executability`, `product surface`, `surface rationale`, `prerequisites`, `command`,
  `observable type`, `observable rationale`, `expected observable`, `cleanup` and `evidence`, each
  exactly once and non-empty; `browser steps`/`UI steps`/`product state path` and the manual barrier
  trio are correctly absent for an automatable SDK scenario. `evidence: pending implementation — the
command, its exit code and the single printed result= line will be recorded here after
DONE-GATE-STAGE-2` is a present, forward-bound field, which is what Stage 1 requires. That the named
  runner (`packages/agent-mcp/examples/verify-mcp-client.ts`) and the `scenario:verify:mcp-client`
  script do not exist yet is correct at Stage 1 and not a defect: the Task's own `## Plan` builds both
  under TC-20 ("`examples/` scenario + `scenario:verify:mcp-client` script printing the single
  `result=` line; isolate `HOME` to a temp dir"), the `## Test Plan` names the same runner, and the
  same shape was accepted at MCP-001. Verified: `ls packages/agent-mcp/examples` returns only
  `scenarios/`, `verify-mcp-activation-admission.ts`, `verify-mcp-definition-control-plane.ts`, and
  `packages/agent-mcp/package.json` has no `scenario:verify:mcp-client` key.
- DONE-GATE-STAGE-1 — every scenario carries its executability decision: PASS.
  `executability: agent-executable` is declared, and the § Executability probe was re-run by this
  guardian rather than accepted. In `packages/agent-mcp` with `HOME` set to a fresh
  `mktemp -d` directory, `pnpm scenario:verify` exited `0` on 2026-09-22 and printed exactly three
  `result=` lines (`result=status=untrusted; activationAttempts=0`,
  `result=approved=true; changedDefinitionDenied=true; revokedDenied=true; activationAttempts=1`,
  `result=winner=alpha:managed; …; networkAttempted=false`), and `pnpm exec tsx --version` printed
  `tsx v4.23.1` — the probe's three claims are true as written. The temporary `HOME` contained only
  `.cache` afterwards, so no real `~/.robota` was touched. The `examples/` runner surface in this
  package is therefore demonstrably agent-executable, and a sibling runner built by this unit inherits
  that executability.
- DONE-GATE-STAGE-1 — the scenario uses a canonical product-surface identity and matching invocation;
  the observable is not a build/test/harness/CI run or an inspection of repository text: **FAIL** on
  the invocation-and-observable half (four defects itemised below). The two halves this gate can pass
  independently do pass. **Surface identity:** `public-sdk-example` with
  `surface rationale: shipped-interface=public-sdk-example` is the correct canonical surface for a
  script below `packages/agent-mcp/examples/` — the rule reserves `robota-cli`/`robota-tui` for
  invocations beginning `robota` or `pnpm exec robota`, and the accepted precedent for this exact
  package is MCP-001 and MCP-2520, whose scenarios sit on the same surface. **Product behaviour:**
  `guardian-observable-verdict=product-behavior`. The observable is the example program's own printed
  MCP session result — an initialized Streamable HTTP connection and the tools the shared client
  discovered — not a build, typecheck, lint, test run, harness check, CI check, or an inspection of
  repository text. The in-process mock server is a counterparty fixture the work ships, which
  `backlog-execution.md` § Scenario Design Preference Order explicitly endorses ("an in-repo test
  server in place of a live one makes the whole scenario machine-executable"); the product code path
  under judgement (client, transport admission, catalog) is the real one.
- DONE-GATE-STAGE-1 — a scenario requiring live credentials or an external service states that
  prerequisite explicitly: PASS, satisfied by explicit negation rather than by silence. Prerequisites
  state "no network and no credentials", and name every environmental condition an executor would
  otherwise discover mid-run: the in-process mock MCP server on loopback, the injected
  loopback-allowing `TEgressLookup` that admits it through `egress-policy`, the `HOME` redirected to a
  fresh temporary directory before anything reads settings, and the build prerequisite
  (`pnpm --filter @robota-sdk/agent-mcp build`, peer `agent-core` built). Nothing external can prevent
  this gate from running in an executor's environment, and the scenario says so.
- DONE-GATE-STAGE-1 — exception clause: N/A. The exception covers a scenario that is genuinely
  impossible to write; the one declared scenario is written in full and nothing is recorded as
  unwritten, so there is nothing to excuse.

**Failed criteria:**

- Criterion 3 — matching canonical invocation: the command is
  `cd packages/agent-mcp && pnpm scenario:verify:mcp-client`. `backlog-execution.md` § Scenario Design
  Preference Order states that "product invocations may not chain or substitute another command" and
  that a public SDK/example path "must remain below `examples/` or `scratch/`", in either a direct
  `node` / `tsx` / `pnpm exec tsx <literal examples path>` form or the directory form
  `pnpm (--dir|-C) <examples-or-scratch-path> run <literal-script-name>`. The authored command fails on
  both counts. Verified mechanically:
  `tokenizeCanonicalShell('cd packages/agent-mcp && pnpm scenario:verify:mcp-client')` returns `null`
  (the `&` operator is rejected outright,
  `scripts/harness/user-execution-scenario-surface.mjs`), and
  `productSurfaceInvocation('public-sdk-example', …)` returns `null`. Substituting the directory form
  does not repair it either: `pnpm --dir packages/agent-mcp run scenario:verify:mcp-client` also
  returns `null`, because `canonicalExamplePath` requires the FIRST path segment to be `examples` or
  `scratch` — `packages/agent-mcp` is not.
  **Required action:** state the working directory in `prerequisites` (as MCP-001 does: "run from
  `packages/agent-mcp`") and make the command a canonical package-relative example path, e.g.
  `pnpm exec tsx examples/verify-mcp-client.ts`, with no code-loading flag (`--conditions=source` is
  not canonical — the defect that failed MCP-001's first Stage-1 run) — then have
  `scenario:verify:mcp-client` wrap that same runner rather than be the scenario's invocation.
- Criterion 3 — canonical observable type for this surface: the scenario declares
  `observable type: product-output`. The rule admits `product-output` only for CLI/TUI; for
  `public-sdk-example` the single permitted type is `sdk-result`
  (`backlog-execution.md`: "`sdk-result` for public SDK examples"; enforced by the
  `allowedObservableTypes` map in `scripts/harness/user-execution-scenario-contract.mjs`, which pairs
  `public-sdk-example` with `new Set(['sdk-result'])`).
  **Required action:** change the field to `observable type: sdk-result`.
- Criterion 3 — matching observable rationale: the scenario declares
  `observable rationale: source=product-process`. That value is the declared partner of
  `product-output`; the partner of `sdk-result` is `source=public-sdk-return`, and the contract binds
  the pair, not the value alone.
  **Required action:** change the field to `observable rationale: source=public-sdk-return`.
- Criterion 3 — expected-observable shape for `sdk-result`: the scenario declares
  `expected observable: exit=0; output-contains=result=transport=streamable-http; discoveredTools=`,
  which is the `exit=<code>; output-contains=<literal>` shape reserved for `product-output`. For
  `sdk-result` the rule fixes the shape as `result=<SDK value>` (contract regex `/^result=\S.*$/`).
  Two further problems are inside the authored value itself: `discoveredTools=` ends with no value, so
  the expectation asserts nothing about the count the runner is required to print; and the `; `
  separator makes `discoveredTools=` a second `output-contains` clause that the single-substring form
  cannot express.
  **Required action:** restate it as one `result=` line carrying the same content with a concrete
  count, e.g. `result=transport=streamable-http; protocolVersion=…; discoveredTools=2; invoked=…`,
  matching the shape MCP-001 and MCP-2520 use.
- Combined mechanical confirmation: for the document as written,
  `validateApplicableScenarioSection(<## User Execution Test Scenarios>)` returns
  `{"ok":false,"error":"applicable Scenario 1: discover and invoke a tool over Streamable HTTP through
the shared client (TC-20) is incomplete or non-canonical"}`, and
  `scenarioContract(<Scenario 1 body>, 'automatable')` returns `null`. The four defects above are
  jointly exactly what blocks this gate; the surface identity, the executability decision, the
  prerequisites and the product-behaviour judgement are already sound and need no change.
  **Required action:** apply all four repairs, then re-run DONE-GATE-STAGE-1.

No `doneGateStageOne` checkpoint-evidence block is written by this entry: the rule-owned form
(`backlog-execution.md` § Checkpoint evidence contract) binds a Stage-1 PASS and the authored scenario
text verbatim, and binding a payload to text this gate refused would fabricate the checkpoint that
GATE-IMPLEMENT's PLAN criterion and `scan-user-execution-plan-order` read.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-09-22

**Status upgrade:** scenario drafted → scenario written

- DONE-GATE-STAGE-1 — ordering: N/A, this gate has no prior gate (`gate-catalogue.md` § Prior-gate
  map), so no prior-gate PASS is owed and none was looked for. Input state verified independently for
  this run: the Task carries `## User Execution Test Scenarios` with the author verdict
  `SCENARIO DRAFTED: automatable | 1`, and the section holds exactly one `### Scenario 1` entry, so
  the outcome and the count agree with what is written. The only earlier `DONE-GATE-STAGE-1` entry on
  this Task is the `❌ FAIL | 2026-09-22` above, so this is a re-judgement of the repaired text, not a
  second verdict on the same content. Judged at HEAD `9eb7ea8fd` on branch
  `feat/mcp-002-shared-client-and-http-vertical`, document blob
  `8695dd149bc3f483adefdfcc49849bd52ccf7558` (modified) — the blob hashed before this entry was
  appended. `git status --porcelain` lists only planning artifacts (this Task, the paired spec, the
  MCP-2816 → MCP-2817 scope records, `ADR-005`, `.agents/memory/`); no path under `packages/`,
  `apps/` or any implementation surface is staged, modified or untracked, so no work this gate
  precedes has run. Two contextual facts were checked and are not inputs this gate reads: the Task's
  frontmatter is `status: todo` (reset from `in-progress` by owner directive after the scope
  reduction) and the paired spec sits at `.agents/spec-docs/backlog/MCP-002-…md` with
  `status: review-ready` while GATE-APPROVAL re-runs; neither the Prior-gate map nor the four
  DONE-GATE-STAGE-1 criteria condition this gate on either value, and the scenario-state this gate
  transitions (`scenario drafted → scenario written`) is independent of the frontmatter status.
- DONE-GATE-STAGE-1 — every scenario is written with exact commands or UI steps, prerequisites, an
  expected observable result, and an evidence field: PASS. Scenario 1 carries `executability`,
  `product surface`, `surface rationale`, `prerequisites`, `command`, `observable type`,
  `observable rationale`, `expected observable`, `cleanup` and `evidence`, each exactly once and
  non-empty; `browser steps`/`ui steps`/`product state path` and the manual barrier trio are
  correctly absent for an automatable SDK scenario. Verified by running the repository's own
  validator rather than by reading: `scenarioContract(<Scenario 1 body>, 'automatable')`
  (`scripts/harness/user-execution-scenario-contract.mjs`) returns a full binding object with every
  field resolved, and `validateApplicableScenarioSection(<section>)` returns
  `{ ok: true, scenarios: [1] }`. `evidence: pending implementation — recorded at DONE-GATE-STAGE-2
with the command, its exit code and the single printed result= line, plus the durable runner path
packages/agent-mcp/examples/verify-mcp-client.ts` is a present, forward-bound field naming the
  durable artifact Stage 2 will cite, which is what Stage 1 requires. The named runner does not exist
  yet and that is correct here, not a defect: `ls packages/agent-mcp/examples` returns only
  `scenarios/`, `verify-mcp-activation-admission.ts` and `verify-mcp-definition-control-plane.ts`, and
  `packages/agent-mcp/package.json` has no `scenario:verify:mcp-client` key — the Task's own `## Plan`
  item TC-20 builds both, the `## Test Plan` names the same scenario, and MCP-001 in this same package
  was accepted at Stage 1 on exactly that shape. The expected values are concrete rather than
  placeholder and are consistent with the fixture the Task extends:
  `packages/agent-mcp/src/__tests__/mock-mcp-server.ts` already answers `initialize` with
  `serverInfo: { name: 'mock-mcp', version: '1.0.0' }` and `capabilities: { tools: {} }`, so
  `catalogSource=mock-mcp` and the `<server>__<tool>` name `mock-mcp__echo` (TC-03's unconditional
  prefix rule) name the server this scenario's prerequisites start, and `discoveredTools=3` matches
  the "exposing three tools" the prerequisites fix.
- DONE-GATE-STAGE-1 — every scenario carries its executability decision: PASS.
  `executability: agent-executable` is declared, so no `manual-only:` technical reason is owed and the
  barrier trio is correctly absent. The decision is substantiated, not asserted: this guardian re-ran
  the recorded § Executability probe rather than accepting it. From `packages/agent-mcp` with `HOME`
  pointed at a fresh `mktemp -d` directory, `pnpm scenario:verify` exited `0` on 2026-09-22 and
  printed exactly three `result=` lines — `result=status=untrusted; activationAttempts=0`,
  `result=approved=true; changedDefinitionDenied=true; revokedDenied=true; activationAttempts=1`, and
  `result=winner=alpha:managed; alphaShadowed=4; betaWinner=beta:local; betaUnresolved=true;
betaShadowed=1; unsetVarPreservedLiterally=true; envRedacted=true; headersRedacted=true;
projectionKeysKept=true; networkAttempted=false` — and `pnpm exec tsx --version` printed
  `tsx v4.23.1` on `node v22.14.0`. All three claims the probe makes are true as written. The
  temporary `HOME` held only `.cache` afterwards, so no real `~/.robota` was read or written. The
  authored flag-free invocation shape was proven separately, because the package's own
  `scenario:verify` script uses `--conditions=source` and that flag is not canonical: this guardian
  ran `pnpm exec tsx examples/verify-mcp-activation-admission.ts --status` from `packages/agent-mcp`
  and it exited `0` printing `result=status=untrusted; activationAttempts=0`. The `examples/` surface
  in this package is therefore demonstrably agent-executable in exactly the form Scenario 1 authors,
  and a sibling runner built by this unit inherits that executability.
- DONE-GATE-STAGE-1 — the scenario uses a canonical product-surface identity and matching invocation,
  and its observable is not a build/typecheck/lint/test/harness/CI run or an inspection of repository
  text: PASS. This is the criterion that decided the earlier FAIL, and all four of its defects are
  repaired. Exact binding — surface=`public-sdk-example`;
  surface-rationale=`shipped-interface=public-sdk-example`;
  invocation=`pnpm exec tsx examples/verify-mcp-client.ts`; observable-type=`sdk-result`;
  expected-observable=`result=transport=streamable-http; discoveredTools=3; invoked=mock-mcp__echo;
catalogSource=mock-mcp`; observable-rationale=`source=public-sdk-return`;
  guardian-observable-verdict=`product-behavior`. Mechanically verified, not inferred:
  `productSurfaceInvocation('public-sdk-example', <command>, null, null)`
  (`scripts/harness/user-execution-scenario-surface.mjs`) now returns
  `pnpm exec tsx examples/verify-mcp-client.ts` where it returned `null` before — a literal path whose
  first segment is `examples`, no chained or substituted command (the `cd … &&` that was rejected
  outright is gone, the working directory moved into `prerequisites` as "run from
  `packages/agent-mcp`", the MCP-001 shape), no variable or glob expansion, balanced quoting, and no
  option at all before the script path, so the non-canonical code-loading flag is absent too.
  `sdk-result` is the single observable type `allowedObservableTypes` permits for this surface, and
  `source=public-sdk-return` is its declared partner rationale; the expected observable now matches
  the `sdk-result` shape `/^result=\S.*$/` as one `result=` line, and it asserts a concrete count
  (`discoveredTools=3`) where the failed text ended at a bare `discoveredTools=`. Product-behaviour
  judgment, which is this guardian's own and not the scanner's: the observable is the shipped example
  program's own returned MCP session values — the negotiated transport, the tools the shared client
  discovered from a live session, the tool it actually invoked, and the catalog's provenance — none of
  which is a build, typecheck, lint, test run, harness check, CI check, or a reading of repository
  text. The in-process mock MCP server is a counterparty fixture the work itself ships, which
  `backlog-execution.md` § Scenario Design Preference Order explicitly endorses ("an in-repo test
  server in place of a live one makes the whole scenario machine-executable"); the code under
  judgement on this side of the wire — client, transport admission through `egress-policy`, catalog
  naming — is the real product path. Surface choice matches the accepted precedent in this same
  package: MCP-001 and MCP-2520 both sit on `public-sdk-example` with the same flag-free
  `pnpm exec tsx examples/…` form.
- DONE-GATE-STAGE-1 — a scenario requiring live credentials or an external service states that
  prerequisite explicitly: PASS, satisfied by explicit negation rather than by silence. Prerequisites
  state "no network beyond loopback, no MCP server other than the mock, no provider credential and no
  external service is required", and name every environmental condition an executor would otherwise
  discover mid-run: the in-process mock server on `127.0.0.1` at an ephemeral port, the injected
  loopback-allowing `TEgressLookup` that admits it through `egress-policy`, the `HOME` redirected to a
  fresh temporary directory before anything reads settings, the build prerequisite
  (`@robota-sdk/agent-core` and `@robota-sdk/agent-mcp` built), the working directory
  `packages/agent-mcp`, and the fact that the runner does not exist yet. Nothing external can prevent
  this gate from running in an executor's environment, and the scenario says so before it is run.
- DONE-GATE-STAGE-1 — exception clause: N/A, answered rather than skipped. The exception covers a
  scenario that is genuinely impossible to write; the one declared scenario is written in full and
  nothing in this section is recorded as unwritten, so there is nothing to excuse.

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "doneGateStageOne",
  "outcome": "automatable",
  "scenarios": [
    {
      "name": "Scenario 1: discover and invoke a tool over Streamable HTTP through the shared client",
      "surface": "public-sdk-example",
      "surfaceRationale": "shipped-interface=public-sdk-example",
      "invocation": "pnpm exec tsx examples/verify-mcp-client.ts",
      "observableType": "sdk-result",
      "observable": "result=transport=streamable-http; discoveredTools=3; invoked=mock-mcp__echo; catalogSource=mock-mcp",
      "observableRationale": "source=public-sdk-return",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "Node.js and pnpm are installed and `pnpm install` has completed; `@robota-sdk/agent-core` and `@robota-sdk/agent-mcp` are built (`pnpm --filter @robota-sdk/agent-core build && pnpm --filter @robota-sdk/agent-mcp build`); run from `packages/agent-mcp`; the example starts the repository's in-process mock MCP server on loopback (`127.0.0.1`, an ephemeral port), exposing three tools, and admits it through an injected loopback-allowing `TEgressLookup`; before anything reads settings it points `HOME` at a fresh temporary directory, so no real `~/.robota` is read or written; no network beyond loopback, no MCP server other than the mock, no provider credential and no external service is required. The runner `examples/verify-mcp-client.ts` is built by this Task (Plan TC-20) and does not exist today.",
      "action": {
        "kind": "command",
        "value": "pnpm exec tsx examples/verify-mcp-client.ts"
      },
      "expectedObservable": "result=transport=streamable-http; discoveredTools=3; invoked=mock-mcp__echo; catalogSource=mock-mcp",
      "cleanup": "the example closes the mock server and the MCP session and removes its temporary `HOME` before exiting; it leaves no files, processes or connections.",
      "evidence": "pending implementation — recorded at DONE-GATE-STAGE-2 with the command, its exit code and the single printed `result=` line, plus the durable runner path `packages/agent-mcp/examples/verify-mcp-client.ts`."
    }
  ]
}
```

<!-- checkpoint-evidence:v1:end -->
