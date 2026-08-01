# SYNTHESIS — six parallel architecture audits, merged

Input: six independent layer audits (L0–L5) plus one architecture↔implementation conformance audit,
run in parallel, none of which had read any of the others. This document is the first cross-reading.

Method: every finding from all seven reports was read in full, then clustered **by cause**. Where two
or more reports described one cause from different heights, the sightings were merged into a single
entry that names every layer that saw it and preserves **both sets of file:line evidence**. Where a
claim was load-bearing or contested, it was re-checked against the repository (read-only); the checks
performed are listed in § Disagreements and corrections.

Nothing in the repository was modified.

---

## Counts

### Per source report

| Report                    | Numbered entries | Discrete defects | Blocker |   High | Medium |    Low |        FOUNDATIONAL |  LOCAL |
| ------------------------- | ---------------: | ---------------: | ------: | -----: | -----: | -----: | ------------------: | -----: |
| `L0-foundation.md`        |               15 |               15 |       1 |      6 |      5 |      3 |                  11 |      4 |
| `L1-runtime.md`           |               18 |               25 |       2 |      5 |     10 |      8 |                  14 |     11 |
| `L2-assembly.md`          |               16 |               16 |       1 |      5 |      7 |      3 |                   9 |      7 |
| `L3-command-transport.md` |               17 |               17 |       2 |      5 |      6 |      4 |                   4 |     13 |
| `L4-product.md`           |               19 |               19 |       2 |      4 |      6 |      7 |                   3 |     16 |
| `L5-dag.md`               |               17 |               23 |       2 |      8 |      6 |      7 |                  10 |     13 |
| `CONFORMANCE.md`          |               30 |               30 |       0 |      8 |     16 |      6 | n/a (doc/code side) |    n/a |
| **Total**                 |          **132** |          **145** |  **10** | **41** | **56** | **38** |              **51** | **64** |

Notes on the count: L1 presents 18 entries but its entry 18 is a table of 8 sub-items; L5 presents 17
but its F17 is a bucket of 7. CONFORMANCE uses a different vocabulary (VIOLATION / PHANTOM / DRIFT /
UNDOCUMENTED) and a doc-side/code-side axis instead of FOUNDATIONAL/LOCAL, so its 30 are excluded from
the depth columns (51 + 64 = 115 = 145 − 30); it declares 24 of its 30 "material". Severity columns are
the source reports' own labels, not mine.

### After merging

|                                                                                 |                  Count |
| ------------------------------------------------------------------------------- | ---------------------: |
| Discrete source defects in                                                      |                **145** |
| Merged findings out (34 ranked + 1 residual bucket)                             |                 **35** |
| — entries carrying sightings from **two or more independent reports**           |                 **21** |
| — entries from a single report (several are themselves within-report groupings) |                 **14** |
| Reduction                                                                       | 145 → 35 entries (76%) |

The number that matters is **21**: twenty-one causes were seen by two or more auditors who could not
read each other's work, and eight of those were seen by three or more. They are the highest-confidence
findings in the corpus and they occupy almost the whole top of the ranked list — ranks 1, 2, 3, 4, 5,
8, 9, 10, 13, 14, 15, 18, 19, 20, 21, 22, 30, 31, 32, 33, 34. The multi-sighting entries with the
widest reach: #19 (six reports), #18, #20 (five each), #13, #15 (four each).

Source defects are assigned to one **primary** merged entry and cross-referenced from the others, so a
per-entry source count is deliberately not tabulated — several defects are genuine instances of two
different invariants and counting them twice would inflate the arithmetic.

---

## The ranked list

Ordered most severe first. Severity accounts for blast radius (how many layers/packages), whether the
failure is silent-wrong-answer or loud, security/trust impact, and whether it blocks other work.
A defect observed from two layers is ranked above an otherwise-equal single-layer sighting, because
the second sighting is independent corroboration of the cause.

`DEPTH` preserves each source report's verdict; where sources disagree it is stated.

---

### 1. The execution root (`cwd`) is carried by no execution contract, so every layer falls back to `process.cwd()` — and the containment guard's default is disarmed

**Severity: BLOCKER.** Three layers, a security property, and silent: a subagent or DAG node reading
outside its intended root returns content rather than an error. It also blocks the subagent-isolation
and workspace work above it. This is the strongest multi-sighting in the audit — three reports found
the _same_ missing field independently, at three different heights, each having to trace a different
symptom back to it.

