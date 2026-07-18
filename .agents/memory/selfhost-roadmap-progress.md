# SELFHOST roadmap — design-gate + implementation progress

Owner goal: **Robota builds Robota** (see [`../../VISION.md`](../../VISION.md)). The 14-spec self-hosting capability
roadmap (`.agents/backlog/SELFHOST-000..014`, derived from commercial-agent prior-art research) is the vehicle.

## Status (as of 2026-07-17)

**All 14 SELFHOST specs are DESIGN-GATED** (GATE-APPROVAL ENDORSE via independent `proposal-reviewer` iterations,
each punch-list verified against the actual code) and promoted to `.agents/spec-docs/todo/` (`status: approved`):

- Table-stakes 001–006 (PR #1190, merged): 001 orchestration primitives, 002 plan-mode, 003 codebase-index/RAG,
  004 trace/cost view, 005 guardrails, 006 per-role model routing.
- Differentiators 007–014 (PR #1191, merged): 007 branching time-travel, 008 durable/semantic memory,
  009 hook catalog, 010 computer-use, 011 evals-as-code, 012 scheduled-tasks, 013 multi-surface deployment,
  014 shared async artifacts.

**SELFHOST-001 is in GATE-IMPLEMENT** (spec now in `.agents/spec-docs/active/`, `status: in-progress`; tasks:
[`../tasks/SELFHOST-001.md`](../tasks/SELFHOST-001.md)):

- **P1 SHIPPED** (PR #1192, merged to develop, merge-verified): neutral orchestration contracts + event-type
  unions in `packages/agent-core/src/orchestration/` (agent-core OWNS them, zero new `@robota-sdk/agent-*` deps);
  the `sequential` primitive (`runSequential`) in `packages/agent-framework/src/orchestration/sequential.ts`
  composing over `agent-executor`'s `ISubagentManager`/`ISubagentRunner` port (never depends on
  `agent-subagent-runner` — the concrete runner is injected at the `agent-cli` root); a standing
  `orchestration-neutrality` harness scan (`scripts/harness/scan-orchestration-neutrality.mjs`, identifier-CONTAINING
  match so camelCase `roomId`/`personaName` are caught) + its red-fixture test; agent-core/agent-framework SPEC
  amendments (core reclassified as OWNER of the neutral contracts).
- **P2 SHIPPED** (PR #1194, merged to develop `354e55e99`, merge-verified): `runParallel` (bounded-concurrency
  worker pool + fail-fast + order-preserving `\n\n`-join aggregate) + `runHandoff` (dynamic loop-ownership transfer
  via an INJECTED neutral `resolveHandoff` policy; previous-output threading; `maxHandoffs` guard). Contracts
  `IParallelOrchestrationSpec` + `IHandoffOrchestrationSpec`. spawn/wait/event mechanics factored into
  `orchestration/shared.ts` (sequential refactored onto it; `ISequentialRunContext` kept as alias).
- **P3 IMPLEMENTED** (this PR): `runHierarchical` (manager step delegates to workers via an injected neutral
  `planDelegation` policy; worker output threaded back each round; `maxRounds` guard) + `runGroupChat` (steps take
  turns chosen by an injected neutral `selectNextStep` policy; prior turns threaded as id-labeled history; `maxTurns`
  guard). Contracts `IOrchestrationDelegation` + `IHierarchicalOrchestrationSpec` + `IGroupChatOrchestrationSpec`.
  Neutrality held for these two highest-drift primitives — WHO delegates / WHO speaks next is caller-injected, and
  the standing `orchestration-neutrality` floor stays clean. **All five named primitives now implemented** (30 tests).
- **GATE-VERIFY + GATE-COMPLETE PASSED** — spec moved `active/` → `.agents/spec-docs/done/`, `status: done`,
  `completed: 2026-07-17`; task archived to `.agents/tasks/completed/SELFHOST-001.md`. All 6 Completion Criteria
  `[x]` with per-TC evidence; User-Execution done-gate passed via a public-SDK-usage scenario (UET-01, exit 0,
  all 5 primitives run — script in `scratch/src/`, INFRA-023). **SELFHOST-001 is DONE.**
- **B3 extraction trigger** (deferred): when a second implementer family lands (a dag-\* adapter), move BOTH the
  contracts AND event unions into a new `agent-interface-orchestration` package (deps ⊆ {agent-core}).

**SELFHOST-002 (explicit plan-mode) is DONE** (spec in `spec-docs/done/`, task archived; all gates). Two work units:
P1 (PR #1197) added the plan/todo-artifact + approval-event contract in `agent-interface-transport` (beside
`IGoalState`) and a **pure** `PlanController` in `agent-framework/src/plan/` (mirrors `GoalController`: returns
`{action,nextMode}`, never calls `setPermissionMode`); P2 (PR #1198) wired `InteractiveSession.setPlan/approvePlan/
revertPlan` (applies the mode flip: `setPlan`→`plan`, `approve`→`acceptEdits`, `revert`→`plan`; emits `plan_event`;
persists+restores the artifact) + the `/plan` command in `agent-command` (registered in `default-command-modules`;
only the module factory is a package export → allowlisted in `check-spec-public-surface.mjs` like its siblings). **No
second mutation gate** — reuses the existing `plan` permission mode (`MODE_POLICY`: plan blocks Write/Edit/Bash,
acceptEdits auto-applies edits but keeps Bash/Shell per-call). TC-04 proven headlessly on a real `InteractiveSession`

- injected provider AND a `/plan` print-mode CLI UET (`slash-smoke.test.ts`).

**SELFHOST-003 (codebase retrieval / RAG, EPIC, `type: DATA`) v1 is DONE** (spec in `spec-docs/done/`, task archived;
all gates). v1 = P1 (retrieval port + contract + duck-typed parser port + neutral `RepoMapRetrievalAdapter`
graph-centrality ranking + `createRetrievalTool`, adapter-gated in `createDefaultTools`, PR #1200), P2 (`buildRepoMapIndex`

- serialize/deserialize persistence; adapter builds/accepts the index once, PR #1202), P3 (`updateRepoMapIndex`
  incremental re-index — re-parse only changed files, PR #1203). Neutral throughout (parser injected, corpus from
  surface, no repo paths, no heavy dep in `agent-tools`). UET = a public-SDK demo (`scratch/src/`). **P4 (embedding-vector
  backend, may revise the port) DEFERRED** → `.agents/backlog/SELFHOST-003-P4-embedding-vector-backend.md`. Also filed:
  `HARNESS-027` (mechanical agent-tools neutrality/dep floor).

## How this was executed (reusable pattern)

Design-gate ALL specs first (owner's chosen path "설계-게이트 일괄"), then implement in priority order. Each spec
authored grounded in real code (four corrected inaccurate backlog seeds against the codebase); the independent
`proposal-reviewer` gate repeatedly caught genuine code-verified defects (dependency cycles, wrong placement,
unbuildable data-flow, a neutrality scan bypassable by camelCase) BEFORE any code — see the specs' Evidence Logs.
PRs use the DX-001 batching policy (one coherent design-gate pass per PR) and the HARNESS-018 async PR-review
(reviewer → 0/1 actionable → fix → merge). **SELFHOST-001, SELFHOST-002, SELFHOST-003 (v1), and SELFHOST-004
are DONE** (all gates). **SELFHOST-004 (run tracing + per-run cost budgeting view)** landed P1–P6 (PRs #1205,
#1210, #1211; spec in `spec-docs/done/`, task in `tasks/completed/`, TC-01…08 checked): turn-granular `costUsd`
→ span-completion event (spanId+durationMs+op) → cost-by-source + span-timeline read-model → per-run budget cap
(`LimitsPlugin.maxRunCost`, exact `calculateModelCost` path) → `usage_report` `TServerMessage` carrier +
`formatUsageReport` view → **live wiring** (session-owned `ObservableEventService`, permission-wrapper
`setEventService` forward, per-turn `collectSpanEntries` draining spans onto history before the usage-summary).
Full chain live in a real interactive turn. Note: span→turn grouping is positional (spans before each
usage-summary), not `ownerPath`-based; `ISpanEntry` carries no owner field.
**SELFHOST-005/006/007 DONE** (PRs #1213/#1214/#1215): parallel guardrails + tool-output validation; per-role model
routing (`IModelRef`/`TRoleModelMap`); branching time-travel checkpoints (neutral `CheckpointTree` + non-destructive
fork restore). **SELFHOST-008 (durable memory, EPIC) — P1 DONE** (PR #1218, merged develop `f44d16b23`, review
ACTIONABLE 0): neutral `IMemoryStore` DIP port + `IMemoryBudget` + deferred duck-typed `ISemanticMemoryAdapter`
(`agent-framework/src/memory/types.ts`, mirror sandbox `ISandboxClient`); `FileSystemMemoryStore` reference adapter
composing the existing fs classes (zero behavior change); BOTH consumers (startup injection via `loadContext` on the
interactive options path — NOT `ICreateSessionOptions` which never reads memory — + post-turn `AutomaticMemoryController`)
routed through the port adapter-gated. v1 = ONE keyword/FTS backend, semantic deferred; TC-06 neutrality = manual +
follow-up **HARNESS-029** (gates P3/P4). **P1R DONE** (PR #1220, owner-requested architecture-audit course-correction):
`IMemoryStore` made **async** (aligns sandbox/retrieval precedents; the async `ISemanticMemoryAdapter` ghost-seam is now
injectable) + segregated into 4 role interfaces (ISP) + the `/memory` command path routed through the injected port via
`ICommandHostContext.getMemoryStore()` (split-brain closed). **P2 DONE** (PR #1221, merged develop `92ea04206`): live
post-turn auto-capture — the dormant `AutomaticMemoryController` fires per USER turn, **awaited in the execution
controller's `finally` before `persistSession()`** (option B; `onComplete` is unawaited so awaiting there would race —
the gate caught this over 3 review iterations), try/catch-guarded, adapter-gated on a surface-supplied `automaticMemory?`
(absent ⇒ OFF). TC-02b proves await-before-persist. **HARNESS-029 DONE** (PR #1223, merged develop `d20f73576`):
mechanical memory-neutrality floor (`scan-memory-neutrality.mjs`, 57 scans) flagging `seeded-memory-content` +
`library-capture-prompt` in `packages/*/src`; the always-on guardian that GATES P3/P4. Review found + fixed 1 SHOULD
ReDoS (disjoint `CAPTURE_PROMPT_DECL` branches `\\.|(?!\1)[^\\]` + TC-07 regression) + threaded `root` through the walk.
**P3 SPLIT + DONE** (PR #1224 merged develop `4fc3ec266`). GATE-APPROVAL proposal-review of the semantic-decorator slice found the recall
path (`controller.retrieve`/`renderRetrievedMemory`/`IMemoryStore.recall`) has ZERO live callers — a semantic backend
would upgrade DEAD code. Owner chose "분할": **P3 = wire per-turn recall FIRST** (keyword, observable); semantic
decorator → **P4** (deferred). P3 shipped via the full gate pipeline (WRITE→APPROVAL[proposal-reviewer REVISE×2→ENDORSE]
→IMPLEMENT→VERIFY→COMPLETE): per-turn durable-memory recall injected EPHEMERALLY. **3-package (layering):** the ephemeral
primitive lives in **agent-core** `IRunOptions.ephemeralSystemContext` (transient system-role msg appended to a DERIVED
provider-message array in `executeRound`, never `addUserMessage`'d → never persisted, no prompt-cache rebuild) — agent-core
owns model-call assembly, not agent-session (reviewer caught the 1st-draft mislocation); `agent-session.run(...,{ephemeralSystemContext})`
= thin pass-through; agent-framework controller computes recall at turn start (query=input) → distinct `<recalled-memory>`
label → ephemeral inject, adapter-gated on surface `recallMemory?` (`IPerTurnRecallConfig`; absent ⇒ OFF), guarded
(recall error → skip). v1 NO dedup vs startup index (summaries vs bodies = granularity mismatch; deferred). TC-01..07
green, 56/56 scans. **P4 DONE** (PR #1225 merged develop `fde56af72`): neutral `SemanticMemoryStore` decorator (base `IMemoryStore` +
injected `ISemanticMemoryAdapter`) — tiered recall (adapter.query primary; error → keyword base.recall, declared),
guarded append-then-index (base durable write first; adapter.index only when `!deduplicated`; index error → skip,
declared), delegate rest; `createSemanticMemoryStore` factory + barrel export; imports NO vector SDK (surface injects
the concrete adapter). Upgrades the live P2/P3 recall+index paths via the existing `memoryStore` seam with no
agent-framework change. TC-01..07 (7 tests), 56/56 scans, proposal-reviewer ENDORSE. Known v1 limit: pre-adapter
durable entries dedup-skip the vector index (keyword-recallable; v2 `upsert-by-id`). **SELFHOST-008 NEUTRAL LIBRARY COMPLETE**; **P5 (concrete backend) DEFERRED to backlog** `.agents/backlog/SELFHOST-008-P5-concrete-semantic-backend.md` (surface-side; mirrors SELFHOST-003-P4). Also this session:
\*\*HARNESS-028\*\* no-fallback mechanical gate DONE (merged main #1216 + develop #1217) — see `no-fallback-gate.md`.
Branch-flow lesson: NEVER PR a develop-based branch into `main` (it sweeps the whole develop→main delta; the #1216
incident, forward-fixed by #1217). Architecture lesson: capability DIP ports must be async + wire ALL consumers through
the port; run architecture-auditor + architecture-conformance-auditor at mid-points (they caught the P1 defects early).

Next: **SELFHOST-008 P6 DONE** (PR #1227 → develop): memory surface-wired into agent-cli (default-OFF opt-in: settings.json+--memory+ROBOTA_MEMORY; injected at print/serve/TUI via agent-transport(+tui) option forwarding; buildRuntimeSession + neutral library UNCHANGED) — the merged P2/P3/P4 are now REACHABLE. **AGENT-RUN VERIFIED** (I ran the real robota CLI, claude-sonnet-4-6): capture 'pnpm ship' → .robota/memory/ (MEMORY.md+topic), fresh-session paraphrased recall answered 'pnpm ship' with the <recalled-memory> block in the session log (P3 fired), default-off wrote nothing. Evidence `.agents/evals/scenarios/selfhost-008-memory-agent-run.md`. This fulfilled the owner agent-run-verification directive + closed the reachability gap. (owner 2026-07-18: P2/P3/P4 are library seams OFF in the real agent); then P5 deferred; then SELFHOST-009; then 010–014 in priority order (`priority: medium`/`low`, `urgency: later`);
each follows the same GATE-WRITE → APPROVAL → IMPLEMENT → VERIFY → COMPLETE flow.
Committing at logical boundaries per the new commit-cadence rule (git-branch.md).
Multi-package specs split into named P-slice work units (own PR each); each code-changing spec's GATE-COMPLETE needs
a real user-execution scenario (product surface — CLI print-mode or public-SDK usage, agent-executable, evidence captured).

Related: [[self-improving-harness-northstar]], [[harness-mechanical-not-skilltree]].

**SELFHOST-009 (hook catalog) DONE** (PR #1228 → develop): BEHAVIOR spec (design-gated prior batch, grounding re-verified). Extended the existing hooks engine (NO new tier): 3 new informational-only named events on `THookEvent` (13→16) — `PreModelCall`/`PostModelCall` (from `onExecutionEvent` provider_request/provider_response_normalized, single-source no double-fire) + `PermissionDecision` (after evaluatePermission); catalog SSOT `packages/agent-core/docs/HOOK-CATALOG.md` + fixed the guide (dropped phantom `Notification`, added 6 omitted + 3 new); drift-guard `scan-hook-catalog.mjs` (57 scans, resolves variable dispatch). PreToolUse gate unchanged, documented + **AGENT-RUN verified** (real robota CLI: settings.json deny hook blocked Bash; contrast run executed it — `.agents/evals/scenarios/selfhost-009-pretooluse-gate-agent-run.md`). TC-01..07 green. NEXT: **SELFHOST-010 (computer-use)**, then 011–014.

**SELFHOST-010 P1 (computer-use) DONE** (PR #1230 merged+verified on develop `ad72dec7e`): neutral `IComputerDriver` port + perceive→act tool in `agent-tools/src/computer-use/` (mirror sandbox) — `ComputerView` (perceive, auto like Read) + `Computer` (mutate, approve/deny like Shell) via the EXISTING PermissionEnforcer (no new gate); zero-dep `PageComputerDriver` (duck-typed `IBrowserPageAdapter`, no browser SDK); `ScriptedComputerDriver` test-support under `computer-use/testing/` (NOT shipped, no-fake green); assembly adapter-gated (NO host fallback); takeover suspends loop + pauses perception. TC-01..08 unit/functional; 58 scans. Independent review (pr-review-reviewer) PASSED all 7 focus areas; 1 SHOULD + 2 minor fixed in `368977b68`: **keypress is a CHORD** (`['Control','a']`→`press('Control+a')`, was sequential presses = not Ctrl+A), drag <2-point guard (extracted `performDrag()`), `capture()` derives screenshot type from `mediaType`. **P2 (real-browser agent-run verification + takeover-loop hardening) / P3 (concrete surface driver) / P4 (agent-tools dep-allowlist floor) PENDING.** GOVERNANCE this session: **HARNESS-032 no-fake-in-src floor** (owner: fake/mock/stub only in test code; recurred into 010's original FakeComputerDriver) — merged #1229; pre-existing debt → HARNESS-033.

**SELFHOST-011 (evals-as-code, EPIC, `type: BEHAVIOR`) — P1 DONE** (PR #1232 merged+verified on develop `c1e856da3`). Neutral `agent-framework/src/evals/` SDK seam (mirror pure `src/self-hosting`/`src/goal` + the `agent-session-analytics` metrics-over-a-run sibling): `eval-types.ts` (`IMetric` = pure fn over the SSOT `IExecutionResult` — response+toolSummaries+usage+history, NOT the string; Alt-4 string-only REJECTED), `IEvalCase`/`IEvalDefinition` (cases×metrics×threshold), report types, `TEvalRunFn`; `runner.ts` `defineEval`+`runEval(def,runFn)` (injected runFn, boolean→1/0, numeric clamped to [0,1], overallScore=mean of case×metric, passed=overallScore>=threshold; IO-free); `session-run-fn.ts` `createSessionRunFn(runtime)` (default runFn = `createAgentRuntime().createSession()` capturing the terminal `complete`-event FULL IExecutionResult, fresh session per case, `await shutdown()` in finally; NOT `createQuery`). Barrel + `// ── Evals ──` root export + SPEC.md. Review (pr-review-reviewer #1232) found 2 SHOULD — **session leak** (no shutdown → fixed, finally) + **numeric false-pass** (unclamped >1 → clamp [0,1]) — both fixed `bf5692cb0`. **P2 DONE** (PR #1233 merged+verified develop `6366850c7`): `robota eval <definition>` CLI gate — `agent-cli/src/eval/eval-command.ts` `runEvalCommand(argv,cwd,deps?):Promise<number>` (dynamic-import consumer def → default runFn from CLI-resolved provider via createSessionRunFn → runEval → exit 0 pass/1 breach; injectable runFn/loadDefinition for tests); cli.ts pre-parse intercept (mirror `session analyze`) + fallthrough + help; `examples/capabilities/agent-eval/` (TC-04); TC-05 neutrality + mechanical floor filed **HARNESS-034**. TC-03 exit test (eval-command.test.ts, 7 cases). **AGENT-RUN VERIFIED** (owner directive): drove real `robota eval` vs live Anthropic — PASS def (model answered 4)→exit 0, FAIL def→exit 1, missing-path/malformed-threshold→1; evidence scenario. Review #1233: 1 SHOULD (TC-03 test misattribution → corrected) + 2 CONSIDER (runFn-in-try for ProviderConfigError; reject malformed --threshold) fixed `0c6605e4e`. **EPIC DONE** — GATE-VERIFY+GATE-COMPLETE PASS, spec in `spec-docs/done/`, P1+P2 tasks archived, all TC-01..06. **P3/P4 DEFERRED to backlog** `.agents/backlog/SELFHOST-011-P3-P4-evals-followups.md`.

NEXT: SELFHOST-012 (scheduled-tasks), then 013 (multi-surface-deployment-gateway), 014 (shared-async-session-artifacts).

NEXT: SELFHOST-011 P2 (CLI gate + agent-run verification), then 012-014.
