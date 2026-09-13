---
title: 'BOUNDARY-2655: Classify and enforce shared package boundary ownership'
issue: https://github.com/woojubb/robota/issues/2655
status: in-progress
created: 2026-09-12
priority: high
urgency: now
area: workspace build and verification
depends_on: []
---

# BOUNDARY-2655: Classify and enforce shared package boundary ownership

## Objective

Inventory shared code across the repository and verify API ownership, domain neutrality and at least two independent package consumers for retained shared files. Migrate package-specific helpers, fixtures, constants and data to their owners. Gate drift and report affected-scope/full-suite promotion reasons.

Parent: AGREEMENT-2655; canonical umbrella: https://github.com/woojubb/robota/issues/2655.

Source acceptance: [Issue #2490](https://github.com/woojubb/robota/issues/2490), transferred to the umbrella by its [recorded disposition](https://github.com/woojubb/robota/issues/2490#issuecomment-5642818355). Full-population classification and actual migrations remain binding.

## Plan

- [x] TC-01: Reconcile the complete tracked population, reference coverage, exclusions and reviewed ownership dispositions. Evidence: final population reconciliation and bounded supplement in Test Plan, including both repaired ownership/path findings.
- [x] TC-02: Validate retained generic shared material against independent consumer evidence and preserve domain-owned public contracts. Evidence: final local integration and the paired spec's local acceptance reconciliation.
- [ ] TC-03: Migrate all classified owner-local material, including recording, hook, session migration and private PTY tooling, preserving behavior.
- [x] TC-04: Extend the existing reference analysis and reject ownership drift with positive/negative regressions. Evidence: final local integration, 24 scanner regressions and independent wiring PASS.
- [x] TC-05: Integrate justified operation/cache inputs and truthful selected/executed/skipped/global-promotion reporting. Evidence: final local integration and typed registry/cache/execution regressions; uncertainty remains conservative.
- [ ] TC-06: Verify focused and affected scope plus final remote CI, land on origin/develop and reconcile source/parent completion.

## Delivery

Merge into origin/develop after verification and record the delivering commit in the source Issue.

## Progress

2026-09-13: GATE-WRITE, independent proposal ENDORSE, DIRECT GATE-APPROVAL and
DONE-GATE-STAGE-1 passed. The first implementation judge returned PASS with a spec-only dirty
inventory, but the checkpoint consumer requires both Task and spec and rejected the commit.
The uncommitted attempt is preserved as withdrawn evidence, not rewritten into a successful
checkpoint. Restore the preceding approved planning state and rejudge the actual Task/spec
changes together. No implementation has started and no TC is marked delivered.

2026-09-13: resumed the remaining source Issue #2490 scope after PR #2717 landed. The canonical
draft is `.agents/spec-docs/draft/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md`.
At base `38e87a027c530dbbe11beae9a62bc6732f65ca59`, read-only AST inspection covered 4,186 tracked
code files and identified 38 resolved relative cross-owner references plus 21 dynamic module
expressions. This is partial reference evidence, not full semantic classification. Nash confirmed
the foundational cause is already owned by this Task; Pascal supplied the private testing-package
relocation constraints. Public API versus generic shared-material criteria and the framework
recorder's provider-neutral boundary still require validation before recommendation approval.
No product implementation, complete population classification or gate PASS is claimed.
The draft's Owner Decision Recommendation now specifies the public-SDK classification boundary,
private PTY relocation and the strictly non-published recording-tool composition exception. These
are concrete contract/placement choices, not another request to approve an already-authorized merge.

2026-09-13: the user explicitly approved all three design recommendations with `모듀 승인함`.
Approval is recorded in the canonical draft's Owner Approval section. Public-SDK classification,
private PTY relocation/removal and the strictly non-published framework recording composition
exception no longer require another owner decision. Independent design validation and delivery
verification remain outstanding; this approval alone does not complete a Plan item or gate.

## Test Plan

Supplement review converged after correcting one newly authored fixture-location description
from session-level to its actual media-level fingerprint. All four test assertions and both
existing SDP samples remain unchanged. Hume independently returned ACTIONABLE FINDINGS: 0,
binding the same ten reviewed/reference paths to fingerprint
`1a21bc8ffc36e0eadca8f5d80f6c9aabcb95e394917ed9880fd1af2363a33011` on HEAD
`36f4ff11e8dbe5ea525978c8648ceca9720ee329` plus working bytes. Earlier bounded reviews remain
applicable to unchanged files; TC-03 and TC-06 remain open for remote runtime/CI and landing.

Final bounded supplement (2026-09-13): the two population findings were independently classified
LOCAL (zero foundational). The four fingerprint parity tests now live with the pairing contract;
their owner-local native SDP sample is byte-identical to the retained browser sample, whose RTC
consumer remains unchanged. Only the nonexistent CSS source directive was removed. Nash recorded
the actual two ownership/path failures before repair and both passing afterward. Main reproduced
seven parity/RTC tests and both ownership/path checks after repair. Main's first Vitest CLI probe
incorrectly treated `--config false` as a filename and failed at startup; the corrected native
`startVitest` API with `config: false`, `cache: false` executed the seven tests successfully.
Supplement ESLint and formatting passed. This adds two changed test-ownership SPEC claim groups
to the seven below, not product runtime changes or a claim that all package suites were run.

After staging this supplement the actual ownership scanner reports 8,608 tracked paths, zero
untracked, 12 exclusions and 123 unknown file kinds: the reviewed 122 plus the newly owned SDP
contract sample (test fixture). All other source/reference/config/uncertainty counts below are
unchanged, and findings remain zero. New README files account for the other two added paths.
The pre-push planning command selects 91/91 scopes because workspace analysis tooling changed;
that is a justified remote verification plan, not 91 locally executed suites.

Final population reconciliation (2026-09-13): Nash reviewed all 122 tracked unknown-kind paths
from `collectWorkspaceSourceInventory`; main reproduced the exact sorted newline-terminated
path-list SHA-256 `3eeaf066c6c792b4d77600bb9801a7fd3eb72b60ffe5a10ffee66c13d161195e`
and owner split (74 repository, 48 workspace). Categories/dispositions are 32 agent/Git hooks
(repository operations), 26 config/deployment inputs (declaring owner), 13 environment templates
(declaring owner; contents deliberately not read), 17 HTML/CSS/Astro sources (UI owner), 16
directory/document publication markers (seven gitkeep, nine nojekyll), four documents/licenses/
diagrams (documentation owner), seven test fixtures (test owner), and seven install/deploy/harness
shell entries (repository operations). Total 122; semantic file-kind uncertainty remaining: zero.
The automatic category remains unknown for these uncommon extensions: this disposition record
does not pretend the source analyzer parses CSS, shell or SDP, or infer absence of hidden consumers.
Two concrete findings emerged and are retained for correction: browser fingerprint parity tests
read the pairing owner's private SDP fixture, and agent-web CSS names a deleted package source.
The real ownership scanner's earlier zero remains its bounded result, not a claim it detected
these unresolved/non-TypeScript references. TC-01 was held until the repair recorded above.

Bidirectional conformance, changed claims only: code→SPEC: seven package claim groups checked;
SPEC→code: the same seven checked (core hook/role checks, session migration storage contract,
framework recorder/replay and export exclusion, builtin provider composition, process PTY-owner
reference, TUI internal PTY ownership, and DAG doctor source/build version). Local discrepancies
are zero after the reviewed repairs. This does not audit unrelated sections of those SPECs or
claim the unexecuted remote PTY/full affected regression gate passed.

2026-09-13 final local integration: 193/193 tests passed in 16 safe focused files,
including scanner 24, wiring 5, config-reference extraction 4 and real DAG doctor 3.
Affected builds and typechecks passed 6/6 (the five packages below plus dag-cli).
The DAG doctor physical-generation regression was observed RED (`vunknown`) on the old
artifact and GREEN (`v3.0.0-beta.63`) on the newly built artifact; the expected missing-config
exit was 1 with empty stderr. No user-home access was permitted in that built-artifact probe.
Frozen installation with lifecycle scripts disabled passed after the final lockfile edit.
Staged ESLint and supported-file formatting passed. Documentation rebuilt successfully
(360 pages, 357 indexed); the migration guide returned HTTP 200 in headless Chrome with the
new contributor paths and no page/console errors. This is not deployment evidence.

The final real ownership scanner examined 8,605 tracked paths, excluded 12, classified 122
unknown-population paths, and analyzed 4,210 sources / 20,261 references plus 197 config
references. Findings: 0. Its 2,381 unresolved references remain explicitly reported, not
proof of absence or semantic neutrality. In particular, historical declared npm dependencies
under the SDK scope are not missing workspace APIs merely because source resolution is unknown.
The typed contract registry contains 272 entries: 238 uncertain/always-run, 34 cacheable,
and 1,021 unique unresolved inputs. No broad-execution performance improvement is claimed.

Independent reviews accepted the two named shared process APIs, 37 tooling references and
171 exact config dispositions. Four scanner findings were repaired and independently reviewed
to zero: config-reference coverage, named API consumer identity, public-alias approval binding,
and measured population lifecycle. The wiring guardian returned PASS. Hume's final 25-file
review bound HEAD `36f4ff11e8dbe5ea525978c8648ceca9720ee329` plus working bytes to manifest
SHA-256 `853682b63c788b40f5f83e1e4794e76ad27f201af06fde17c2af63aac2ccec15`;
Carson's package review separately returned zero findings. These are bounded local reviews,
not remote-CI, merged-head or whole-repository conformance verdicts. Remote PTY/HOME execution,
final CI, origin/develop landing and Issue reconciliation remain outstanding.

2026-09-13 integrated verification (12:13–12:18 KST, uncommitted implementation on HEAD
`36f4ff11e8dbe5ea525978c8648ceca9720ee329`): affected builds and package typechecks each passed
5/5 for core, session, framework, builtin-providers and transport-tui. The core browser build
reported `node:child_process` as an unresolved external import warning; all builders exited 0.
The source-reference/planner/inventory/parser/input suite passed 137/137 tests in eight files.
Cache/projection/execution-reporting integration passed 20/20 in four files, including RED→GREEN
for explicit `cacheable: false`. Owner migrations passed 24/24 tests in five files after rebuilding;
framework offline recording/replay passed 4/4 in three files, preserving committed cassette bytes.
The real session migration example additionally reported first-run 1/3/4, repeat 0/4/4,
unchanged skipped bytes and no creation of missing storage. PTY/HOME runtime tests and the full
repository/Git-fixture suites were not executed locally; remote CI remains required.

The typed contract registry is structurally valid with entry-local uncertainty: Hume measured
269 entries, 236 uncertain/always-run, 33 cacheable and 1,016 unique unresolved inputs before
the final scanner/wiring additions. These are intermediate population counts, not final-head
performance or full-coverage claims. The initial real boundary scanner exposed false positives
for declared public APIs whose physical source resolution was incomplete; correction and final
scan review remain pending. Nash's independent semantic review found zero actionable findings
in exactly two shared process API decisions and 37 tooling edges (32 Vitest, three artifact
tool consumers and two compiler-configuration checks), not the complete population.

2026-09-13 engineering refinement: the original source Issue #2490 was reread after the reference
integration surfaced 1,000 unresolved runtime expressions across 234/266 contract-test entries.
Main identified the exhaustive caller-binding expansion as unnecessary scope; Hume's independent
read-only assessment agreed. The active spec now explicitly separates entry-local uncertainty
(conservative execution, no cache reuse/write) from genuinely global uncertainty (complete
promotion). This uses the owner's standing authorization to simplify unnecessary work and improve
the harness; it does not alter the three approved public-contract/PTY/recorder decisions or remove
any source Issue outcome. Unknowns remain visible and cannot justify shared retention. Final
selection counts and review remain required; this is not a claim that broad execution was fixed.

2026-09-13 implementation checkpoint (not completion): the first implementation gate landed in
`36f4ff11e8dbe5ea525978c8648ceca9720ee329`. The three disjoint owner migrations are implemented:
core hook examples, session migration tooling, framework cassette tooling, and the private PTY
support consolidation into TUI. Worker focused evidence reports core/session 20 tests and framework
4 tests passing; PTY runtime tests remain deliberately unexecuted locally. The lockfile importer
changes were applied surgically. `pnpm install --frozen-lockfile --ignore-scripts` exited 0 without
lockfile regeneration; this does not establish native lifecycle-script execution. Framework examples
and TUI source `tsgo --noEmit --incremental false` checks both exited 0 after installation and the
recorder's public provider config validation correction.

At 11:32 KST, the actual four-file harness run passed 53/53 tests: workspace affected planner 39,
source evidence 10, inventory 2, and native-parser lifecycle 2. Earlier whole-repository runs failed
the existing 512 MB heap limit. Instrumented reads identified generated `.robota-artifacts`
transaction backups in the source population; generated static export output was also included.
Excluding those generated inputs and releasing scoped native snapshots produced the passing run
under the unchanged limit. The later inventory classification increment passed 3/3 focused tests.
Resolver ownership returned with 22/22 focused tests passing. These are intermediate engineering
results, not final-head CI or completion evidence: complete population dispositions, drift checks,
selection/cache integration, final review, remote CI and merge remain outstanding. No TC is checked
complete by this checkpoint.

2026-09-13: Hume independently endorsed the latest recommendation, including the single reference
analysis/graph route, shared typed selection/cache evidence and approved non-published recorder
placement. `REVIEW VERDICT: ENDORSE`. No additional design findings were reported. This is design
validation, not completed population classification, implementation or CI evidence.

Focused positive/negative regressions plus actual execution at the owning boundary. Verify every
requirement in Objective and the source Issue before marking this Task complete.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: automatable | 6`

**Subject:** `.agents/tasks/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md`

**Applicability:** Moving the executable hook examples and documented session-history migration
changes commands that users can invoke. The framework's existing offline goal replay supplies an
observable for preserving its owned cassette scenario. This is not a blanket N/A for ownership work.

**Surface selection:** Prefer self-contained public SDK examples and ordinary disposable sample
data. Commands below run from the stated package directory; they do not require a live provider,
credentials, HOME rebinding, a test runner, a Git fixture, a clone or a worktree. Package-owned
example paths are literal `examples/...` paths relative to that working directory.

**Invocation probes, not completion evidence (2026-09-13):** `node --version` returned `v22.14.0`;
`pnpm exec tsx --version` returned `tsx v4.23.1`. From the repository root, each of
`node scripts/examples/hook-block-demo.mjs`, `node scripts/examples/hook-json-response-demo.mjs`,
`node scripts/examples/hook-permission-mode-demo.mjs` and
`node scripts/examples/hook-timeout-demo.mjs` returned exit 0. Observed hook results included the
blocking reason, JSON denial, both permission-mode strings, and a timeout error at 1006ms followed
by `hook completed` at 2025ms. These probes used the existing paths and existing build artifacts;
none proves the relocated paths or the completed BOUNDARY implementation.

**Fixture preparation inside this unit:** In addition to moving the four existing examples, propose
two small executable examples owned by the affected packages:
`packages/agent-session/examples/verify-session-history-migration.mjs` and
`packages/agent-framework/examples/verify-goal-cassette-replay.mts`. Their sole work is sample setup,
invocation of the actual migration command or existing public framework testing API, reporting the
observed results, and cleanup. They must not copy the migration algorithm, goal loop or cassette
provider, or introduce a generic harness. These two files and the new migration flag are not yet
implemented or executed; main must include their preparation in this unit before the scenarios are
executed. Missing setup is not a passing scenario or a request to run against real user data.

**Bounded execution limitations:** Scenarios 5 and 6 are drafted setup contracts, not attempted
commands: their owner-local examples do not yet exist, and the safe migration flag is not yet
implemented. Do not mark Stage 2 or relocation verified until actual execution fills the six evidence
fields. PTY relocation and HOME-isolation tests remain engineering verification on the permitted
remote runner; they are not local scenarios, and preserving their behavior does not permit local
HOME overrides. The live recorder and default-home migration paths remain unexecuted by design.

### Scenario 1: Relocated hook blocking example

- executability: agent-executable
- product surface: public-sdk-example
- surface rationale: shipped-interface=public-sdk-example
- prerequisites: Working directory: `packages/agent-core`. Relocate `hook-block-demo.mjs` to this package's `examples/` and point its import at the owning package output. The current agent-core artifact and a POSIX shell must be available. The destructive-looking `tool_input.command` is inert input data; execute only the example's harmless configured hook that prints a reason and exits 2, never that tool-input string.
- command: `node examples/hook-block-demo.mjs`
- observable type: sdk-result
- observable rationale: source=public-sdk-return
- expected observable: result=runHooks returns blocked=true and reason="Bash tool blocked: dangerous command detected" Comparison: Capture the actual `runHooks result` JSON and exit 0. The example's later manually assembled `IToolResult` and its PASS prose do not prove PermissionEnforcer or AI delivery behavior.
- cleanup: No scenario files are created; allow the short hook child to exit.
- evidence: 2026-09-13 direct owner-local command exited 0; actual runHooks result was blocked=true with reason="Bash tool blocked: dangerous command detected" and empty stdout. Illustrative tool-result prose was not substituted for the SDK return.

### Scenario 2: Relocated JSON hook responses

- executability: agent-executable
- product surface: public-sdk-example
- surface rationale: shipped-interface=public-sdk-example
- prerequisites: Working directory: `packages/agent-core`. Relocate `hook-json-response-demo.mjs`, correct the owning output import, and use the same current agent-core artifact and local shell. Its three hook commands only print JSON.
- command: `node examples/hook-json-response-demo.mjs`
- observable type: sdk-result
- observable rationale: source=public-sdk-return
- expected observable: result=stopReason blocks with Security policy violation; PreToolUse returns permissionDecision=deny; systemMessage returns blocked=false and stdout="User has elevated permissions today." Comparison: Compare all three actual returned objects printed by the example and require exit 0; do not substitute its summary string for the returned values.
- cleanup: No persistent files or services; hook children exit normally.
- evidence: 2026-09-13 direct owner-local command exited 0; actual results were blocked=true/reason="Security policy violation", blocked=true/permissionDecision="deny", then blocked=false/stdout="User has elevated permissions today.".

### Scenario 3: Relocated permission-mode stdin forwarding

- executability: agent-executable
- product surface: public-sdk-example
- surface rationale: shipped-interface=public-sdk-example
- prerequisites: Working directory: `packages/agent-core`. Relocate `hook-permission-mode-demo.mjs`, correct the owner import, and make Node available on PATH for the child that reads hook JSON from stdin. No user settings are seeded.
- command: `node examples/hook-permission-mode-demo.mjs`
- observable type: sdk-result
- observable rationale: source=public-sdk-return
- expected observable: result=hook stdout is "default" then "bypassPermissions", with blocked=false for both invocations Comparison: Capture both child stdout values and exit 0. These strings verify forwarding only; the scenario does not change the verifier's own permission posture.
- cleanup: No scenario files; both stdin-reading children exit.
- evidence: 2026-09-13 direct owner-local command exited 0; child stdout was "default" then "bypassPermissions", and blocked=false for both results. No verifier permission setting was changed.

### Scenario 4: Relocated timeout example with explicit runtime outcomes

- executability: agent-executable
- product surface: public-sdk-example
- surface rationale: shipped-interface=public-sdk-example
- prerequisites: Working directory: `packages/agent-core`. Relocate `hook-timeout-demo.mjs`, correct both its owning output import and command-executor source lookup. Use a POSIX shell with `sleep`; no long wait is required.
- command: `node examples/hook-timeout-demo.mjs`
- observable type: sdk-result
- observable rationale: source=public-sdk-return
- expected observable: result=timeout:1 returns blocked=false with errors containing kind=timeout; timeout:5 returns blocked=false with stdout containing "hook completed" Comparison: Capture both actual result objects, exit 0 and the existing elapsed-time checks (first below 1800ms; second at least 1800ms and below 4000ms). A slow host failure must be reported, not silently retried into a PASS. Reading DEFAULT_TIMEOUT_SECONDS=600 is source inspection, not evidence that a default-duration command executed; the old "exit code 1" description is not the current timeout outcome contract. Preserve and observe the explicit timeout diagnostic.
- cleanup: Let the short sleep children finish; no persistent data is created.
- evidence: 2026-09-13 direct owner-local command exited 0; timeout:1 returned blocked=false with errors[0].kind="timeout" at 1007ms; timeout:5 returned blocked=false/stdout="hook completed" at 2019ms. Both elapsed bounds matched; the inspected default constant was not runtime evidence.

### Scenario 5: Session migration on explicitly injected disposable data

- executability: agent-executable
- product surface: public-sdk-example
- surface rationale: shipped-interface=public-sdk-example
- prerequisites: Working directory: `packages/agent-session`. Move the real command to `scripts/migrate-session-history.mjs` and implement `--sessions-dir <absolute-directory>` before running this example. The example creates one ordinary `mkdtemp` directory under the OS temporary directory, obtains its absolute path and seeds four JSON files: legacy messages (user "hello", assistant "world", fixed valid updatedAt `2026-01-01T00:00:00Z`), existing nonempty history, empty messages, and malformed JSON. Add one non-JSON sentinel. Keep original bytes for comparison. No fixture contains credentials or uses the real sessions directory; no HOME, USERPROFILE or other global-home override is permitted.
- command: `node examples/verify-session-history-migration.mjs`
- observable type: sdk-result
- observable rationale: source=public-sdk-return
- expected observable: result=first migration reports Migrated: 1, Skipped: 3, Total: 4; legacy history has two chat entries; second migration reports Migrated: 0, Skipped: 4, Total: 4 with unchanged bytes Comparison: The example invokes the real owner command with `execFileSync(process.execPath, [absoluteScriptPath, '--sessions-dir', absoluteFixtureDirectory])`, without a shell or environment override. Report captured command stdout plus the parsed migrated JSON: original messages remain, history types/data preserve user "hello" and assistant "world", each entry has a UUID and the fixed updatedAt timestamp. Existing history, empty-message JSON, malformed JSON and the non-JSON sentinel must remain byte-identical. Compare all bytes again after the second invocation. Also invoke the same command with an explicit missing child directory below the fixture root: observe `No sessions directory found.` and no directory creation. Do not execute the default path, even with `--help`: the old command ignores arguments and would discover the actual home directory. Emit a compact result containing the actual counts and entry values; assertion failure exits nonzero, but exit status alone is not the user evidence.
- cleanup: In `finally`, remove only the exact ordinary temporary directory created by this example; never derive a cleanup target from HOME, a workspace root or an unvalidated command argument.
- evidence: 2026-09-13 direct example exited 0; real command reported 1/3/4 then 0/4/4 migrated/skipped/total. Printed history retained user hello and assistant world with distinct UUIDs and timestamp 2026-01-01T00:00:00.000Z. Skipped/sentinel bytes and all repeat-run bytes matched; missing storage remained absent. Only the owned ordinary temporary fixture was removed.

### Scenario 6: Existing framework goal cassette replay, without recording

- executability: agent-executable
- product surface: public-sdk-example
- surface rationale: shipped-interface=public-sdk-example
- prerequisites: Working directory: `packages/agent-framework`. The new owner-local example uses the existing public `@robota-sdk/agent-framework/testing` scriptedSession API and the existing framework-owned `src/testing/__fixtures__/goal-cassette-fixture.ts` constants/objective. Dependencies and the current public package outputs must resolve. Read the existing cassette without modification; use `scriptedSession({ cassette: GOAL_CASSETTE_PATH, bare: true })`, which owns its ordinary temporary workspace and session-log directory. Do not import Vitest configuration, rebind HOME, load a concrete live provider, read keys or use record/toCassette mode.
- command: `pnpm exec tsx examples/verify-goal-cassette-replay.mts`
- observable type: sdk-result
- observable rationale: source=public-sdk-return
- expected observable: result=goal.status=satisfied; goal.stopReason=satisfied; GOAL.txt contains "done"; tool calls include Bash and report_goal_status Comparison: Execute `runGoal(buildGoalObjective(harness.cwd), { maxIterations: GOAL_MAX_ITERATIONS })` and print the actual status, stopReason, GOAL.txt content and tool names before disposal. Assert the committed cassette bytes are unchanged. The recorder moves to `packages/agent-framework/scripts/record-goal-cassette.mts`, but this offline run proves preserved replay behavior, not successful live recording or the new concrete provider composition. Keep recorder import/dependency wiring verification in engineering evidence; no paid recording or committed cassette regeneration is authorized. The existing replay test remains in framework.
- cleanup: Always `await harness.dispose()` in `finally`; it removes only its owned temporary workspace after shutdown. Do not write to user settings or delete the committed cassette.
- evidence: 2026-09-13 direct pnpm exec tsx example exited 0 and printed status=satisfied, stopReason=satisfied, GOAL.txt=done, tool calls=Bash, report_goal_status. Disposal completed and the example's cassette-byte assertion passed; no live recording, credentials or HOME override was used.

### [DONE-GATE-STAGE-1] — ❌ FAIL | 2026-09-13

**Status remains:** todo

- DONE-GATE-STAGE-1 — Ordering: PASS. The catalogue declares no predecessor for this Task-only entry gate; the Task remains todo and records scenarios as planned, not executed. This independent guardian did not author the scenarios. The reported unsupported gate.mjs invocation supplies no gate verdict.
- DONE-GATE-STAGE-1 — Executability: PASS. All six scenarios explicitly say agent-executable. Scenarios 5 and 6 require the two bounded owner-local examples and safe directory injection accepted into this work unit; this is preparation-to-build under user-execution-scenario PLAN step 3, not an execution claim or a manual exception.
- DONE-GATE-STAGE-1 — Product observables: PASS semantically. Scenarios 1–4 observe actual hook results, scenario 5 invokes the real migration command and observes migrated disposable session data, and scenario 6 observes the public scriptedSession goal replay. Source constants, unit tests, wiring checks and prior probes are not substituted for these results.
- DONE-GATE-STAGE-1 — Credentials/services: PASS. The scenarios explicitly use local hooks, disposable data and offline cassette replay; live recording, keys and concrete live providers are excluded. No live-service prerequisite is concealed.

**Failed criteria:**

- Every scenario is fully written in the canonical field contract: all six evidence fields are empty, whereas backlog-execution.md requires nonempty single-line fields. A pending marker is sufficient at Stage 1; executed evidence is not required yet.
  **Required action:** The scenario author must record an explicit pending value and preserve the unexecuted state.
- Canonical scenario/checkpoint binding: headings use `Scenario N — ...`, while the existing scenarioEntries owner accepts `Scenario N` or `Scenario N: ...`. The existing read-only validateApplicableScenarioSection call returned `{"ok":false,"error":"applicable scenario section has no Scenario entries"}` and recognized zero entries. Additionally, scenarioContract rejects continuation lines and the undeclared working-directory/comparison labels; the required command context and comparison details must remain preserved in a supported authored form. Consequently an exact doneGateStageOne payload cannot bind these six current scenario bodies.
  **Required action:** The author must reconcile the scenario headings and fields with the existing canonical contract, preserving all setup, working-directory, comparison and safety requirements. Do not manufacture a PASS payload or weaken the parser in this gate invocation.

No authored scenario was changed, no product scenario or test suite was run, and no Git operation, fixture repository, HOME override or status transition was performed. The only diagnostic invoked the existing pure scenario parser against this Task's text. No Stage-2 verdict is issued.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-09-13

**Status upgrade:** scenario drafted → scenario written

- DONE-GATE-STAGE-1 — Ordering: PASS. This is the same Task-only entry gate with no predecessor in the catalogue. The Task remains todo; the prior FAIL is retained unchanged. This rejudgement covers its named format failures, not a new scenario pipeline or implementation authorization.
- DONE-GATE-STAGE-1 — Every scenario is fully written: PASS, 6/6. Canonical colon headings and single-line fields now bind all six scenarios. Every evidence field explicitly says pending. Working directories, comparison procedures, sample setup and cleanup/safety constraints remain present; no execution evidence was invented.
- DONE-GATE-STAGE-1 — Executability: PASS, 6/6 agent-executable. Carry the prior semantic judgement: scenarios 5 and 6 require accepted owner-local setup within this unit under user-execution-scenario PLAN step 3. Their missing future examples do not claim an executed result.
- DONE-GATE-STAGE-1 — Canonical product surface and observable: PASS, 6/6 public-sdk-example with matching literal example commands, sdk-result and source=public-sdk-return. The exact names, invocations, expectations and guardian-observable-verdict=product-behavior bindings are recorded below. Hook return values, actual disposable-data migration and public scriptedSession goal replay remain the observables; engineering checks are not substitutes.
- DONE-GATE-STAGE-1 — Credentials and external services: PASS. Carry the prior judgement: local/offline operation is explicit, with no live provider, credentials, recording or external service required. No manual exception is used.
- DONE-GATE-STAGE-1 — Scenario 1: Relocated hook blocking example: field completeness PASS; evidence pending; guardian-observable-verdict=product-behavior.
- DONE-GATE-STAGE-1 — Scenario 2: Relocated JSON hook responses: field completeness PASS; evidence pending; guardian-observable-verdict=product-behavior.
- DONE-GATE-STAGE-1 — Scenario 3: Relocated permission-mode stdin forwarding: field completeness PASS; evidence pending; guardian-observable-verdict=product-behavior.
- DONE-GATE-STAGE-1 — Scenario 4: Relocated timeout example with explicit runtime outcomes: field completeness PASS; evidence pending; guardian-observable-verdict=product-behavior.
- DONE-GATE-STAGE-1 — Scenario 5: Session migration on explicitly injected disposable data: field completeness PASS; evidence pending; guardian-observable-verdict=product-behavior.
- DONE-GATE-STAGE-1 — Scenario 6: Existing framework goal cassette replay, without recording: field completeness PASS; evidence pending; guardian-observable-verdict=product-behavior.

**Read-only verification:** Existing validateApplicableScenarioSection returned ok=true with six scenarios; each scenarioContract has evidence=pending, and the existing formatCheckpointEvidence accepted the rule-owned doneGateStageOne v1 payload below. These were pure document/parser operations, not product runs, test suites or Git operations.

**Judged document SHA-256:** `13dc91eae7bbdd48ee2a88365810c08cde4942b19d7bc688042fd79b3d200858` (Task bytes before this entry was appended).

Only this gate evidence is appended. Scenario bodies, the previous FAIL, Task status and Plan checkboxes are unchanged. No Stage-2 result, implementation completion or new owner approval is claimed.

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "doneGateStageOne",
  "outcome": "automatable",
  "scenarios": [
    {
      "name": "Scenario 1: Relocated hook blocking example",
      "surface": "public-sdk-example",
      "surfaceRationale": "shipped-interface=public-sdk-example",
      "invocation": "node examples/hook-block-demo.mjs",
      "observableType": "sdk-result",
      "observable": "result=runHooks returns blocked=true and reason=\"Bash tool blocked: dangerous command detected\" Comparison: Capture the actual `runHooks result` JSON and exit 0. The example's later manually assembled `IToolResult` and its PASS prose do not prove PermissionEnforcer or AI delivery behavior.",
      "observableRationale": "source=public-sdk-return",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "Working directory: `packages/agent-core`. Relocate `hook-block-demo.mjs` to this package's `examples/` and point its import at the owning package output. The current agent-core artifact and a POSIX shell must be available. The destructive-looking `tool_input.command` is inert input data; execute only the example's harmless configured hook that prints a reason and exits 2, never that tool-input string.",
      "action": {
        "kind": "command",
        "value": "node examples/hook-block-demo.mjs"
      },
      "expectedObservable": "result=runHooks returns blocked=true and reason=\"Bash tool blocked: dangerous command detected\" Comparison: Capture the actual `runHooks result` JSON and exit 0. The example's later manually assembled `IToolResult` and its PASS prose do not prove PermissionEnforcer or AI delivery behavior.",
      "cleanup": "No scenario files are created; allow the short hook child to exit.",
      "evidence": "pending"
    },
    {
      "name": "Scenario 2: Relocated JSON hook responses",
      "surface": "public-sdk-example",
      "surfaceRationale": "shipped-interface=public-sdk-example",
      "invocation": "node examples/hook-json-response-demo.mjs",
      "observableType": "sdk-result",
      "observable": "result=stopReason blocks with Security policy violation; PreToolUse returns permissionDecision=deny; systemMessage returns blocked=false and stdout=\"User has elevated permissions today.\" Comparison: Compare all three actual returned objects printed by the example and require exit 0; do not substitute its summary string for the returned values.",
      "observableRationale": "source=public-sdk-return",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "Working directory: `packages/agent-core`. Relocate `hook-json-response-demo.mjs`, correct the owning output import, and use the same current agent-core artifact and local shell. Its three hook commands only print JSON.",
      "action": {
        "kind": "command",
        "value": "node examples/hook-json-response-demo.mjs"
      },
      "expectedObservable": "result=stopReason blocks with Security policy violation; PreToolUse returns permissionDecision=deny; systemMessage returns blocked=false and stdout=\"User has elevated permissions today.\" Comparison: Compare all three actual returned objects printed by the example and require exit 0; do not substitute its summary string for the returned values.",
      "cleanup": "No persistent files or services; hook children exit normally.",
      "evidence": "pending"
    },
    {
      "name": "Scenario 3: Relocated permission-mode stdin forwarding",
      "surface": "public-sdk-example",
      "surfaceRationale": "shipped-interface=public-sdk-example",
      "invocation": "node examples/hook-permission-mode-demo.mjs",
      "observableType": "sdk-result",
      "observable": "result=hook stdout is \"default\" then \"bypassPermissions\", with blocked=false for both invocations Comparison: Capture both child stdout values and exit 0. These strings verify forwarding only; the scenario does not change the verifier's own permission posture.",
      "observableRationale": "source=public-sdk-return",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "Working directory: `packages/agent-core`. Relocate `hook-permission-mode-demo.mjs`, correct the owner import, and make Node available on PATH for the child that reads hook JSON from stdin. No user settings are seeded.",
      "action": {
        "kind": "command",
        "value": "node examples/hook-permission-mode-demo.mjs"
      },
      "expectedObservable": "result=hook stdout is \"default\" then \"bypassPermissions\", with blocked=false for both invocations Comparison: Capture both child stdout values and exit 0. These strings verify forwarding only; the scenario does not change the verifier's own permission posture.",
      "cleanup": "No scenario files; both stdin-reading children exit.",
      "evidence": "pending"
    },
    {
      "name": "Scenario 4: Relocated timeout example with explicit runtime outcomes",
      "surface": "public-sdk-example",
      "surfaceRationale": "shipped-interface=public-sdk-example",
      "invocation": "node examples/hook-timeout-demo.mjs",
      "observableType": "sdk-result",
      "observable": "result=timeout:1 returns blocked=false with errors containing kind=timeout; timeout:5 returns blocked=false with stdout containing \"hook completed\" Comparison: Capture both actual result objects, exit 0 and the existing elapsed-time checks (first below 1800ms; second at least 1800ms and below 4000ms). A slow host failure must be reported, not silently retried into a PASS. Reading DEFAULT_TIMEOUT_SECONDS=600 is source inspection, not evidence that a default-duration command executed; the old \"exit code 1\" description is not the current timeout outcome contract. Preserve and observe the explicit timeout diagnostic.",
      "observableRationale": "source=public-sdk-return",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "Working directory: `packages/agent-core`. Relocate `hook-timeout-demo.mjs`, correct both its owning output import and command-executor source lookup. Use a POSIX shell with `sleep`; no long wait is required.",
      "action": {
        "kind": "command",
        "value": "node examples/hook-timeout-demo.mjs"
      },
      "expectedObservable": "result=timeout:1 returns blocked=false with errors containing kind=timeout; timeout:5 returns blocked=false with stdout containing \"hook completed\" Comparison: Capture both actual result objects, exit 0 and the existing elapsed-time checks (first below 1800ms; second at least 1800ms and below 4000ms). A slow host failure must be reported, not silently retried into a PASS. Reading DEFAULT_TIMEOUT_SECONDS=600 is source inspection, not evidence that a default-duration command executed; the old \"exit code 1\" description is not the current timeout outcome contract. Preserve and observe the explicit timeout diagnostic.",
      "cleanup": "Let the short sleep children finish; no persistent data is created.",
      "evidence": "pending"
    },
    {
      "name": "Scenario 5: Session migration on explicitly injected disposable data",
      "surface": "public-sdk-example",
      "surfaceRationale": "shipped-interface=public-sdk-example",
      "invocation": "node examples/verify-session-history-migration.mjs",
      "observableType": "sdk-result",
      "observable": "result=first migration reports Migrated: 1, Skipped: 3, Total: 4; legacy history has two chat entries; second migration reports Migrated: 0, Skipped: 4, Total: 4 with unchanged bytes Comparison: The example invokes the real owner command with `execFileSync(process.execPath, [absoluteScriptPath, '--sessions-dir', absoluteFixtureDirectory])`, without a shell or environment override. Report captured command stdout plus the parsed migrated JSON: original messages remain, history types/data preserve user \"hello\" and assistant \"world\", each entry has a UUID and the fixed updatedAt timestamp. Existing history, empty-message JSON, malformed JSON and the non-JSON sentinel must remain byte-identical. Compare all bytes again after the second invocation. Also invoke the same command with an explicit missing child directory below the fixture root: observe `No sessions directory found.` and no directory creation. Do not execute the default path, even with `--help`: the old command ignores arguments and would discover the actual home directory. Emit a compact result containing the actual counts and entry values; assertion failure exits nonzero, but exit status alone is not the user evidence.",
      "observableRationale": "source=public-sdk-return",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "Working directory: `packages/agent-session`. Move the real command to `scripts/migrate-session-history.mjs` and implement `--sessions-dir <absolute-directory>` before running this example. The example creates one ordinary `mkdtemp` directory under the OS temporary directory, obtains its absolute path and seeds four JSON files: legacy messages (user \"hello\", assistant \"world\", fixed valid updatedAt `2026-01-01T00:00:00Z`), existing nonempty history, empty messages, and malformed JSON. Add one non-JSON sentinel. Keep original bytes for comparison. No fixture contains credentials or uses the real sessions directory; no HOME, USERPROFILE or other global-home override is permitted.",
      "action": {
        "kind": "command",
        "value": "node examples/verify-session-history-migration.mjs"
      },
      "expectedObservable": "result=first migration reports Migrated: 1, Skipped: 3, Total: 4; legacy history has two chat entries; second migration reports Migrated: 0, Skipped: 4, Total: 4 with unchanged bytes Comparison: The example invokes the real owner command with `execFileSync(process.execPath, [absoluteScriptPath, '--sessions-dir', absoluteFixtureDirectory])`, without a shell or environment override. Report captured command stdout plus the parsed migrated JSON: original messages remain, history types/data preserve user \"hello\" and assistant \"world\", each entry has a UUID and the fixed updatedAt timestamp. Existing history, empty-message JSON, malformed JSON and the non-JSON sentinel must remain byte-identical. Compare all bytes again after the second invocation. Also invoke the same command with an explicit missing child directory below the fixture root: observe `No sessions directory found.` and no directory creation. Do not execute the default path, even with `--help`: the old command ignores arguments and would discover the actual home directory. Emit a compact result containing the actual counts and entry values; assertion failure exits nonzero, but exit status alone is not the user evidence.",
      "cleanup": "In `finally`, remove only the exact ordinary temporary directory created by this example; never derive a cleanup target from HOME, a workspace root or an unvalidated command argument.",
      "evidence": "pending"
    },
    {
      "name": "Scenario 6: Existing framework goal cassette replay, without recording",
      "surface": "public-sdk-example",
      "surfaceRationale": "shipped-interface=public-sdk-example",
      "invocation": "pnpm exec tsx examples/verify-goal-cassette-replay.mts",
      "observableType": "sdk-result",
      "observable": "result=goal.status=satisfied; goal.stopReason=satisfied; GOAL.txt contains \"done\"; tool calls include Bash and report_goal_status Comparison: Execute `runGoal(buildGoalObjective(harness.cwd), { maxIterations: GOAL_MAX_ITERATIONS })` and print the actual status, stopReason, GOAL.txt content and tool names before disposal. Assert the committed cassette bytes are unchanged. The recorder moves to `packages/agent-framework/scripts/record-goal-cassette.mts`, but this offline run proves preserved replay behavior, not successful live recording or the new concrete provider composition. Keep recorder import/dependency wiring verification in engineering evidence; no paid recording or committed cassette regeneration is authorized. The existing replay test remains in framework.",
      "observableRationale": "source=public-sdk-return",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "Working directory: `packages/agent-framework`. The new owner-local example uses the existing public `@robota-sdk/agent-framework/testing` scriptedSession API and the existing framework-owned `src/testing/__fixtures__/goal-cassette-fixture.ts` constants/objective. Dependencies and the current public package outputs must resolve. Read the existing cassette without modification; use `scriptedSession({ cassette: GOAL_CASSETTE_PATH, bare: true })`, which owns its ordinary temporary workspace and session-log directory. Do not import Vitest configuration, rebind HOME, load a concrete live provider, read keys or use record/toCassette mode.",
      "action": {
        "kind": "command",
        "value": "pnpm exec tsx examples/verify-goal-cassette-replay.mts"
      },
      "expectedObservable": "result=goal.status=satisfied; goal.stopReason=satisfied; GOAL.txt contains \"done\"; tool calls include Bash and report_goal_status Comparison: Execute `runGoal(buildGoalObjective(harness.cwd), { maxIterations: GOAL_MAX_ITERATIONS })` and print the actual status, stopReason, GOAL.txt content and tool names before disposal. Assert the committed cassette bytes are unchanged. The recorder moves to `packages/agent-framework/scripts/record-goal-cassette.mts`, but this offline run proves preserved replay behavior, not successful live recording or the new concrete provider composition. Keep recorder import/dependency wiring verification in engineering evidence; no paid recording or committed cassette regeneration is authorized. The existing replay test remains in framework.",
      "cleanup": "Always `await harness.dispose()` in `finally`; it removes only its owned temporary workspace after shutdown. Do not write to user settings or delete the committed cassette.",
      "evidence": "pending"
    }
  ]
}
```

<!-- checkpoint-evidence:v1:end -->

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-09-13

**Status upgrade:** in-progress → in-progress

- DONE-GATE-STAGE-2 — Independent guardian: Hume. Subject: `.agents/tasks/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md`, current implementation working tree on HEAD `36f4ff11e8dbe5ea525978c8648ceca9720ee329`. Main directly executed the six commands and recorded their results above; this guardian inspected those records and the actual repository examples, rather than claiming to have independently rerun them.
- DONE-GATE-STAGE-2 — Ordering: PASS. The retained 2026-09-13 DONE-GATE-STAGE-1 PASS precedes the completed scenario implementation and these execution records. The Task remains in-progress. The sealed Stage-1 checkpoint's historical pending evidence remains unchanged; the six live scenario evidence fields now contain execution results.
- DONE-GATE-STAGE-2 — Direct execution: PASS, 6/6. Main's current-conversation execution report and each scenario's evidence record identify direct owner-local example execution, each exit 0, not execution through test runners.
- DONE-GATE-STAGE-2 — Expected observables: PASS, 6/6. The actual hook results, timeout bounds, migration data/byte preservation and public SDK goal replay match the authored expectations, as detailed below. No scenario expectation was changed by this guardian.
- DONE-GATE-STAGE-2 — Concrete evidence: PASS, 6/6. Each named scenario above contains its observed output and exit code under `evidence`; the following existing repository artifacts bind the commands to their implementations.
- DONE-GATE-STAGE-2 — Scenario 1: From `packages/agent-core`, `node examples/hook-block-demo.mjs` exited 0; actual runHooks returned blocked=true, reason="Bash tool blocked: dangerous command detected", empty stdout. Evidence: Scenario 1 evidence field; durable executable: `packages/agent-core/examples/hook-block-demo.mjs`. The later illustrative tool-result prose is not the observed product result.
- DONE-GATE-STAGE-2 — Scenario 2: From `packages/agent-core`, `node examples/hook-json-response-demo.mjs` exited 0; actual results were blocked=true/reason="Security policy violation", blocked=true/permissionDecision="deny", then blocked=false/stdout="User has elevated permissions today.". Evidence: Scenario 2 evidence field; durable executable: `packages/agent-core/examples/hook-json-response-demo.mjs`.
- DONE-GATE-STAGE-2 — Scenario 3: From `packages/agent-core`, `node examples/hook-permission-mode-demo.mjs` exited 0; child stdout was "default" then "bypassPermissions", both blocked=false. Evidence: Scenario 3 evidence field; durable executable: `packages/agent-core/examples/hook-permission-mode-demo.mjs`. This proves stdin forwarding, not a change to verifier permissions.
- DONE-GATE-STAGE-2 — Scenario 4: From `packages/agent-core`, `node examples/hook-timeout-demo.mjs` exited 0; timeout:1 returned blocked=false with a timeout diagnostic at 1007ms (<1800ms); timeout:5 returned blocked=false/stdout="hook completed" at 2019ms (>=1800ms and <4000ms). Evidence: Scenario 4 evidence field; durable executable: `packages/agent-core/examples/hook-timeout-demo.mjs`. Reading the default constant is not runtime evidence.
- DONE-GATE-STAGE-2 — Scenario 5: From `packages/agent-session`, `node examples/verify-session-history-migration.mjs` exited 0; the real command reported migrated/skipped/total 1/3/4 then 0/4/4, retained user hello and assistant world with distinct UUIDs and the expected timestamp, preserved skipped/sentinel and repeated-run bytes, and left missing storage absent. Evidence: Scenario 5 evidence field; durable executable: `packages/agent-session/examples/verify-session-history-migration.mjs`, invoking `packages/agent-session/scripts/migrate-session-history.mjs` with explicit disposable storage. Only its owned temporary fixture was removed.
- DONE-GATE-STAGE-2 — Scenario 6: From `packages/agent-framework`, `pnpm exec tsx examples/verify-goal-cassette-replay.mts` exited 0; public scriptedSession with bare:true produced status=satisfied, stopReason=satisfied, GOAL.txt=done and Bash/report_goal_status calls. Disposal completed and cassette bytes remained unchanged. Evidence: Scenario 6 evidence field; durable executable: `packages/agent-framework/examples/verify-goal-cassette-replay.mts`. This is offline replay evidence, not a live recorder/provider claim.
- DONE-GATE-STAGE-2 — Durable test artifacts: PASS, existing paths inspected: `packages/agent-core/src/__tests__/owned-hook-examples.test.ts`, `packages/agent-session/src/__tests__/migrate-session-history.test.ts`, and `packages/agent-framework/scripts/__tests__/goal-cassette-replay-example.test.ts`. These are supporting durable references only; their test results are not substituted for the direct execution evidence above, and this guardian did not run them.
- DONE-GATE-STAGE-2 — Engineering-evidence substitution: absent. The reported 193 safe tests, build/type checks and scans are separate engineering evidence, not the basis for this scenario verdict.
- DONE-GATE-STAGE-2 — Capability absence/manual exception: N/A. All six scenarios executed; no missing-capability claim or manual-only exception is used. No live credentials, HOME override, PTY or Git fixture is claimed or required by these executions.
- DONE-GATE-STAGE-2 — Boundary: PASS is limited to executed scenarios. It does not certify remote CI, TC-06 landing, GATE-VERIFY, GATE-COMPLETE, issue closure or merge authorization. Scenario bodies, criteria, status and historical checkpoint evidence were not changed.