**DEPTH: FOUNDATIONAL** (L1, L2 and L5's `cwd` half all agree; L5 marks the duplication half LOCAL).

**Layers that observed it: L1 (runtime), L2 (assembly), L5 (DAG).**

**Evidence**

- L1 #2 — `packages/agent-session/src/session.ts:108` → `this.cwd = process.cwd();`, and
  `packages/agent-session/src/session-types.ts:38-145` (`ISessionOptions`) has **no `cwd` field**.
  That ambient value flows into every hook input and `CLAUDE_PROJECT_DIR`
  (`session-lifecycle.ts:56-66,:86-97`; `session-run.ts:140-149,:246-253,:300-312`), into
  `PermissionEnforcer.cwd` (`session.ts:141-147` → `permission-enforcer.ts:58`), and into the
  persisted record (`session-history-ops.ts:131`). Meanwhile the spawn contract declares it
  **required** — `packages/agent-executor/src/subagents/types.ts:22-28` `ISubagentSpawnRequest.cwd:
string` — and `packages/agent-framework/src/subagents/in-process-subagent-runner.ts:134-160` passes
  no cwd, because the option does not exist.
- L2 F1 — `packages/agent-subagent-runner/src/child-process-subagent-worker.ts:95-100` calls
  `createDefaultTools()` **with no argument**, so `cwd` is `undefined`, and
  `packages/agent-tools/src/builtins/path-guard.ts:41-42` is then a no-op
  (`if (cwd === undefined) return undefined;`). `packages/pack-coding/src/coding-pack.ts:22-28`
  states the consequence in its own doc: _"file tools constructed with no options carry a DISARMED
  working-directory guard: their `Read` will happily return `/etc/hostname`."_ Nothing downstream
  re-binds it — `create-subagent-session.ts:157` only _filters_ the array.
- L1 18e — `packages/agent-tools/src/builtins/path-guard.ts:37-40`: `isWithinCwd` returns `true` when
  `cwd === undefined`. The guard is fail-open by default.
- L5 F12(b) — `packages/dag-nodes/tool/src/containment.ts:22-24` names the same missing field as its
  reason: _"`INodeExecutionContext` carries no workspace root, so this makes explicit the boundary the
  node was already implicitly claiming."_ Confirmed at
  `packages/dag-core/src/types/node-lifecycle.ts:13-23`; `IWorkspaceLayout` exists in `dag-core`
  (`types/workspace-layout.ts`) and is never threaded in. Same anchor at
  `dag-nodes/file-read/src/index.ts:28,94` and `file-write/src/index.ts:30,100`.
- L5 F12(c) — `packages/dag-nodes/skill/src/index.ts:96` → `cwd: config.cwd ?? process.cwd()` with no
  `resolveContainmentRoot` call, taking the root from the same LLM-authorable `.dag.json` that
  `containment.ts:25-27` argues must not be trusted (_"a root the attacker supplies is not a root"_).

_Verified: `session-types.ts` has no `cwd`; `session.ts:108` and the worker's bare
`createDefaultTools()` are verbatim as reported._

**The cause in one sentence:** the working root is an ambient process fact rather than a required
field on `ISessionOptions` / `INodeExecutionContext` / the tool factory, so every construction site
either invents it or silently disables the guard that depends on it.

---

### 2. The trust boundary is documentation rather than code: two shipped transports have no authentication, two more chose opposite defaults, and the server's dev fallback authenticates any three-part string

**Severity: BLOCKER.** Remote arbitrary tool execution on the host with no gate, plus an auth bypass
selected by a missing environment variable. Two layers. Loud in neither direction: an unauthenticated
`POST /submit` looks identical to an authorized one.

**DEPTH: FOUNDATIONAL** for the missing admission seam (L3); **LOCAL** for the two `agent-server`
defects (L4). Both readings are correct and describe different halves.

**Layers that observed it: L3 (transport), L4 (product).**

**Evidence**

- L3 F2 — the design premise is written down and coherent:
  `packages/agent-framework/src/commands/remote-command-policy.ts:5-9` — _"pairing (Stage B3) is the
  sole trust boundary … So this policy is allow-by-default."_ It is enforced in two of four remote
  transports.
  - **WS, secure by default and well built:** `agent-transport-ws/src/ws-transport-configurable.ts:116-122`
    auto-mints a token unless `open: true`; `:237-240` closes with 1008 _before_ the `messages` send
    at `:271-275`; `verifyClient` at `:217-230` rejects a disallowed `Host`/`Origin` at the upgrade.
  - **WebRTC, insecure by default:** `agent-transport-webrtc/src/webrtc-transport.ts:49`
    `readonly secret?: string`, gated at `:194`; without it `:211-227` wires `createWsHandler`
    straight onto the data channel. Two sibling transports made **opposite** default choices for one
    decision.
  - **HTTP, no gate at all:** `agent-transport-http/src/routes.ts:33-166` installs no middleware;
    `POST /submit` reaches `session.submit(body.prompt)` at `:102`, `POST /command` reaches
    `session.executeCommand` at `:121`. The absent boundary is stated nowhere —
    `agent-transport-http/docs/SPEC.md:37-39` says only _"no new error classes"_.
  - **MCP, no gate and it strips the origin tag:** `agent-transport-mcp/src/mcp-server.ts:64-77`
    registers **every** command from `session.listCommands()` as callable, and `listCommands()`
    (`interactive-session-skill-router.ts:130-137` over `system-command-executor.ts:57-60`) drops
    `modelInvocable`/`userInvocable`/`safety`/`requiresPermission` — so `modelInvocable: false`
    commands (e.g. `plugin`, `agent-command/src/plugin/plugin-command-module.ts:19,31`) become
    model-callable. `mcp-server.ts:106` calls `executeCommand` **with no `source`**, defaulting to
    `'user'`, so a remote peer is attributed as the local operator and the `'remote'` policy seam is
    bypassed.
- L4 L1 — `apps/agent-server/src/websocket-server.ts:181-198`: with `JWT_SECRET` unset the string
  `"a.b.c"` authenticates as any `userId`/`sessionId`; the constructor logs a warning at `:69-75` and
  serves anyway. And even the verified path discards `jwt.verify`'s return — `client.userId` /
  `client.sessionId` at `:201-202` come from the _message body_, so any holder of any valid token can
  claim another user's session and reach `broadcastToSession` (`:271-291`).
- L4 L2 — `apps/agent-server/src/app.ts:115-138` registers `/api/v1/remote/chat` with no auth over
  providers built at `:92-108` from the **operator's** `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` /
  `GEMINI_API_KEY`; the only control is a global IP rate limiter (`:68-83`).

**The cause in one sentence:** admission is not a member of any contract, so each transport re-decides
it — with opposite defaults — and the policy layer that _assumes_ a boundary exists has no way to
require one.

---

### 3. The failure contract destroys the failure: a provider error is rendered to prose and re-parsed, a tool crash is reported as `success: true`, and an error whose message contains "abort" is returned as a successful interrupted run

**Severity: BLOCKER.** The sharpest silent-wrong-answer in the corpus, on the hottest path, with
exit-code consequences in print mode. Three layers; the same invariant recurs independently in the DAG
subsystem, which shares no code with the agent stack — evidence that this is a house pattern, not one
bad file.

**DEPTH: FOUNDATIONAL** (L0, L1); the DAG recurrences are marked **LOCAL** by L5 because the correct
shape already exists beside them.

**Layers that observed it: L0 (foundation), L1 (runtime), L5 (DAG).**

**Evidence**

- L0 F1 — `packages/agent-core/src/services/execution-round-streaming.ts:119-138` renders a provider
  failure into an assistant chat message with a `providerError: true` metadata flag;
  `execution-service-helpers.ts:214-253` reconstructs it (`:220` reads the flag, `:251-252` returns
  `error: new Error(response)` — the _rendered display string_). Class, `code`, `category`,
  `recoverable`, stack and `cause` are all gone. Worse, cancellation is a bare `Error` with a mutated
  `name` (`execution-round-provider.ts:202-206`, not exported, so no `instanceof` is possible), and
  three sites therefore re-implement a substring test —
  `execution-service.ts:234-239` and `execution-round-streaming.ts:121-125`:
  `error.message.includes('aborted') || error.message.includes('abort')` → `success: true,
interrupted: true`. **Any provider error whose message contains "abort"** ("connection aborted by
  peer") is reported as a successful interrupted run with an empty response. The workaround is already
  written one layer up:
  `packages/agent-framework/src/interactive/interactive-session-execution.ts:46-52` copies the same
  heuristic. It also breaks `packages/agent-core/docs/SPEC.md` § _Cancellation Contract (CORE-018)_
  point 4, in both directions.
- L1 #3 — `packages/agent-session/src/permission-enforcer.ts:192-199` returns
  `{ success: true, data: JSON.stringify({ success: false, output: '', error: message }) }` for a
  thrown tool; `permission-types.ts:79-88` `PERMISSION_DENIED_RESULT` does the same for a user denial
  (_"success:true prevents ToolExecutionError"_); `tool-hook-helpers.ts:69-78` for a hook block. Three
  distinct outcomes are indistinguishable from success at `IToolResult`, and `onToolExecution`
  (`permission-enforcer.ts:163-173`) reports `success: true` for a crashed tool. L1 is explicit that
  "never throw" is correct and "encode the failure as success" is not — they are independent
  decisions.
- L5 F10 — `packages/dag-framework/src/create-dag-framework.ts:67-74` `NoopDeadLetterReinject` returns
  `{ ok: true, value: { reinjected: false } }`, wired at `:152`, so
  `dag-api/src/controllers/dag-diagnostics-controller.ts:185` always reports a successful "nothing to
  reinject" — indistinguishable from a genuinely empty DLQ, while the real
  `dag-worker/src/services/dlq-reinject-service.ts:32-48` exists and is tested only against mocks.
- L5 F13 — `dag-scheduler`'s `triggerScheduledBatch` (`scheduler-trigger-service.ts:87-115`) returns
  `{ ok: true, value: { startedRuns, partialError } }` when a later item fails but the error itself
  when the _first_ one does.
- Same class, ranked separately below: `ICommandResult` (#21), `ISessionStore.load` collapsing
  missing/corrupt (residual), plugin-load `catch {}` (#15).

_Verified: `permission-enforcer.ts:192-199` is verbatim as quoted._

**The cause in one sentence:** the result envelopes on these paths cannot express failure, so failure
is smuggled into a success-shaped value — as prose, as a metadata flag, or as a nested JSON string —
and every consumer above has to guess.

---

### 4. `agent-core`'s "browser" build is a Node build, and every browser product hand-writes stubs around it

**Severity: BLOCKER/HIGH.** A declared capability that is not delivered; blocks all browser work and
is re-paid per bundler. The workaround converts a build-time contract violation into a deferred silent
runtime `TypeError` in a user's browser.

**DEPTH: FOUNDATIONAL** — both reports agree. **Severity disagreement:** L0 rated it `high`, L4 rated
it `blocker`. My reading: L4's is better supported, because L4 traced the workaround's _failure mode_
(`fs`/`net`/`tls`/`worker_threads: false` resolve to empty objects, so a reachable call becomes a
runtime error, not a build failure) and L0 did not.

**Layers that observed it: L0 (foundation, the cause), L4 (product, the workaround).**

**Evidence**

- L0 F6 — `packages/agent-core/package.json` declares `exports["."].browser`, and
  `tsdown.config.ts` builds `dist/browser` from the _same_ barrel as the Node build; that barrel
  re-exports Node-only modules: `src/utils/index.ts:2-8` (`./path-containment` → `node:fs`,
  `node:path`) and `src/hooks/index.ts:4` (`CommandExecutor`, `HttpExecutor` → `node:child_process`).
- L4 F1 — `packages/agent-core/dist/browser/index.js:1`:
  `import{randomUUID as e}from"node:crypto";import{realpathSync as t}from"node:fs";import{basename as n,…}from"node:path";import s from"jssha";import{spawn as c}from"node:child_process";`
  Root-cause sites named by L4 and not by L0: `utils/path-containment.ts:19-20`,
  `hooks/executors/command-executor.ts:10`, and five `randomUUID` importers —
  `services/execution-pipeline.ts:1`, `services/execution-round-provider.ts:6`,
  `managers/conversation-message-factory.ts:8`, `managers/conversation-store.ts:6`,
  `services/conversation-service/message-helpers.ts:7`.
- The workaround, cited by both: `apps/agent-web/next.config.ts:79-110` (L0) / `:83-114` (L4) —
  `config.resolve.fallback = { child_process: false, fs: false, module: false, net: false, tls: false,
worker_threads: false }`, `config.resolve.alias = { 'node:child_process': false, 'node:fs': false, … }`,
  plus two `NormalModuleReplacementPlugin`s, plus two hand-written stub files
  `apps/agent-web/src/lib/child-process-browser.js` and `src/lib/crypto-browser.js`.

_Verified: the `browser` export condition and the five `node:` imports on line 1 of
`dist/browser/index.js` are exactly as both reports state._

**The cause in one sentence:** one kitchen-sink barrel is built twice under two platform conditions,
so the browser condition is a promise the package's own module graph cannot keep — and no build-time
assertion exists to catch the regression.

---

### 5. No turn or run identity: concurrency has no owner, so every consumer invents its own busy flag and two of them race

**Severity: BLOCKER.** Three layers. Silent: an orphaned turn keeps streaming, keeps writing history
and keeps executing tools while `isRunning()` reports `false` and `abort()` is a no-op for it.
Blocks the concurrency and multi-surface work above it.

**DEPTH: FOUNDATIONAL** (L1, L5); L3's two instances are **LOCAL** symptoms of it.

**Layers that observed it: L1 (runtime), L3 (transport), L5 (DAG).**

**Evidence**

- L1 #1 — `packages/agent-session/src/session.ts:180-194`: `run()` assigns
  `this.abortController = new AbortController()` with no re-entrancy guard, and clears it in
  `finally`; `session-base.ts:131-140` keys `abort()`/`isRunning()` off that single field. A second
  `run()` overwrites it; the first `finally` to fire nulls it. **The guard exists one layer up** —
  `packages/agent-framework/src/interactive/interactive-session-execution-controller.ts:268-274`:
  _"RUNTIME-12: claim the turn SYNCHRONOUSLY at entry"_ — which is the textbook shape of a workaround
  for a defect below. Every other consumer of this published library gets no guard.
- L3 L7 — `agent-transport-mcp/src/mcp-server.ts:130-162` `waitForCompletion` subscribes to
  **session-global** `complete`/`interrupted`/`error` with no request correlation and no busy guard;
  two concurrent `submit` calls each resolve on whichever `complete` fires first.
- L3 L10 — `agent-transport-http/src/routes.ts:46-54` implements the busy check HTTP needed and
  documents its own TOCTOU: _"the synchronous `streamSSE` subscribe below runs before `await
session.submit`, so two requests passing this check in the same tick could still both proceed."_
- L5 F3 — run advancement has no owner in the DAG stack either: `WorkerLoopService.processOnce()`
  (`worker-loop-service.ts:73`) is a single _step_, so three consumers implement the loop differently —
  `dag-framework/src/runtime/worker-loop-driver.ts`, `adapters/prompt-backend.ts:228-268`
  (`MAX_PROCESS_ITERATIONS = 5000`), `local-dag-runtime-provider.ts:280-306`
  (`MAX_WORKER_ITERATIONS = 10_000`) — and two of them share one queue
  (`create-dag-framework.ts:126-129,132,171,185`), with `prompt-backend.ts:89`'s
  `void this.processRunUntilTerminal(...)` a floating promise on top.

**The cause in one sentence:** the layer that owns the `AbortController` (and the DAG layer that owns
the step) does not own the _unit of work_, so "is something running?" has no authoritative answer and
each consumer maintains a parallel, drifting one.

---

### 6. `running` is a terminal trap: the DAG subsystem has no crash-recovery path at the contract level

**Severity: BLOCKER.** Silent and permanent: a worker that dies mid-node leaves a task and its run
`running` forever, and on the one adapter that _does_ redeliver, recovery is guaranteed to fail.

**DEPTH: FOUNDATIONAL — `dag-core`.** **Layer: L5 only** (no other auditor's scope reaches it).

**Evidence** (L5 F1, four independent facts)

- `packages/dag-core/src/state-machines/task-run-state-machine.ts:23-34` — the transition table has
  no `running:RECLAIM`, no `running:EXPIRE`, no `running → queued` at all.
- `packages/dag-core/src/interfaces/ports.ts:89-117` — `IStoragePort` has no query that can _find_ a
  stale task.
- `packages/dag-core/src/types/domain.ts:186-187` — `ITaskRun.leaseOwner?` / `leaseUntil?` exist and
  **nothing ever writes them**; the sqlite adapter copies them at INSERT
  (`sqlite-storage-adapter.ts:245-246`) from a record that never has them set. Ghost columns.
- `ILeasePort.renew` (`ports.ts:80-84`) has **zero callers**; the worker acquires at
  `worker-loop-service.ts:84-88` and releases in `finally` at `:97`.

Traced consequence: `finalizeDagRunIfTerminal` (`dag-run-finalizer.ts:15,56`) treats `running` as
pending and returns early forever. On the in-memory queue the message _is_ redelivered
(`in-memory-queue-port.ts:71-82`) — and recovery still fails, because it hits `transitionToRunning`
(`worker-loop-service.ts:161`) → `transition('running','START')` → not in the table → error →
`failAfterAck` (`:119`) acks and drops it.

_Verified: the transition table is exactly the ten entries reported, with no `running → queued`;
`ILeasePort.renew` has callers only in `dag-adapters-local/src/__tests__/testing-ports.test.ts`._

**The cause in one sentence:** `dag-core` owns the state machine, the persistence port and the lease
port — the three things a recovery path needs — and none of them can express recovery, so the run
lifecycle is total on the happy path and silently partial on crash.

---

### 7. `ITransportAdapter` is a four-member lifecycle stub, so six transports have each grown a private dialect and nothing mechanical can see the drift

**Severity: BLOCKER.** Six packages; every other transport-layer finding (#2, #21, #28, #29 and the
registry deadlock) is a consequence. Blocks any new transport and any capability added to the session.

**DEPTH: FOUNDATIONAL.** **Layer: L3.** (L3 itself identifies #8 below as its root, so the two should
be sequenced together.)

**Evidence** (L3 F1)

- The entire shared contract is `packages/agent-interface-transport/src/transport-adapter.ts:7-12`:
  `{ readonly name; attach(session); start(); stop() }`. It says nothing about what of the session is
  exposed, admission, framing, cancellation or error shape.
- Every implementation therefore returns an intersection with its own extra surface, so no consumer
  can be polymorphic: `agent-transport-http/src/http-transport.ts:20` (`& { getApp(): Hono }`),
  `agent-transport-mcp/src/mcp-transport.ts:24` (`& { getServer(): Server }`),
  `agent-transport-ws/src/ws-transport.ts:20` (`& { onMessage }`),
  `agent-transport/src/headless/headless-transport.ts:22` (`& { getExitCode() }`).
- Measured drift on every omitted axis (L3's table): session surface, admission, in-flight-on-disconnect,
  error shape, cancellation verb — six transports, six answers. The capability gap is stated in the
  code and enforced nowhere: `agent-transport-http/src/routes.ts:5-6` — _"Exposes the core session
  methods (a subset; background-task, job-group, and execution-workspace methods are WS-only)."_
- `start()` does not even mean the same thing: `agent-transport/src/headless/headless-transport.ts:31-35`
  runs the entire prompt to completion inside `start()` and
  `agent-transport-tui/src/tui-transport.ts:24-26` blocks for the life of the UI, while
  `TransportRegistry.startAll` awaits each sequentially
  (`agent-transport/src/transport-registry.ts:62-68`) — registering either deadlocks everything behind it.

_Verified: `transport-adapter.ts` is exactly the four members quoted._

**The cause in one sentence:** the transport contract specifies lifecycle and nothing else, so
"implementing a transport" is an open-ended manual obligation with no parity check.

---

### 8. `IInteractiveSession` is a 40+-member god contract that nothing can implement, with 51 unchecked casts and no conformant test double

**Severity: HIGH.** Two layers. Blast radius is 8+ packages and 33 test files; it is the de-facto
transport contract (#7) and the edit-fan-out multiplier behind #7's drift.

**DEPTH: FOUNDATIONAL** — both reports agree.

**Layers that observed it: L0 (foundation, as a contract-quality and testability defect), L3
(transport, as the seam that makes transport parity impossible).**

**Evidence — both reports, both cited**

- L0 F7 — `packages/agent-interface-transport/src/session-contracts.ts:337-440`: one interface
  carrying submission, abort, queue control, shutdown, autonomous-goal lifecycle, execution state,
  message/context/cwd accessors, command execution and listing, event subscription, prompt resolution,
  background tasks (7 methods), job groups (4), workspace snapshots and agent jobs (5) — nine
  unrelated responsibilities. `rg "as unknown as IInteractiveSession|as IInteractiveSession"` returns
  **51 matches across 20+ test files in 8 packages** (`agent-transport`, `-ws`, `-http`, `-mcp`,
  `-tui`, `-protocol`, `-webrtc`, `agent-framework`, `agent-cli`), each with its own hand-rolled
  partial double (`createMockSession`, `createFakeSession`, `createStubSession`,
  `createEventDrivenMockSession`), none checked against the real implementation.
- L3 F3 — same interface at `:338-440`; adds the _optional-member_ consequence L0 only names:
  `isInitialized?` (`:337`), `getPendingCount?` (`:366`), `getActiveDriverId?` (`:368`), and the seam
  where it bites — `agent-transport-protocol/src/ws-session-events.ts:48`
  `session.getActiveDriverId?.() ?? undefined`, which silently loses **all** co-drive attribution with
  no error, no log, and no way to distinguish "no active driver" from "capability not implemented".
- L3 F3 also names the parallel defect in the command axis:
  `packages/agent-framework/src/command-api/host-context.ts:126-225` — `ICommandHostContext`, ~50
  members of which ~30 are optional, importing from eight framework subsystems (`:1-44`), so the
  "command contract" transitively couples every command to every subsystem.

_Verified: the cast count is exactly 51, across 33 files._

**The cause in one sentence:** one wide hand-mirrored interface stands in for a set of
capability-scoped ports, so nothing can implement it honestly and every consumer fabricates a private
approximation.

---

### 9. The `(preset, CLI args) → session options` projection chain has no owner: eleven assembly seams are unreachable and nine resolved preset fields are computed and discarded

**Severity: HIGH.** Two layers, two adjacent hops of one chain. Silent: three shipped "capabilities"
(guardrails, retrieval, effort) cannot fire in any shipped surface, and user-visible CLI flags are
parsed, validated, and dropped. Blocks the capability work that thinks it landed.

**DEPTH: FOUNDATIONAL** — both reports agree, and each names the _other's_ layer as contributing.

**Layers that observed it: L2 (assembly, the `ICreateSessionOptions` hop), L4 (product, the
`IResolvedPresetOptions` hop).**

**Evidence**

- L2 F4 — `runtime-host.ts:4-6` declares `buildRuntimeSession` the _single_ session-construction seam
  and `assemble-product.ts:177` delegates to it; the option surface is mapped **by hand** in
  `interactive/interactive-session-init.ts`. Eleven keys of `ICreateSessionOptions`
  (`assembly/create-session-types.ts`) are never set on that path: `sessionStore`,
  `promptForApproval`, `onCompact`, `compactInstructions`, `toolDescriptions`, `providerFactory`,
  `sessionFactory`, `additionalHookExecutors`, `guardrails`, `effort`, `retrievalAdapter`. Three are
  advertised capabilities: **`guardrails`** (SELFHOST-005, read only at `create-session.ts:147-161`),
  **`retrievalAdapter`** (SELFHOST-003, gates `CodebaseRetrieval` at `assemble-session-tools.ts:68` /
  `create-tools.ts:72-74`), **`effort`** (documented at `create-session-types.ts:172-177` as
  "Resolved from a preset's `effort` (PRESET-008)", applied at `create-session.ts:270`, carried by no
  field — so startup drops it while the in-session `/preset` switch applies it,
  `command-api/preset/preset-application.ts:91-95`).
- L4 F2 — `packages/agent-preset/src/preset-types.ts:32-79` defines `IResolvedPresetOptions` with 20
  fields and claims _"Every field maps to an existing agent-framework session/assembly seam"_.
  `agent-product/src/assemble-product.ts:143-150` overlays exactly **one**
  (`defaultPermissionMode`). The shell hand-writes the rest **four times**:
  `agent-cli/src/modes/print-mode.ts:105-145`, `modes/serve-mode.ts:94-126`, `cli.ts:449-501`,
  `agent-transport-tui/src/tui-session-options.ts:17-56`, with `render.tsx:102-143` a fifth reshaping
  hop and the same preset literal rebuilt three times inside `cli.ts` alone (`:374-387`, `:422-433`,
  `:492-500`). Nine resolved fields reach no session: `systemPrompt`, `appendSystemPrompt`,
  `language`, `effort`, `temperature`, `maxOutputTokens`, `defaultTrustLevel`, `allowedTools`,
  `deniedTools`. `--system-prompt`, `--append-system-prompt`, `--task-file` and `--json-schema` are
  dropped in interactive TUI mode while `cli-args.ts:124` advertises `robota --task-file task.md`.
- L2 F16 — `interactive-session-options.ts:42-158` vs `:187-275`: `IInitOptions` hand-duplicates ~40
  fields of `IInteractiveSessionStandardOptions`; L2 verified all 47 keys are currently referenced, so
  this is the same root with no live drop _today_.

_Verified: `guardrails` and `retrievalAdapter` have no production setter — every non-test hit is a
declaration or a consumption site. `resolvedPreset.<field>` in `agent-cli/src` resolves to exactly the
six fields L4 names (`agentName`, `enableParallelSubagents`, `model`, `permissionMode`, `persona`,
`selfVerification`), and `temperature`/`maxOutputTokens` appear nowhere in `agent-cli/src`._

**The cause in one sentence:** the mapping from resolved intent to session options is hand-written at
four sites and mechanically checked at none, so a field added anywhere in the chain is silently
dropped everywhere it was not remembered.

---

### 10. Cancellation is declared at four layers and honoured at none

**Severity: HIGH.** Three layers. Silent and destructive in one instance: aborting a turn during
auto-compaction still clears and rewrites the conversation history.

**DEPTH: FOUNDATIONAL** in all three reports.

**Layers that observed it: L0 (untyped abort), L1 (compaction), L5 (whole DAG stack).**

**Evidence**

- L0 F1 (also #3 above) — the abort has no type: `createAbortError()`
  (`execution-round-provider.ts:202-206`) is an unexported bare `Error` with a mutated `name`, so no
  consumer can `instanceof` it and three sites plus the framework copy
  (`interactive-session-execution.ts:46-52`) substring-match instead.
- L1 #7 — `packages/agent-session/src/compaction-orchestrator.ts:91-137`: `compact()` takes no
  `AbortSignal` and the provider call at `:118-129` passes only `{ model }`. After it returns,
  `session-history-ops.ts:49-75` does `clearHistory()` → `injectMessage(system)` →
  `injectMessage(assistant, '[Context Summary]…')`. `session-run.ts:113-130` invokes auto-compaction at
  the head of a turn with the turn's `abortSignal` in scope at `:106` and not passed. The rest of the
  package gets cancellation right (`session-run.ts:195-232`), which makes this an asymmetry rather
  than an omission.
- L5 F4 — declared at four levels, delivered at none:
  `dag-core/src/types/runtime-provider.ts:63` (`signal?: AbortSignal`) and `:132` (`cancelRun`);
  `dag-orchestration-client/src/orchestration-http-contracts.ts:213-265` — `IDagOrchestrationPort`
  has **no cancel method at all**, so the capability is dropped at that boundary;
  `dag-framework/src/http-dag-runtime-provider.ts:215-223` rejects honestly;
  `local-dag-runtime-provider.ts:110-114,281-283` sets a boolean and still runs `processOnce()` in the
  same iteration; `dag-runtime/src/services/run-cancel-service.ts:32-61` writes `dagRun.status` and
  nothing else; `dag-worker/src/services/worker-loop-service.ts:101-155` **never reads
  `dagRun.status`**, so a cancelled run's queued tasks run to completion;
  `dag-core/src/types/node-lifecycle.ts:13-23` — `INodeExecutionContext` carries no signal, so
  `INodeLifecycle.execute` is uncancellable by construction, which
  `dag-worker/src/services/task-timeout-executor.ts:32-34` states plainly as its own limitation.

**The cause in one sentence:** cancellation is modelled as an optional parameter on the outermost
contract rather than as a value threaded to the leaf that does the work, so each layer can accept the
signal and none can act on it.

---

### 11. The DAG's top-level "run a DAG" contract is typed on the imported system's file format, and the conversion is lossy in both directions

**Severity: BLOCKER.** The domain SSOT is bypassed at the one entry point that matters; the loss is
silent (fabricated ids, invented port keys, a status value outside its own union) and the packages
above document their workarounds in their own comments.

**DEPTH: FOUNDATIONAL — `dag-core`.** **Layer: L5.**

**Evidence** (L5 F2)

- `packages/dag-core/src/types/runtime-provider.ts:108-117` — `IDagRuntimeProvider.execute(dag:
IDagWorkflowFile, …)`, where `IDagWorkflowFile` (`types/workflow-file.ts:58-68`) is the foreign
  serialization: `last_node_id`, numeric node ids, `links: [number,number,number,number,number,string]`,
  `widgets_values`, `"Format version. Current: 0.4"`.
- `packages/dag-builder/src/dag-workflow-converter.ts` is not information-preserving: `:111`
  (`const portTypeStr = 'STRING'; // all ports are STRING-typed in workflow format`), `:253-254`
  (output/input keys **invented** as `out${i}`/`in${i}`), `:281`
  (`status: (companion?.status ?? 'active') as TDagDefinitionStatus` — **`'active'` is not a member of
  `TDagDefinitionStatus`**, `domain.ts:2`), `:207` (`node-${wfNode.id}` destroying string node ids).
- The workaround is written down above it:
  `packages/agent-command-workflows/src/authoring/execute-workflow.ts:29-31` and
  `persistence/instant-node-loader.ts:52-54,69-75` — the latter rebuilding a `node-<n> → <originalId>`
  map from a companion file produced purely to survive the round-trip.
- The round-trip is _pointless_ in every production path: the caller holds an `IDagDefinition`, calls
  `toDagWorkflowFile` (`execute-workflow.ts:31`), and the provider immediately calls
  `fromDagWorkflowFile` (`local-dag-runtime-provider.ts:107`, `http-dag-runtime-provider.ts:146`).

**The cause in one sentence:** an absorbed system's wire format was placed in the domain package and
then used as the execution contract, so the canonical model is serialized to a lossier one and back
between two callers who both already hold it.

---

### 12. The publish registry authorizes five packages that do not exist, omits thirteen that are publishable, and no scan reads it

**Severity: HIGH.** Supply-chain shaped: a document that is the _only_ gate on what may be published
under the org scope names five phantom packages as beta-published and has no mechanical floor at all.
I rank this above its sources' individual severities (V3 `high`, P3 `medium`) because the four
findings compose into "the publishing gate does not exist", which none of them says alone.

**DEPTH: doc-side + code-side pair** (CONFORMANCE's axis; no FOUNDATIONAL/LOCAL verdict was issued).

**Layer: CONFORMANCE.**

**Evidence**

- V3 — 13 publishable packages sit outside the registry that claims to gate publishing
  (`.agents/publish-registry.md:52`, `:6`): `agent-capability-pack`, `agent-process`, `agent-product`,
  `agent-provider-{anthropic,bytedance,defaults,gemini,openai,openai-compatible}`,
  `agent-remote-pairing`, `agent-transport-protocol`, `agent-transport-webrtc`, `pack-coding`.
  `grep -n "publish-registry" scripts/harness/*.mjs` returns **nothing** — the rule has no floor.
- P3 — `.agents/publish-registry.md:31-35` lists five `@robota-sdk/plugin-*` packages
  (`plugin-github`, `-jira`, `-linear`, `-notion`, `-slack`) as beta-published. None of the 86
  workspace manifests is named that.
- P2 — `:18` lists a consolidated `@robota-sdk/agent-provider` with subpaths; the repo's own SSOT
  (`.agents/project-structure.md:20`) says _"There is **NO** bare `agent-provider` package."_
- V4 — three packages the registry's Private table forbids publishing carry `"private": false`
  deliberately (`agent-executor`, `agent-interface-transport`, `agent-interface-tui`), and the
  registry lists `agent-executor` in _both_ tables (`:19` and `:41`).

**The cause in one sentence:** the publish gate is prose with no scan behind it, so it drifted in both
directions until it simultaneously under-authorizes real packages and authorizes imaginary ones.

---

### 13. Product identity (`.robota`, `.claude`, `AGENTS.md`, `robota-cli`, `/provider`) is hardcoded across four neutral library layers, and no neutrality scan covers the layers where it happens

**Severity: HIGH.** Four layers — the widest blast radius of any single invariant in the audit. Mostly
loud-on-adoption (a second product inherits `robota`'s directory names) but one instance is an outright
bug that misreports which config is in effect.

**DEPTH: FOUNDATIONAL** (L2); **LOCAL** (L3, L4) — and both are right: L4's CLI sites are locally
fixable, L2's `agent-framework`/`agent-preset` sites are not fixable from above.

**Layers that observed it: L1, L2, L3, L4.**

**Evidence**

- L2 F5 — `agent-framework/src/paths.ts:20,37`; `interactive/interactive-session-init.ts:105`;
  `assembly/create-session.ts:190-197` (allowlist literals `Read(.agents/**)`, `Read(.claude/**)`,
  `Read(.robota/**)`) and `:218`; `commands/skill-source.ts:157-161`;
  `plugins/marketplace-client.ts:87,201`; `utils/error-humanizer.ts:12,55` (model-facing text
  _"Run `/provider` … (`~/.robota/settings.json`)"_); `context/context-loader.ts:35-36`;
  `agent-preset/src/resolve-preset.ts:31` (`DEFAULT_AGENT_NAME = 'robota-cli'`);
  `load-external-presets.ts:18`. **The guard gap is verifiable:**
  `.agents/harness.config.json` `productShellDirs` is `["packages/agent-cli","apps/agent-web","apps/docs","apps/blog"]`
  and `scripts/harness/scan-composition-neutrality.mjs:9-22` covers only `agent-product` and
  `agent-capability-pack` — neither `agent-framework` nor `agent-preset` is covered by any neutrality
  scan.
- L4 L8 — the product rebuilds the same literal at
  `agent-cli/src/startup/diagnose-command.ts:132-133`, `startup/memory-enablement.ts:141`,
  `remote-control/host-identity.ts:41`, `remote-control/trusted-device-store.ts:46`. The diagnose site
  is an outright bug: `join(process.env['HOME'] ?? '', '.robota', 'settings.json')` — on Windows
  `HOME` is normally unset, so this becomes a **relative** path resolved against cwd, and the command
  whose entire job is reporting which configuration is in effect reports the wrong file. L4 also
  enumerates ten further `'.robota'` literals inside `agent-framework` itself
  (`agents/agent-definition-loader.ts:163,166`, `memory/project-memory-store.ts:66`,
  `memory/pending-memory-store.ts:20`, `update-check/update-check.ts:70`, `config/config-loader.ts:227`,
  plus L2's).
- L3 L9 — `agent-command/src/plugins/default-plugin-command-adapter.ts:1-2,30-33`: `execSync` plus
  `join(home,'.robota','plugins')` and `join(home,'.robota','settings.json')` baked into a library.
- L1 18h — `agent-session/src/session-store.ts:64`: library default path `~/.robota/sessions`.

**The cause in one sentence:** there is no injected product-identity/paths port, so every library that
needs the config root writes the product's name — and the neutrality scan was scoped to the two
packages that were already clean.

---

### 14. Vendor model knowledge lives in the vendor-neutral packages, and the wrong default is already reaching a consumer

**Severity: HIGH.** Two layers. Silent wrong answer: every non-Anthropic session tracks a 200k context
window regardless of the real one, and a `model: sonnet` alias is sent verbatim to a non-Anthropic
provider.

**DEPTH: FOUNDATIONAL** (L0); **LOCAL** (L2). Both are right for their own instance — L2's alias map
is fixable in place; L0's tables invert knowledge (the vendor package reads its own model list out of
the foundation) and are not.

**Layers that observed it: L0 (foundation), L2 (assembly).**

**Evidence**

- L0 F5 — `packages/agent-core/src/context/models.ts:1-102` (`CLAUDE_MODELS`),
  `src/context/model-pricing.ts:21-59` including regex vendor matching at `:50-59`
  (`/claude-opus/i`, `/gpt-4/i`, `/gemini-2/i`). This contradicts the package's own charter —
  `packages/agent-core/docs/SPEC.md` § _Boundaries_: _"Core must not branch on concrete provider names
  or model names"_ — while the same SPEC blesses it in § _Model Definitions (SSOT)_. Knowledge is
  **inverted**: `packages/agent-provider-anthropic/src/anthropic/provider-definition.ts:2,76` imports
  `CLAUDE_MODELS` _from_ the foundation and iterates it. The correct seam exists and is documented as
  correct and unused: `interfaces/provider-definition.ts:74-91` `IProviderModelCatalogEntry`. The wrong
  default is live: `models.ts:74-76` `getModelContextWindow` falls back to `DEFAULT_CONTEXT_WINDOW`
  (200 000), consumed at `packages/agent-session/src/context-window-tracker.ts:29`.
- L2 F10 — `agent-framework/src/assembly/create-subagent-session.ts:33-38`
  `MODEL_SHORTCUTS = { sonnet: 'claude-sonnet-4-6', haiku: 'claude-haiku-4-5', opus: 'claude-opus-4-6' }`,
  applied unconditionally at `:108-110`/`:169-171` with no reference to `options.provider.name`.

**The cause in one sentence:** vendor facts (model catalogues, prices, aliases) are owned by the
layers that must not know about vendors, so the correct per-provider catalog seam sits unused beside
a hardcoded table that is guaranteed to drift.

---

### 15. Every diagnostic `agent-core` emits is discarded by construction, and the same silence pattern recurs at three layers above

**Severity: HIGH.** Four layers observed the class. Silent by definition: the only record of a
swallowed failure goes nowhere, so a broken path is indistinguishable from a working one for the life
of the process. Directly violates AGENTS.md's "Silence is not success".

**DEPTH: FOUNDATIONAL** (L0); **LOCAL** (L1, L2, L4 instances).

**Layers that observed it: L0, L1, L2, L4.**

**Evidence**

- L0 F2 — `packages/agent-core/src/utils/logger.ts:85-93`: `ConsoleLogger` never writes to a console;
  it forwards to an injected sink that defaults to `SilentLogger` (`:90-93`).
  `createLogger(packageName, logger?)` is the only way to supply one, and **no call site in the repo
  passes it** — there is no global sink setter either, so a consumer cannot turn them on. That
  silences 157 `logger.*` calls in `agent-core` alone, including the only trace of swallowed failures:
  `src/plugins/event-emitter-helpers.ts:77-85`, `src/utils/periodic-task.ts:22-27`,
  `src/core/robota-initializer.ts:166`, `src/services/execution-round-streaming.ts:132` (#3's provider
  failure). The level knob is dead _and_ global: `robota.ts:97-100` mutates `setGlobalLogLevel`
  process-wide from the constructor.
- L1 #16 — `session-run.ts:188-193` logs **every** text delta and `session-logger.ts:82-101` answers
  with a blocking `appendFileSync` per streamed token, wrapped in `catch { }` at `:98-100`.
- L1 18a — `agent-executor/src/subagents/worktree-subagent-runner.ts:238`
  `void runHooks(...).catch(() => undefined)`: `WorktreeCreate`/`WorktreeRemove` hook failures are
  invisible and the result is discarded before the worktree is used.
- L2 F12 — `agent-framework/src/interactive/interactive-session-init.ts:107-122` `} catch { // No
plugins dir or load failed }` — a malformed plugin bundle means the user's hooks silently do not
  run, and the comment conflates a normal case with an error. No `allow-fallback:` marker, unlike
  sibling degradations in the same layer (`runtime-host.ts:63,67`).
- L4 L11 — `apps/agent-server/src/routes/handlers/playground-session-submit.ts` uses raw
  `console.log('[SSE] …')` while its sibling modules use `createLogger`.

_Verified: 37 `createLogger(` call sites exist; the only match for `createLogger\([^)]*,` is the
declaration itself at `logger.ts:183`._

**The cause in one sentence:** the diagnostic sink is an un-settable constructor parameter defaulting
to a no-op, so the foundation's error reporting is off by construction and every layer above learned to
swallow instead.

---

### 16. Permission policy is a hardcoded product tool-name matrix with no extension seam, and an unknown tool's deny is silently dropped

**Severity: HIGH.** Security-relevant and silent: a `MyTool(secrets/**)` **deny** pattern never
matches, and evaluation falls through to `UNKNOWN_TOOL_FALLBACK` = `'approve'` in `default` and
`acceptEdits` modes. Single layer, but it is the security kernel.

**DEPTH: FOUNDATIONAL.** **Layer: L0.**

**Evidence** (L0 F4)

- `packages/agent-core/src/permissions/permission-mode.ts:16-107` — a file headed _"Permission mode
  definitions for Robota CLI"_ in the zero-dependency foundation, enumerating `TKnownToolName`
  (`'Shell' | 'Bash' | 'Read' | 'Write' | 'Edit' | 'Glob' | 'Grep' | 'WebFetch' | 'WebSearch' |
'AskUserQuestion' | 'ComputerView' | 'Computer'`) and `MODE_POLICY` keyed on it.
- `packages/agent-core/src/permissions/permission-gate.ts:76-91` hardcodes each tool's argument
  schema in a `switch` with `default: return undefined`.
- The two owners can drift silently: tool names are declared in `agent-tools` as plain string
  literals with no type link (`builtins/read-tool.ts:176`, `builtins/shell-tool.ts:247`,
  `computer-use/computer-tool.ts:189`) — nothing couples the classified set to the produced set.

  **WITHDRAWN, on review of this record (#1591):** this entry claimed _"drift already exists — `'Bash'`
  is in the L0 matrix and no such tool is produced anywhere in `packages/`"_. That is false.
  `packages/agent-tools/src/builtins/shell-tool.ts:253-255` defines `createBashTool()` →
  `createHostShellTool('Bash', options)`, exported at `src/index.ts:104` with a `bashTool` singleton
  at `:261`, and `src/__tests__/shell-tool.test.ts:11` asserts the name — a deliberate model-familiar
  alias. The missing coupling is real; the instance offered as proof that it has already bitten was
  not, and is struck rather than replaced with another unverified one.

- The same package already contains the correct pattern, which makes this an inconsistency rather
  than an unknown: `packages/agent-core/src/interfaces/role-model.ts:1-13` deliberately uses an opaque
  `string` key with the reasoning for rejecting a fixed union written down.

**The cause in one sentence:** risk classification is owned by a name table two layers below the tools
it names, instead of being declared by each tool, so a tool the table does not know about is
unprotectable and defaults to approve.

---

### 17. `apps/agent-server` forks the shared session bridge and has re-grown three bugs the shared package already fixed; a Node server depends on a React UI package for the wire types

**Severity: HIGH.** Observed, not predicted, regression: a leak, a missing teardown, a missing
concurrency guard and an unhandled write failure, all fixed upstream and all absent in the fork. Also
inverts a dependency the conformance gate cannot see.

**DEPTH: FOUNDATIONAL** (the wire protocol has no contract owner, so a UI package became one).
**Layer: L4.**

**Evidence** (L4 F3)

- The repo declares one bridge (`.agents/project-structure.md:26`;
  `agent-transport-protocol/src/ws-protocol.ts:30-57,:60-100+`). Four surfaces share it. Two do not:
  `packages/agent-playground/src/lib/playground/websocket-client/constants.ts:1-6` defines a second WS
  protocol (`playground_update`/`auth`/`ping`/`pong`) with its own reconnect/backoff state machine, and
  `apps/agent-server/src/routes/handlers/playground-session-submit.ts` defines a third, SSE.
- The measured cost, comparing `agent-transport-http/src/routes.ts` with the fork:
  client disconnect — `stream.onAbort(() => { session.abort(); resolve(); })` at `routes.ts:95-98`
  vs **none** in the fork, so an abandoned SSE request leaks **seven** session listeners permanently
  (`playground-session-submit.ts:150-163` registers; `cleanup()` is unreachable);
  teardown — `finally { for (const fn of cleanup) fn(); }` at `routes.ts:104-108` vs none;
  concurrent submit — `409` at `routes.ts:52-54` vs none, so two concurrent submits cross-subscribe
  and interleave both clients' events; SSE write failure — awaited + `.catch()` at `routes.ts:66-70`
  vs a bare `res.write(...)`.
- The inverted edge: `apps/agent-server/src/websocket-server.ts:6-9` imports
  `IPlaygroundWebSocketMessage` from `@robota-sdk/agent-playground`, a real manifest edge at
  `apps/agent-server/package.json:41` — a Node server depending on a React package that pulls
  `monaco-editor`, `@xyflow/react`, `dagre` and fifteen `@radix-ui/*`. The conformance gate passes
  because no rule forbids `apps/* → packages/*` (see #19).

**The cause in one sentence:** the playground session's wire vocabulary has no contract owner, so the
UI package became one and the server forked the bridge rather than depending on it.

---

### 18. One concern implemented N times; the fix applied N−1 times

**Severity: HIGH.** Five layers. Each instance is individually medium, but together they are a
structural property: this repo reliably ships two implementations of one concern and then patches one
of them. One instance is a security fix.

**DEPTH: FOUNDATIONAL** for the ones where no owner exists (L1 #6, L1 #9, L5 F9, L5 F14); **LOCAL**
for the rest.

**Layers that observed it: L0, L1, L3, L4, L5.**

**Instances (each with its own evidence)**

- **L1 #6 — the PATH-hijack fix landed in one of two shell-spawn implementations.**
  `agent-executor/src/background-tasks/runners/managed-shell-process-runner.ts:61-83` documents the
  defect and its fix (bare `sh` looked up in a caller-controlled `PATH`; hardcoded POSIX `-c`). Its
  sibling in the same directory, `runners/scheduled-task-runner.ts:171-177`, still has all three
  ingredients: `const shell = state.request.shell ?? 'sh'; spawn(shell, ['-c', command], { env: {
...process.env, ...(state.request.env ?? {}) } })`. `agent-core`'s `resolvePlatformShell()` is the
  stated SSOT, used by the other runner and by `agent-tools/src/builtins/shell-tool.ts:115` — three
  spawn sites, two use it.
- **L1 #9 — the OpenAI Responses API is implemented twice** in packages that already share a seam.
  `agent-provider-openai` depends on `agent-provider-openai-compatible` and imports its `shared/`
  module at 7 sites, so Chat Completions has one owner; the Responses API has parallel files
  (`openai/responses-{parser,chat,converter,stream-utils}.ts` vs `qwen/responses-*`), whose
  whitespace-insensitive parser diff is 312 lines over ~300 and is overwhelmingly identifier renaming.
- **L5 F9 — task dispatch implemented twice, diverged.**
  `dag-runtime/src/services/entry-task-dispatcher.ts:76-119` vs
  `dag-worker/src/services/downstream-task-dispatcher.ts:75-161`. Node timeout is honoured downstream
  (`:111-113`) and silently dropped for entry nodes (`entry-task-dispatcher.ts:101` is just
  `payload: input`), so `IDagNode.timeoutMs` has no effect on any run's first node. Message-id schemes
  differ (`${taskRunId}:message` vs `:message:1` vs `:message:${nextAttempt}`).
- **L5 F12(a) — byte-identical duplication.** `dag-nodes/gemini-image-edit/src/image-output-normalizer.ts`
  and `dag-nodes/text-to-image/src/image-output-normalizer.ts` are 140 lines each and diff clean
  except five error-code literals; `seedance-video/src/video-output-normalizer.ts` is the same shape.
  `parseCsv`/`resolveModel` are triplicated
  (`gemini-image-edit/src/runtime-helpers.ts:36,70`, `text-to-image/src/runtime-core.ts:28,41`,
  `seedance-video/src/runtime-core.ts:36,46`) — and `dag-node` already owns this
  (`src/value-objects/media-reference.ts`, `src/lifecycle/binary-value-parser.ts`).
- **L5 F14 — `dag-projection` and `dag-api` define the same six projection view types twice**
  (`projection-read-model-service.ts:12-48` vs `controller-service-ports.ts:76-112`); they compile
  together only because TypeScript is structural.
- **L5 F15 — two `dag_*` MCP tool surfaces** (`dag-mcp-server/src/tool-definitions.ts`, 29 tools;
  `dag-cli/src/mcp/tool-definitions.ts`, 26) in one flat namespace with three exact-name collisions
  (`dag_nodes_list`, `dag_build`, `dag_validate`) that are **not the same tool**. Plus a fifth run
  store: `dag-cli/src/run-store.ts` opens `.dag/runs.db` via `node:sqlite` through `createRequire` —
  a _different driver_ from `dag-adapters-sqlite`'s `better-sqlite3` — with `status` as bare `TEXT`.
- **L3 L4 — duplicated and mutually contradictory protocol knowledge in `agent-remote-client`:**
  `src/client/request-handler-simple.ts:23-60` encodes the same two endpoints a second time and
  **disagrees** (`url: '/chat/stream'` at `:47-48` vs `` `${baseUrl}/stream` `` at
  `chat-http-methods.ts:174`), has no production importer, and carries a 270-line green test suite
  certifying the wrong encoding.
- **L4 L6 — `apps/agent-app` reimplements a weaker `killProcessTree`.**
  `electron/sidecar.ts:139-144` is `kill('SIGTERM')` + a timer to `kill('SIGKILL')`;
  `packages/agent-process/src/kill-process.ts:74-118` exists for exactly this and additionally kills
  the _tree_, swallows ESRCH, and resolves on the real `exit` event. On Windows the reimplementation
  does not terminate descendants at all, so `apps/agent-app/docs/SPEC.md:101` ("no orphaned `robota`
  process") is not delivered there.
- **L0 F15 — the SIGTERM→grace→SIGKILL policy and its 2000 ms constant exist twice**
  (`agent-process/src/kill-process.ts:14`, `agent-testing/src/pty/spawn-pty.ts:32,:179-191`);
  deliberate and documented (zero-dep charter), noted rather than argued.

**The cause in one sentence:** in each case "who owns this concern" was never decided, so two sites
implemented it and a later fix reached only the one whose bug was found.

---

### 19. The mechanical guards are blind exactly where the defects are — and the green conformance result is being read as evidence about things it does not check

**Severity: HIGH.** Six of seven reports independently hit a case where a real edge, a real violation
or a real drift is invisible to the harness. This is what makes every other finding in this document
able to regress silently, so it blocks the durability of every fix below.

**DEPTH: mixed** — L4 marks its instance LOCAL ("mechanical-guard coverage, not a design defect
today"); CONFORMANCE treats the same fact as an UNDOCUMENTED code→doc gap. I read it as
**FOUNDATIONAL for the harness**: the rules cannot be made true by editing the packages they fail to
observe.

**Layers that observed it: L1, L2, L3, L4, L5, CONFORMANCE.**

**Instances**

- **Exact duplicate across two reports — `agent-cli` is exempt from every direction rule by
  construction.** L4 L15 and CONFORMANCE U5 report the same fact from opposite sides:
  `packages/agent-cli/package.json` declares all workspace edges as `devDependencies` (deliberate,
  INFRA-028), so `edges.txt:14` reads `@robota-sdk/agent-cli -> (none)` and
  `scripts/harness/check-dependency-direction.mjs` builds its rules from `pkg.dependencies` only
  (`:76`, used by `checkBidirectionalDeps:96`, `checkForbiddenProductionDeps:151`,
  `checkCoreZeroDeps:172`, `:199`, `:227`). Only `checkFullGraphCycles` reads `allDependencies`
  (`:649`). Every `agent-cli → …` edge drawn in three architecture diagrams is unverifiable against
  the stated ground truth. _Verified: 0 production `@robota-sdk` deps, 23 devDeps._
- **CONFORMANCE U4 — a shipped, build-order-significant edge is declared nowhere at all.**
  `packages/agent-cli/package.json:41` runs `pnpm --filter @robota-sdk/agent-cli-web build && node
scripts/copy-web-assets.mjs && tsdown`, and `@robota-sdk/agent-cli-web` appears in **none** of the
  four dependency sections. _Verified._
- **L2 F5 — the neutrality scan covers only the two packages that were already clean**
  (`scan-composition-neutrality.mjs:9-22`), not `agent-framework` or `agent-preset` where the
  violations are (#13).
- **L4 F3 — the inverted `apps/agent-server → packages/agent-playground` edge passes** because no
  rule forbids `apps/* → packages/*` (#17).
- **L1 #14 — `agent-provider-replay → agent-session` passes** because the gate does not forbid
  L1↔L1 edges; a _provider_ pulls in the whole session runtime to read an event-name enum.
- **CONFORMANCE V1 — the single most important conformance divergence is uncaught:**
  `packages/dag-framework/docs/SPEC.md:238` states _"`dag-framework` MUST NOT import `@robota-sdk/agent-*`
  packages"_ while `package.json` declares `@robota-sdk/agent-core` in **`dependencies`** and
  `src/types.ts:12` + `src/load-default-node-registry.ts:2` import it. `harness:conformance` has no
  `dag-* → agent-*` rule. _Verified: the production dependency is present._
- **CONFORMANCE V3 — no scan reads `.agents/publish-registry.md`** (#12).
- **L3 F1 — no transport-parity scan exists**; the repo has `check-command-layering.mjs` for the
  command axis and nothing equivalent for transports.
- **L5 — the DAG "layers" have no ordering invariant at all.**
  `check-dependency-direction.mjs` encodes exactly two DAG rules (`checkDagNodesLeaf` at `:263ff`,
  the `dag-nodes-default` allowlist at `:306ff`); `conformance.txt`'s green result is evidence about
  node leaf-ness and says nothing about whether the eleven mid packages are layered. L5's structural
  verdict: they are not — they are a two-level hub-and-spoke antichain (only one non-`dag-core` edge
  exists among the eleven, `dag-scheduler → dag-runtime`, and that package has zero consumers).
- **L0 F6 / L4 F1 — the browser artifact has no build-time `node:` assertion**, so #4 regresses
  silently.

**The cause in one sentence:** the guards were written against the manifests' `dependencies` field and
a fixed list of packages, so any real coupling expressed some other way — a devDependency, a build
script, an `apps/` edge, an intra-tier edge, a doc rule with no scan — is invisible, and `conformant:
true` is being read far outside what it covers.

---

### 20. Declared-but-unreachable capabilities: eleven assembly seams, three shipped features, a dead foreign-API vertical inside the domain SSOT, and a dead package

**Severity: HIGH.** Five layers. The cost is not the dead code, it is that the dead code _reads as
load-bearing_: a tested `DlqReinjectService` and a 401-line `DagPromptBackend` look shipped, and three
SELFHOST capabilities are recorded as delivered while unable to fire.

**DEPTH: FOUNDATIONAL** for the seam gaps (L2 F4, L5 F11, L1 #10); **LOCAL** for the rest.

**Layers that observed it: L0, L1, L2, L3, L5.**

**Instances**

- L2 F4 — the eleven unreachable `ICreateSessionOptions` seams, including `guardrails`,
  `retrievalAdapter` and `effort` (detailed in #9). Also `computerDriver`
  (`create-tools.ts:51`) never forwarded by `assemble-session-tools.ts:63-69`.
- L5 F11 — **an entire foreign-API vertical slice is dead and it lives inside the SSOT domain
  package.** `dag-core/src/types/prompt-types.ts` (138 lines, _"derived from OpenAPI spec"_) defines
  the absorbed system's HTTP surface verbatim (`partial_execution_targets:41`, `IQueueStatus:61-64`,
  `ISystemStats{vram_total,vram_free}:115-127`). `PromptApiController`
  (`dag-api/src/controllers/prompt-api-controller.ts:14`) is exported and never instantiated;
  `DagPromptBackend` (401 src + 711 test lines) is constructed on every `createDagFramework()` call
  and exposed only via `internals.promptBackend`, which no consumer reads. Its adapter cannot satisfy
  the contract honestly: `getQueue()` (`:159-167`) always returns empty, `manageQueue(_action)`
  (`:169-171`) returns `{ok:true}` and does nothing, `getSystemStats()` (`:207-226`) reports
  `os.totalmem()` as `vram_total`.
- L5 F10 — the DLQ reinject Noop (see #3).
- L5 F13 — `dag-scheduler` has zero consumers in the monorepo, couples to a concrete
  `RunOrchestratorService` class (`scheduler-trigger-service.ts:11,58`) while
  `dag-api/src/ports/controller-service-ports.ts:55-57` already defines the exact minimal port.
- L5 F8 step 3 — **seven of thirty** `IDagOrchestrationPort` methods (the whole cost-meta family)
  return `notImplementedResponse` in the in-process adapter
  (`dag-framework/src/adapters/orchestration-adapter.ts:290-323`), while
  `dag-mcp-server/src/tool-definitions.ts:89-135` publishes seven matching `dag_cost_meta_*` tools.
- L3 L1 — `get-usage-report`/`usage_report` is an orphan protocol variant: declared at
  `agent-transport-protocol/src/ws-protocol.ts:37-38,:81-85`, matched by **none** of the five
  predicates in `ws-handler.ts:127-152`, so it falls to `:123-124`
  `send({ type: 'protocol_error', message: 'Unknown message type: …' })`. Nothing sends it, the GUI
  reducer has no case, the SPEC never mentions it — and it is "proved" by a type-only test (#34).
- L3 L6 — the transport registry's settings-backed options are dead end to end: `getAll()` resolves
  `{transport, config}` (`transport-registry.ts:30-36`), `getEnabled()` **maps the config away**
  (`:38-42`), `startAll()` never applies options (`:62-68`), `setOptions()` (`:53-60`) has no caller,
  and `IConfigurableTransport.validateOptions?` (`transport-config.ts:16`) is implemented by three
  transports and called by nothing. So `WsTransport.optionsSchema`
  (`ws-transport-configurable.ts:94-101`) advertises a `port` option the registry header documents
  (`transport-registry.ts:4-5`) and that has no effect.
- L3 L5 — `TuiTransport` satisfies the interface while inverting its meaning:
  `tui-transport.ts:20-30` — `attach(_session)` discards the session ("creates its own
  InteractiveSession internally"), `stop()` does nothing. Registered in a `TransportRegistry`,
  `startAll(session)` would report success while serving a different session.
- L1 #10 — MCP has two incompatible config contracts (`agent-core/src/interfaces/tool-integration.ts:45-58`
  `IMCPToolConfig` vs `agent-tool-mcp/src/mcp-protocol.ts:15-21` `IMCPConfig`; `auth.token` vs
  `apiKey`), so the port in `agent-core` describes an MCP tool nobody builds; and `MCPTool.disconnect()`
  (`mcp-tool.ts:198-213`) has zero callers because `ITool` has no disposal member.
- L1 #17 — `SubagentManager.wait()` (`subagents/subagent-manager.ts:38-41`) drops the `usage` that
  `toBackgroundResult` at `:233-241` was explicitly plumbed to carry.
- L0 F13 — `ErrorUtils.fromUnknown` (`errors.ts:287-301`) misclassifies every foreign error as
  `ConfigurationError` (`category: 'user'`, `recoverable: false`) and drops the original object; its
  only call sites are its own tests.
- L4 L10 — `open@^11` is a declared runtime dependency of `agent-cli`, never imported, with a weaker
  hand-rolled equivalent at `modes/serve-monitor-ui.ts:176-191` that mis-handles Windows `start <url>`
  quoting.

**The cause in one sentence:** these seams and features were declared in a type or a registry without
a construction path or a caller, and nothing mechanically asserts that a declared extension point is
reachable from the seam the product actually builds through.

---

### 21. Closed product-feature unions in the neutral contract package, and `ICommandResult` carries its failure only as English

**Severity: HIGH.** Two layers. The extension seam is at the wrong end of the graph: a third-party
command needing any host effect must patch the most stable package in the repo _and_ the framework.

**DEPTH: FOUNDATIONAL** — both agree. **Severity disagreement:** L0 rated it `medium`, L3 rated it
`high`. I take L3's: L3 supplied the missing argument (the repo's own _Command module isolation_ rule
requires command packages to consume framework interfaces "like third-party modules", which this makes
impossible) and L0 did not.

**Layers that observed it: L0 (foundation, contract hygiene), L3 (command/transport, extensibility).**

**Evidence**

- `packages/agent-interface-transport/src/command-contracts.ts:113-122` — `TCommandHostAction`
  enumerates `provider-hot-swap`, `language-change`, `settings-reset`, `session-exit`,
  `session-restart`, `session-rename`, `statusline-settings-patch`, `remote-control-enable`,
  `remote-control-stop`; `:131-135` — `TCommandUiIntent` enumerates `show-plugin-manager`,
  `show-settings`, `show-session-picker`, `show-agent-switcher`. (L3's line numbers. L0 cited
  `:172-183` and `:191-196` for the same declarations — **those line numbers are wrong**; see
  § Disagreements. The content L0 quotes is correct.)
- `agent-interface-transport` depends only on `agent-core`, while the features it names are owned
  above it — `remote-control-*` is implemented at
  `agent-command/src/remote-control/remote-control-command.ts:102` and wired in
  `agent-cli/src/remote-control/`. The dispatcher is a matching closed switch at
  `agent-framework/src/interactive/interactive-session-host-actions.ts:111-188`.
- L0 F11 adds two related defects in the same file that L3 does not raise:
  **`ICommand` is a god-DTO** (`:21-60`) mixing command identity, skill-file metadata
  (`skillContent`, `argumentHint`, `allowedTools`, `model`, `effort`, `context`, `agent`), plugin
  packaging (`pluginDir`) and a function-valued `execute?`, all optional — while the wire projection
  `ICommandListEntry` (`:154-162`) is correctly narrow, showing the split was understood and
  half-applied. And **`ICommandResult` (`:141-152`) is a boolean-plus-prose envelope**
  (`{ message: string; success: boolean; data?: Record<string, unknown> }`) that crosses the transport
  boundary, so a remote surface receives a failure it cannot classify, retry-qualify or localise.
- The correct pattern for the fix already exists and is exemplary:
  `interactive-session-host-actions.ts:53-61` `missingCapabilityFailure` turns an unwired adapter into
  an explicit failure naming the missing capability — never a silent skip.

_Verified: `TCommandHostAction` is at `:113`, `TCommandUiIntent` at `:131`, `ICommandResult` at
`:141-152`, `ICommand` at `:21`; the file is 199 lines long._

**The cause in one sentence:** the extension point for host effects is a closed union in the graph's
most stable package rather than a registry the contributing package writes into.

---

### 22. Module-level singletons and shared mutable state in packages whose own documents claim the opposite

**Severity: HIGH.** Three layers. Silent cross-contamination: one session's tool spans published on
another session's bus, one agent's log level applied process-wide, a subagent's construction
re-pointing the parent's server-tool logging.

**DEPTH: FOUNDATIONAL** in all three reports.

**Layers that observed it: L0, L1, L2.**

**Evidence**

- L0 F8 — `packages/agent-core/docs/SPEC.md` § _Dependency Injection_ states _"No global singletons
  exist. Each `Robota` instance is completely independent."_ Three contradictions: `LoggerConfig` is
  an explicit `private static instance` singleton (`utils/logger.ts:56-70`) that the **`Robota`
  constructor mutates** (`robota.ts:99-100`), so constructing agent A with `logging.level: 'debug'`
  changes the level for every already-constructed agent B — in a runtime whose headline feature is
  multi-agent orchestration; `DEFAULT_ABSTRACT_EVENT_SERVICE` (`event-service.ts:62`) is one shared
  instance with a mutable `listeners: Set<…>` at `:26` whose `emit` is a no-op, so a subscription is
  both shared and silently never delivered; and `Robota`'s constructor `new`s six collaborators
  directly (`robota.ts:102-107`), leaving no seam — which forces the workaround
  `vi.mock('@robota-sdk/agent-core', …)` in
  `agent-framework/src/interactive/__tests__/interactive-session-bare.test.ts:61-74` and at least four
  other framework test files.
- L1 #5 — ten built-in tools are instantiated at import time and exported
  (`agent-tools/src/builtins/{shell-tool.ts:258,:261, read-tool.ts:188, write-tool.ts:74,
edit-tool.ts:140, glob-tool.ts:164, grep-tool.ts:203, web-fetch-tool.ts:233, web-search-tool.ts:88,
ask-user-question-tool.ts:169}`, re-exported at `index.ts:104-122`). The consumer _knows_ —
  `agent-framework/src/assembly/create-tools.ts:63-65`: _"SEC-007: built per call, NOT the
  module-level singletons. A singleton is context-free by construction…"_ — and then at `:68-69`
  registers two singletons anyway (`webFetchTool`, `webSearchTool`). Two verified consequences:
  `web-search-tool.ts:75-88` binds `createBraveSearchProvider()` at module load and
  `ICreateDefaultToolsOptions` (`create-tools.ts:41-52`) has no way to reach the `IWebSearchProvider`
  port that `createWebSearchTool({provider})` honours; and `FunctionTool.setEventService`
  (`agent-core/src/tool-registry/function-tool.ts:50-52`) mutates `this.eventService`, so a singleton
  registered in two concurrent sessions has its event bus overwritten by whichever wired last.
- L1 #4 — providers keep per-call streaming state as **public instance fields**
  (`agent-provider-gemini/src/gemini/provider.ts:39`, `anthropic/provider.ts:60`,
  `openai-compatible/deepseek/provider.ts:51`, `qwen/provider.ts:38`), and the session fights it in a
  block that labels itself a workaround — `agent-session/src/session-run.ts:117-129`: _"This
  workaround stays until provider packages remove the instance-level onTextDelta property."_
  `session-lifecycle.ts:34-40` and `session.ts:268-273` both _assign_ it, and
  `in-process-subagent-runner.ts:134-139` passes the **parent's provider instance** into
  `createSubagentSession`, so constructing a subagent re-points the parent session's server-tool
  logging at the subagent's log. Last writer wins; there is no owner.
- L2 F6 — `agent-preset/src/resolve-preset.ts:46` `const externalPresets: IPreset[] = []` is a
  module global mutated by `registerExternalPresets` (`:76-95`), disconnected from the
  instance-scoped `createPresetRegistry` (`:211-226`) that `assembleProduct` actually uses
  (`assemble-product.ts:118`) — and the instance one drops collisions **silently** (`continue`,
  `continue`) while the global one reports them.

**The cause in one sentence:** context-dependent state (log level, event bus, streaming callback,
preset registry) is stored on module-level or static objects, so every "independent" instance shares it
and the last constructor wins.

---

### 23. `IStoragePort` is a kitchen-sink port with no atomicity, so the default adapter is durable for one aggregate and volatile for the other two — while three documents say otherwise

**Severity: HIGH.** Silent total loss of run state in the default composition, and an idempotency
invariant no adapter can enforce. Single layer, but it is the DAG persistence kernel.

**DEPTH: FOUNDATIONAL — `dag-core`.** **Layer: L5.**

**Evidence** (L5 F5)

- `dag-core/src/interfaces/ports.ts:89-117` — one interface, 17 methods, three unrelated aggregates
  (definitions, runs, tasks), no compare-and-set, no conditional insert, no transaction scope.
- `create-dag-framework.ts:101` defaults storage to `new FileStoragePort(storageRoot)`, and
  `dag-adapters-local/src/file-storage-port.ts:28-29` holds `dagRuns` and `taskRuns` in **process-local
  `Map`s** (`createDagRun:137-139`, `createTaskRun:177-179`, mutations through `:259`), while
  definitions are written atomically (`saveDefinitionAtomically:51-59`, tmp-file + rename). The class
  named `FileStoragePort` is file-backed for one of its three aggregates, and is fully conformant to
  the type. Two documents assert the opposite: `dag-adapters-local/docs/SPEC.md:29` and
  `dag-core/docs/SPEC.md:466`.
- Idempotency is a TOCTOU with no backstop: `dag-runtime/src/services/run-orchestrator-service.ts:101-135`
  does `getDagRunByRunKey` then `createDagRun`, and `dag-adapters-sqlite/src/migrations.ts:36`
  provides only `CREATE INDEX … ON dag_runs(run_key)` — **an index, not a UNIQUE constraint**. Three
  adapters give three behaviours for one call: `Map.set` silently overwrites; SQLite throws on
  duplicate `dag_run_id`.

**The cause in one sentence:** one port covering three aggregates with only unconditional reads and
writes cannot express durability or atomicity, so each adapter answers those questions differently and
none of the answers is checkable.

---

### 24. Two `IQueuePort` adapters disagree on visibility-timeout semantics; the contract never specified them and no shared conformance suite exists

**Severity: HIGH.** Directly compounds #6: a crashed worker's task is permanently lost on the SQLite
adapter, whose own class doc claims the opposite. Single layer, but it is the clearest instance in the
corpus of the invariant behind #7, #8 and #23.

**DEPTH: FOUNDATIONAL — `dag-core`.** **Layer: L5.**

**Evidence** (L5 F6)

- `dag-adapters-local/src/in-memory-queue-port.ts:71-82` reclaims expired in-flight messages.
- `dag-adapters-sqlite/src/sqlite-queue-adapter.ts:99-105` — `SELECT * FROM task_queue WHERE
in_flight = 0 AND visible_after <= ?` — a row set to `in_flight = 1` at `:112` is **excluded by the
  predicate forever**, while the class doc at `:35` states _"Supports visibility timeouts via a
  `visible_after` epoch-ms column."_ It records the deadline and never acts on it.
- The contract is silent: `dag-core/src/interfaces/ports.ts:53-62` documents nothing about redelivery,
  and `dag-core/docs/SPEC.md:227` specifies only the waiting half. Secondary divergences follow:
  duplicate `messageId` is a silent duplicate push in memory (`:20`) and a PRIMARY KEY violation in
  SQLite (`:76`); FIFO is insertion-ordered in memory (`shift()`, `:56`) but `ORDER BY visible_after
ASC` with no tiebreaker in SQLite.
- **No shared adapter conformance suite exists** — the two adapters' tests are independent, so nothing
  forces them to agree. (Mitigating: `dag-adapters-sqlite` has zero consumers, which is also why this
  survived.)

**The cause in one sentence:** the queue contract specifies the happy path and leaves redelivery,
duplicate handling and ordering unstated, so each adapter invented an answer and nothing compares them.

---

### 25. `IDagOrchestrationPort` is declared "transport-neutral" and returns an HTTP envelope; the in-process adapter fabricates status codes and answers 501 to seven of thirty methods

**Severity: HIGH.** Inverted dependency direction (the domain adapter owns the transport's
representation), untyped payloads forcing casts at every consumer, and the largest single fix in the
corpus (30 methods × 2 adapters × ~40 call sites).

**DEPTH: FOUNDATIONAL — `dag-orchestration-client`.** **Layer: L5.**

**Evidence** (L5 F8)

- `dag-orchestration-client/src/orchestration-http-contracts.ts:210-212` — the doc comment is attached
  to `IDagOrchestrationPort` and tells the reader to prefer it _over itself_ (a stale reference to a
  renamed sibling).
- All 30 methods return `IDagOrchestrationHttpResponse` (`:49-53`) = `{ ok; status: number;
payload }`, where `IDagOrchestrationHttpPayload` (`:43-47`) extends an open index signature — so
  every response is effectively untyped and every consumer casts:
  `http-dag-runtime-provider.ts:133,151,190,202,209`.
- The non-HTTP adapter impersonates HTTP: `dag-framework/src/adapters/orchestration-adapter.ts:66`
  (`status: 501`), `:68` (`instance: 'inproc://dag-framework'`), hand-written 200/400/404 at
  `:165-178,436-443,503-558,635-648`, and `:290-323` returns `notImplementedResponse` for the whole
  cost-meta family.
- The real HTTP server is reduced to a relay: `apps/dag-runtime-server/src/app.ts:23-25`
  `return c.json(response.payload, response.status as ContentfulStatusCode);`

**The cause in one sentence:** the transport's representation was pushed inward to the innermost
adapter, so the "transport-neutral" port is an HTTP contract that only one of its two adapters can
speak.

---

### 26. `dag-core` — the declared SSOT — owns three graph models, three node-catalog contracts and three run-status vocabularies

**Severity: HIGH.** A reader cannot tell which of three "the DAG" types is the DAG; two converters
emit incompatible encodings of the same concept; the package's own `TResult` discipline is broken by
its own top-level result type.

**DEPTH: FOUNDATIONAL — `dag-core`.** **Layer: L5.**

**Evidence** (L5 F7)

- Three graph representations: `IDagDefinition` (`types/domain.ts:153-162`, string ids, camelCase),
  `IDagWorkflowFile` (`types/workflow-file.ts:58-68`, numeric ids, 6-tuple links, snake_case),
  `TPrompt`/`IPromptNodeDef` (`types/prompt-types.ts:13-20`, inline `[sourceNodeId, slotIndex]`
  tuples) — against `dag-core/docs/SPEC.md:5,42`'s claim that _"Every domain type is defined exactly
  once in this package."_
- Three node-catalog contracts: `INodeManifest` (`domain.ts:79-89`), `INodeObjectInfo`/`TObjectInfo`
  (`prompt-types.ts:96-111`), `IDagNodeManifest` (`runtime-provider.ts:29-41`) — with two converters
  that disagree on the same field: `prompt-backend.ts:286-340` emits raw `'string'`/`'number'`;
  `local-dag-runtime-provider.ts:316-364` emits `'STRING'`/`'FLOAT'`/`'IMAGE'`.
- Three status vocabularies: `TDagRunStatus` (`domain.ts:47`), `TRunPhase`
  (`runtime-provider.ts:75` — `completed` where the domain says `success`, no `created`), and two
  progress event vocabularies (`runtime-provider.ts:51` vs `run-progress.ts:5-11`) translated ad hoc
  at `local-dag-runtime-provider.ts:236-263`.
- `IDagRuntimeResult` (`runtime-provider.ts:67-72`) is `{ ok: boolean; error?: string }` — outside
  the `TResult` taxonomy the same package declares at `SPEC.md:37`.

**The cause in one sentence:** the absorbed system's wire model was merged into the domain package
rather than kept beside it, so the SSOT is the union of two vocabularies and neither owns the other.

---

### 27. `agent-remote-client`'s streaming path posts to an endpoint the server does not expose and drops the `Authorization` header; the tests mock `fetch` and assert neither

**Severity: HIGH.** Two defects on one call path, both invisible to a green test suite — the clearest
single instance of accidental-green in the corpus.

**DEPTH: LOCAL.** **Layer: L3.**

**Evidence** (L3 L3)

- Auth dropped: the executor builds `Authorization: Bearer ${config.userApiKey}`
  (`src/client/remote-executor-simple.ts:93-99`); the non-streaming path forwards them
  (`chat-http-methods.ts:88-96`, used at `http-client.ts:77-85`); `executeChatStreamRequest`
  (`chat-http-methods.ts:167-174`) has **no `headers` parameter** and its `fetch` sends only
  `{'Content-Type': 'application/json'}` (`:186-192`); `http-client.ts:96-105` calls it without them.
- Endpoint does not exist: `chat-http-methods.ts:174` targets `` `${baseUrl}/stream` ``; the only
  consumer sets `baseUrl = …/api/v1/remote`
  (`agent-playground/src/lib/playground/robota-executor/remote-providers.ts:6-8,16`), and
  `apps/agent-server/src/app.ts` exposes `/api/v1/remote/health` (`:112`), `/remote/chat` (`:115`),
  `/byok/chat` (`:142`), `/remote/ws/status` (`:206`) — no `/stream`.
- The suite cannot see either: `src/client/__tests__/http-client-chat.test.ts:271-310` stubs `fetch`
  and asserts only the decoded chunks — never the URL, never the headers (the fixture at `:21` sets
  `Authorization: 'Bearer test-key'` and no assertion reads it back).

**The cause in one sentence:** the client owns its request construction and its test mocks the
transport at the point that would have observed it, so neither the route nor the credential is checked
by anything.

---

### 28. The GUI discards the transport's entire error channel, including a `protocol_error` the client deliberately synthesizes "to surface it via the normal path"

**Severity: HIGH.** A server-side turn failure reaches the browser and vanishes; the user sees a stuck
spinner. The contrast is what makes it severe: the transport layer built an explicit no-silent-drop
result type and the consumer drops it on the floor.

**DEPTH: LOCAL.** **Layer: L3.**

**Evidence** (L3 L2)

- `agent-transport-gui/src/client/ws-session-client.ts:64-75` synthesizes
  `{ type: 'protocol_error', message: 'Malformed message from server (invalid JSON)' }` with the
  comment _"Surface it via the normal path."_
- "The normal path" is `agent-transport-gui/src/hooks/useSessionClient.ts:111-216` — a
  `switch (msg.type)` with cases for `messages`, `user_message`, `text_delta`, `thinking`,
  `tool_start`, `tool_end`, `execution_workspace_event`, the three prompt events, `ui_intent`,
  `session_renamed`, `history_cleared`, `complete`, `interrupted`, **and no `default`**. No case for
  `protocol_error`, `error`, `resume_gap`, `command_result`, `executing`, `pending`, `context` or
  `background_*`. A grep across `agent-transport-gui`, `-webrtc-web` and `agent-cli-web` finds
  `protocol_error` only at the synthesis site.
- The server does emit real failures there: `agent-transport-protocol/src/ws-session-events.ts:62-63`.
- The seam is correct and honoured on the transport side: `TChannelReceiveResult`
  (`agent-interface-transport/src/channel-contracts.ts:111-118`) exists precisely so a frame is never
  a silent drop, and `ws-transport-configurable.ts:265-266` honours it.

**The cause in one sentence:** a `switch` over an open protocol union with no `default` branch turns
every message variant the GUI has not yet implemented into silence.

---

### 29. `CodeExecutor` fabricates compilation, initialization and health-check progress and returns canned model responses — on a published package's public surface

**Severity: HIGH.** Execution claims with no runtime behind them, reachable by any consumer of the
package. Breaks `.agents/project-structure.md:115` (_"Execution claims require runtime evidence"_)
directly.

**DEPTH: LOCAL.** **Layer: L4.**

**Evidence** (L4 L3, plus L4 L5 as the same pattern in the UI)

- `packages/agent-playground/src/lib/playground/code-executor.ts:100-118` pushes
  `'🔨 Compiling agent...'` → `simulateDelay(DELAY_COMPILE_MS)` → `'✅ Compilation successful'` →
  `'🚀 Initializing agent...'` → `'🧪 Running health checks...'` → `'✅ All systems operational'`,
  where `simulateDelay` is `setTimeout` (`:262-264`). There is no compiler, no initialization and no
  health check.
- `sendMessage()` (`:215-221`) never contacts a model; `generateAgentResponse` (`:236-259`) picks at
  random from five hardcoded strings with keyword branches on `'time'` and `'weather'`.
- It is on the **public surface**: `src/index.ts` → `./playground` → `export * from './services'`
  (`src/playground/index.ts:3`) → `export * from '../../lib/playground/code-executor'`
  (`src/playground/services/index.ts:13`).
- Same pattern in the exported component: `use-send-message.ts:36-42` substitutes
  `simulateAgentResponse` (a 1–3 s wait returning a random entry from `SIMULATED_AGENT_RESPONSES`,
  `simulated-response.ts:6-14`, `constants.ts:7-13`) when the optional `onSendMessage` prop
  (`chat-interface/types.ts:20`) is absent, rendered identically to a real assistant message; the
  `catch` discards the error entirely and shows a fixed string.
- Related, same package: `remote-injection-sandbox.ts` is headed _"Sandbox environment for secure
  playground code execution"_ and executes user code with `new Function(...)` (`:78-80`), whose bodies
  run in the **global** scope — `window`, `document`, `localStorage`, `eval` and dynamic `import()`
  are all reachable, and the `process.env` stub at `:51-57` seeding `OPENAI_API_KEY:
'playground-mock-key'` reads as protection while shadowing one name (L4 L4).

**The cause in one sentence:** a demo path was written into the real class on the real export surface
instead of a separately named, explicitly opted-into demo implementation.

---

### 30. Ports shaped like exactly one concrete implementation, so substituting an implementation is impossible or requires a cast

**Severity: MEDIUM-HIGH.** Three layers. The widest-blast-radius _fix_ in the corpus (L0 F10 is
flagged by its own author as the item to sequence last), and the direct cause of at least one
reimplementation (#18's `killProcessTree`).

**DEPTH: FOUNDATIONAL** (L0, L2); the L4 instance is a secondary note on a LOCAL finding.

**Layers that observed it: L0, L2, L4.**

**Evidence**

- L0 F10 — `packages/agent-core/src/interfaces/file-system.ts:15-41`: `IFileSystem` mirrors `node:fs`
  member-for-member including Node's naming, Node's `BufferEncoding` global and Node's
  `constants.F_OK`. A port shaped like one implementation is not a port: any non-Node adapter must
  emulate Node semantics _including throwing the right `ENOENT`_, which callers already string-match
  (`agent-framework/src/user-local/memory.ts:210`). The same package ships a **parallel**
  `IFileSystemAsync` (`:29-41`) over an overlapping but different operation set. The sync-only choice
  propagates into `IInteractiveSessionStore`
  (`agent-interface-transport/src/session-contracts.ts:549-555`, `save/load/list/delete` all
  synchronous), implemented over `IFileSystem` at
  `agent-framework/src/interactive/session-persistence.ts:35-49` — so no database, remote host, or
  IndexedDB store can implement it without lying about durability.
- L2 F2 — `packages/agent-capability-pack/src/capability-pack-types.ts:41` types the additive tool
  axis as `readonly FunctionTool[]` — a **class** with a `private` member
  (`agent-core/src/tool-registry/function-tool.ts:27-30`), which makes the type nominal, so **a tool
  written against the published `AbstractTool` extension point cannot be contributed by a capability
  pack.** The kernel papers over it with an unchecked assertion:
  `agent-product/src/assemble-product.ts:74-77` `...(materials.tools as readonly
IToolWithEventService[])`, required because `IFunctionTool`
  (`agent-core/src/interfaces/tool.ts:200-203`) does not declare `setEventService` even though the
  class implements it. The contract is simultaneously too narrow for third parties and too wide to
  type-check.
- L4 L6 (secondary) — `killProcessTree` is typed on the concrete `node:child_process` `ChildProcess`,
  which is _why_ `apps/agent-app/electron/sidecar.ts:103-106` invented a narrow `ISupervisedChild`
  interface and then reimplemented the function to stay testable.

**The cause in one sentence:** these "ports" were extracted by copying one implementation's shape
instead of describing the capability, so the only thing that satisfies them is the implementation they
were copied from.

---

### 31. Architecture documents describe a package decomposition the repo abandoned

**Severity: MEDIUM-HIGH.** Twenty-six doc-side findings; a reader following the prescribed reading
order learns a repository that does not exist, and three shipped things (the product-assembly tier,
`packages/agent-cli-web`, the `/remote` route) appear in no map at all. Loud once noticed, but it is
what makes onboarding and every future placement decision unreliable.

**DEPTH: doc-side** (CONFORMANCE's axis). **Layer: CONFORMANCE.**

**Evidence — the phantom family, condensed**

- **P1** — `.agents/specs/command-inventory.md:20-43` names **18 packages**
  (`@robota-sdk/agent-command-{agent,background,session,compact,…}`) that do not exist; they are
  directories inside the single `packages/agent-command` and `ICommandModule.id` values, not npm
  packages. Also self-inconsistent with `project-structure.md:17`.
- **P4/U2** — `apps/agent-web-monitor` was dissolved by GUI-007 and still appears in **six** live
  architecture documents (`repository-overview.md:15`, `dependency-direction.md:15,54,55`,
  `agent-system.md:141,155` marked status "landed", `apps-and-deployment.md:39,44,49`,
  `transport-architecture.md:27,28,88`, `agent-cli/composition-tree.md:141`) — while its replacement,
  `packages/agent-cli-web`, appears in **zero** `.agents/specs/` documents.
- **P5/U1** — `apps/agent-web/docs/SPEC.md:28-31,60,97` documents a `/monitor` route and a
  `MonitorClient.tsx` that do not exist (the only broken `src/…` path among **391** checked), while
  the real `/remote` route (`apps/agent-web/src/app/remote/page.tsx`) and the
  `agent-transport-webrtc-web` production dependency are documented nowhere.
- **U3** — the entire ARCH-005 product-assembly tier (`agent-product`, `agent-capability-pack`,
  `pack-*`) — the repo's single deliberate carve-out from its strongest assembly prohibition
  (`project-structure.md:133`) — is in **no** family table, **no** layer diagram and **no**
  capability-placement row.
- **D1/D2** — the `agent-command` module inventory is stale in both directions (`model` documented
  and absent; `default`, `editor`, `goal`, `plan`, `preset`, `remote-control`, `schedule`, `shell`
  present and undocumented), and `command-inventory.md` is missing 9 of the shipped commands while
  `cross-cutting-contracts.md:47` routes ownership questions to it.
- **D3** — the Layered Assembly diagram (`project-structure.md:93-108`) claims an ordering the
  manifests do not have: no package in the row above `agent-executor` depends on it, and the diagram
  omits `agent-interface-transport` (17 dependents), `agent-interface-tui` and `agent-process`.
- Plus P6–P11, D4–D8, U6–U7 (see CONFORMANCE for each).

**Same invariant, seen inside the packages by the layer auditors** — the SPEC blesses the violation:
`packages/agent-core/docs/SPEC.md` forbids branching on model names in § Boundaries and blesses it in
§ Model Definitions (L0 F5, #14); claims "No global singletons exist" (L0 F8, #22); states a
Cancellation Contract the code breaks in both directions (L0 F1, #3);
`dag-adapters-local/docs/SPEC.md:29` and `dag-core/docs/SPEC.md:466` both assert `FileStoragePort`
persists runs (L5 F5, #23); `dag-core/docs/SPEC.md:316-317` documents two error codes the source never
emits and omits ~16 it does (L5 F16); `apps/action/docs/SPEC.md` still describes the removed
`execSync` design in three places, _"so a reader following the SPEC would reintroduce the
vulnerability"_ (L4 L9); `agent-transport-{http,mcp}/docs/SPEC.md` omit the projected surface, the
omitted capabilities and the absent trust model (L3 L12);
`agent-framework/src/commands/command-module-selection.ts:9-10` invites re-creating a duplication that
was already removed (L2 F14); `agent-cli/src/product/robota-plumbing.ts:65-68` describes an open
localhost path that SEC-001 closed (L3 L11).

**The cause in one sentence:** the architecture documents are hand-maintained prose with no scan
tying any of their claims to the manifests or the source, so they record the decomposition that was
planned rather than the one that shipped.

---

### 32. Contract packages take runtime dependencies on the things they are supposed to be independent of

**Severity: MEDIUM.** Two layers. Installing a "pure contract" package installs a 30-subsystem,
~22.5k-LOC framework; a provider package pulls in the whole session runtime to read an enum.

**DEPTH: FOUNDATIONAL** in both reports.

**Layers that observed it: L1, L2.**

**Evidence**

- L2 F13 — `agent-capability-pack/src/capability-pack-types.ts:2,:26` and
  `agent-preset/src/preset-types.ts:1` + `index.ts:3` import contract types from
  `@robota-sdk/agent-framework` and declare it under **`dependencies`** (not `peer`, not `dev`). L2
  enumerates what that framework is by non-test LOC: `interactive 5842 | command-api 2495 | context
1667 | assembly 1486 | plugins 1352 | memory 1237 | commands 1058 | tools 1021 | background-tasks
917 | checkpoints 698 | user-local 674 | orchestration 636 | config 610 | testing 600 | evals 435
| …` — thirty reasons to change, against a charter of "command contracts, common APIs,
  session/tool/provider composition". A concrete fragility follows:
  `preset-types.ts:26` derives `TPresetPermissionMode` by indexed access from a 53-field interface, so
  a change to that field's union silently changes `agent-preset`'s published type.
- L1 #14 — `agent-provider-replay → agent-session` (manifest edge) exists purely to obtain
  `SESSION_LOG_EVENT` and `ISessionLogLine` (`replay-provider.ts:13,16`), against the repo's own
  Interface Package Rule (`.agents/project-structure.md:263-283`). Compounding: the substrate is
  documented as _"keyed deterministically: a `provider_request` (executionId + round) is answered by
  its recorded `provider_response_normalized`"_ (`session-log-events.ts:10-14`) while
  `replay-provider.ts:46-61` is a **positional cursor**, so any divergence in call order silently
  replays the wrong recorded response — defeating the purpose of a determinism harness.

**The cause in one sentence:** the shared contract types were never extracted into a types-only
package, so every consumer of a contract takes a dependency on its implementer.

---

### 33. Verification-honesty failures: tests that certify what is not there

**Severity: MEDIUM.** Four layers. Each is individually small; together they are why several of the
findings above survived — the suite is green and the capability is absent.

**DEPTH: LOCAL** in all sources.

**Layers that observed it: L2, L3, L4, L5.**

**Instances**

- L3 L1 — `agent-transport-protocol/src/__tests__/usage-report-carrier.test.ts:9-11` claims _"this
  test proves the carrier … actually reaches the GUI — not assumed 'free'"_, while the body
  constructs a literal, JSON-round-trips it (`:50`, `:66`) and asserts
  `{ type: 'get-usage-report' } as const` has type `'get-usage-report'` (`:75-76`). It exercises no
  handler, no transport and no GUI, for a variant no handler accepts (#20).
- L3 L3 — the stream tests that assert neither URL nor headers (#27).
- L2 F4 — `assembly/__tests__/computer-use-enforcement.test.ts:1-24` constructs `createComputerTool`
  directly and wraps it with `PermissionEnforcer` rather than exercising the assembled path, while
  `computerDriver` is never forwarded by `assemble-session-tools.ts:63-69`.
- L2 F11 — `agent-product/src/__tests__/assemble-product.test.ts` exercises only standard-branch
  inputs (`:193,211,315,333`); the branch that silently drops pack tools and pack subagents
  (`assemble-product.ts:53-62`) is unexercised.
- L5 F10 — `DlqReinjectService` is exercised only by its own unit test against mocks
  (`dlq-reinject-service.test.ts:50,78`); the assembled product runs the Noop (#3).
- L5 F6 — the two `IQueuePort` adapters are tested only against themselves (#24).
- L4 L14 — `packages/agent-cli-web/package.json` defines **no `test` script**, alone among the eight
  product-layer units, so `pnpm -r test` covers none of it — including the `ws-url` meta-tag contract
  with `serve-monitor-ui.ts`'s `injectWsUrl`, the seam that makes the CLI-served monitor work.

**The cause in one sentence:** these tests assert the shape of a value or the behaviour of a directly
constructed object rather than driving the assembled path, so they pass whether or not the capability
is wired.

---

### 34. Initialization that cannot fail cleanly, and resources that grow without bound

**Severity: MEDIUM.** Two layers each. Unhandled rejections, sessions that are live-but-broken, and
unbounded memory on the paths explicitly designed to run forever.

**DEPTH: FOUNDATIONAL** (L2 F8, L1 #11); LOCAL for the rest.

**Layers that observed it: L1, L2, L4.**

**Evidence**

- L2 F8 — `agent-framework/src/interactive/interactive-session.ts:347-354` starts
  `this.initPromise = this.initializeAsync(stdOpts)` with no `try`/`catch`; `initializeAsync`
  (`:356-385`) does real fallible work (config load, context load, project detection, sandbox restore,
  plugin merge, `createSession` which throws on a missing provider at `create-session.ts:94-98`); the
  promise is awaited only lazily by the `protected` `ensureInitialized` (`:387-389`), and the only
  public readback is a boolean getter (`:608`). `buildRuntimeSession` (`runtime-host.ts:28-30`) and
  `assembleProduct`'s `buildRuntime` (`assemble-product.ts:177`) both return synchronously — so a
  consumer that builds and does not immediately submit gets an unhandled rejection, and one that does
  submit gets the init error from an unrelated call.
- L4 L6 — `apps/agent-app/electron/main.ts:78` spawns with **no `'error'` listener**; on ENOENT (the
  documented dev path) Node emits `'error'`, not `'exit'`, and an unhandled `'error'` on a
  ChildProcess **throws** — so `SidecarSupervisor` never reaches `fatal`, the UI never shows _"The
  agent process stopped"_, and the main process dies. `main.ts:109`
  `app.whenReady().then(createWindow)` has no `.catch`.
- L4 L7 — `--serve` installs none of the process guards
  (`agent-cli/src/process-guards.ts:1-15`, applied at `cli.ts:441` on the TUI branch only), so a
  transient unhandled rejection kills the sidecar and every attached surface, while the identical
  failure in the TUI is rendered into the transcript and the session continues. Two sibling
  presentations over the same `buildRuntimeSession` runtime, no document stating the intent.
- L1 #11 — `agent-executor/src/background-tasks/log-pages.ts:49-55` appends every byte of child
  stdout/stderr with no cap and no ring buffer, fed by both runners
  (`managed-shell-process-runner.ts:228-241`, `scheduled-task-runner.ts:198-208`), while the separate
  `createLimitedOutputCapture` (`log-pages.ts:18-47`) caps only the 30 KB result payload. It matters
  specifically because FLOW-004 monitor processes (`managed-shell-process-runner.ts:46-59`) are
  _designed_ to run indefinitely. `IBackgroundTaskHandle.readLog` (`background-tasks/types.ts:96`)
  specifies a paging cursor and no retention policy.
- L1 18f — `agent-session/src/session.ts:68,227-263` destroys the agent on `shutdown()` and never
  clears the session-owned `eventService` listeners.
- L4 F3 — the seven leaked session listeners per abandoned SSE request (#17).

**The cause in one sentence:** construction is synchronous while initialization is asynchronous and
unobservable, and the contracts that hand out long-lived handles specify how to read them but not how
much they may retain.

---

### 35. Residual local items (grouped; each is contained, each is small)

**Severity: MEDIUM to LOW. DEPTH: LOCAL** unless noted.

- **L0** — F12: `agent-core` throws **127 bare `new Error(...)`** (`event-service.ts:77-117`,
  `robota-config-manager.ts:112,279,290`, `robota-initializer.ts:98`,
  `executors/local-executor.ts:89,93,119`, `execution-service-helpers.ts:226,245`) despite owning a
  13-class `RobotaError` taxonomy (`utils/errors.ts:28-258`), so `ErrorUtils.getErrorCode` returns
  `'UNKNOWN_ERROR'` for the foundation's own errors. F9 (**medium, FOUNDATIONAL**): `ITerminalOutput`
  (`interfaces/terminal-output.ts:1-19`) is a fat presentation port in the zero-dep foundation with
  every member mandatory, so implementers fake capabilities silently
  (`agent-transport/src/headless/print-terminal.ts:20-22,54-56` — `writeMarkdown` writes raw,
  `spinner` returns a no-op) and it is a _second_ "ask the user" seam competing with
  `IUserInteraction.ask`, which `interaction.ts:67-76` and `interaction-contracts.ts:35-40` both call
  "the sole seam"; plus two banned pass-through re-exports (`agent-framework/src/types.ts:14`,
  `agent-session/src/permission-enforcer.ts:36`). F3 (**high, FOUNDATIONAL**):
  `TActionResponse.cancelled` (`interfaces/interaction.ts:58-65`) collapses five outcomes —
  user dismissed (`PendingActionPrompt.tsx:43`), no renderer, model-invoked refusal
  (`user-interaction-port.ts:24-27`), fail-closed timer (`session-prompt-registry.ts:51-53`), no
  queued answer (`ProgrammaticInteractionChannel.ts:44-47`). F14: `pairing.ts:107-108` cites `SEC-003`
  (superseded); the live owner is `SEC-007`.
- **L1** — #8 (FOUNDATIONAL): `runHooks` computes and returns `blocked` for every event
  (`agent-core/src/hooks/hook-runner.ts:136-179`) and L1 honours it at exactly one of three awaited
  seams (`tool-hook-helpers.ts:69`); `session-run.ts:135-158` reads only `stdout` and
  `compaction-orchestrator.ts:107-112` does not even bind the result. #12: `ISessionStore.load`
  collapses "missing" and "corrupt" into `undefined` (`session-store.ts:38-45,:116-128,:141-149`).
  #13: three owners for "how many tokens did this session use"
  (`agent-core/src/services/execution-usage.ts:20-38`, `agent-session/src/session-base.ts:167-179`,
  `agent-session-analytics/src/usage.ts:90-183`) over two substrates with two field vocabularies.
  #15: the declared session-log SSOT is used by one writer and has already drifted
  (`'session_shutdown_step_error'` at `session.ts:235` is absent from `SESSION_LOG_EVENT`).
  18b/c/d/g: raw `setInterval` bypassing the `startPeriodicTask` SSOT
  (`webhook-queue.ts:46`); `ensureConnection` polling a mutable field 50×100 ms instead of awaiting a
  shared promise (`mcp-tool.ts:151-173`); `Object.create(tool)` shadowing `setEventService`
  (`permission-enforcer.ts:93-97,202-208`); `cancel()` resolving with a freshly constructed,
  always-empty capture (`scheduled-task-runner.ts:114-118`).
- **L2** — F7 (FOUNDATIONAL): the composition **order** is specified in the kernel
  (`merge-capability-packs.ts:23-26`) and implemented in the shell
  (`agent-cli/src/product/robota-plumbing.ts:117-130`), so every product must re-implement the preset
  command-module delta. F9: `interactive-session.ts:181-187` mutates the caller's options object and
  unconditionally overwrites two declared consumer seams (`permissionHandler`, `askHandler`).
  F11: the injected-session branch (`assemble-product.ts:53-62`) silently drops pack tools and pack
  subagents. F15: a documented "PURE, IO-free fold" invokes `profile.transports()`
  (`assemble-product.ts:170-175`).
- **L3** — L8: `agent-transport-tui/src/command-output-summary.ts:5` hardcodes
  `new Set(['Shell','Bash','BackgroundProcess'])` and JSON-parses `IToolState.toolResultData`
  (`session-contracts.ts:93`), an untyped **display** field. L13: `payload-channels.ts:124-127` fans
  every outbound frame to all sinks and `receive(bytes)` (`:90-122`) carries no sender identity, so
  any registered channel is inherently all-to-all under multi-surface co-drive.
- **L4** — L12: `apps/agent-web` uses **jest** while every other unit uses vitest; committed
  `apps/agent-web/.agents/evals/lessons/*` duplicate the repo-root SSOT; a dead
  `src/lib/crypto-browser.ts` beside the `.js` the config resolves. L13: `agent-playground`'s manifest
  carries `"private": true` **and** `publishConfig`/`files`/`prepublishOnly`. L16: `--serve --open`
  shutdown awaits `server.close()` alone, so an idle keep-alive connection delays teardown on every
  SIGTERM. L9: `apps/action` runs `using: 'node20'` (`action.yml:31`) against the CLI's
  `"engines": {"node": ">=22.0.0"}`, exposes a provider-blind `api-key` bound to
  `ANTHROPIC_API_KEY` only (`index.ts:17`), and emits an unpinned `npx --yes @robota-sdk/agent-cli`.
- **L5** — F16: the declared error-taxonomy SSOT has drifted (two documented codes the source never
  emits; ~16 emitted codes absent). F17's seven polish items, notably: `ILeasePort.renew`/`get` have
  zero callers while `leaseDurationMs: 30_000` and `LOCAL_DEFAULT_TIMEOUT_MS: 300_000`
  (`local-dag-runtime-provider.ts:50,52`) mean the lease expires four minutes before a long task
  finishes and nothing notices; `node-lifecycle-runner.ts:77-105` swallows dispose failures on every
  error path while escalating the same failure on the success path;
  `worker-loop-service.ts:209,254` hardcode `'running'` rather than re-reading the status, so a
  concurrent writer would be silently overwritten.

---

## Cross-cutting themes

Each theme states the invariant being violated in one sentence, then lists its instances. A finding
can appear under more than one theme; the ranked-list number is given for each.

### T1 — A failure contract that destroys the failure

**Invariant: a result type must be able to represent every outcome its operation can produce, and a
failure must survive the boundary with its class, cause and category intact.**

| Instance                                                                       | Layers | Rank | Severity |
| ------------------------------------------------------------------------------ | ------ | ---- | -------- |
| Provider error rendered to prose and re-parsed; abort classified by substring  | L0     | #3   | blocker  |
| Tool crash / permission denial / hook block all `success: true`                | L1     | #3   | high     |
| DLQ reinject Noop returns `ok:true, reinjected:false`                          | L5     | #3   | high     |
| `dag-scheduler` `partialError` inside an `ok:true`                             | L5     | #3   | medium   |
| `manageQueue` returns `{ok:true}` and does nothing                             | L5     | #20  | medium   |
| Cancel reports success while the work continues                                | L5     | #10  | high     |
| `ICommandResult` = boolean + English, across the transport boundary            | L0     | #21  | medium   |
| `ISessionStore.load` collapses missing and corrupt into `undefined`            | L1     | #35  | medium   |
| `TActionResponse.cancelled` collapses five distinct outcomes                   | L0     | #35  | high     |
| `IDagRuntimeResult` = `{ok: boolean; error?: string}` outside its own taxonomy | L5     | #26  | high     |
| `agent-core` throws 127 untyped `Error`s despite owning a taxonomy             | L0     | #35  | medium   |
| `ErrorUtils.fromUnknown` maps every foreign error to `ConfigurationError`      | L0     | #20  | low      |

### T2 — An extension point that exists in the type system and nowhere else

**Invariant: a declared seam must be reachable from the construction path the product actually uses,
and a capability that cannot fire must not be recorded as delivered.**

| Instance                                                                                                                             | Layers | Rank     |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------ | -------- |
| 11 `ICreateSessionOptions` seams unreachable, incl. `guardrails`/`retrievalAdapter`/`effort`                                         | L2     | #9, #20  |
| 9 resolved preset fields computed and dropped; 4 CLI flags parsed and ignored                                                        | L4     | #9       |
| `get-usage-report`/`usage_report` declared, unhandled, unproduced, "proved" by a type-only test                                      | L3     | #20, #33 |
| Transport registry options: schema, validator, setter — none reach a transport                                                       | L3     | #20      |
| The whole prompt/foreign-API vertical inside `dag-core`; `PromptApiController` never instantiated                                    | L5     | #20      |
| `dag-scheduler`: a published package no product composes                                                                             | L5     | #20      |
| 7 of 30 `IDagOrchestrationPort` methods answered 501, with 7 matching published MCP tools                                            | L5     | #25, #20 |
| `IMCPToolConfig` describes an MCP tool nobody builds; `disconnect()` has no caller                                                   | L1     | #20      |
| ~~`MODE_POLICY` names `'Bash'`, a tool no package produces~~ — WITHDRAWN (#1591): `createBashTool()` exists and is exported; see #16 | L0     | #16      |
| `ILeasePort.renew` — zero callers; `leaseOwner`/`leaseUntil` — ghost columns                                                         | L5     | #6, #35  |
| `IWorkspaceLayout` exists in `dag-core` and is never threaded into the execution context                                             | L5     | #1       |
| `IProviderModelCatalogEntry` — documented as the correct SSOT for cost, unused                                                       | L0     | #14      |
| `open@^11` declared and never imported                                                                                               | L4     | #20      |

### T3 — A trust boundary that is documentation rather than code

**Invariant: an admission or containment decision must be enforced by a mechanism the contract
requires, not by a convention each implementation may or may not follow.**

| Instance                                                                                | Layers | Rank |
| --------------------------------------------------------------------------------------- | ------ | ---- |
| HTTP and MCP have no admission gate; WebRTC insecure-by-default vs WS secure-by-default | L3     | #2   |
| MCP strips `modelInvocable`/`safety` and attributes remote calls as `'user'`            | L3     | #2   |
| `agent-server` WS: format-only JWT fallback; token never bound to the claimed identity  | L4     | #2   |
| `/api/v1/remote/chat`: unauthenticated proxy over the operator's provider keys          | L4     | #2   |
| `checkPathWithinCwd` returns "allowed" when `cwd` is `undefined` — fail-open default    | L1, L2 | #1   |
| Child-process subagent worker builds tools with no `cwd`; guard disarmed                | L2     | #1   |
| `skill` DAG node takes its containment root from the LLM-authorable `.dag.json`         | L5     | #1   |
| `UNKNOWN_TOOL_FALLBACK = 'approve'`; a deny on an unknown tool never matches            | L0     | #16  |
| `createPlaygroundSandbox` named a sandbox, executes `new Function` in global scope      | L4     | #29  |
| The PATH-hijack fix landed in one of two shell-spawn implementations                    | L1     | #18  |

### T4 — One concern, two owners; the fix reaches one of them

**Invariant: every fact and every mechanism has exactly one owner, and a second implementation of it
is a defect even when both copies are currently correct.**

Instances: #18 in full (shell spawn ×3, Responses API ×2, task dispatch ×2, media normalizers ×3,
projection view types ×2, MCP tool surfaces ×2 + 5 run stores, `agent-remote-client` protocol ×2,
kill-grace ×2, `killProcessTree` ×2), plus: three token-usage reducers (L1 #13, #35); three graph
models / three status vocabularies in `dag-core` (L5, #26); two MCP config contracts (L1, #20); the
`.robota` literal at 14+ sites (#13); `CLAUDE_MODELS` + `MODEL_SHORTCUTS` (#14); two preset registries
(#22); the `DEFAULT_TOOL_DESCRIPTIONS` constant that forces `pack-coding` to mirror
`createDefaultTools()` by name (L2 F3, below).

### T5 — Context-dependent state stored where it cannot be scoped

**Invariant: state whose correct value depends on a call, a session or an instance must not live on a
module, a static field, or a shared long-lived object.**

Instances: #1 (the execution root as an ambient `process.cwd()`), #22 in full (LoggerConfig static,
`DEFAULT_ABSTRACT_EVENT_SERVICE`, ten tool singletons, provider `onTextDelta`/`onServerToolUse`
instance fields, the module-global preset registry), #5 (the single `abortController` field standing in
for turn identity), and L5 F9's `timeoutMs` smuggled through the node-to-node **data** payload
(`downstream-task-dispatcher.ts:111-113` → `worker-loop-service.ts:315-321`), where any node whose
output port happens to be named `timeoutMs` silently overrides the next node's execution timeout.

### T6 — A port defined by copying one implementation

**Invariant: a port describes a capability, not a class; every intended implementation must be able to
satisfy it without a cast and without emulating another implementation's semantics.**

Instances: #30 in full (`IFileSystem` ≅ `node:fs` + a parallel async twin + a sync-only session store;
`ICapabilityPack.tools: readonly FunctionTool[]` — a nominal class type; `killProcessTree` on the
concrete `ChildProcess`), plus `IStoragePort`'s 17 methods over three aggregates (#23),
`IDagOrchestrationPort` returning an HTTP envelope (#25), and `TuiInteractionChannel.getSession()`
returning the concrete framework class rather than `IInteractiveSession` (L3 L5).

### T7 — A god contract nothing can implement, so everyone approximates it

**Invariant: an interface a host either implements fully or does not claim; optional members are a
capability question and must be asked explicitly.**

Instances: `IInteractiveSession`, 40+ members, 51 casts, 3 optional capability methods (#8);
`ICommandHostContext`, ~50 members / ~30 optional, importing from eight subsystems (#8);
`ICommand`, a god-DTO of four merged concerns, all optional (#21); `ITerminalOutput`, a fat
presentation port with every member mandatory so implementers fake silently (#35);
`IStoragePort` (#23); `IDagOrchestrationPort` (#25).

### T8 — A contract that under-specifies, so its adapters disagree and nothing compares them

**Invariant: a port with more than one implementation needs a shared conformance suite; without one it
has as many contracts as it has adapters.**

Instances: two `IQueuePort` adapters disagreeing on redelivery, duplicate ids and FIFO, with
independent test files (#24); three `IStoragePort` adapters giving three behaviours for `createDagRun`
(#23); six transports with six answers on admission, cancellation, error shape and session surface,
and no parity check (#7); `IInteractiveSession` with 20+ private hand-rolled doubles and no published
conformant one (#8); `ITransportAdapter.start()` meaning "bind" in four implementations and "run to
completion" in two (#7).

### T9 — The neutral layer knows the product; the stable layer knows the volatile one

**Invariant: knowledge flows toward the more stable abstraction — a library must not name its
consumer's product, vendor, or feature set.**

Instances: `.robota`/`.claude`/`AGENTS.md`/`robota-cli`/`/provider` across `agent-framework`,
`agent-preset`, `agent-command`, `agent-session` (#13); `CLAUDE_MODELS` + price regexes in `agent-core`
and `MODEL_SHORTCUTS` in `agent-framework` (#14); `TKnownToolName`/`MODE_POLICY` naming product tools
in the zero-dep foundation (#16); `TCommandHostAction`/`TCommandUiIntent` naming product features in
the most stable package (#21); `agent-preset`'s built-in persona prose inside `packages/`
(`presets/autonomous-builder.ts:11-34`, `careful-reviewer.ts:14-32`, `neutral-executor.ts:14-25`,
L2 F6); `agent-transport-tui`'s hardcoded tool-name allow-list (L3 L8, #35);
`agent-provider-anthropic` reading its own model list _out of_ the foundation (#14);
`dag-framework → agent-core` against its own SPEC (#19); `apps/agent-server → agent-playground` (#17).

### T10 — Silence is not success

**Invariant: a degraded, skipped or failed path must be observable; a swallowed error must never be
indistinguishable from a working path.**

Instances: #15 in full (the un-settable logger sink, the per-token `appendFileSync` in `catch {}`, the
plugin-load `catch {}`, the discarded worktree-hook result, the `console.log`s), plus:
`getActiveDriverId?.() ?? undefined` losing all co-drive attribution (#8); the GUI `switch` with no
`default` (#28); `createPresetRegistry` dropping collisions with a bare `continue` (#22); pack tools
and subagents dropped on the injected-session branch with no rejection channel (#35);
`runHooks`' `blocked` decision discarded at two of three awaited seams (#35); `void
runHooks(...).catch(() => undefined)` (#15); the floating `void this.processRunUntilTerminal(...)`
(#5); `upstream_failed`/`skipped` declared in the state machine, the constants, the projection and the
SPEC with **no producer anywhere**, so `IDagRun` + `ITaskRun[]` cannot answer "why didn't node X run?"
(L5 F9, #18).

### T11 — The guard is scoped to where the problem is not

**Invariant: an enforcement mechanism must observe the surface the rule is about; a green result is
evidence only about what the check actually reads.**

Instances: #19 in full. This theme is the reason every other theme can regress silently, and it is the
only one every layer auditor hit independently.

### T12 — The document describes the system that was planned

**Invariant: a document that claims to be an SSOT must be mechanically tied to what it describes, or
it will drift in both directions.**

Instances: #31 in full (26 conformance findings), plus the in-package SPEC self-contradictions listed
under #31, plus `.agents/publish-registry.md` having no reader at all (#12).

---

## Disagreements and corrections

### Where the reports disagree with each other

1. **`agent-core`'s browser build — severity.** L0 F6 rates it `high`; L4 F1 rates it `blocker`.
   **My reading: blocker**, per L4. L4 established what L0 did not — that the workaround
   (`fs`/`net`/`tls`/`worker_threads: false` → empty modules) converts a build-time contract
   violation into a deferred runtime `TypeError` in a user's browser, and that it must be re-invented
   per bundler and by every external consumer. Both agree on FOUNDATIONAL. L4 also identified the
   five `randomUUID` sites as the largest and cheapest-to-fix offender, which L0 did not; L0
   identified the barrel mechanism (`utils/index.ts:2-8`, `hooks/index.ts:4`) more precisely. Both
   halves are needed.

2. **Closed host-action/UI-intent unions — severity.** L0 F11 rates it `medium`; L3 F4 rates it
   `high`. **My reading: high**, per L3, which supplied the decisive argument L0 lacked: the repo's
   own _Command module isolation_ rule requires command packages to consume framework interfaces
   "like third-party modules", and a closed union in `agent-interface-transport` makes that
   impossible — a third-party command must patch the graph's most stable package **and**
   `agent-framework`.

3. **Product-identity hardcoding — depth.** L2 F5 calls it FOUNDATIONAL; L3 L9 and L4 L8 call their
   instances LOCAL. **Both are correct and they are describing different sites.** L4's four
   `agent-cli` sites are locally replaceable with the existing `projectPaths()`/`getUserSettingsPath()`
   seam (and one of them is an outright bug). L2's `agent-framework`/`agent-preset` sites are not
   fixable from above — a second product inherits them — and, as L4 independently found, `paths.ts` is
   not even the exclusive owner _within its own package_ (ten further literals). The merged verdict is
   FOUNDATIONAL for the library sites, LOCAL for the shell sites.

4. **The `agent-cli` devDependency exemption — classification.** L4 L15 calls it "mechanical-guard
   coverage, not a design defect today"; CONFORMANCE U5 files it as UNDOCUMENTED (doc-side) and
   recommends amending `project-structure.md:118`. **These are the same fact reported twice** — this
   is the audit's one exact cross-report duplicate. My reading is that both under-call it: the fix is
   neither a doc note nor "no defect today", because the exemption removes the repo's largest
   composition root from _all_ direction rules while three architecture diagrams draw its edges. It
   belongs with #19.

5. **Vendor model knowledge — depth.** L0 F5 FOUNDATIONAL, L2 F10 LOCAL. **Both correct.** L2's
   `MODEL_SHORTCUTS` map is a self-contained three-line table; L0's `CLAUDE_MODELS` **inverts
   knowledge** (`agent-provider-anthropic` imports its own model list from the foundation) and is
   already producing a wrong default at a live consumer.

### Where I think a source report is wrong

6. **L0 F11's line citations for `TCommandHostAction` and `TCommandUiIntent` are wrong.** L0 cites
   `command-contracts.ts:172-183` and `:191-196`. The file is **199 lines** long and those ranges
   contain `ICommandPluginAdapter` and friends. The correct locations are **`:113-122`** and
   **`:131-135`**, exactly as L3 F4 cites. L0's _content_ is correct — the quoted union members are
   verbatim — so this is a citation error, not a false finding, but the L3 line numbers should be the
   ones carried forward. (L0's other citations in the same finding — `ICommand` at `:21-60`,
   `ICommandResult` at `:141-152`, `ICommandListEntry` at `:155-162` (actually `:154-162`) — are
   correct.)

7. **L2 F4's `guardrails` claim needs one qualification.** L2 says "a repo-wide grep finds no
   production caller anywhere that sets it". That is true for the session option
   (`ICreateSessionOptions.guardrails: Record<string, TGuardrail>`), which I verified. But there is a
   _different_ `guardrails` field in the config schema —
   `packages/agent-framework/src/config/config-types.ts:82`, `guardrails: z.array(z.string()).optional()`
   — a string array, not a guardrail map. L2 did not mention it. It does not weaken the finding (the
   two shapes cannot satisfy each other, and no code bridges them); if anything it strengthens it,
   because there are now _two_ declared guardrail surfaces and neither reaches the executor.

8. **L5's "the DAG subsystem is not layered" verdict is correct but should not be read as a defect on
   its own.** L5 is careful about this and I want to preserve the care: a hub-and-spoke with one
   composition root is a legitimate ports-and-adapters shape. The defect L5 actually establishes is
   narrower and I agree with it as stated — _the flat graph plus a core that under-specifies the
   cross-spoke contracts_, which is what produces F1, F3 and F9. The structural observation should not
   be filed as "the DAG packages are mis-layered".

9. **Severity caveat carried forward from L4.** L4 states that the severity of its two
   `apps/agent-server` auth findings "assumes the server is deployed" (it carries `firebase.json`,
   `vercel.json` and deploy scripts) and would drop one band each if not. I have kept them at blocker
   and high in #2 because, as L4 says, the code is the thing that would be deployed — but the
   deployment status is a fact worth establishing before sequencing.

10. **One claim I could not confirm and neither could its author.** L1's finding 4 depends on whether
    the optional class field `onServerToolUse` is materialised as an own property under the packages'
    compile target; L1 explicitly says it did not verify the emitted JS. If it is not materialised the
    _consequence_ differs (server-tool logging never fires at all rather than being cross-wired), but
    the underlying defect — duck-typed mutation of a shared instance — holds either way. I did not
    verify it either.

### Verifications I performed (read-only)

All against `develop` at the time of writing. Every check below **confirmed** the source report:

- `packages/agent-core/package.json` declares `exports["."].browser` → `./dist/browser/index.js`, and
  that file's first line imports `node:crypto`, `node:fs`, `node:path`, `node:child_process` (#4).
- `as unknown as IInteractiveSession|as IInteractiveSession` → **exactly 51 matches across 33 files**
  (#8; L0 said "51 matches across 20+ test files in 8 packages" — the file count is higher than L0's
  floor, the match count is exact).
- `command-contracts.ts`: `TCommandHostAction` at `:113`, `TCommandUiIntent` at `:131`,
  `ICommandResult` at `:141-152`, `ICommand` at `:21`, file length 199 (#21, and correction 6).
- `guardrails` / `retrievalAdapter`: no production setter; every non-test hit is a declaration or a
  consumption site (#9, #20).
- `permission-enforcer.ts:192-199` returns `success: true` with the error inside a JSON string,
  verbatim (#3).
- `child-process-subagent-worker.ts:99` calls `createDefaultTools()` with no argument (#1).
- `agent-session/src/session.ts:108` is `this.cwd = process.cwd()`; `session-types.ts` contains no
  `cwd` field (#1).
- `createLogger(` has 37 call sites; the only match for a second argument is the declaration itself at
  `logger.ts:183` (#15).
- `task-run-state-machine.ts` contains exactly the ten transitions L5 lists, with no `running → queued`
  (#6); `ILeasePort.renew` is called only from `dag-adapters-local/src/__tests__/testing-ports.test.ts`
  (#6).
- `transport-adapter.ts` is exactly the four members quoted (#7).
- `agent-cli/package.json`: **0** production `@robota-sdk` dependencies, **23** devDependencies, and
  `@robota-sdk/agent-cli-web` declared in none of the four dependency sections (#19).
- `agent-cli/src` references exactly six `resolvedPreset.*` fields (`agentName`,
  `enableParallelSubagents`, `model`, `permissionMode`, `persona`, `selfVerification`);
  `temperature` and `maxOutputTokens` appear nowhere in it (#9).
- `dag-framework/package.json` declares `@robota-sdk/agent-core` in **`dependencies`** (#19).

I did **not** re-verify: any of the DAG dispatch/queue/storage line citations beyond the state machine
and the lease port; the L1 provider-field claims; the L4 `agent-server` handler line numbers; the L3
transport drift table; or any of the 391 SPEC path references or 1483 symbol references CONFORMANCE
scanned. Those rest on their source reports.

---

## What the audit did NOT cover

This section aggregates every "Limits of this audit" from all seven reports, plus the gaps created by
the merge itself. It is the honest map of where a reader should not assume the absence of a finding
means the absence of a defect.

### Nothing was executed, anywhere

All seven auditors were read-only and none ran a build, a test, a typecheck, a lint or
`pnpm harness:scan`. **Every behavioural claim in this document is derived from source reading**, not
from an observed run. The claims each report flagged as most worth reproducing with a failing test
before acting:

- a real provider error containing "abort" being reported as `success: true, interrupted: true` (L0 F1 / #3);
- a subagent's `Read` returning a path outside the parent root (L1 #2, L2 F1 / #1);
- the orphaned turn and the cross-session `onServerToolUse` re-point (L1 #1, #4 / #5, #22);
- the `running:START` failure on redelivery, SQLite in-flight rows never reclaimed, entry nodes
  ignoring `timeoutMs` (L5 F1, F6, F9 / #6, #24, #18);
- `--task-file` being ignored in TUI mode (L4 F2 / #9) — falsifiable by a one-line manual check.

Per this repo's own lesson, each of those tests must be shown **red against the unfixed code**.

### Packages sampled rather than exhaustively read

| Unit                                                                                       | Read                                                                             | Not read                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-core` (160 files)                                                                   | 26 files                                                                         | `abstracts/abstract-module*`, workflow converter/validator (~900 LOC), `managers/*` beyond construction, `services/cache/*`, `services/conversation-service/*`, `tool-registry/*`, `schema/*`, `orchestration/*`, hook executor internals |
| `agent-plugin` (58 files / 6 278 LOC)                                                      | 3 files + a sweep for timers/disposal/IO                                         | the eight plugins' semantics: limits, retry policy, execution-analytics aggregation                                                                                                                                                       |
| provider packages (118 files / 11 850 LOC)                                                 | 4 files + greps + one structural diff                                            | streaming/assembly correctness of every provider; `-bytedance`, `-gemini`, `-defaults` beyond the neutrality scan                                                                                                                         |
| `agent-tools`                                                                              | contracts + `path-guard` + 3 builtins                                            | `computer-use/`, `retrieval/`, `sandbox/` implementations                                                                                                                                                                                 |
| `agent-framework` (372 files / 54 836 LOC)                                                 | `assembly/`, `runtime/`, `subagents/`, `interactive/` in full                    | `command-api/` (2 495 LOC), `memory/`, `plugins/`, `checkpoints/`, `background-tasks/`, `evals/`, `orchestration/`, most of `context/` — F13/#32 judges their _placement_, not their internals                                            |
| `agent-transport-tui` (64 files / 6 005 LOC)                                               | transport adapter, channel lifecycle, output summariser                          | all Ink component internals                                                                                                                                                                                                               |
| `agent-playground` (419 files)                                                             | execution/transform/sandbox/websocket/chat paths + export surface                | ~250 presentational components; `PlaygroundApp.tsx` (828 lines) read only around send/execute                                                                                                                                             |
| `dag-cli` (89 files / 25 016 LOC — **larger than the rest of the DAG subsystem combined**) | `run-store.ts` in full; `commands/runs.ts` and `mcp/tool-definitions.ts` sampled | `commands/run.ts` (2 389 lines), `commands/node.ts` (1 478) — L5 calls `dag-cli` "an open area"                                                                                                                                           |
| `dag-nodes/*` (18 leaves)                                                                  | 4 leaves + byte-diffs of 3 normalizers                                           | ~12 leaves checked only by grep for `process.cwd()` and duplicated helper names                                                                                                                                                           |
| `dag-framework/adapters/orchestration-adapter.ts` (664 lines)                              | imports, response-construction sites, tail                                       | all per-method business logic                                                                                                                                                                                                             |

### Whole areas nobody looked at

- **Runtime, performance and concurrency behaviour.** No profiling, no load, no fuzzing. Specifically
  named as unverified: whether `globToRegex` (`permission-gate.ts:39-45`) is ReDoS-safe on adversarial
  allow/deny entries; whether the WebCrypto derivations in `agent-remote-pairing` match test vectors;
  the two-driver race in `dag-framework` and the `run_key` TOCTOU (read from the code paths, no
  failing interleaving constructed).
- **No threat model was executed.** L3 F2 reports _absence of a gate_ as read in the code; it does not
  claim an exploit path for any particular deployment, and the shipped CLI _does_ pass a secret to
  `WebRtcTransport` (`agent-cli/src/remote-control/remote-control-controller.ts:461-482`) — the defect
  is the library default and the two ungated transports, not the current product wiring.
- **Test-suite quality was assessed only where it bore on a finding.** Nobody swept for
  accidental-green patterns, and no auditor verified that any existing test fails against the unfixed
  code. `apps/agent-web`'s and `apps/agent-server`'s tests were not analysed at all.
- **External-package behaviour was assumed from documentation, not verified:** `ws` close semantics,
  werift ICE / `iceTransportPolicy` handling, Hono `streamSSE` abort semantics, the MCP SDK's
  `Server.close()`, Electron `detached` semantics on Windows.
- **Whether a mechanical guard already exists for a given finding was not systematically checked.**
  L0 says so explicitly for F4/F5/F6. #19 catalogues the coverage gaps that _were_ found, not the
  complete set.
- **Git history was not consulted by any auditor.** Nobody checked when the DAG absorption
  (WORKFLOW-001) happened, what was consciously deferred, or whether a finding corresponds to an
  existing item in `.agents/tasks/`. L5 flags F11 in particular as likely matching a deferred item.
  **Cross-check before filing anything.**
- **`examples/*` and `scratch` workspace members** were out of scope everywhere.
- **`content/` and `apps/docs` published documentation was never diffed against the code** — that is
  the documentation-refresh loop's corpus, not this audit's.
- **`.agents/rules/` and `.agents/skills/`** were not audited except where `project-structure.md`
  routes into them.
- **Twenty `.agents/specs/` documents were not read in full** by CONFORMANCE (only machine-scanned for
  phantom package names): `agent-invocation-router.md`, `ai-workflow-control-plane.md`,
  `background-task-layer.md`, `background-work-state.md`, `deployment-matrix.md`, `gate-catalogue.md`,
  `harness-composition-*.md`, `process-execution.md`, `repository-situational-awareness.md`,
  `self-hosting-loop-verification.md`, `subagent-process-manager.md`, `transparent-workflow.md`,
  `user-local-memory.md`, `user-local-storage.md`, `document-standards/`, and the six files under
  `architecture-map/agent-cli/`. Claims inside those beyond package-name references are unchecked.
- **SPEC _bodies_ were scanned, not read.** Of 87 SPECs, CONFORMANCE read prose in ~12; the other 75
  were covered by path/symbol/package-name scans only, so prose claims about behaviour, lifecycle or
  invariants in those files are unverified. Symbol conformance was checked by
  **presence-in-source, not by signature comparison** — a documented `IFoo` whose _fields_ drifted
  would pass. The two signature drifts found (D6, D7) were caught incidentally.
- **Consumer-side counts are grep-derived.** "51 casts", "127 bare throws", "157 logger calls", "no
  caller sets `guardrails`", "no caller for `setOptions`" are accurate as counts of textual matches
  over `packages/` + `apps/` excluding `dist/` and `node_modules/`. A caller reached purely by dynamic
  `import()`, by string-keyed dispatch, or by spreading an untyped object would be missed.
- **`edges.txt` and `conformance.txt` were taken as given** by all six layer auditors and not
  re-derived from the manifests. Given #19, that input is narrower than its name suggests.

### Gaps created by this merge

- **Nothing was re-severitied downward.** Where reports disagreed I took the better-argued side and
  said so; I did not independently re-rate findings both reports agreed on.
- **Cross-layer duplicates were found by reading, not mechanically.** Two reports describing one cause
  in different vocabulary, in packages neither named, could have escaped me. The 17 merges here are a
  floor, not a ceiling.
- **No backlog items, IDs, sequencing or effort estimates appear in this document**, by instruction.
  Each source report carries its own suggested grouping and its own risk-of-the-fix assessment; those
  were deliberately not merged, because sequencing across layers is a different exercise that should
  start from this ranked list rather than from six independent ones.
