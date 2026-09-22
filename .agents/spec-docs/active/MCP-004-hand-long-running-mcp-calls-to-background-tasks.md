---
status: in-progress
type: BEHAVIOR
lane: L2
issue: 2524
tags: [mcp, async, cli]
---

# MCP-004: hand long-running MCP calls to background tasks

## Problem

A main-conversation MCP tool call blocks the interactive session for as long as the server takes.
After MCP-002 the call path is `DiscoveredMCPTool.execute` →
`MCPConnectionSupervisor.callTool` → the SDK client, bounded only by the per-call timeout the CLI
composition passes (`perCallMs`, 30 000 ms by default in
`packages/agent-cli/src/startup/mcp-client-composition.ts`). A server tool that legitimately runs for
minutes — a build, a crawl, a report — therefore either times out at thirty seconds or, with a raised
timeout, freezes the conversation: no status, no id, no way to keep working, and cancellation only by
aborting the whole turn.

Robota already owns a generic background-task system — `IBackgroundTaskManager` in
`packages/agent-executor/src/background-tasks/types.ts:127`, the kind-indexed contracts in
`packages/agent-interface-execution/src/background-task-contracts.ts`, and the conversation-facing
notification path in
`packages/agent-framework/src/interactive/interactive-session-background-tracker.ts:70-80` — but MCP
calls have no typed handoff into it. Measured on `integration/agreement-014@a63fe09f8`: every existing
background task is spawned _instead of_ running in the foreground (`background-process-tool.ts:63`,
`agent-tool.ts:209` both call `spawn({ mode: 'background' })` up front); no code path anywhere converts
an already-running foreground tool call into a background task, and `TBackgroundTaskKind` is the closed
union `'agent' | 'process' | 'scheduled'` (`background-task-contracts.ts:23`) with no member for a
tool call.

Reproduction: register an HTTP MCP server whose tool sleeps 90 s (the mock server's `listDelayMs`
style delay applied to `tools/call`), run `robota`, and ask the model to call it. The turn blocks with
no visible progress until `perCallMs` elapses and the call fails as a timeout; nothing was handed off,
no task id exists, `/tasks` shows nothing.

Issue #2524 (umbrella issue #2525, parent initiative issue #1985) owns the parent checklist line "longer than
two minutes moves to a background task".

## Prior Art Research

Researched from product documentation only (`research.md`); `prior-art-researcher`, 2026-09-22, terminal
signal `PRIOR_ART_RESEARCH: FOUND`.

### References consulted

| Reference                                                                                   | Type          | URL                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code — MCP (the moving reference issue #2524 names)                                  | product docs  | https://code.claude.com/docs/en/mcp                                                                                                                                                 |
| Claude Code — background tasks, `/tasks`, headless, sub-agents                              | product docs  | https://code.claude.com/docs/en/commands · https://code.claude.com/docs/en/headless · https://code.claude.com/docs/en/sub-agents                                                    |
| Gemini CLI — MCP servers                                                                    | product docs  | https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html                                                                                                               |
| OpenAI — Responses API background mode                                                      | API docs      | https://developers.openai.com/api/docs/guides/background                                                                                                                            |
| OpenAI — webhook delivery guarantees                                                        | API docs      | https://developers.openai.com/api/docs/guides/webhooks                                                                                                                              |
| Cursor — CLI MCP                                                                            | product docs  | https://cursor.com/docs/cli/mcp                                                                                                                                                     |
| GitHub Copilot — agent mode with MCP · VS Code — MCP servers                                | product docs  | https://docs.github.com/en/copilot/tutorials/enhance-agent-mode-with-mcp · https://code.visualstudio.com/docs/copilot/customization/mcp-servers                                     |
| MCP specification — cancellation · progress (2025-06-18) · tasks (2025-11-25, experimental) | protocol spec | https://modelcontextprotocol.io/specification/2025-06-18/basic/utilities/cancellation · …/progress · https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks |

Codex CLI's `/ps` / `/stop` background-process commands surfaced only through indexed help text, not a
fetched primary page — weak evidence, not relied on.

### Observed common behaviour

- **Threshold.** Claude Code backgrounds a main-conversation MCP call after a fixed default of two
  minutes, globally configurable (`CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS`, `0` = off) with a separate kill
  switch; the threshold is global, not per tool. Gemini CLI has only a per-server call _timeout_
  (default 600 000 ms) that fails the call. OpenAI backgrounds on an explicit per-request
  `background: true`, never by elapsed time. Cursor and Copilot document no host-level backgrounding.
  The MCP 2025-11-25 tasks primitive is a negotiated capability declared per tool, not a duration
  trigger.
- **Visible at handoff.** Claude Code hands the model a stable task id immediately as the tool result
  and lists the task in `/tasks`; OpenAI returns a `Response` id in `queued`/`in_progress`; MCP tasks
  return `taskId` + `status: "working"` + `pollInterval`.
- **Completion delivery.** Claude Code delivers the settled result through its ordinary
  task-notification path, not an MCP-only channel; OpenAI is poll-or-webhook; the MCP tasks utility
  says a requestor MUST NOT rely on the push notification — polling is the only guaranteed path.
- **Cancellation.** Claude Code: the user stops the task in `/tasks` and the model moves on. OpenAI:
  an explicit idempotent cancel endpoint. MCP core: `notifications/cancelled` from either side,
  fire-and-forget, race-tolerant; a cancelled task stays cancelled even if the work finishes
  (2025-11-25).
- **Session exit/restart.** Claude Code is explicit: background tasks do not survive exiting the
  session; nothing resumes on restart. Server-side task stores (OpenAI, MCP tasks) outlive the client —
  a different lifecycle model from a host process.
- **Subagent / non-interactive.** Claude Code backgrounds only main-conversation calls; subagent and
  IDE calls never background; headless (`-p`) runs disable backgrounding by default because a one-shot
  run can end before the result arrives, with a per-run opt-in.
- **Exactly-once.** No product claims it. OpenAI's webhooks are explicitly at-least-once with an
  idempotency key and a dedupe window — "effectively once" is the industry pattern.

### Constraints that apply to Robota

The generic background-task owner already exists (`agent-executor`, kind-indexed
`TBackgroundTaskKind`, shared status/event unions, watchdogs, permission policy — AGREEMENT-009 /
DATA-010 / ARCH-117, all three children still `todo`); issue #2524 forbids a second framework or an
MCP-only channel; the MCP wire-level tasks primitive is a different layer (negotiated with the remote
server, rarely declared) and cannot be the mechanism; "delivered exactly once" is an effectively-once
obligation Robota implements itself (single terminal transition, idempotent emission keyed by task id).

### Recommendation

A global, configurable, off-capable duration threshold defaulting to Claude Code's two minutes; a new
background-task _kind_ carrying server/tool identity, permission context, provenance and the remaining
timeout budget so the existing manager, watchdogs and event stream route it unchanged; the existing
task id returned synchronously as the tool result at handoff; completion through the existing
notification path; cancellation through the existing authority, propagated to the live MCP request as
`notifications/cancelled`, late cancels a no-op, one terminal transition; no survival across session
exit, explicitly tested; subagent calls never backgrounded; print/serve default off with an explicit
opt-in; "effectively once" specified and tested as such.

## Architecture Review

### Affected Scope

- `packages/agent-interface-execution` — `src/background-task-contracts.ts`: `TBackgroundTaskKind` gains
  `'tool-invocation'`; new `IToolInvocationBackgroundTaskRequest` (data only: tool name, flattened provenance,
  permission mode, adoption token; the remaining budget is the base request's `maxRuntimeMs`) joins `TBackgroundTaskRequest`; the SSOT of the
  kind vocabulary (INFRA-025), so this is the one declaration.
- `packages/agent-session` — `src/session-record-codec/background-task-members.ts`: `TASK_KINDS` gains
  the member (today an unknown kind makes `decodeBackgroundTaskState` / `decodeBackgroundTaskResult`
  add an issue and `record-decoder.ts` marks the whole session record `corrupt`, so a session that
  persisted one `tool-invocation` task would be unresumable). This second kind list is the one DATA-010
  exists to eliminate; the edit is labelled `Contained — DATA-010.`
- `packages/agent-executor` — `src/background-tasks/`: `ToolInvocationBackgroundTaskRunner` (`kind:
'tool-invocation'`) exposing an ADOPTER PORT (`adopt(token, { settled, abort })`) the framework discovers
  in `backgroundTaskRunners` by instance narrowing (`kind === 'tool-invocation' && 'adopt' in runner`),
  the sibling of `buildBackgroundProcessTool`'s `hasProcessRunner` boolean;
  `IBackgroundTaskRunner` gains a declared capability `admission?: 'queued' | 'already-running'`
  (default `'queued'`), and `spawn` starts a task whose runner declares `'already-running'` directly —
  no queue, no concurrency slot — because the work is already running and consumes no
  manager-provisioned resource (the manager already knows "running without a slot",
  `background-task-manager.ts:340-346`); `IBackgroundTaskManager` and the data contracts are unchanged; today `spawn` enqueues and `drainQueue` starts a runner only under
  `maxConcurrent` (`background-task-manager.ts:56-78,272-280`), and `cancel()` of a queued task never
  reaches a handle (`:141-145`) — an adopted call would keep running with nothing to abort it;
  `background-task-manager-helpers.ts:140-193` projects the new kind's preview/metadata into state;
  `createDefaultBackgroundTaskRunners()` (`src/background-tasks/runners/index.ts:18`) registers the
  runner. The watchdogs stay agent-only (`background-task-watchdogs.ts:40-119`): the adopted call's budget is the
  supervisor's `toolCallMs` (S2), and `maxRuntimeMs` on the request is informational.
- `packages/agent-mcp` — `src/supervisor/connection.ts`: a FIFTH typed timeout, `IMCPTimeouts.toolCallMs`,
  honoured by `callTool` at the one site that hard-codes `timeouts.perCallMs` (`connection.ts:424`);
  `perCallMs` keeps MCP-002's meaning for discovery and protocol requests (`:372,:398`). No change to
  `IMCPToolInvoker`, `DiscoveredMCPTool` or the CLI's structural `IMcpServerConnection`: the composition
  sets `toolCallMs` once from `mcp.callTimeoutMs` (`mcp-client-composition.ts:173-190`, `buildSupervisorOptions`), so the budget
  holds in every mode with no caller, and the wrapper owns no budget timer — a handed-off call's budget
  expiry arrives as the supervisor's timeout rejection. MCP-002's "setting one timeout never changes
  another" test gains a fifth case. The package still depends on `agent-core` only.
- `packages/agent-framework` — `src/assembly/create-session-runtime.ts`: `buildToolCallHandoff`, the
  wrapper, built beside `buildBackgroundProcessTool` (`:76-97`) where the manager, session id, cwd and
  the assembled tools are already in hand; `src/assembly/create-session-types.ts`:
  `ICreateSessionOptions.toolCallHandoff?: IToolCallHandoffPolicy` (a named, exported type —
  `{ thresholdMs; budgetMs; toolNames; provenance }` — because `ICreateSessionOptions` is public and the
  `barrel-parameter-types` floor applies) — the policy the host passes; `buildToolCallHandoff` and the
  wrapper module stay OFF the barrel, as `buildBackgroundProcessTool` is today; the tracker (`interactive-session-background-tracker.ts:249`) and the
  `/tasks` rendering (`command-api/background/background-command-api.ts`) render the kind; restore
  reconciliation (`interactive-session-restore.ts:190-222`) already fails every restored non-terminal
  task `stale_worker` — it is the restart mechanism, tested here, not re-implemented.
- `packages/agent-cli` — `src/startup/mcp-settings.ts` (new) reads the `mcp` settings object
  (`autoBackgroundMs`, `callTimeoutMs`) from the same layered documents `mcpServers` is read from
  (`readSettingsSourceText`, `mcp-definition-sources.ts`) — the framework's `SettingsSchema`
  (`config-types.ts:155-192`) deliberately carries no `mcp` namespace and gains none; `mcp-startup.ts` /
  `mcp-client-composition.ts`: read the two
  settings, pass `callTimeoutMs` as the tool-call budget and `toolCallHandoff` into the session options
  for the interactive and `serve` runtimes, omit it for `print` with a diagnostic when the setting is
  set. No wrapper code lives in `agent-cli`: `project-structure.md:373-382` and
  `check-background-workspace-conformance.mjs` refuse a startup module that value-imports
  `agent-executor`, and the testing-layering rule places feature behaviour in the framework.
- `packages/agent-core` — NOT edited. `IToolExecutionContext.signal` (the TURN claim,
  `agent-session/src/turn-claim.ts`) is the only carrier the wrapper needs, for the unlink at handoff.
  The context carries no session identity a per-call gate could key on (`ownerType: 'tool'`,
  `ownerId: toolCall.id` for every call — `tool-execution-service.ts:225-226`; `sessionId` is set
  nowhere in `agent-core/src/services`), so subagent exclusion is decided at composition, below.
- Records: `.agents/tasks/DATA-010-…md` gains one Plan line naming `'tool-invocation'`; a row in
  `scripts/harness/functional-coverage-manifest.json` for the new capability; SPEC of the five edited
  packages and `agent-cli`'s README.

Sibling scan: the other host-level "run this in the background" surfaces are `BackgroundProcess`
(`agent-framework/src/tools/background-process-tool.ts`, assembled by `buildBackgroundProcessTool`) and
the `Agent` tool's background mode (`agent-tool.ts:209`); both are spawn-time choices the model makes,
and neither promotes an in-flight call. `buildBackgroundProcessTool` is the placement analog this unit
mirrors; `packages/agent-mcp/examples/verify-mcp-client.ts` is the scenario model.

### Alternatives Considered

1. **An MCP-only job runner inside `agent-mcp`** — the supervisor keeps a table of long calls and the
   tool returns a "pending" result the model polls with a new `/mcp tasks` verb.
   Pro: no cross-package contract change; the timeout budget stays where the call is made.
   Con: it is exactly the second job system issue #2524 forbids ("Keep policy and notification semantics
   generic rather than building an MCP-only job system"); it cannot reach the conversation's task
   notifications, `/tasks`, persistence or cancellation authority, and `agent-mcp` may not import
   `agent-executor` or `agent-framework` (its boundary is `agent-core` only).
2. **Use the MCP 2025-11-25 tasks primitive** — when a server declares `execution.taskSupport`, call
   through `tasks/create` and poll `tasks/get`.
   Pro: protocol-native; the server owns the long work.
   Con: it is a wire-level capability negotiated with each remote server, experimental, and undeclared by
   nearly every server Robota talks to; it decides nothing for the servers that do not declare it, which
   is the case this unit exists for; and it is a different layer from the host's task lifecycle
   (server-side state outlives the session — the opposite of the exit semantics required here).
3. **The wrapper in `agent-cli/src/startup/` decorating each discovered tool** — the first draft of
   this unit.
   Pro: the composition already reads the settings and knows the mode.
   Con: measured false on three counts — at that point the CLI has neither the manager nor the session
   id (`cli.ts` runs `mcp.connect()` before the session exists; the manager is created inside
   `buildAgentRuntime` and reached through `retrieveSessionBackgroundTaskManager(session)`); a startup
   module that value-imports `agent-executor` is refused by `check-background-workspace-conformance`
   (`project-structure.md:373-382`); and the in-process subagent runner receives the parent's assembled
   tools (`build-agent-runtime.ts:55` → `in-process-subagent-runner.ts:233`), so "subagents never see the
   decorator by construction" does not hold there — the exclusion has to be made where
   `agentToolDeps.tools` is captured, in framework assembly.
4. **Threshold inside the tool-execution loop of `agent-core`** — race every tool against a global
   threshold.
   Pro: one mechanism for every tool.
   Con: `agent-core` does not know the background manager; a generic "any tool may be handed off" changes
   the semantics of tools never written to be adopted (file edits, permission prompts); the issue scopes
   the threshold to MCP calls.
5. **Adopt-in-flight handoff built in `agent-framework` session assembly, backed by a generic
   `tool-invocation` kind and manager admission of already-running work** — CHOSEN, below.
   Pro: reuses the manager, event stream, `/tasks`, persistence, restore reconciliation and cancellation
   authority; sits where `buildBackgroundProcessTool` already hands work to the manager with the session
   id in hand; keeps the wrapped array off `agentToolDeps.tools` so subagents (in-process or child) are never handed off; keeps
   `agent-core` untouched and `agent-mcp` on `agent-core` only.
   Con: a manager edit (admission path), an `agent-session` codec constant, a new SSOT kind member while
   AGREEMENT-009's kind-safe migration is `todo` (mitigated by the DATA-010 coordination line and the
   containment label on the codec list), and five packages in one unit — delivered as three ordered
   seams so each is reviewable on its own.

### Decision

Alternative 5, after `proposal-reviewer` (2026-09-22, REVISE → the changes below) tested the first
draft's premises against the tree. Delivered as three ordered seams in one branch:

**Delivery mode:** `single`

**S1 — contract, codec, runner, admission** (`agent-interface-execution`, `agent-session`,
`agent-executor`). `'tool-invocation'` joins `TBackgroundTaskKind` (one declaration) and `TASK_KINDS`
(`Contained — DATA-010.`); `IToolInvocationBackgroundTaskRequest` carries data only — `toolName`,
`provenance: { owner: 'mcp'; serverId; sourceName; securityIdentity }` flattened into `metadata`
(`Record<string, TBackgroundPrimitive>`), `permissionMode`, `adoptionToken`; the remaining budget rides the base request's `maxRuntimeMs`.
(Naming: the kind is `'tool-invocation'`; the feature, its files and tests keep the name "tool-call
handoff" — deliberate, not a drift to "fix".) `ToolInvocationBackgroundTaskRunner` owns the adoption
registry as an instance (an adopter port
`adopt(token, { settled: Promise<IToolResult>; abort(reason): void }): () => void`, whose return value
releases the token when `spawn` refuses), never a module singleton;
`start(task)` looks the token up: found → a handle whose `cancel(reason)` calls `abort` and which emits
exactly one terminal runner event when `settled` settles (`background_task_completed` with the result's
text as `IBackgroundTaskResult.output` — only text survives the handoff, `structuredContent` does not,
stated in the placeholder — or `background_task_failed` with `IBackgroundTaskError { category:
'runner', message, recoverable: false }`); not found → the task fails at once with `category:
'validation'` and a message naming the token, a programmer-error refusal, not the restart path.
The runner declares `admission: 'already-running'` on the existing SPI, and `spawn` — after the same
`validateBackgroundTaskRequest` and the same `created`/`started` events — constructs its state as `running` before `background_task_created` is emitted (a status parameter on
`createQueuedBackgroundTaskState`, `helpers.ts:155-200`, or a sibling) and starts it directly with
its handle bound, bypassing the queue and the concurrency slot, so `cancel()` always reaches
`abort`; `IBackgroundTaskManager` gains no method and no request field carries lifecycle policy; every
other transition stays as it is — the terminal guards (`isTerminalBackgroundTaskStatus` at
`background-task-manager.ts:139-381`) are what make a late settle after cancel, or a second completion,
a no-op, and they are asserted as one emission per task. `createDefaultBackgroundTaskRunners()`
registers the runner; `background-task-manager-helpers.ts` projects `toolName`/`serverId` into the
state's preview.

**S2 — the call budget seam** (`agent-mcp`, `agent-cli`). `IMCPTimeouts.toolCallMs` is a REQUIRED fifth field (no `?? perCallMs` alias — an alias would make
MCP-002's "setting one timeout never changes another" false and is the `primary ?? fallback` form the
No Fallback Policy names); `callTool` passes `timeouts.toolCallMs` to the SDK request where it passed
`perCallMs`; the CLI composition sets it from `mcp.callTimeoutMs`. Migration is compile-enforced at the
eight object literals that build an `IMCPTimeouts` today — `mcp-client-composition.ts:68-73`
(`DEFAULT_MCP_CLIENT_TIMEOUTS`), `agent-mcp/src/__tests__/supervisor-test-helpers.ts:61`,
`agent-mcp/examples/verify-mcp-client.ts:64` and the five cases in `timeout-semantics.test.ts:38-136` —
each setting `toolCallMs` equal to its current `perCallMs`, so no existing caller changes behaviour. Stated plainly against issue #2524's non-goal "does not own per-call timeout":
this unit ADDS a tool-call budget distinct from `perCallMs`, because a 30 s per-request bound makes a
120 s threshold unreachable; `perCallMs` itself is untouched. `perCallMs` keeps its MCP-002 meaning and default (discovery and protocol requests); the
tool-call budget is a separate number the host chooses. This corrects the first draft's hidden change: raising `perCallMs` to ten minutes would have raised
every discovery and protocol request in every mode.

**S3 — the wrapper, settings plumbing, modes** (`agent-framework`, `agent-cli`). `buildToolCallHandoff(options,
manager, sessionId, cwd, tools)` in `create-session-runtime.ts`, beside `buildBackgroundProcessTool`,
wraps each tool the policy selects (the MCP tools the host names via `toolCallHandoff.toolNames`) when
a `tool-invocation` runner is present in `backgroundTaskRunners` (the `hasProcessRunner` pattern). Per call:

- Construction-time gate, not a per-call gate: `buildToolCallHandoff` REPLACES the selected entries in
  the session-local `tools` array (it never mutates `options.additionalTools`, which `cli.ts:418` shares
  across every session the process creates), each wrapper carrying a reference to its inner tool; and
  `createSubagentSession` — the ONE derivation point every derived session's tool list passes through,
  reached by the in-process subagent (`assembly/build-agent-runtime.ts:55` →
  `subagents/in-process-subagent-runner.ts:233`) and by forks (`interactive-session-fork.ts:53`) — unwraps
  handoff tools in `filterTools` (`assembly/create-subagent-session.ts:168-197`). Subagents and forks therefore
  never hold a wrapped tool, consistent with the prior art's "main conversation only", and the tool
  execution context needs no identity it does not carry (`ownerType: 'tool'`, `ownerId: toolCall.id`
  for every call — `tool-execution-service.ts:225-227`).
- Start the underlying `execute` exactly once with a LINKED controller (aborted by `context.signal`, the
  turn claim, until a successful `spawn`; by manager cancel/shutdown afterwards); race it against the
  threshold timer on the injected clock. The wrapper never reaches the MCP invoker: the call's own
  budget is set on the `agent-cli → agent-mcp` edge (S2), and `toolCallHandoff.budgetMs` only informs the task's `maxRuntimeMs` (the remaining budget, for `/tasks`);
  the supervisor's `toolCallMs` timer is the one enforcer.
- Settles first → returned unchanged; no task; timers cleared.
- Threshold first → set a synchronous `committed` flag, then `const release = runner.adopt(token, …)`
  and `await manager.spawn(request)`. After `committed` the handoff is final even if the call settles
  while `spawn` is pending (the runner completes at once from the already-settled promise). The turn
  signal is UNLINKED only AFTER `spawn` returns the running task — from then on the only abort sources
  are manager cancel and manager shutdown (the budget is the supervisor's `toolCallMs`), so an Esc
  later in the same turn cannot kill a background task and misreport it as failure; if `spawn` refuses,
  `release()` withdraws the token and the link is untouched (§ Fallback). The tool returns `IToolResult { success: true, data: { backgroundTaskId, status: 'running', serverId, toolName, message: 'Handed to background task <id>; the text result arrives as a task notification.' } }` (`IToolResult` has `success`, `data?: TUniversalValue`, `error?`, `metadata?` — the placeholder rides `data`); the tracker records `background_task_created` immediately, which is the
  user-visible half of the acceptance criterion.
- Both at the same tick → the settled promise is checked before the timer callback commits; exactly one
  path produces output.
- `spawn` refuses (manager shutting down; a missing runner is unreachable in the product because the
  framework and `SubagentManager` read the same runner list, `cli.ts:348,378,387`, but reachable in an
  embedding host) → declared in § Fallback: the token is released, the turn link is still in place, and
  the wrapper keeps awaiting the still-running call in the foreground exactly as it would have without
  this unit; the returned result's `data.message` carries the refusal reason and the same reason goes to
  the session's diagnostic sink; nothing is retried or re-sent.

**Budget and threshold.** `mcp.autoBackgroundMs` (default 120 000; `0` disables) and `mcp.callTimeoutMs`
(default 600 000) are read by the CLI from the `mcp` object of the same layered settings documents `mcpServers` comes from (raw, beside `mcpServers`; never through the framework's `SettingsSchema`); the handoff is eligible
only when `0 < autoBackgroundMs < callTimeoutMs`. `callTimeoutMs` is the tool-call budget in EVERY mode
that composes MCP tools, including `print` (Gemini CLI's precedent: one call timeout, default
600 000 ms) — named consequence: a stuck server holds a print run for up to ten minutes where MCP-002
failed it at thirty seconds; the previous behaviour is one setting away (`mcp.callTimeoutMs: 30000`).
The background task records `callTimeoutMs − elapsed` as the base request's `maxRuntimeMs` — informational
for `/tasks` (the watchdogs are gated to `kind === 'agent'`, `background-task-watchdogs.ts:40-42`,
and stay so); the enforcer is the supervisor's `toolCallMs` timer, whose timeout rejection the runner
emits as one `background_task_failed` with `category: 'runner'` and the supervisor's timeout message. An invalid value is a
reported settings problem, never silently defaulted.

**Cancellation.** `manager.cancel(taskId, reason)` — the existing authority `/tasks` and the session
exercise — reaches the handle's `abort`; the supervisor's request sees the signal and the SDK client
emits `notifications/cancelled` for the live request. A cancel after the task is terminal is a no-op;
a settle after cancel emits nothing; the reason lands in `error.message` as the manager already does.

**Session exit and restart.** On exit the session calls `manager.shutdown()`, which cancels every
non-terminal task (`background-task-manager.ts:226-235`) with the product's message
(`'Session shutdown'`), then `mcp.shutdown()` closes the supervisors — the adopted call ends `cancelled`,
persisted as such. On the next start the framework's restore reconciliation fails every restored
non-terminal `tool-invocation` task with `timeoutReason: 'stale_worker'` and a synthetic
`background_task_failed` — the existing generic mechanism, adopted from Claude Code's stated behaviour
that background tasks do not survive the session; this unit tests it and the codec round-trip rather
than adding a second path.

**Modes.** Interactive TUI and `serve` (a long-lived GUI runtime over the same `InteractiveSession`,
`serve-mode.ts:45,106`): adopted — the host passes `toolCallHandoff`. `print`: rejected — a one-shot
run exits at `process.exit(channel.getExitCode())` with no drain, so the host omits the policy and,
when `mcp.autoBackgroundMs` is set, reports one diagnostic that it is ignored in print mode; the
headless opt-in Claude Code offers is deliberately not adopted here (adding a drain is a separate
lifecycle decision). Subagents: rejected by construction — the in-process runner copies the unwrapped list, the child-process runner rebuilds tools by name.

**Permission context and provenance.** The permission gate runs before `execute`, and `agent-mcp` has
no elicitation or sampling path, so no permission decision can occur mid-call; `permissionMode` on the
request is provenance metadata for `/tasks` and the notification, not an enforcement carrier, and the
`TBackgroundPermissionPolicy` vocabulary (agent tasks) is not extended. `serverId`, `sourceName` and
`securityIdentity` travel as flattened `metadata`.

**Validated before approval (contract-boundary change).** Reachability: producers of `tool-invocation`
requests are the wrapper only; consumers are the runner, `spawn`'s already-running branch, the helpers'
projection, the codec, the tracker and `/tasks`; every reader of `TBackgroundTaskKind` was enumerated
(`rg "TBackgroundTaskKind|kind === '|TASK_KINDS"` over `packages/*/src`), which is how the codec and
the helpers were found. Capability preservation: no existing kind or contract changes shape;
`perCallMs` keeps its meaning. Adversarial pass: duplicate delivery (settle + cancel, double completion)
→ manager terminal guards, TC-04/05; request re-send → single `execute`, TC-02; queued-but-running
orphan → runner-declared admission, TC-20; turn abort killing a background task → unlink at commit, TC-21;
subagent handoff → composition gate (unwrapped `agentToolDeps.tools`), TC-10 (behavioural, both runners); restart → reconciliation + codec,
TC-08/TC-22; spawn refusal → declared foreground continuation, TC-23.

Separate root items filed rather than folded in: `SubagentManager.nextTaskId` mints `process_N` for
every non-agent kind (already wrong for `scheduled`) — under AGREEMENT-009; a completed background
task's output is delivered to `/tasks` and the TUI but never to the model unless the task wakes the
loop — under umbrella issue #2525, the other half of the parent checklist line.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — `agent-interface-execution` (kind SSOT), `agent-session` (codec, contained under DATA-010), `agent-executor` (runner, adopter port, runner-declared admission), `agent-mcp` (required fifth typed timeout `toolCallMs`), `agent-framework` (wrapper, views), `agent-cli` (settings + mode plumbing); `agent-core` untouched
- [x] Sibling scan 완료 — `BackgroundProcess` (via `buildBackgroundProcessTool`) and the `Agent` tool's background mode inspected: both spawn-time choices, no in-flight promotion; `buildBackgroundProcessTool` is the placement analog, the MCP-002 example runner the scenario model
- [x] 대안 최소 2개 검토 완료 — five alternatives above, including the first draft's placement, rejected on measured grounds
- [x] 결정 근거 문서화 완료 — § Decision, with the validation pass and the reviewer's corrections

## Fallback & Degradation Declaration

One declared degradation, reviewed at GATE-APPROVAL:

- **Admission refused after the threshold fired** — `manager.spawn` throws because the manager is
  shutting down or this runtime has no `tool-invocation` runner. The wrapper releases the adoption token, leaves the turn-signal link in place (it is unlinked only
  after a successful `spawn`), and does NOT abort, retry or re-send the call; it keeps awaiting the
  same in-flight promise in the foreground, exactly the behaviour the session had before this unit, and the returned `IToolResult.data.message` carries `handoff refused: <reason>`
  while the same reason is reported through the session's diagnostic sink. Justification: the
  alternative — aborting a call the user asked for because the bookkeeping for a nicer UX was
  unavailable — destroys work to preserve a convenience; continuing in the foreground preserves the
  user's request and surfaces the refusal twice. The code site carries `// allow-fallback: admission
refused — continue the in-flight call in the foreground and report the refusal (MCP-004 § Fallback)`.
  Tested by TC-23.

## Solution

1. **S1.** Add `'tool-invocation'` to `TBackgroundTaskKind` and `IToolInvocationBackgroundTaskRequest` to the
   request union in `agent-interface-execution`; add the member to `agent-session`'s `TASK_KINDS`
   (`Contained — DATA-010.`); add `ToolInvocationBackgroundTaskRunner` with its adopter port, the manager's
   admission path for already-running work, the helpers' state projection; register the runner in
   `createDefaultBackgroundTaskRunners()`; record the member in DATA-010's Plan.
2. **S2.** Add the required `IMCPTimeouts.toolCallMs`, honoured by `callTool` where `perCallMs` was
   hard-coded; migrate the eight `IMCPTimeouts` literals; `perCallMs` unchanged.
3. **S3.** Add `toolCallHandoff` to `ICreateSessionOptions` and `buildToolCallHandoff` to
   `create-session-runtime.ts`; render the kind in the tracker and `/tasks`; have the CLI read `mcp.autoBackgroundMs` / `mcp.callTimeoutMs` beside `mcpServers`, set
   `toolCallMs` from it, and pass the policy for interactive and serve runtimes only.
4. Ship `packages/agent-cli/examples/verify-mcp-background.ts` behind `pnpm scenario:verify:mcp-background`
   (mock server, short threshold, real manager and runner, one `result=` line) and a `scriptedSession()`
   functional test with its `functional-coverage-manifest.json` row.
5. Update the five packages' SPEC and `agent-cli`'s README.

## Affected Files

- `packages/agent-interface-execution/src/background-task-contracts.ts`, `docs/SPEC.md` (edit)
- `packages/agent-session/src/session-record-codec/background-task-members.ts` (edit, `Contained — DATA-010.`), `src/__tests__/…tool-call-round-trip.test.ts` (new), `docs/SPEC.md` (edit)
- `packages/agent-executor/src/background-tasks/tool-invocation-runner.ts` (new: runner + adopter port), `background-task-manager.ts` (edit: `spawn` honours a runner's `admission: 'already-running'`), `types.ts` (edit: `IBackgroundTaskRunner.admission?`, the adopter port type), `background-task-manager-helpers.ts` (edit: projection), `runners/index.ts` (edit: registration), `src/__tests__/tool-invocation-runner.test.ts`, `src/__tests__/default-runners.test.ts` (new), `docs/SPEC.md` (edit)
- `packages/agent-mcp/src/supervisor/connection.ts` (edit: required `IMCPTimeouts.toolCallMs`, honoured by `callTool`), `src/__tests__/supervisor-test-helpers.ts`, `examples/verify-mcp-client.ts` (edit: the literal gains `toolCallMs`), `src/__tests__/timeout-semantics.test.ts` (edit: fifth timeout), `docs/SPEC.md` (edit)
- `packages/agent-framework/src/assembly/create-session-runtime.ts` (edit: `buildToolCallHandoff`), `src/assembly/tool-call-handoff.ts` (new: the wrapper + `unwrapToolCallHandoff`), `src/assembly/create-subagent-session.ts` (edit: unwrap in `filterTools`), `src/assembly/create-session-types.ts` (edit: `toolCallHandoff`), `src/interactive/interactive-session-background-tracker.ts`, `src/command-api/background/background-command-api.ts` (edit: kind rendering), `src/assembly/__tests__/tool-call-handoff.test.ts`, `src/__tests__/create-subagent-session.test.ts` (edit), `src/testing/__tests__/tool-call-handoff-functional.test.ts`, `src/interactive/__tests__/background-tracker-tool-call-kind.test.ts`, `src/interactive/__tests__/restore-reconciles-tool-call.test.ts` (new), `docs/SPEC.md` (edit)
- `packages/agent-cli/src/startup/mcp-startup.ts`, `mcp-client-composition.ts` (edit: settings, `toolCallMs` set from `mcp.callTimeoutMs`, policy per mode), `src/startup/mcp-settings.ts` (new: reads the `mcp` settings object beside `mcpServers`), `src/startup/__tests__/mcp-settings.test.ts` (new), `mcp-startup.test.ts`, `mcp-client-composition.test.ts` (edit), `examples/verify-mcp-background.ts` (new), `package.json` (script), `docs/SPEC.md`, `README.md` (edit)
- `scripts/harness/functional-coverage-manifest.json` (edit: one row)
- `.agents/tasks/DATA-010-define-the-kind-indexed-background-task-contract-map.md` (edit: one coordination line)

## Completion Criteria

- [ ] TC-01: `pnpm exec vitest run packages/agent-framework/src/assembly/__tests__/tool-call-handoff.test.ts` → exits 0 — under a fake clock a call that settles at `thresholdMs − 1` returns the underlying result unchanged, `manager.spawn` was never called, and no timer remains armed
- [ ] TC-02: same file → exits 0 — a call still pending at `thresholdMs` spawns exactly one `kind: 'tool-invocation'` task and returns `IToolResult` with `data.backgroundTaskId` equal to the spawned id and `data.status === 'running'`; the fake tool's `execute` count is 1 before and after the handoff
- [ ] TC-03: `pnpm exec vitest run packages/agent-executor/src/__tests__/tool-invocation-runner.test.ts` → exits 0 — when the adopted promise resolves, the real `BackgroundTaskManager` emits exactly one `background_task_completed` whose `task.result.output` is the tool's text and whose `task.status` is `completed`
- [ ] TC-04: same file → exits 0 — across a fake-clock sweep in which the settle tick varies from `threshold − 5` to `threshold + 5` and the `spawn` promise resolves 0–2 ticks late, every run yields exactly one delivery: a foreground result with no task, or one task whose completion is emitted once — never both, never zero
- [ ] TC-05: same file → exits 0 — `manager.cancel(id, 'user')` invokes the adopter's `abort`, emits exactly one `background_task_cancelled` whose `error.message` contains `user`, and a settle arriving after the cancel changes no event count
- [ ] TC-06: same file → exits 0 — an adopted promise that rejects after handoff emits exactly one `background_task_failed` with `error.category === 'runner'` and the rejection message, never a completion
- [ ] TC-07: same file → exits 0 — `manager.shutdown()` while a `tool-invocation` task is running invokes `abort`, leaves the task `cancelled` with `error.message` containing `Background task manager shutdown`, and the fake clock reports zero pending timers
- [ ] TC-08: `pnpm exec vitest run packages/agent-framework/src/interactive/__tests__/restore-reconciles-tool-call.test.ts` → exits 0 — a persisted session record holding a `running` `tool-invocation` task is restored with that task `failed`, `timeoutReason === 'stale_worker'`, and exactly one synthetic `background_task_failed` — the restart path is the existing reconciliation, exercised for the new kind
- [ ] TC-09: `pnpm exec vitest run packages/agent-framework/src/assembly/__tests__/tool-call-handoff.test.ts` → exits 0 — the spawned request carries `toolName`, `metadata.serverId`, `metadata.sourceName`, `metadata.securityIdentity`, `metadata.permissionMode` and `maxRuntimeMs === budgetMs − elapsed`; when the supervisor's `toolCallMs` elapses on the adopted call (fake supervisor rejecting with its timeout error) the task fails with exactly one `background_task_failed` carrying that message
- [ ] TC-10: `pnpm exec vitest run packages/agent-framework/src/assembly/__tests__/tool-call-handoff.test.ts packages/agent-framework/src/__tests__/create-subagent-session.test.ts` → exits 0 — the session-local `tools` array holds the wrapper for each selected MCP tool while `options.additionalTools` still holds the unwrapped instances, and `createSubagentSession` (in-process subagent AND fork inputs) returns tool lists containing the unwrapped tool and no wrapper; and `pnpm exec vitest run packages/agent-framework/src/testing/__tests__/tool-call-handoff-functional.test.ts` → exits 0 — driving a real `InteractiveSession` through `scriptedSession()`, an in-process subagent's tool call past the threshold spawns no task while the main turn's call does
- [ ] TC-11: `pnpm exec vitest run packages/agent-cli/src/startup/__tests__/mcp-settings.test.ts packages/agent-cli/src/startup/__tests__/mcp-startup.test.ts` → exits 0 — `mcp.autoBackgroundMs` and `mcp.callTimeoutMs` decode from the `mcp` object of a layered settings file (the same documents `mcpServers` is read from; the framework `SettingsSchema` is untouched — `git diff --stat origin/integration/agreement-014...HEAD -- packages/agent-framework/src/config` is EMPTY) with defaults `120000` / `600000`, `0` disables the handoff, `autoBackgroundMs ≥ callTimeoutMs` disables it with a diagnostic, and a negative or non-integer value is a reported settings problem rather than a silent default
- [ ] TC-12: `grep -rnE "TBackgroundTaskKind\s*=" packages/*/src --include='*.ts'` → exactly one declaration, in `packages/agent-interface-execution/src/background-task-contracts.ts`, containing `'tool-invocation'`; `grep -n "tool-invocation" packages/agent-session/src/session-record-codec/background-task-members.ts` returns the member on a line adjacent to `Contained — DATA-010`; and `pnpm exec vitest run packages/agent-framework/src/interactive/__tests__/background-tracker-tool-call-kind.test.ts` exits 0 rendering a `tool-invocation` task in the tracker and the `/tasks` projection
- [ ] TC-13: `git diff --stat origin/integration/agreement-014...HEAD -- packages/agent-core/src` is EMPTY, `grep -rnE "@robota-sdk/agent-(executor|framework|cli|session)" packages/agent-mcp/src packages/agent-mcp/package.json` returns none, and `grep -rnE "from '@robota-sdk/agent-executor'" packages/agent-cli/src/startup` returns none — the core tool contract is unchanged, `agent-mcp` still depends on `agent-core` only, and no wrapper code lives in `agent-cli`
- [ ] TC-14: `pnpm scenario:verify:mcp-background` from `packages/agent-cli` → exits 0 and prints one line `result=handoff=background-task; taskId=<id>; completion=notified-once; status=completed` — a mock server whose tool answers after a short configured threshold, run end to end through the real manager and runner under an isolated `HOME`
- [ ] TC-15: `pnpm --filter @robota-sdk/agent-interface-execution test && pnpm --filter @robota-sdk/agent-session test && pnpm --filter @robota-sdk/agent-executor test && pnpm --filter @robota-sdk/agent-mcp test && pnpm --filter @robota-sdk/agent-framework test && pnpm --filter @robota-sdk/agent-cli test && pnpm build` → exits 0, and `node scripts/harness/run-all-scans.mjs --affected --context pr` reports no NEW failure relative to the base
- [ ] TC-16: `grep -n "tool-invocation" .agents/tasks/DATA-010-define-the-kind-indexed-background-task-contract-map.md` returns a Plan line naming the member the kind-indexed contract map must carry — the AGREEMENT-009 coordination is recorded, not assumed
- [ ] TC-17: `pnpm exec vitest run packages/agent-executor/src/__tests__/default-runners.test.ts` → exits 0 — `createDefaultBackgroundTaskRunners()` contains exactly one runner whose `kind === 'tool-invocation'`, so a `tool-invocation` task admitted in the product never fails with `No runner for task kind` (`background-task-manager.ts:283-285`); and `grep -n "tool-invocation" packages/agent-executor/src/background-tasks/runners/index.ts` returns a hit
- [ ] TC-18: `pnpm exec vitest run packages/agent-mcp/src/__tests__/timeout-semantics.test.ts packages/agent-cli/src/startup/__tests__/mcp-client-composition.test.ts` → exits 0 — `IMCPTimeouts.toolCallMs` is a fifth distinct setting (setting it changes only the `callTool` request budget; setting any of the other four never changes it), `callTool` passes `toolCallMs` where it passed `perCallMs`, and the composition sets `toolCallMs === mcp.callTimeoutMs` while `startupMs`, `perCallMs`, `globalDefaultMs` and `idleMs` keep their MCP-002 defaults
- [ ] TC-19: `grep -ln "tool-invocation" packages/agent-interface-execution/docs/SPEC.md packages/agent-session/docs/SPEC.md packages/agent-executor/docs/SPEC.md packages/agent-mcp/docs/SPEC.md packages/agent-framework/docs/SPEC.md packages/agent-cli/docs/SPEC.md packages/agent-cli/README.md` lists all seven files, and `node scripts/harness/check-spec-public-surface.mjs` plus `node scripts/harness/check-spec-paths.mjs` exit 0
- [ ] TC-20: `pnpm exec vitest run packages/agent-executor/src/__tests__/tool-invocation-runner.test.ts` → exits 0 — with `maxConcurrent: 1` and one `process` task holding the slot, a spawned `tool-invocation` task (runner `admission: 'already-running'`) is `running` immediately (never `queued`), holds no slot, and `manager.cancel` reaches its `abort` at once
- [ ] TC-21: `pnpm exec vitest run packages/agent-framework/src/assembly/__tests__/tool-call-handoff.test.ts` → exits 0 — aborting `context.signal` (the turn claim) after `spawn` returned does NOT abort the adopted call and emits no task event; aborting it before the threshold, or after a refused `spawn`, aborts the call as before
- [ ] TC-22: `pnpm exec vitest run packages/agent-session/src/__tests__/background-task-tool-call-round-trip.test.ts` → exits 0 — a session record holding a `tool-invocation` task state and result encodes and decodes without a decode issue, and the record is not marked `corrupt`
- [ ] TC-23: `pnpm exec vitest run packages/agent-framework/src/assembly/__tests__/tool-call-handoff.test.ts` → exits 0 — when `manager.spawn` throws after the threshold, the wrapper does not abort or re-send the call, returns the call's own eventual result with `data.message` containing `handoff refused:` and the reason, reports the same reason once through the diagnostic sink, the adoption token was released (the runner's registry is empty), the turn signal still aborts the call, and the tool's `execute` count is still 1
- [ ] TC-24: `pnpm exec vitest run packages/agent-framework/src/testing/__tests__/tool-call-handoff-functional.test.ts` → exits 0 — through `scriptedSession()`, a main-turn MCP tool call that exceeds the threshold yields a `background_task_created` entry in the session's execution workspace before the turn's next model step, and one `background_task_completed` afterwards; and `grep -n "tool-call-handoff" scripts/harness/functional-coverage-manifest.json` returns the capability row
- [ ] TC-25: `pnpm exec vitest run packages/agent-cli/src/startup/__tests__/mcp-startup.test.ts` → exits 0 — with `mcp.autoBackgroundMs` set, the session options the interactive and `serve` compositions build carry `toolCallHandoff` (with `thresholdMs`, `budgetMs` and the MCP tool names), the `print` composition's options carry NO `toolCallHandoff` and exactly one diagnostic line says the setting is ignored in print mode; with the setting at `0` no composition carries the policy and no diagnostic is emitted

## Test Plan

Derived strategy — BEHAVIOR × `async`: async state-assertion tests under a fake clock; BEHAVIOR × `mcp`:
protocol integration through the mock server; BEHAVIOR × `cli`: composition tests plus the
process-level scenario runner; testing-layering rule 3: feature behaviour proven in `agent-framework`
with one `scriptedSession()` functional test.

| TC-ID | Test Type                   | Tool / Approach                                                                                                   | Notes                                                                                 |
| ----- | --------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| TC-01 | unit (fake clock)           | vitest, `vi.useFakeTimers`, fake tool + fake manager                                                              | Just-under threshold; the absence of a `spawn` is the load-bearing half               |
| TC-02 | unit (fake clock)           | vitest, fake invoker counting calls and recording options                                                         | One request, one task, one placeholder result, budget passed down                     |
| TC-03 | integration (fake clock)    | vitest over the real `BackgroundTaskManager` + runner                                                             | Counts `background_task_completed` events                                             |
| TC-04 | property-style (fake clock) | vitest, settle tick × `spawn` latency sweep                                                                       | Exactly-one delivery is the property, not a single example                            |
| TC-05 | integration (fake clock)    | vitest, real manager, adopted deferred                                                                            | Cancel race: late settle emits nothing                                                |
| TC-06 | integration (fake clock)    | vitest, adopted deferred that rejects                                                                             | Failure path, real `IBackgroundTaskError` shape                                       |
| TC-07 | integration (fake clock)    | vitest, `manager.shutdown()` mid-flight                                                                           | Zero pending timers asserted on the fake clock                                        |
| TC-08 | integration                 | vitest over `restoreInteractiveSession` with a persisted record                                                   | The existing reconciliation is the restart path                                       |
| TC-09 | unit (fake clock)           | vitest over the admitted request shape + budget expiry                                                            | Flattened provenance, permission mode, `maxRuntimeMs` as the remaining budget         |
| TC-10 | unit + functional           | vitest over the session-local wrap and the `createSubagentSession` unwrap (subagent + fork) + `scriptedSession()` | Construction-time property, then behaviour through a real session                     |
| TC-11 | unit + composition          | vitest over settings decoding and the composition's eligibility                                                   | Defaults, `0`, `auto ≥ timeout`, refused invalid values                               |
| TC-12 | config assertion + unit     | `grep` over `packages/*/src` + tracker/tasks view test                                                            | One declaration; contained codec list; views render it                                |
| TC-13 | config assertion            | `git diff --stat` + `grep`                                                                                        | Layering: core untouched, `agent-mcp` on core only, no wrapper in `agent-cli`         |
| TC-14 | scenario                    | `pnpm scenario:verify:mcp-background` from `packages/agent-cli`                                                   | End to end through the real manager; the public-sdk-example surface                   |
| TC-15 | build / scan                | package tests + build + affected scans                                                                            | Base-state advisories are tolerated; a NEW failure is not                             |
| TC-16 | records assertion           | `grep` over the DATA-010 Task                                                                                     | AGREEMENT-009 coordination recorded                                                   |
| TC-17 | unit + config assertion     | vitest over `createDefaultBackgroundTaskRunners()` + `grep`                                                       | The product runner list — what makes the handoff reachable                            |
| TC-18 | unit + composition          | vitest over `IMCPTimeouts` independence and the composition options                                               | Fifth typed timeout; MCP-002 defaults untouched                                       |
| TC-19 | docs assertion + scan       | `grep -l` over seven docs + the two SPEC scans                                                                    | SPEC/README layers in sync                                                            |
| TC-20 | integration (fake clock)    | vitest, `maxConcurrent: 1` with a slot holder                                                                     | Admission never queues; cancel always reaches abort                                   |
| TC-21 | unit (fake clock)           | vitest, turn-claim abort before/after a successful `spawn`                                                        | Ownership transfers only once the task exists                                         |
| TC-22 | unit                        | vitest over the `agent-session` codec round trip                                                                  | The record must not become `corrupt`                                                  |
| TC-23 | unit (fake clock)           | vitest, `spawn` that throws                                                                                       | The one declared degradation: token released, link intact, both reports asserted      |
| TC-24 | functional                  | `scriptedSession()` + manifest grep                                                                               | Immediate user-visible status and once-only completion through a real session         |
| TC-25 | composition                 | vitest over `composeMcpClientForStartup` per mode                                                                 | Adopted (interactive, serve) / rejected with one diagnostic (print); `0` = silent off |

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

**Why this surface:** the delivered behaviour is observable in the interactive TUI only after a real
server call exceeds the threshold, which no non-interactive product verb exposes on its own (print and
serve reject the handoff by design). The executable surface a person can run is therefore the package's
`examples/` runner — the same `public-sdk-example` surface MCP-001, MCP-2520 and MCP-002 ship — driving
the real manager and runner against an in-process mock server with a short configured threshold. The
paired Task's `## User Execution Test Scenarios` carries the same scenario (written in this planning
round); this section mirrors it.

### Scenario 1: a long MCP call is handed to a background task and its completion is notified once

- Executability: agent-executable
- Product surface: public-sdk-example
- Surface rationale: shipped-interface=public-sdk-example
- Prerequisites: Node.js and pnpm are installed and `pnpm install` has completed; `@robota-sdk/agent-core`, `@robota-sdk/agent-mcp`, `@robota-sdk/agent-interface-execution` and `@robota-sdk/agent-executor` are built; run from `packages/agent-cli`; the example starts its own mock Streamable HTTP server whose `slow` tool answers after 300 ms, sets `mcp.autoBackgroundMs` to 100 and `mcp.callTimeoutMs` to 5000 in a temporary `HOME`, and needs no network or credentials
- Command: `pnpm exec tsx examples/verify-mcp-background.ts`
- Observable type: sdk-result
- Observable rationale: source=public-sdk-return
- Expected observable: result=handoff=background-task; taskId=<id>; completion=notified-once; status=completed
- Cleanup: the example shuts the manager and the mock server down and removes its temporary `HOME` before exiting; it leaves no files, processes or connections.
- Evidence: pending implementation — recorded at DONE-GATE-STAGE-2 with the command, its exit code and the single printed `result=` line, plus the durable runner path `packages/agent-cli/examples/verify-mcp-background.ts`.

## Tasks

- [ ] `.agents/tasks/MCP-004-hand-long-running-mcp-calls-to-background-tasks.md` — populated

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-09-22

**Status remains:** draft
**Failed criteria:**

- Completion Criteria › At least 1 criterion per distinct feature or sub-item (`semantic`): the sub-item
  that makes the feature reachable in the product has no criterion. Solution step 2 names it — "register
  the runner where the CLI builds its runner list" — and the tree says where that is:
  `packages/agent-cli/src/cli.ts:348` takes `createDefaultBackgroundTaskRunners()` from
  `packages/agent-executor/src/background-tasks/runners/index.ts:18`, which today returns exactly
  `[createManagedShellProcessRunner(), createScheduledTaskRunner()]`, and `agent-framework/src/runtime/
agent-runtime.ts:98` falls back to the same factory. Found: none of TC-01…TC-16 asserts that the product's
  runner list carries a `kind: 'tool-invocation'` runner — TC-03…TC-08 drive `ToolInvocationBackgroundTaskRunner` directly
  against a manager the test constructs, TC-10 asserts decoration of the tools and never the runner list,
  and TC-14's scenario runs "through the real manager and runner" that the example itself wires. With the
  factory left unchanged every one of the sixteen criteria passes while the interactive TUI spawns a
  `tool-invocation` task that `BackgroundTaskManager` fails on arrival with `No runner for task kind: tool-invocation`
  (`background-task-manager.ts:283-285`) — the delivered behaviour dead and every gate green. Affected
  Files compounds it: the executor entry reads "`background-tasks/index.ts` or `src/index.ts` (export)",
  an export, not a registration, and `runners/index.ts` is not named. Secondary, same criterion: Solution
  step 6's SPEC/README/`ARCHITECTURE.md` updates have no criterion (TC-16 covers only the DATA-010 line),
  and "pass `callTimeoutMs` as the per-call budget" to the supervisor is asserted nowhere — TC-09 checks the
  spawned request's `timeoutMs`, not what the composition hands `perCallMs`.
  **Required action:** add a criterion asserting the product's default runner list (or the CLI's
  assembled list) contains a `tool-invocation` runner — e.g. `createDefaultBackgroundTaskRunners().some(r =>
r.kind === 'tool-invocation')` in an `agent-executor` or `agent-cli` test, or a TC-14 scenario that composes
  through `createDefaultBackgroundTaskRunners()` rather than a hand-built list — and name
  `runners/index.ts` in Affected Files; decide the two secondary gaps (a criterion or an explicit reason
  they are record obligations); then re-run GATE-WRITE.

**Semantic criteria checked (the other six):**

- Problem › concrete symptom — PASS. The wrong behaviour is specific (a long `tools/call` either times out
  or freezes the conversation with no id, no status, no cancellation short of aborting the turn) and its
  measurements reproduce: `mcp-client-composition.ts:70` `perCallMs: 30_000`;
  `background-task-contracts.ts:23` `TBackgroundTaskKind = 'agent' | 'process' | 'scheduled'`;
  `types.ts:127` `IBackgroundTaskManager`; tracker `subscribe` at :70-80 routes `recordTaskEvent`;
  `agent-tool.ts:209` `mode: 'background'`; `background-task-manager.ts:283` dispatches on
  `task.request.kind` and guards terminal transitions with `isTerminalBackgroundTaskStatus` at :139,
  :154, :213, :306, :316 (and beyond); tracker `:249` branches only on `'process'`. One figure is off:
  the `BackgroundProcess` spawn is at `background-process-tool.ts:63`, not `:60`.
- Problem › reproduction condition — PASS. States when and where: an HTTP MCP server whose tool sleeps
  90 s, `robota`, the model calls it; the turn blocks until `perCallMs` elapses, no task id exists,
  `/tasks` shows nothing. The named delay mechanism exists (`mock-mcp-server.ts:99` `listDelayMs`) and
  the spec correctly says "style", i.e. analogous, not already applied to `tools/call`.
- Prior Art › research feeds Alternatives/Decision — PASS, derived not decorated. The 120 000 default and
  `0 = off` come from the recorded Claude Code threshold finding; the synchronous task id as the tool
  result from "Visible at handoff"; completion through the ordinary notification path from "Completion
  delivery"; `orphaned-on-restart` from Claude Code's stated no-survival behaviour; the subagent/print/
  serve rejections from "Subagent / non-interactive"; "effectively once" from OpenAI's at-least-once plus
  idempotency finding. Alternative 2 is rejected on the research's own characterisation of the MCP
  2025-11-25 tasks primitive (negotiated per server, server-side state outlives the client). The one
  divergence from § Recommendation — no headless opt-in — states a stronger local ground (no
  drain-before-exit exists in `print-mode.ts`).
- Architecture Review › Decision references the trade-off — PASS. The Decision names Alternative 4 and
  carries its recorded costs forward rather than dropping them: the new SSOT kind member while
  AGREEMENT-009 is `todo` is met by the DATA-010 coordination line (TC-16) and by declaring the member
  where DATA-010 will read it; the process-local adoption registry is made explicit through
  `orphaned-on-restart` and TC-08; the headless opt-in is declined with its cost and reason stated.
- Architecture Review › new-surface placement — N/A on the package/app/presentation reading (no new
  package, app, or interface surface; the kind is a new member of an existing union, the runner sits
  beside `managed-shell-process-runner.ts` and `scheduled-task-runner.ts`, the decorator beside
  `mcp-client-composition.ts`; `agent-mcp` and `agent-core` are untouched, TC-13 asserts it, and
  `agent-mcp/package.json` confirms the `agent-core`-only peer boundary). Under the broader "could
  plausibly live in more than one place" reading the requirement is met anyway: Alternatives 1 and 3
  are the competing placements and are rejected on dependency direction; the Sibling scan names the
  analogous existing layer (`BackgroundProcess` and the `Agent` tool's background mode, both spawn-time
  choices in `agent-framework`) and the reuse is of the shared `agent-executor` manager contract, not
  a dependency on a sibling product.
- Completion Criteria › Command form or Observable behavior form — PASS on form for all 16. Each is
  command-first with a named observable including its negative half (TC-01 no spawn and no armed timer;
  TC-05 a late settle emits nothing; TC-10 the grep returns none; TC-13 the diff is EMPTY). One content
  defect, not a form defect: TC-12's first grep (`-l` over every file containing `'tool-invocation'`) will list
  the runner, decorator and tracker too once they exist, so "as the only file" cannot be its output —
  the parenthetical `TBackgroundTaskKind\s*=` grep is the assertion that actually binds.

**Mechanical set:** `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <this> --dry-run` with
`HARNESS_BASE_REF=origin/integration/agreement-014` re-run by this guardian: 27 criteria — 20 PASS,
0 FAIL, 7 PENDING-GUARDIAN; 16 Completion Criteria = 16 Test Plan rows; no entry written by the script.

**Accuracy defects that mislead a later reader (recorded, not the decider):**

- Affected Files: "`ARCHITECTURE.md` (edit: background-task kinds paragraph)" — `grep -in background
ARCHITECTURE.md` returns nothing; there is no such paragraph to edit.
- § User Execution Test Scenarios: "The paired Task's `## User Execution Test Scenarios` carries the same
  scenario; this section mirrors it" — the Task on disk
  (`.agents/tasks/MCP-004-hand-long-running-mcp-calls-to-background-tasks.md`) carries one generic
  paragraph and `SCENARIO DRAFTED: automatable | 1`, not Scenario 1. GATE-IMPLEMENT reads the Task.
- `background-process-tool.ts:60` → the spawn is at `:63`; `background-task-manager.ts` terminal guards
  run to `:381`, not `:316`.

**Judged by:** `backlog-gate-guard`
**Judged at:** HEAD `a63fe09f8bf2` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/draft/MCP-004-hand-long-running-mcp-calls-to-background-tasks.md` blob `6d4bb4df69cb` (untracked)
**Stacked base:** `origin/integration/agreement-014@a63fe09f8bf2` (`HARNESS_BASE_REF`; equals HEAD — the branch carries no commit of its own)

### [GATE-WRITE] — ✅ PASS | 2026-09-22

**Status upgrade:** draft → review-ready

Re-run after the `[GATE-WRITE] — ❌ FAIL | 2026-09-22` entry above. Ordering check: GATE-WRITE is the
entry gate (no prior gate; `gate-catalogue.md` § Prior-gate map exempts it); the document is
`status: draft` under `.agents/spec-docs/draft/`, the state this gate consumes. The only prior entry is
this gate's own FAIL, which a re-run is the sanctioned answer to.

- GATE-WRITE — File begins with `---` YAML frontmatter block: line 1 is `---`, block closes at line 7
- GATE-WRITE — `status: draft` present in frontmatter: line 2 `status: draft`
- GATE-WRITE — `type:` is one of the 11 values: line 3 `type: BEHAVIOR`
- GATE-WRITE — `tags:` field present: line 6 `tags: [mcp, async, cli]`
- GATE-WRITE — Problem contains a concrete symptom: the named call path `DiscoveredMCPTool.execute → MCPConnectionSupervisor.callTool → SDK client`, bounded by `perCallMs` 30 000 ms (verified: `mcp-client-composition.ts:70` `perCallMs: 30_000`); the wrong behaviour is stated as two observable outcomes (timeout at 30 s, or a frozen turn with no status, no id, cancel only by aborting the turn) and the measured absence of any in-flight promotion path (`background-process-tool.ts:63` and `agent-tool.ts:209` both `mode: 'background'` at spawn — verified; `TBackgroundTaskKind = 'agent' | 'process' | 'scheduled'` at `background-task-contracts.ts:23` — verified)
- GATE-WRITE — Problem contains a reproduction condition: "register an HTTP MCP server whose tool sleeps 90 s (the mock server's `listDelayMs` style delay …), run `robota`, ask the model to call it → the turn blocks until `perCallMs` elapses, no task id, `/tasks` shows nothing"; the cited mechanism exists (`mock-mcp-server.ts:99`, handlers `:114-115`) and the spec correctly marks it as analogous
- GATE-WRITE — No TBD/TODO or vague single-sentence Problem: `gate.mjs` — no TBD/TODO, 2055 chars, 8 sentences; my grep over the body (excluding the Evidence Log) finds none of TBD/TODO
- GATE-WRITE — `## Prior Art Research` section present: present at the section following the Problem
- GATE-WRITE — Section substantiated (≥1 documentation source): eight product/API/protocol-spec rows with URLs (Claude Code, Gemini CLI, OpenAI, Cursor, Copilot/VS Code, MCP 2025-06-18 / 2025-11-25); no third-party source code cited; the Codex CLI hint is explicitly marked weak and not relied on; `scan-spec-research` reports substantiated
- GATE-WRITE — OR `Waived:` line: N/A — the section is substantiated, so no waiver is needed and none is present
- GATE-WRITE — Research feeds Alternatives / Decision: traced, not asserted — 120 000 ms default and `0` = off from the Claude Code threshold finding; synchronous task id as the tool result from "Visible at handoff"; delivery through the ordinary notification path from "Completion delivery"; `orphaned-on-restart` from Claude Code's no-survival statement; subagent/print/serve rejection from "Subagent / non-interactive"; "effectively once" from OpenAI's at-least-once + idempotency finding; Alternative 2 rejected on the research's own characterisation of the MCP tasks primitive; the one divergence (no headless opt-in) states a stronger local ground (`print-mode.ts` has no drain-before-exit)
- GATE-WRITE — All 4 checklist items `[x]`: 4/4, each carrying its evidence inline
- GATE-WRITE — Sibling scan `[x]` with evidence: names `BackgroundProcess` (`background-process-tool.ts`) and the `Agent` tool's background mode (`agent-tool.ts:209`) as spawn-time siblings with no in-flight promotion, and `verify-mcp-client.ts` (exists) as the scenario model
- GATE-WRITE — Alternatives Considered ≥2 with pro/con: four numbered alternatives, each with Pro and Con
- GATE-WRITE — Decision references the trade-off: Alternative 4's recorded costs are carried forward — the new SSOT kind member while AGREEMENT-009 is `todo` is met by the DATA-010 coordination line (TC-16) and by declaring the member at the SSOT; the process-local adoption registry is made explicit through `orphaned-on-restart` (TC-08) and `session-shutdown` (TC-07); the headless opt-in is declined with its cost and reason
- GATE-WRITE — New-surface placement (conditional): N/A — no new package, app, or presentation/interface surface and no boundary reclassification; the kind is a new member of an existing union, the runner sits beside `managed-shell-process-runner.ts` / `scheduled-task-runner.ts` (directory verified), the decorator beside `mcp-client-composition.ts`; `agent-mcp` and `agent-core` untouched (TC-13) and `agent-mcp/package.json` peers on `agent-core` only (verified). Even on the broader reading the Sibling scan names the analogous `agent-framework` spawn-time surfaces and the reuse is of the shared `agent-executor` manager contract, not a sibling product
- GATE-WRITE — Every item has a `TC-N` prefix: 19 items, TC-01 … TC-19, all prefixed
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: PASS — the three gaps that decided the prior FAIL are closed. Solution step 1 (kind + request type) → TC-12 (single `TBackgroundTaskKind` declaration containing `'tool-invocation'`), TC-09 (request shape), TC-16 (DATA-010 line); step 2 runner + adoption registry → TC-03…TC-08, and **runner registration in `createDefaultBackgroundTaskRunners()` → TC-17** (function exists at `runners/index.ts:18`, consumed at `cli.ts:348` — verified; the `No runner for task kind` failure it forecloses is at `background-task-manager.ts:283-285` — verified); step 3 settings keys → TC-11, tracker / `/tasks` rendering → TC-12 second half (`background-command-api.ts:34` renders `${task.kind}:${task.label}` without switching on kind, so the tracker test is the rendering assertion that binds); step 4 decorator → TC-01/02/04/09, mode gating + print/serve diagnostic → TC-10, **`callTimeoutMs` handed to the supervisor as `perCallMs` → TC-18**; cancellation → TC-05; failure → TC-06; shutdown/restart → TC-07/TC-08; permission context + provenance → TC-09; step 5 scenario runner → TC-14; **step 6 docs (four SPECs + `agent-cli` README) → TC-19**, DATA-010 → TC-16; layering → TC-13; build/test/scans → TC-15. The paired Task's Plan keys every line to these TC-IDs. One assertion gap noted, not a distinct sub-item: the eligibility bound `autoBackgroundMs < callTimeoutMs` has no explicit test (TC-11 covers `0`; the budget timer in TC-09 makes the `≥` case unreachable by construction)
- GATE-WRITE — Command form or Observable behavior form: PASS for all 19 — each is command-first with a named observable including its negative half (TC-01 no spawn and no armed timer; TC-05 a late settle emits nothing; TC-10 the grep returns none; TC-13 the diff is EMPTY; TC-17 `exactly one runner whose kind === 'tool-invocation'` + a grep hit; TC-18 `timeouts.perCallMs === mcp.callTimeoutMs` + MCP-002 defaults unchanged; TC-19 `grep -ln` lists all five files + two scans exit 0). The prior entry's TC-12 content defect is repaired: the binding grep is now `TBackgroundTaskKind\s*=` → exactly one declaration
- GATE-WRITE — No banned phrase in criteria: none of "works correctly", "no errors", "implemented", "displays correctly" (`gate.mjs` and my grep agree)
- GATE-WRITE — `## Test Plan` present: present, with the derived-strategy line
- GATE-WRITE — One row per TC-N: 19 Completion Criteria = 19 Test Plan rows (counted independently: 19 / 19)
- GATE-WRITE — Each row has Test Type and Tool/Approach: 19 rows, none TBD
- GATE-WRITE — Manual rows have Notes: N/A — 0 manual rows
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` names `.agents/tasks/MCP-004-hand-long-running-mcp-calls-to-background-tasks.md`; the Task on disk now carries a TC-keyed Plan, a Test Plan, and a Scenario 1 identical to this document's (the prior entry's mirror defect is closed)
- GATE-WRITE — Evidence Log present and empty (first run): `gate.mjs` PASS — the one prior entry is this gate's own FAIL, none from a later gate
- GATE-WRITE — No `## Status` / `## Classification` body sections: none

**Mechanical set:** `HARNESS_BASE_REF=origin/integration/agreement-014 node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <this> --dry-run` re-run by this guardian: 27 criteria — 20 PASS, 0 FAIL, 7 PENDING-GUARDIAN; no entry written by the script. The 7 pending semantic criteria are judged above.

**Prior-entry defects, status now:** `ARCHITECTURE.md` removed from Affected Files and Solution step 6 says why (verified: no `background` in `ARCHITECTURE.md`) — closed. Task mirror — closed. `background-process-tool.ts:63` — corrected.

**Accuracy notes (recorded, not the decider):**

- Affected Scope still says the manager's terminal guards run "lines 139-316"; the last `isTerminalBackgroundTaskStatus` guard is at `:381`.
- Affected Files omits `packages/agent-executor/src/background-tasks/runners/index.ts` (Solution step 2 edits it), `packages/agent-executor/src/__tests__/default-runners.test.ts` (TC-17, new), and the three existing test files TC-10/TC-11/TC-18 extend (`mcp-startup.test.ts`, `mcp-definition-sources.test.ts`, `mcp-client-composition.test.ts` — all exist today).

**Judged by:** `backlog-gate-guard`
**Judged at:** HEAD `a63fe09f8bf2` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/draft/MCP-004-hand-long-running-mcp-calls-to-background-tasks.md` blob `58dfd4a38cd0` (untracked)
**Stacked base:** `origin/integration/agreement-014@a63fe09f8bf2` (`HARNESS_BASE_REF`; equals HEAD — the branch carries no commit of its own)

### [GATE-WRITE] — ❌ FAIL | 2026-09-22

**Status remains:** draft
**Failed criteria:**

- Completion Criteria › At least 1 criterion per distinct feature or sub-item (`semantic`): the per-mode
  policy has no criterion. The sub-item is stated four times — § Decision "Modes" (interactive TUI and
  `serve` adopted, "the host passes `toolCallHandoff`"; `print` rejected, "the host omits the policy and,
  when `mcp.autoBackgroundMs` is set, reports one diagnostic that it is ignored in print mode"),
  § Affected Scope `agent-cli` ("pass `toolCallHandoff` into the session options for the interactive and
  `serve` runtimes, omit it for `print` with a diagnostic when the setting is set"), § Solution step 3
  ("pass the policy for interactive and serve runtimes only"), and the paired Task's Plan line 35 ("S3 ·
  TC-11, TC-18 — `agent-cli`: … pass `toolCallHandoff` for interactive and serve, omit it for print with a
  diagnostic"). Found: none of TC-01…TC-24 asserts it. TC-11 asserts settings decoding (defaults, `0`,
  `autoBackgroundMs ≥ callTimeoutMs` with a diagnostic, invalid values refused); TC-18 asserts the
  `timeoutMs` override reaches the SDK request and the composition passes `mcp.callTimeoutMs` as the
  budget with MCP-002's defaults unchanged; TC-10/TC-24 drive `scriptedSession()` with a policy the test
  itself supplies; TC-14 is the example runner, which wires its own manager. No criterion observes which
  runtime receives `toolCallHandoff`, that `print` receives none, or that the print-mode diagnostic is
  emitted. The previous `✅ PASS` entry covered this sub-item under the earlier TC-10 ("mode gating +
  print/serve diagnostic → TC-10"); the rewrite re-keyed TC-10 to the owner gate and the mode coverage was
  dropped, so with `print` accidentally handed the policy — a one-shot run that exits at
  `print-mode.ts:168` `process.exit(channel.getExitCode())` with no drain, exactly the failure the
  Decision rejects — all 24 criteria still pass.
  **Required action:** add a criterion (or extend TC-11/TC-18's asserted observables, since the Task
  already keys the line there) that observes, in `mcp-startup.test.ts` / `mcp-client-composition.test.ts`
  or a mode test, that the interactive and `serve` session options carry `toolCallHandoff`, that the
  `print` options do not, and that `print` with `mcp.autoBackgroundMs` set emits exactly one diagnostic;
  add the matching Test Plan row(s) so the counts still match; re-key the Task Plan line if a new TC-ID is
  minted; then re-run GATE-WRITE.

**Semantic criteria checked (the other six) — all PASS:**

- Problem › concrete symptom — PASS. Verified on `a63fe09f8bf2`: `mcp-client-composition.ts:70`
  `perCallMs: 30_000`; `connection.ts:422-424` passes `timeoutMs: this.options.timeouts.perCallMs` to
  `session.callTool`; `background-task-contracts.ts:23` `TBackgroundTaskKind = 'agent' | 'process' |
'scheduled'`; `types.ts:127` `IBackgroundTaskManager`; `background-process-tool.ts:63` and
  `agent-tool.ts:209` both `mode: 'background'`; tracker `:70-80` subscribes via
  `retrieveSessionBackgroundTaskManager`. The wrong behaviour (timeout at 30 s or a frozen turn with no
  id, no status, cancel only by aborting the turn) is specific.
- Problem › reproduction condition — PASS. HTTP server whose tool sleeps 90 s, `robota`, the model calls
  it → blocks until `perCallMs`, no task id, `/tasks` empty; `mock-mcp-server.ts:99` `listDelayMs` exists
  and is correctly marked as analogous.
- Prior Art › research feeds Alternatives / Decision — PASS. 120 000 / `0` = off from the Claude Code
  threshold finding; synchronous task id from "Visible at handoff"; ordinary notification path from
  "Completion delivery"; no survival across exit from Claude Code's stated behaviour (mapped onto the
  existing `stale_worker` reconciliation, `interactive-session-restore.ts:204,214` verified); subagent
  and print rejection from "Subagent / non-interactive"; `callTimeoutMs` 600 000 in every mode from the
  Gemini CLI precedent with the print-mode consequence named; "effectively once" from OpenAI's
  at-least-once + idempotency finding; Alternative 2 rejected on the research's own characterisation of
  the MCP tasks primitive; the headless opt-in declined with a stated local ground.
- Architecture Review › Decision references the trade-off — PASS. Alternative 5's recorded costs are
  carried into the Decision rather than dropped: the manager admission edit is justified against
  `background-task-manager.ts:141-145` (queued cancel never reaches a handle — verified) and `:272-285`
  (`drainQueue` under `maxConcurrent`, `No runner for task kind` — verified); the `agent-session`
  `TASK_KINDS` edit (`background-task-members.ts:36`, decoded via `decodeLiteral` at `:153`;
  `record-decoder.ts:97,114,126` marks `corrupt` — verified) is contained under DATA-010; the new SSOT
  member while AGREEMENT-009 is `todo` is met by the DATA-010 line (TC-16; the Task exists, 0 hits today);
  five packages are cut into three ordered seams; the first draft's placement is kept as Alternative 3
  and rejected on measured grounds that hold (`cli.ts:418` `mcp.connect()` precedes every mode entry at
  `:469`/`:494`; `project-structure.md:373-382` + `check-background-workspace-conformance.mjs`
  `cli-agent-executor-import`; `in-process-subagent-runner.ts:233` `parentTools: deps.tools`); the
  `perCallMs` hidden change is replaced by a per-call `timeoutMs` override with the non-goal named.
- Architecture Review › new-surface placement — N/A. No new package, app, or presentation/interface
  surface and no boundary reclassification: the kind is a new member of an existing union, the runner
  sits beside `managed-shell-process-runner.ts` / `scheduled-task-runner.ts`, the wrapper beside
  `buildBackgroundProcessTool` (`create-session-runtime.ts:76-97`, `hasProcessRunner` at `:83` —
  verified), `agent-mcp` stays on `agent-core` only (`package.json` verified). On the broader reading the
  requirement is met anyway: Alternatives 1/3/4/5 are the competing placements, the Sibling scan names
  the analogous `agent-framework` spawn-time surfaces, and the reuse is of the shared `agent-executor`
  manager contract.
- Completion Criteria › Command form or Observable behavior form — PASS for all 24. Each is command-first
  with a named observable including its negative half, and the asserted shapes exist: `error.category`
  `'runner'`/`'validation'` are members of `TBackgroundTaskErrorCategory` (`background-task-contracts.ts:
44-50`); `IBackgroundTaskError { category, message, recoverable }` (`:56-60`); `timeoutReason ===
'stale_worker'` (`:42`, `:214`); `IBackgroundTaskResult.output` (`:170`); TC-07's `Background task
manager shutdown` is the manager's default reason (`background-task-manager.ts:226`) and the session
  passes `'Session shutdown'` (`interactive-session.ts:610`) — the two statements are consistent;
  `securityIdentity` is a real activation-record field (`mcp-activation.ts:41`); `serverId`/`sourceName`
  are on the catalog entry (`catalog/types.ts:25`, `build.ts:67-68`).

**Mechanical set:** `HARNESS_BASE_REF=origin/integration/agreement-014 node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <this> --dry-run` re-run by this guardian: 27 criteria — 20 PASS, 0 FAIL, 7 PENDING-GUARDIAN; 24 Completion Criteria = 24 Test Plan rows (counted independently); 0 manual rows; no banned phrase; no TBD/TODO; `## Evidence Log` present with 2 prior entries, none from a later gate; no entry written by the script.

**Accuracy notes (recorded, not the decider):**

- `build-agent-runtime.ts:55` → the assembled `tools` are passed at `:55`.
- `serve-mode.ts` lives at `packages/agent-cli/src/modes/serve-mode.ts`; `buildServeSessionOptions` is at `:106`, not inside `:58-93`.
- `IToolResult` (`agent-core/src/interfaces/tool.ts:34-40`) has no declared `text` member; the placeholder's `text:` rides the index signature, and `DiscoveredMCPTool.execute` today returns `{ success, data }` only (`discovered-tool.ts:146-150`). Legal, but GATE-APPROVAL should confirm the model-facing surface reads it.
- The Task's `## Test Plan` paragraph still says the fake-clock tests live in `agent-cli` and `agent-executor`; the spec now places the wrapper tests in `agent-framework`.

**Judged by:** `backlog-gate-guard`
**Judged at:** HEAD `a63fe09f8bf2` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/draft/MCP-004-hand-long-running-mcp-calls-to-background-tasks.md` blob `d4a87c40628e` (untracked)
**Stacked base:** `origin/integration/agreement-014@a63fe09f8bf2` (`HARNESS_BASE_REF`; equals HEAD — the branch carries no commit of its own)

### [GATE-WRITE] — ✅ PASS | 2026-09-22

**Status upgrade:** draft → review-ready

Re-run after the third `[GATE-WRITE] — ❌ FAIL | 2026-09-22` entry (blob `d4a87c40628e`). Ordering
check: GATE-WRITE is the entry gate (`gate-catalogue.md` § Prior-gate map exempts it from a prior-gate
PASS); the document is `status: draft` under `.agents/spec-docs/draft/`, the state this gate consumes;
the Evidence Log holds three prior entries, all this gate's own (FAIL, PASS, FAIL), none from a later
gate — a re-run after a FAIL is the sanctioned route.

- GATE-WRITE — File begins with `---` YAML frontmatter block: line 1 `---`, block closes at line 7
- GATE-WRITE — `status: draft` present in frontmatter: line 2 `status: draft`
- GATE-WRITE — `type:` is one of the 11 values: line 3 `type: BEHAVIOR`
- GATE-WRITE — `tags:` field present: line 6 `tags: [mcp, async, cli]`
- GATE-WRITE — Problem contains a concrete symptom: PASS — the wrong behaviour is two named observable outcomes (timeout at `perCallMs` 30 s, or a frozen turn with no status, no id, no cancel short of aborting the turn) on a named call path, and each measurement re-verified on `a63fe09f8bf2`: `mcp-client-composition.ts:70` `perCallMs: 30_000`; `connection.ts:422-424` passes `timeoutMs: this.options.timeouts.perCallMs`; `background-task-contracts.ts:23` `TBackgroundTaskKind = 'agent' | 'process' | 'scheduled'`; `background-process-tool.ts:63` and `agent-tool.ts:209` both `mode: 'background'` at spawn; `background-task-manager.ts:283-285` `No runner for task kind`
- GATE-WRITE — Problem contains a reproduction condition: PASS — when/where stated (an HTTP MCP server whose tool sleeps 90 s, `robota`, the model calls it → blocks until `perCallMs` elapses, no task id, `/tasks` empty); the cited delay mechanism exists (`src/__tests__/mock-mcp-server.ts:99` `listDelayMs`, applied in `mock-mcp-server-handlers.ts:114-115`) and the spec correctly marks it "style", i.e. analogous
- GATE-WRITE — No TBD/TODO or vague single-sentence Problem: `gate.mjs` — no TBD/TODO, 2061 chars, 8 sentences; my grep over the body (lines 1 – `## Evidence Log`) finds no TBD/TODO
- GATE-WRITE — `## Prior Art Research` section present: present, line 42
- GATE-WRITE — Section substantiated (≥1 documentation source): eight product/API/protocol-spec rows with URLs (Claude Code, Gemini CLI, OpenAI ×2, Cursor, Copilot/VS Code, MCP 2025-06-18 / 2025-11-25); no third-party source code; the Codex CLI hint is marked weak and not relied on; `scan-spec-research` reports substantiated
- GATE-WRITE — OR `Waived:` line: N/A — the section is substantiated; no waiver needed and none present
- GATE-WRITE — Research feeds Alternatives / Decision: PASS, traced — 120 000 ms default and `0` = off from the Claude Code threshold finding; synchronous task id as the tool result from "Visible at handoff"; delivery through the ordinary notification path from "Completion delivery"; no survival across exit from Claude Code's stated behaviour, mapped onto the existing `stale_worker` reconciliation (`interactive-session-restore.ts:204` verified); subagent and print rejection from "Subagent / non-interactive"; `callTimeoutMs` 600 000 in every mode from the Gemini CLI precedent with the print-mode consequence named; "effectively once" from OpenAI's at-least-once + idempotency finding; Alternative 2 rejected on the research's own characterisation of the MCP tasks primitive; the headless opt-in declined with a stated local ground (`print-mode.ts:168` `process.exit(channel.getExitCode())`, no drain — verified)
- GATE-WRITE — All 4 checklist items `[x]`: 4/4, each with inline evidence
- GATE-WRITE — Sibling scan `[x]` with evidence: names `BackgroundProcess` (`background-process-tool.ts`, via `buildBackgroundProcessTool`) and the `Agent` tool's background mode (`agent-tool.ts:209`) as spawn-time siblings with no in-flight promotion; `packages/agent-mcp/examples/verify-mcp-client.ts` exists as the scenario model
- GATE-WRITE — Alternatives Considered ≥2 with pro/con: five numbered alternatives, each with Pro and Con
- GATE-WRITE — Decision references the trade-off: PASS — Alternative 5's recorded costs are carried into the Decision, not dropped: the manager admission edit is justified against `background-task-manager.ts:141-145` (queued cancel never reaches a handle — verified) and `:283-285`; the `agent-session` `TASK_KINDS` edit (`background-task-members.ts:36`, decoded at `:153` — verified) is contained under DATA-010; the new SSOT member while AGREEMENT-009 is `todo` is met by the DATA-010 coordination line (TC-16); five packages are cut into three ordered seams; the first draft's placement stays as Alternative 3 and is rejected on measured grounds that hold (`build-agent-runtime.ts:55` `tools,` → `in-process-subagent-runner.ts:233` `parentTools: deps.tools` — both verified); the `perCallMs` hidden change is replaced by a per-call `timeoutMs` override with the non-goal named
- GATE-WRITE — New-surface placement (conditional): N/A — no new package, app, or presentation/interface surface and no boundary reclassification: the kind is a new member of an existing union, the runner sits beside `managed-shell-process-runner.ts` / `scheduled-task-runner.ts`, the wrapper beside `buildBackgroundProcessTool` (`create-session-runtime.ts:76`, `hasProcessRunner` at `:83` — verified), `agent-mcp` stays on `agent-core` only (`package.json:47,53` — verified), `agent-core` untouched (TC-13). On the broader reading the requirement is met anyway: Alternatives 1/3/4/5 are the competing placements, the Sibling scan names the analogous `agent-framework` spawn-time surfaces, and the reuse is of the shared `agent-executor` manager contract, not a sibling product
- GATE-WRITE — Every item has a `TC-N` prefix: 25 items, TC-01 … TC-25, all prefixed (counted independently)
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: PASS — the sub-item that decided the prior FAIL is closed: the per-mode policy (§ Decision "Modes", § Affected Scope `agent-cli`, § Solution step 3, Task Plan line 35) is now observed by **TC-25** — interactive and `serve` session options carry `toolCallHandoff` with `thresholdMs`/`budgetMs`/tool names, `print` carries none and emits exactly one diagnostic, `0` → no policy and no diagnostic — with its Test Plan row and the Task's S3/`agent-cli` Plan line re-keyed to `TC-11, TC-18, TC-25`. Full map: S1 kind + request → TC-12/TC-09/TC-22/TC-16; runner + adoption → TC-03…TC-08; admission never queued → TC-20; runner registration → TC-17; helpers/tracker/`/tasks` projection → TC-12; S2 `timeoutMs` override → TC-18; S3 threshold race → TC-01/02/04; owner gate (both runners) → TC-10; provenance + budget expiry → TC-09; turn-signal unlink → TC-21; admission refusal (§ Fallback) → TC-23; settings keys, `0`, `auto ≥ timeout`, invalid values → TC-11; per-mode policy → TC-25; budget passed by the composition → TC-18; cancellation → TC-05; failure → TC-06; shutdown → TC-07; restart → TC-08 + TC-22; scenario runner → TC-14; functional test + manifest row → TC-24; docs (six SPECs + README) → TC-19; DATA-010 line → TC-16; layering → TC-13; build/tests/scans → TC-15. No sub-item in § Solution or § Decision is left without a criterion
- GATE-WRITE — Command form or Observable behavior form: PASS for all 25 — each is command-first with a named observable including its negative half (TC-01 no admit and no armed timer; TC-05 a late settle emits nothing; TC-13 the diff is EMPTY; TC-25 `print` carries NO `toolCallHandoff`, `0` emits no diagnostic). The placeholder result is now asserted on declared `IToolResult` fields — `data.backgroundTaskId`, `data.status`, `data.message` — and `IToolResult` (`agent-core/src/interfaces/tool.ts:34-40`) declares `success`, `data?: TUniversalValue`, `error?`, `metadata?` exactly as the Decision states; `DiscoveredMCPTool.execute` returns `{ success, data }` today (`discovered-tool.ts:150`), so the shape is consistent with the surface it decorates
- GATE-WRITE — No banned phrase in criteria: none of "works correctly", "no errors", "implemented", "displays correctly" (`gate.mjs` and my grep agree)
- GATE-WRITE — `## Test Plan` present: present, with the derived-strategy line
- GATE-WRITE — One row per TC-N: 25 Completion Criteria = 25 Test Plan rows, ids 01–25 identical in both (counted independently)
- GATE-WRITE — Each row has Test Type and Tool/Approach: 25 rows, none TBD
- GATE-WRITE — Manual rows have Notes: N/A — 0 manual rows
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` names `.agents/tasks/MCP-004-hand-long-running-mcp-calls-to-background-tasks.md`; the Task on disk (`status: todo`, modified) carries a TC-keyed Plan (lines 28–38, every TC-01…TC-25 keyed), a `## Test Plan` that now places the fake-clock tests in `agent-framework` and `agent-executor` (the prior entry's note is closed), and Scenario 1 identical to this document's
- GATE-WRITE — Evidence Log present and empty (first run): `gate.mjs` PASS — three prior entries, all GATE-WRITE, none from a later gate
- GATE-WRITE — No `## Status` / `## Classification` body sections: none

**Mechanical set:** `HARNESS_BASE_REF=origin/integration/agreement-014 node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <this> --dry-run` re-run by this guardian: 27 criteria — 20 PASS, 0 FAIL, 7 PENDING-GUARDIAN; no entry written by the script. The 7 pending semantic criteria are judged above.

**Prior-entry notes, status now:** `build-agent-runtime.ts:55` → `:55` — corrected (verified: `tools,` at `:55`). Placeholder `text:` on the index signature → `data.{backgroundTaskId,status,serverId,toolName,message}` — corrected. Task `## Test Plan` paragraph → `agent-framework` + `agent-executor` — corrected. Still open, accuracy only: § Decision "Modes" cites `serve-mode.ts:45,106`; `IServeModeOptions` is at `:45` and `buildServeSessionOptions` at `:106`.

**Judged by:** `backlog-gate-guard`
**Judged at:** HEAD `a63fe09f8bf2` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/draft/MCP-004-hand-long-running-mcp-calls-to-background-tasks.md` blob `dc2e08a4b6fe` (untracked)
**Stacked base:** `origin/integration/agreement-014@a63fe09f8bf2` (`HARNESS_BASE_REF`; equals HEAD — the branch carries no commit of its own)

### [GATE-WRITE] — ❌ FAIL | 2026-09-22

**Status remains:** draft
**Failed criteria:**

- Completion Criteria › At least 1 criterion per distinct feature or sub-item (`semantic`): § Solution
  declares S2 and S3 sub-items that no criterion covers — and that the rest of the document rejects.
  Step 2 (line 387): "Add `timeoutMs?` to `IMCPToolInvoker.callTool` and honour it in the supervisor".
  Step 3 (line 391): "pass the budget into each discovered tool". Found against them: § Affected Scope
  `agent-mcp` says "No change to `IMCPToolInvoker`, `DiscoveredMCPTool` or the CLI's structural
  `IMcpServerConnection`" and puts the budget on `IMCPTimeouts.toolCallMs`; § Decision S2 says
  `callTool` passes `timeouts.toolCallMs` where it passed `perCallMs`; § Decision S3 says "The wrapper
  never reaches the MCP invoker: the call's own budget is set on the `agent-cli → agent-mcp` edge";
  TC-18 asserts `IMCPTimeouts.toolCallMs` as a fifth typed timeout and the composition setting it;
  Affected Files lists only `connection.ts` for `agent-mcp` (no `discovered-tool.ts`, where
  `IMCPToolInvoker` lives — `catalog/discovered-tool.ts:35-40`, `callTool(name, args, options?: {
signal })`, no `timeoutMs`); the paired Task's Plan line 31 reads "`IMCPTimeouts.toolCallMs`, honoured
  by `callTool`; `perCallMs` unchanged; composition sets it from `mcp.callTimeoutMs`". So the document
  carries two S2 designs: the one § Decision/TC-18/Task commit to, and the superseded one § Solution
  still instructs. Read as-is, § Solution's sub-item has no criterion; read against § Decision, it
  cannot be given one. Secondary, same criterion: TC-04 (line 414) keys its sweep to "the `admit`
  promise resolves 0–2 ticks late" and the Test Plan Notes for TC-01 ("the absence of an admit") and
  TC-04 ("admit latency sweep") name the same mechanism, which § Decision S1 removed ("no `admit`
  method" — the pending promise is now `manager.spawn`); the observable is still exactly-one delivery,
  but the named input does not exist in the design under judgement.
  **Required action:** restate § Solution steps 2 and 3 to match § Decision S2/S3 (`IMCPTimeouts.toolCallMs`
  honoured by `callTool`, set once by the composition from `mcp.callTimeoutMs`; the wrapper carries no
  budget and touches no invoker or discovered tool), or — if the invoker change is intended — put it
  back into § Affected Scope, Affected Files, TC-13/TC-18 and the Task, so the document names one S2;
  re-key TC-04 and the TC-01/TC-04 Test Plan notes from `admit` to `spawn`; then re-run GATE-WRITE.

**Semantic criteria checked (the other six) — all PASS:**

- Problem › concrete symptom — PASS. Two named wrong outcomes (timeout at `perCallMs` 30 s, or a frozen
  turn with no status, no id, cancel only by aborting the turn) on a named call path; re-verified on
  `a63fe09f8bf2`: `mcp-client-composition.ts:70` `perCallMs: 30_000`; `connection.ts:424` passes
  `timeoutMs: this.options.timeouts.perCallMs` in `callTool` (and `:372,:398` `perRequestTimeoutMs`
  for discovery/protocol, as § Affected Scope says); `IMCPTimeouts` has exactly four members
  (`connection.ts:48-53`); `background-task-contracts.ts:23` `TBackgroundTaskKind = 'agent' | 'process'
| 'scheduled'`; `background-task-manager.ts:283-285` `No runner for task kind`.
- Problem › reproduction condition — PASS. HTTP server whose tool sleeps 90 s, `robota`, the model calls
  it → blocks until `perCallMs`, no task id, `/tasks` empty; `mock-mcp-server.ts:99` `listDelayMs` exists
  and is correctly marked "style", i.e. analogous.
- Prior Art › research feeds Alternatives / Decision — PASS. 120 000 / `0` = off from the Claude Code
  threshold finding; synchronous task id from "Visible at handoff"; ordinary notification path from
  "Completion delivery"; no survival across exit mapped onto the existing `stale_worker` reconciliation
  (`interactive-session-restore.ts:204` verified); subagent and print rejection from "Subagent /
  non-interactive"; `callTimeoutMs` 600 000 from the Gemini CLI precedent with the print-mode
  consequence named; "effectively once" from OpenAI's at-least-once + idempotency finding; Alternative 2
  rejected on the research's own characterisation of the MCP tasks primitive; headless opt-in declined
  on a local ground (`print-mode.ts:168` `process.exit(channel.getExitCode())`, no drain — verified).
- Architecture Review › Decision references the trade-off — PASS. Alternative 5's costs are carried into
  the Decision: the manager admission edit is justified against `background-task-manager.ts:141-145`
  (queued cancel never reaches a handle — verified) and `drainQueue` under `maxConcurrent` (`:272-280`
  — verified); `createQueuedBackgroundTaskState` at `helpers.ts:155` (verified) is the named seam; the
  watchdogs' `kind !== 'agent'` gate at `background-task-watchdogs.ts:40-42` (verified) grounds the
  "`maxRuntimeMs` informational" statement; the `TASK_KINDS` edit (`background-task-members.ts:36`,
  decoded at `:153`) is contained under DATA-010 (Task exists, 0 hits today — TC-16 is the obligation);
  Alternative 3's rejection holds (`cli.ts:418` `additionalTools.push(...(await mcp.connect()))`
  precedes the mode entries at `:469`/`:494`; `project-structure.md:373-382` + the
  `cli-agent-executor-import` rule; `in-process-subagent-runner.ts:233` `parentTools: deps.tools`); the
  `perCallMs` hidden change is replaced by a fifth typed timeout with the non-goal named; the
  construction-time exclusion is grounded in `tool-execution-service.ts:225-226` (`ownerType: 'tool'`,
  `ownerId: toolCall.id` — verified) and `SettingsSchema` (`config-types.ts:155-192`) carries no `mcp`
  key (verified: 0 hits).
- Architecture Review › new-surface placement — N/A. No new package, app, or presentation/interface
  surface and no boundary reclassification: the kind is a new member of an existing union; the runner
  sits beside `managed-shell-process-runner.ts` / `scheduled-task-runner.ts`; the wrapper beside
  `buildBackgroundProcessTool` (`create-session-runtime.ts:76`, `hasProcessRunner` at `:83` —
  verified); `agent-mcp` peers on `agent-core` only (`package.json:47,53` — verified); `agent-core`
  untouched (TC-13). On the broader reading the requirement is met anyway: Alternatives 1/3/4/5 are the
  competing placements, the Sibling scan names the analogous `agent-framework` spawn-time surfaces, and
  the reuse is of the shared `agent-executor` manager contract, not a sibling product.
- Completion Criteria › Command form or Observable behavior form — PASS on form for all 25. Each is
  command-first with a named observable including its negative half (TC-01 no spawn and no armed timer;
  TC-05 a late settle emits nothing; TC-13 the diff is EMPTY; TC-21 the post-`spawn` turn abort emits no
  task event; TC-23 the registry is empty and `execute` count is still 1; TC-25 `print` carries NO
  `toolCallHandoff`). Asserted shapes exist: `IToolResult { success, data?, error?, metadata? }`
  (`agent-core/src/interfaces/tool.ts:34-40`); `'runner'`/`'validation'` in
  `TBackgroundTaskErrorCategory` (`background-task-contracts.ts:44-52`); `securityIdentity`
  (`agent-mcp/src/mcp-activation.ts:41`); `serverId`/`sourceName` (`catalog/types.ts:25,113`);
  `'Session shutdown'` (`interactive-session.ts:610`). TC-04's `admit` wording is recorded under the
  failed criterion above, not here.

**Mechanical set:** `HARNESS_BASE_REF=origin/integration/agreement-014 node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <this> --dry-run` re-run by this guardian: 27 criteria — 20 PASS, 0 FAIL, 7 PENDING-GUARDIAN; 25 Completion Criteria = 25 Test Plan rows (counted independently, ids 01–25 in both); 0 manual rows; no banned phrase; no TBD/TODO; `## Evidence Log` present with 4 prior entries, all GATE-WRITE, none from a later gate; no entry written by the script.

**Accuracy defects that mislead a later reader (recorded, not the decider):**

- `createSubagentSession` lives at `packages/agent-framework/src/assembly/create-subagent-session.ts` (`filterTools` at `:167-196`), not `src/subagents/`; its existing test is `src/__tests__/create-subagent-session.test.ts`. Affected Files marks `src/subagents/create-subagent-session.ts` and `src/subagents/__tests__/create-subagent-session.test.ts` as "(edit)" — neither path exists — and TC-10's command runs the nonexistent test path.
- `build-agent-runtime.ts:55` (line 274) → the assembled `tools` are passed at `:55` (the previous entry's correction regressed; line 206 still says `:55`).
- `interactive-session-fork.ts:53` → `createSubagentSession({` is at `:49`.
- `mcp-client-composition.ts:173-190`, `buildSupervisorOptions` (line 143) are import names; the supervisor timeouts are wired in `buildSupervisorOptions` at `:177-190`, where `openMcpSession` receives `{ startupMs, perCallMs }` only (`:186`) and the supervisor receives the whole `timeouts` (`:190`) — the site a `toolCallMs` addition must reach.
- § Decision "Validated before approval" (line 342) still says "producers of `tool-call` requests" — the kind is `'tool-invocation'`.
- `serve-mode.ts:45,106` — now correct (`IServeModeOptions` at `:45`, `buildServeSessionOptions` at `:106`); the previous entry's open note is closed.

**Judged by:** `backlog-gate-guard`
**Judged at:** HEAD `a63fe09f8bf2` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/draft/MCP-004-hand-long-running-mcp-calls-to-background-tasks.md` blob `0c05acd4d8a9` (untracked)
**Stacked base:** `origin/integration/agreement-014@a63fe09f8bf2` (`HARNESS_BASE_REF`; equals HEAD — the branch carries no commit of its own)

### [PROPOSAL-REVIEW] — ✅ ENDORSE | 2026-09-22

**Status remains:** draft (recorded for GATE-APPROVAL; the design gate reads this entry)

**Reviewer:** `proposal-reviewer`, four rounds on this document's § Architecture Review, each premise tested against `origin/integration/agreement-014@a63fe09f8`.

- Round 1 — REVISE: wrapper placement in `agent-cli/src/startup` violated the composition-root exemption and could not reach the manager or session id; queued adopted tasks would be un-cancellable; turn-signal coupling; `agent-session` codec `TASK_KINDS` marks unknown kinds `corrupt`; restart already reconciled by the framework; raising `perCallMs` was a hidden change; `serve` is long-lived; criteria named non-existent fields. All folded in (§ Alternatives 3 records the rejected placement).
- Round 2 — REVISE: per-call owner gate keyed on fields constant for every call (`ownerType: 'tool'`, `ownerId: toolCall.id`); budget had no typed path from wrapper to invoker; unlink-before-spawn contradicted the declared fallback; forks share tool instances too. Folded in: construction-time wrap/unwrap at `assembly/create-subagent-session.ts`, `IMCPTimeouts.toolCallMs`, unlink after a successful `spawn`, token release.
- Round 3 — REVISE (narrow): `toolCallMs` must be required, not aliased; § Solution/checklist/paths stale. Folded in.
- Round 4 — **ENDORSE**: "The decision (Alternative 5, three seams) is correct, its placement mirrors the proven analog, every premise I tested across four rounds now holds against source, and the document no longer contradicts itself anywhere I can find." Rule alignment: No Fallback Policy (alias rejected; one declared fallback in the sanctioned form), "Silence is not success", composition-root exemption, testing-layering rules 3 and 6, finding-depth (`Contained — DATA-010.`; EXEC-2062, DELIVERY-2525 filed), barrel-parameter-types, issue #2524 non-goal stated plainly.
- Separate root items the review produced: `.agents/tasks/EXEC-2062-*.md` (id minting, under AGREEMENT-009's issue #2062), `.agents/tasks/DELIVERY-2525-*.md` (model-facing delivery, under umbrella issue #2525). Name-only observations left unfolded: the child-process subagent worker composes no MCP tools; `mcpServers` bypasses `SettingsSchema` (MCP-002's decision); `IToolExecutionContext.sessionId` has no producer.

**Judged by:** `proposal-reviewer` (design review; recorded by the author verbatim from the returned verdict)
**Judged at:** HEAD `a63fe09f8bf2` · base `origin/integration/agreement-014@a63fe09f8bf2` · document `.agents/spec-docs/draft/MCP-004-hand-long-running-mcp-calls-to-background-tasks.md` (untracked)

### [STRUCTURE-AUDIT] — ✅ PLACEMENT SOUND, 7 FINDINGS APPLIED | 2026-09-22

**Status remains:** draft (structure channel for GATE-APPROVAL)

**Auditor:** `architecture-structure-auditor`, 31/31 cells (six targets × seven criteria), `blocker=0 high=2 medium=3 low=2`.

- F1 (high) owner gate keyed on an identity the context does not carry → gate at construction (wrap by replacement; unwrap in `filterTools`). Applied.
- F2 (high) budget had no typed path from the wrapper to the invoker → budget on the supervisor's typed timeouts (`toolCallMs`), set by the composition; wrapper owns no timer. Applied (converged with review round 2).
- F3 (medium) `admit()` / `adopt: true` are the wrong seam → runner-declared `admission: 'already-running'` on the existing SPI, honoured by `spawn`. Applied.
- F4 (medium) MCP-named settings keys do not belong in the framework schema → read by the CLI beside `mcpServers`; `SettingsSchema` untouched (TC-11 diff assertion). Applied.
- F5 (medium) second budget field → base `maxRuntimeMs` carries the remaining budget. Applied.
- F6 (low) `'tool-call'` collides with the execution-origin kind `tool_call` → kind renamed `'tool-invocation'`; the feature keeps its name. Applied.
- F7 (low) surface consistency → request type on the executor re-export lists; `IToolCallHandoffPolicy` named and exported; builder off the barrel. Applied.
- Healthy cells recorded: placement at the SSOT and beside the existing runners/assembly; every dependency edge pre-exists (`framework → executor`, `session → interface-execution`, `cli → mcp`); no `package.json` or `tsconfig` edge changes; S1 and S2 independently buildable, S3 after both.

**Judged by:** `architecture-structure-auditor` (structure channel; recorded by the author verbatim from the returned report)
**Judged at:** HEAD `a63fe09f8bf2` · base `origin/integration/agreement-014@a63fe09f8bf2` · document `.agents/spec-docs/draft/MCP-004-hand-long-running-mcp-calls-to-background-tasks.md` (untracked)

### [GATE-WRITE] — ✅ PASS | 2026-09-22

**Status upgrade:** draft → review-ready

Re-run after the fifth `[GATE-WRITE] — ❌ FAIL | 2026-09-22` entry (blob `0c05acd4d8a9`). Ordering
check: GATE-WRITE is the entry gate (`gate-catalogue.md` § Prior-gate map exempts it from a prior-gate
PASS); the document is `status: draft` under `.agents/spec-docs/draft/`, the state this gate consumes;
the Evidence Log holds five prior GATE-WRITE entries (FAIL, PASS, FAIL, PASS, FAIL) and two non-gate
review records (`[PROPOSAL-REVIEW]`, `[STRUCTURE-AUDIT]`, both recorded for GATE-APPROVAL), none from a
later gate — a re-run after a FAIL is the sanctioned route.

- GATE-WRITE — File begins with `---` YAML frontmatter block: line 1 `---`, block closes at line 7
- GATE-WRITE — `status: draft` present in frontmatter: line 2 `status: draft`
- GATE-WRITE — `type:` is one of the 11 values: line 3 `type: BEHAVIOR`
- GATE-WRITE — `tags:` field present: line 6 `tags: [mcp, async, cli]`
- GATE-WRITE — Problem contains a concrete symptom: PASS — two named wrong outcomes (timeout at `perCallMs` 30 s, or a frozen turn with no status, no id, no cancel short of aborting the turn) on the named call path `DiscoveredMCPTool.execute → MCPConnectionSupervisor.callTool → SDK client`; every measurement re-verified on `a63fe09f8bf2`: `mcp-client-composition.ts:70` `perCallMs: 30_000`; `connection.ts:424` `timeoutMs: this.options.timeouts.perCallMs` in `callTool`; `IMCPTimeouts` has exactly four members (`connection.ts:48-53`); `background-task-contracts.ts:23` `TBackgroundTaskKind = 'agent' | 'process' | 'scheduled'`; `types.ts:127` `IBackgroundTaskManager`; tracker `:70-80` subscribes via `retrieveSessionBackgroundTaskManager`; `background-process-tool.ts:63` and `agent-tool.ts:209` both `mode: 'background'` at spawn
- GATE-WRITE — Problem contains a reproduction condition: PASS — when/where stated (an HTTP MCP server whose tool sleeps 90 s, `robota`, the model calls it → blocks until `perCallMs` elapses, no task id, `/tasks` empty); the cited delay mechanism exists (`src/__tests__/mock-mcp-server.ts:99` `listDelayMs`) and the spec marks it "style", i.e. analogous
- GATE-WRITE — No TBD/TODO or vague single-sentence Problem: `gate.mjs` — no TBD/TODO, 2061 chars, 8 sentences; my grep over the body (lines 1 – `## Evidence Log`) finds no TBD/TODO (the three `todo` hits are the status word of sibling Tasks)
- GATE-WRITE — `## Prior Art Research` section present: present, line 42
- GATE-WRITE — Section substantiated (≥1 documentation source): eight product/API/protocol-spec rows with URLs (Claude Code, Gemini CLI, OpenAI ×2, Cursor, Copilot/VS Code, MCP 2025-06-18 / 2025-11-25); no third-party source code; the Codex CLI hint is marked weak and not relied on; `scan-spec-research` reports substantiated
- GATE-WRITE — OR `Waived:` line: N/A — the section is substantiated; no waiver needed and none present
- GATE-WRITE — Research feeds Alternatives / Decision: PASS, traced — 120 000 ms default and `0` = off from the Claude Code threshold finding; synchronous task id as the tool result from "Visible at handoff"; delivery through the ordinary notification path from "Completion delivery"; no survival across exit from Claude Code's stated behaviour, mapped onto the existing `stale_worker` reconciliation (`interactive-session-restore.ts:204` verified); subagent and print rejection from "Subagent / non-interactive"; `callTimeoutMs` 600 000 in every mode from the Gemini CLI precedent with the print-mode consequence named; "effectively once" from OpenAI's at-least-once + idempotency finding; Alternative 2 rejected on the research's own characterisation of the MCP tasks primitive; the headless opt-in declined on a stated local ground (`print-mode.ts:168` `process.exit(channel.getExitCode())`, no drain — verified)
- GATE-WRITE — All 4 checklist items `[x]`: 4/4, each with inline evidence
- GATE-WRITE — Sibling scan `[x]` with evidence: names `BackgroundProcess` (`background-process-tool.ts`, via `buildBackgroundProcessTool`) and the `Agent` tool's background mode (`agent-tool.ts:209`) as spawn-time siblings with no in-flight promotion; `packages/agent-mcp/examples/verify-mcp-client.ts` exists as the scenario model
- GATE-WRITE — Alternatives Considered ≥2 with pro/con: five numbered alternatives, each with Pro and Con
- GATE-WRITE — Decision references the trade-off: PASS — Alternative 5's recorded costs are carried into the Decision, not dropped: the manager admission edit is justified against `background-task-manager.ts:141-145` (queued cancel never reaches a handle — verified) and `drainQueue` under `maxConcurrent` (`:272-280` — verified), `createQueuedBackgroundTaskState` at `helpers.ts:155` (verified) is the named seam, the watchdogs' `kind !== 'agent'` gate (`background-task-watchdogs.ts:40-42,119` — verified) grounds "`maxRuntimeMs` informational"; the `TASK_KINDS` edit (`background-task-members.ts:36`, decoded at `:153`; `record-decoder.ts:97,114,126` marks `corrupt` — verified) is contained under DATA-010 (Task exists, 0 hits today — TC-16 is the obligation); the fifth typed timeout is REQUIRED with the alias rejected under the No Fallback Policy and issue #2524's non-goal stated plainly; Alternative 3's rejection holds (`cli.ts:418` `mcp.connect()` precedes the mode entries at `:469`/`:494`; `project-structure.md:373-382` + `cli-agent-executor-import`; `build-agent-runtime.ts:55` `tools,` → `in-process-subagent-runner.ts:233` `parentTools: deps.tools` — verified); the construction-time exclusion is grounded in `tool-execution-service.ts:225-226` (`ownerType: 'tool'`, `ownerId: toolCall.id` — verified) and `SettingsSchema` (`config-types.ts:155-192`) carries no `mcp` key (0 hits — verified)
- GATE-WRITE — New-surface placement (conditional): N/A — no new package, app, or presentation/interface surface and no boundary reclassification: the kind is a new member of an existing union; the runner sits beside `managed-shell-process-runner.ts` / `scheduled-task-runner.ts` (directory verified); the wrapper sits beside `buildBackgroundProcessTool` (`create-session-runtime.ts:76`, `hasProcessRunner` at `:83` — verified); `IToolCallHandoffPolicy` is a new option on the existing public `ICreateSessionOptions`, and the `mcp` settings keys sit beside `mcpServers` in the documents MCP-002 already reads; `agent-mcp` peers on `agent-core` only (`package.json:47,53` — verified); `agent-core` untouched (TC-13). On the broader reading the requirement is met anyway: Alternatives 1/3/4/5 are the competing placements, the Sibling scan names the analogous `agent-framework` spawn-time surfaces, and the reuse is of the shared `agent-executor` manager contract, not a sibling product
- GATE-WRITE — Every item has a `TC-N` prefix: 25 items, TC-01 … TC-25, all prefixed (counted independently)
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: PASS — the sub-item that decided the prior FAIL is closed: § Solution step 2 now reads "Add the required `IMCPTimeouts.toolCallMs`, honoured by `callTool` where `perCallMs` was hard-coded; migrate the eight `IMCPTimeouts` literals; `perCallMs` unchanged" and step 3 "set `toolCallMs` from it" — the same S2 that § Affected Scope `agent-mcp`, § Decision S2, TC-18 and the Task's Plan line 31 commit to; no invoker or discovered-tool change is instructed anywhere in the body (`IMCPToolInvoker.callTool` at `discovered-tool.ts:35-40` takes `{ signal }` only, consistent with "No change"). The eight-literal count is verified: `mcp-client-composition.ts:68-73`, `supervisor-test-helpers.ts:58-64`, `verify-mcp-client.ts:64`, `timeout-semantics.test.ts:38,59,80,108,136` — the other `{ startupMs, perCallMs }` literals in the tree are `IMCPSessionTimeouts` (`client/session.ts:40-45`), not `IMCPTimeouts`. Full map: S1 kind + request → TC-12/TC-09/TC-22/TC-16; runner + adoption → TC-03…TC-08; admission never queued → TC-20; runner registration → TC-17; helpers/tracker/`/tasks` projection → TC-12; S2 required `toolCallMs` + `callTool` + composition + MCP-002 defaults → TC-18, literal migration compile-enforced → TC-15; S3 threshold race → TC-01/02/04; wrap-by-replacement + unwrap for subagents AND forks → TC-10; provenance + budget expiry → TC-09; turn-signal unlink → TC-21; admission refusal (§ Fallback) → TC-23; settings keys, `0`, `auto ≥ timeout`, invalid values → TC-11; per-mode policy + print diagnostic → TC-25; cancellation → TC-05; failure → TC-06; shutdown → TC-07; restart → TC-08 + TC-22; scenario runner → TC-14; functional test + manifest row → TC-24; docs (six SPECs + README) → TC-19; DATA-010 line → TC-16; layering → TC-13; build/tests/scans → TC-15. Assertion gap noted, not a distinct sub-item: the runner's unknown-token branch (`start(task)` → `category: 'validation'`) has no explicit test; it is an error branch of the runner sub-item TC-03…TC-07 own
- GATE-WRITE — Command form or Observable behavior form: PASS for all 25 — each is command-first with a named observable including its negative half (TC-01 no `spawn` and no armed timer; TC-04 the `spawn` promise resolves 0–2 ticks late — the `admit` wording is gone from TC-04 and the TC-01/TC-04 Test Plan notes; TC-05 a late settle emits nothing; TC-13 the diff is EMPTY; TC-21 the post-`spawn` turn abort emits no task event; TC-23 the registry is empty and `execute` count is still 1; TC-25 `print` carries NO `toolCallHandoff`). The commands resolve: TC-10 runs `src/__tests__/create-subagent-session.test.ts` (exists); TC-12's binding grep returns exactly one declaration today; TC-13's two greps return 0 today; TC-15/TC-19 name `run-all-scans.mjs`, `check-spec-public-surface.mjs`, `check-spec-paths.mjs` (all exist); TC-24's `scriptedSession()` exists (`testing/scripted-session-harness.ts`) and `functional-coverage-manifest.json` exists. Asserted shapes exist: `IToolResult { success, data?, error?, metadata? }` (`agent-core/src/interfaces/tool.ts:34-40`); `'runner'`/`'validation'` in `TBackgroundTaskErrorCategory` (`background-task-contracts.ts:44-52`); `securityIdentity` (`mcp-activation.ts:41`); `'Session shutdown'` (`interactive-session.ts:610`); `'Background task manager shutdown'` (`background-task-manager.ts:226`)
- GATE-WRITE — No banned phrase in criteria: none of "works correctly", "no errors", "implemented", "displays correctly" (`gate.mjs` and my grep agree)
- GATE-WRITE — `## Test Plan` present: present, line 442, with the derived-strategy line
- GATE-WRITE — One row per TC-N: 25 Completion Criteria = 25 Test Plan rows, ids 01–25 identical in both (counted independently)
- GATE-WRITE — Each row has Test Type and Tool/Approach: 25 rows, none TBD
- GATE-WRITE — Manual rows have Notes: N/A — 0 manual rows
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` names `.agents/tasks/MCP-004-hand-long-running-mcp-calls-to-background-tasks.md`; the Task on disk (`status: todo`, modified) carries a TC-keyed Plan (every TC-01…TC-25 keyed; S2 line = `IMCPTimeouts.toolCallMs` honoured by `callTool`, composition sets it; S3 `agent-cli` line = TC-11/TC-18/TC-25), a `## Test Plan` placing the fake-clock tests in `agent-framework` and `agent-executor`, and Scenario 1 identical to this document's
- GATE-WRITE — Evidence Log present and empty (first run): `gate.mjs` PASS — 7 prior entries, five GATE-WRITE plus two non-gate review records, none from a later gate
- GATE-WRITE — No `## Status` / `## Classification` body sections: none

**Mechanical set:** `HARNESS_BASE_REF=origin/integration/agreement-014 node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <this> --dry-run` re-run by this guardian: 27 criteria — 20 PASS, 0 FAIL, 7 PENDING-GUARDIAN; no entry written by the script. The 7 pending semantic criteria are judged above.

**Prior-entry defects, status now:** § Solution steps 2–3 restated to S2/S3 — closed. TC-04 and the TC-01/TC-04 notes say `spawn` — closed. § Validated says `tool-invocation` (line 348) — closed. `create-subagent-session` paths → `src/assembly/create-subagent-session.ts` / `src/__tests__/create-subagent-session.test.ts` (both exist; the old `src/subagents/` paths appear nowhere in the body) — closed. `build-agent-runtime.ts:55` `tools,` — verified. `interactive-session-fork.ts:53` `parentTools: deps.tools` — verified (the predecessor's `:49` was the `createSubagentSession({` line; the spec cites the tools line, which is correct). `mcp-client-composition.ts:173-190` `buildSupervisorOptions` (function at `:173`, `timeouts` handed to the supervisor at `:190`) — verified.

**Accuracy notes (recorded, not the decider):**

- § Affected Scope "SPEC of the five edited packages" and § Solution step 5 "the five packages' SPEC" undercount: Affected Files and TC-19 name six SPECs (`agent-cli/docs/SPEC.md` included) plus the README — TC-19 binds the stricter set.
- `supervisor-test-helpers.ts:61` → the `IMCPTimeouts` literal spans `:58-64` (`perCallMs` at `:60`).
- `filterTools` cited `:168-197` → the `function filterTools(` keyword is at `:167`; closing brace at `:197`.
- The `[PROPOSAL-REVIEW]` and `[STRUCTURE-AUDIT]` entries are author-transcribed ("recorded by the author verbatim"); their standing as independent evidence is GATE-APPROVAL's to weigh, not this gate's.

**Judged by:** `backlog-gate-guard`
**Judged at:** HEAD `a63fe09f8bf2` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/draft/MCP-004-hand-long-running-mcp-calls-to-background-tasks.md` blob `faf2e611c993` (untracked)
**Stacked base:** `origin/integration/agreement-014@a63fe09f8bf2` (`HARNESS_BASE_REF`; equals HEAD — the branch carries no commit of its own)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-22

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인 — 구현 진행"
**Given:** 2026-09-22, this conversation
**Review fingerprint:** 5986acd6019e (review 37f6c359, type/tags ea3c2f52)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-22, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (5986acd6019e) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `a63fe09f8bf2` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/backlog/MCP-004-hand-long-running-mcp-calls-to-background-tasks.md` blob `1bcd6513f2c6` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-22

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인 — 구현 진행"
**Given:** 2026-09-22, this conversation

Guardian judgement of the three semantic criteria the mechanical evaluator left `PENDING-GUARDIAN`
(`HARNESS_BASE_REF=origin/integration/agreement-014 node scripts/harness/gate.mjs judge --gate
GATE-APPROVAL --doc <this> --dry-run` re-run by this guardian: 9 criteria — 6 PASS, 0 FAIL, 3
PENDING-GUARDIAN; no entry written by the script), with the mechanical set re-checked where a hand
check could reach it.

Ordering check: PASS — `[GATE-WRITE] — ✅ PASS | 2026-09-22` (the sixth GATE-WRITE entry, judged by
`backlog-gate-guard` at blob `faf2e611c993`) carries `**Status upgrade:** draft → review-ready`, and
the document's current `status:` is `review-ready` — the `recorded-pass` rule the Prior-gate map
declares for this row is satisfied by the document's own state; the file sits under
`.agents/spec-docs/backlog/`, the folder `spec-workflow.md` § Lifecycle Folders maps `review-ready`
to. NON-COMPLIANCE trigger checked: no implementation work precedes this gate — `git log
origin/integration/agreement-014..HEAD` is empty and `git status --porcelain` shows only
`.agents/` paths (this document and two review-produced Tasks untracked, the paired Task modified);
no `packages/` or `scripts/` path is touched.

- GATE-APPROVAL — User has provided explicit approval in the current conversation: PASS (mechanical, `gate.mjs`) — the standing `[GATE-APPROVAL]` entry written by `gate.mjs approve --route DIRECT` at line 979 carries `**Instruction (verbatim):** "승인 — 구현 진행"` and `**Given:** 2026-09-22, this conversation`; `node scripts/harness/scan-standing-delegation-evidence.mjs` exits 0 on the tree
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — "승인 — 구현 진행" is the first phrase in the catalogue's own list of what counts on Route DIRECT ("승인"), and it authorises implementation in the same breath ("구현 진행"). It was selected from an AskUserQuestion whose three options were "승인 — 구현 진행", "승인 — 단, print도 옵트인 허용" and "보류 — 질문 있음": the middle option is a variant of THIS document's § Decision "Modes" paragraph (which declines the headless print opt-in), so the question was posed on this design and no other item; the third option was the hold, so choosing the first is a confirmation of the design, not the answer to a clarifying question, not silence, and not approval of a different item. Basis stated plainly: this guardian does not see the owner's turn; it judges the record `gate.mjs approve` made in this conversation and the dispatch brief's account of the question, which agree with each other and with the catalogue's list
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval: N/A — route DIRECT; no class is cited (mechanical, `gate.mjs` PASS as not applicable)
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: N/A on the CLASS route; the DIRECT form's equivalent fields (`Instruction (verbatim)`, `Given`) are present in the standing entry and in this one (mechanical, `gate.mjs` PASS)
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: N/A — route DIRECT (mechanical, `gate.mjs` PASS as not applicable)
- GATE-APPROVAL — The item is inside the class as the registry defines it: N/A — route DIRECT; the entry cites no class and argues no resemblance. Checked that it could not have leaned on one either: the registry holds `LANE-L0-L1` (this document is `lane: L2`) and `BACKLOG-ZERO-MIGRATION` (documentation-only migration of a frozen legacy population; this unit edits six packages' source), so neither scope contains it — DIRECT is the only route open, and DIRECT is the route recorded
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: PASS (mechanical) — the `**Review fingerprint:** 5986acd6019e (review 37f6c359, type/tags ea3c2f52)` recorded at approval equals the fingerprint `gate.mjs` recomputes on the current text; corroborated by hand: the document text preceding the standing `[GATE-APPROVAL]` heading hashes (`git hash-object --stdin`) to `1bcd6513f2c6`, the exact blob that entry's `**Judged at:**` line names, so nothing but that entry was appended after approval
- GATE-APPROVAL — **Independent architecture validation (conditional):** APPLIES, and PASS. Applicability: no new package or app, but `spec-workflow.md` § New-Surface Architecture Placement names "a new module that could plausibly live in more than one place" as the trigger, and the handoff wrapper is exactly that — the first draft placed it in `agent-cli/src/startup/` (§ Alternatives 3) and the review moved it to `agent-framework` session assembly (§ Decision S3); the unit also adds a new runner module, a new SSOT kind member, a required fifth typed timeout on the public `IMCPTimeouts`, a new public option `IToolCallHandoffPolicy` on `ICreateSessionOptions`, and a user-facing `mcp.*` settings namespace. Evidence present and specific, not a bare "reviewed": `[PROPOSAL-REVIEW] — ✅ ENDORSE | 2026-09-22` records four rounds of `proposal-reviewer` against `origin/integration/agreement-014@a63fe09f8`, and its quoted Round-4 verdict covers the placement explicitly — "its placement mirrors the proven analog" (rule 1: `buildBackgroundProcessTool` at `create-session-runtime.ts:76`, `hasProcessRunner` at `:83` — verified) — with the composition-root exemption named in the rule-alignment list and the rejected placement recorded in Round 1 (rule 2: the wrapper consumes the shared `agent-executor` manager contract rather than sitting under the CLI product; `project-structure.md:373-382` refusal verified). `[STRUCTURE-AUDIT] — ✅ PLACEMENT SOUND, 7 FINDINGS APPLIED` is the `architecture-audit-fanout` structure channel (`architecture-structure-auditor`, the agent the fanout skill lists for that channel), 31/31 cells, with healthy cells naming "placement at the SSOT and beside the existing runners/assembly; every dependency edge pre-exists". Independence weighed: both charters make the agents read-only ("Never edits" / "Return a structured review (no edits)"), so author transcription is the only way a verdict reaches this log and is not by itself a defect; the transcribed findings were tested against source at `a63fe09f8` and hold — `TASK_KINDS` at `background-task-members.ts:36` decoded at `:153` with `record-decoder.ts:97,114,126` marking `corrupt` (Round 1); `ownerType: 'tool'` / `ownerId: toolCall.id` at `tool-execution-service.ts:225-226` (Round 2, F1); queued `cancel` path at `background-task-manager.ts:141-145` (Round 1); `filterTools` at `create-subagent-session.ts:167` (Round 2); `'tool_call'` execution-origin kind at `workspace-contracts.ts:33` (F6); `config/config-types.ts` carries 0 `mcp` hits (F4); `callTool` hard-codes `perCallMs` at `connection.ts:424` and `IMCPTimeouts` has no `toolCallMs` today (Round 2/3, F2); the two side Tasks the review says it filed exist on disk, both `created: 2026-09-22` (`EXEC-2062-*.md`, `DELIVERY-2525-*.md`). The Architecture Review itself carries the placement as a primary decision (Affected Scope's sibling scan, Alternative 3's measured rejection, Decision S3's named analog)

**Recorded, not the decider:** the standing `gate.mjs` entry's `**Judged at:**` line names `base origin/develop@c8cd7ea65962`; this branch is stacked on `origin/integration/agreement-014@a63fe09f8bf2`, which equals HEAD, and the mechanical result is the same under either base (re-run with `HARNESS_BASE_REF` set).

**Judged by:** `backlog-gate-guard`
**Judged at:** HEAD `a63fe09f8bf2` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/backlog/MCP-004-hand-long-running-mcp-calls-to-background-tasks.md` blob `213a6ca1f6aa` (untracked)
**Stacked base:** `origin/integration/agreement-014@a63fe09f8bf2` (`HARNESS_BASE_REF`; equals HEAD — the branch carries no commit of its own)

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-09-22

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names 22/25 TC ids and carries 11 checkbox task(s)
  **Required action:** one task per TC-N
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : 2 path(s) outside the paired spec/Task: .agents/tasks/DELIVERY-2525-a-completed-background-task-s-output-reaches-tasks-and-the-tui-but-never-the-mod.md, .agents/tasks/EXEC-2062-subagentmanager-nexttaskid-mints-process-n-ids-for-every-non-agent-background-ta.md
  **Required action:** commit, stash, or remove them before this gate

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `a63fe09f8bf2` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/todo/MCP-004-hand-long-running-mcp-calls-to-background-tasks.md` blob `b8b0f8c26256` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-22

**Status upgrade:** approved → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인 갱신 — 구현 진행"
**Given:** 2026-09-22, this conversation
**Review fingerprint:** 484fc4203b96 (review c8048d3c, type/tags ea3c2f52)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-22, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (484fc4203b96) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `a63fe09f8bf2` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/todo/MCP-004-hand-long-running-mcp-calls-to-background-tasks.md` blob `c01c68af902b` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-22

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-22; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/MCP-004-hand-long-running-mcp-calls-to-background-tasks.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/MCP-004-hand-long-running-mcp-calls-to-background-tasks.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (25)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 507 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: automatable | 1`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/MCP-004-hand-long-running-mcp-calls-to-background-tasks.md",
  "specPath": ".agents/spec-docs/todo/MCP-004-hand-long-running-mcp-calls-to-background-tasks.md",
  "taskItems": [
    {
      "kind": "tc-id",
      "value": "TC-01"
    },
    {
      "kind": "tc-id",
      "value": "TC-02"
    },
    {
      "kind": "tc-id",
      "value": "TC-03"
    },
    {
      "kind": "tc-id",
      "value": "TC-04"
    },
    {
      "kind": "tc-id",
      "value": "TC-05"
    },
    {
      "kind": "tc-id",
      "value": "TC-06"
    },
    {
      "kind": "tc-id",
      "value": "TC-07"
    },
    {
      "kind": "tc-id",
      "value": "TC-08"
    },
    {
      "kind": "tc-id",
      "value": "TC-09"
    },
    {
      "kind": "tc-id",
      "value": "TC-10"
    },
    {
      "kind": "tc-id",
      "value": "TC-11"
    },
    {
      "kind": "tc-id",
      "value": "TC-12"
    },
    {
      "kind": "tc-id",
      "value": "TC-13"
    },
    {
      "kind": "tc-id",
      "value": "TC-14"
    },
    {
      "kind": "tc-id",
      "value": "TC-15"
    },
    {
      "kind": "tc-id",
      "value": "TC-16"
    },
    {
      "kind": "tc-id",
      "value": "TC-17"
    },
    {
      "kind": "tc-id",
      "value": "TC-18"
    },
    {
      "kind": "tc-id",
      "value": "TC-19"
    },
    {
      "kind": "tc-id",
      "value": "TC-20"
    },
    {
      "kind": "tc-id",
      "value": "TC-21"
    },
    {
      "kind": "tc-id",
      "value": "TC-22"
    },
    {
      "kind": "tc-id",
      "value": "TC-23"
    },
    {
      "kind": "tc-id",
      "value": "TC-24"
    },
    {
      "kind": "tc-id",
      "value": "TC-25"
    }
  ],
  "plan": {
    "outcome": "automatable",
    "count": 1
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/MCP-004-hand-long-running-mcp-calls-to-background-tasks.md",
    ".agents/tasks/MCP-004-hand-long-running-mcp-calls-to-background-tasks.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `a63fe09f8bf2` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/todo/MCP-004-hand-long-running-mcp-calls-to-background-tasks.md` blob `363ecf124a27` (untracked)
