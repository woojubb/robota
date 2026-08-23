# Hook Event Catalog (SSOT)

This is the **single source of truth** for every named lifecycle hook event in the Robota hooks
engine. It is mechanically kept true to the code by `scripts/harness/scan-hook-catalog.mjs`, which
FAILs on any drift between this table, the `THookEvent` union
(`packages/agent-core/src/hooks/types.ts`), and the resolved `runHooks` firing call-sites.

Every event is a member of the `THookEvent` union and is dispatched through the **one** `runHooks`
engine (`packages/agent-core/src/hooks/hook-runner.ts`). There is no second hook tier or parallel
registry.

## Blocking semantics

The **only** blocking event is `PreToolUse`. Three things deny there, not one: a hook whose executor
returns the `deny` outcome (or an `allow` whose stdout carries
`hookSpecificOutput.permissionDecision: "deny"` / `continue: false`) sets `IRunHooksResult.blocked`,
and the turn owner's `runPreToolHook` → `PermissionEnforcer` path turns that into a denial
`IToolResult` so the tool's `execute` never runs. Every other event is **informational-only**: its
`runHooks` result is not awaited or consulted for gating, so it cannot veto or mutate the action it
observes.

In particular `PreModelCall`, `PostModelCall`, and `PermissionDecision` (SELFHOST-009) are
**informational-only despite the "Pre"/"Decision" naming**. They are fired fire-and-forget from
points the turn owner already observes (a void, un-awaited `onExecutionEvent` callback, and
post-`evaluatePermission`), so they cannot block or mutate `provider.chat()` or the permission
outcome.

**A hook that FAILS is not a hook that approved (SEC-015).** An executor that could not reach a verdict —
timeout, spawn failure, HTTP status, unreachable endpoint, undecodable body, unexpected exit code —
returns the `error` outcome, and `runHooks` reports every one on `IRunHooksResult.errors`.

**Whether that blocks is per-event policy, and `PreToolUse` fails closed (SEC-016).** A `PreToolUse`
hook that reached no verdict — or a configured hook type with no registered executor — now denies the
tool call, with the failure `kind` and the `source` executor named in the reason.
`HOOK_ENFORCEMENT_POLICY` (`packages/agent-core/src/hooks/enforcement-policy.ts`) is the SSOT for
which events enforce. Every other event is `advisory`, and each records WHY: measured across the
tree, `PreToolUse` is the only event whose fire site awaits `runHooks` and consults `blocked`, so the
other fifteen could not honour an enforcing posture even if one were declared. That is what each
row's `enforcementReachable` field records, and what
`scripts/harness/scan-hook-enforcement-reachable.mjs` refuses to let drift. A body
whose `{ ok }` verdict is undecodable but which carries an explicit block directive is a `deny`, not an
`error` — the hook said so outright.

## Events

| Event                | Timing                                                | Fire-site (file : function)                                                         | Key input fields                                         | Blocking            |
| -------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------- |
| `PreToolUse`         | Before a tool executes                                | `agent-session/src/tool-hook-helpers.ts : runPreToolHook`                           | `tool_name`, `tool_input`, `permission_mode`             | **BLOCKING** (gate) |
| `PostToolUse`        | After a tool executes                                 | `agent-session/src/tool-hook-helpers.ts : firePostToolHook`                         | `tool_name`, `tool_input`, `tool_output`                 | Informational       |
| `SessionStart`       | Session initialization                                | `agent-session/src/session-lifecycle.ts : fireSessionStartHook`                     | `prompt`, `permission_mode`                              | Informational       |
| `SessionEnd`         | Session teardown                                      | `agent-session/src/session-lifecycle.ts : fireSessionEndHook`                       | `reason`, `transcript_path`                              | Informational       |
| `Stop`               | After a turn's response completes                     | `agent-session/src/session-run.ts : executeRun`                                     | `response`, `last_assistant_message`, `stop_hook_active` | Informational       |
| `StopFailure`        | When a turn errors                                    | `agent-session/src/session-run.ts : executeRun`                                     | `reason`, `stop_hook_active`                             | Informational       |
| `PreCompact`         | Before context compaction                             | `agent-session/src/compaction-orchestrator.ts`                                      | `trigger`                                                | Informational       |
| `PostCompact`        | After context compaction                              | `agent-session/src/session-history-ops.ts`                                          | `trigger`, `compact_summary`                             | Informational       |
| `UserPromptSubmit`   | Before the user prompt is sent to the model           | `agent-session/src/session-run.ts : executeRun`                                     | `user_message`, `prompt`                                 | Informational\*     |
| `SubagentStart`      | When a subagent (background `agent` task) starts      | `agent-framework/src/assembly/background-task-hooks.ts : fireSubagentLifecycleHook` | `agent_id`, `agent_type`                                 | Informational       |
| `SubagentStop`       | When a subagent finishes / fails / is cancelled       | `agent-framework/src/assembly/background-task-hooks.ts : fireSubagentLifecycleHook` | `agent_id`, `agent_type`, `last_assistant_message`       | Informational       |
| `WorktreeCreate`     | When an isolated worktree is created for a subagent   | `agent-executor/src/subagents/worktree-subagent-runner.ts : fireWorktreeHook`       | `tool_input` (taskId, worktreePath, branchName)          | Informational       |
| `WorktreeRemove`     | When a subagent's worktree is removed                 | `agent-executor/src/subagents/worktree-subagent-runner.ts : fireWorktreeHook`       | `tool_input` (taskId, worktreePath, branchName, removed) | Informational       |
| `PreModelCall`       | As a provider request goes out (per round)            | `agent-session/src/session-run.ts : fireModelCallHook`                              | `model`, `provider`, `round`                             | Informational       |
| `PostModelCall`      | After the provider response is normalized (per round) | `agent-session/src/session-run.ts : fireModelCallHook`                              | `model`, `provider`, `round`                             | Informational       |
| `PermissionDecision` | Right after `evaluatePermission` decides a tool call  | `agent-session/src/permission-enforcer.ts : firePermissionDecisionHook`             | `tool_name`, `tool_input`, `permission_decision`         | Informational       |

\* `UserPromptSubmit` is **informational-only at the turn owner**: its hook stdout is injected into the model
context as a `<system-reminder>` (`session-run.ts : executeRun` reads only `hookResult.stdout`). The turn owner
does **not** consult its `IRunHooksResult.blocked` — so a `{ decision: "block" }` / `continue: false` response
does **not** halt the prompt today. The ONLY event whose `blocked` result gates execution is `PreToolUse`
(`tool-hook-helpers.ts : runPreToolHook`). (If halting the prompt from `UserPromptSubmit` is ever wanted, the turn
owner must be wired to consult `blocked` there — that is not the case now.)

## Fire-site dispatch note (for the drift-guard scan)

Most events pass their name as a **string literal** to `runHooks('<Event>', …)`. Four are dispatched
through a **variable**, so the name never appears as a literal first argument:

- `SubagentStart` / `SubagentStop` — `runHooks(hooks, hookEventName, …)` where `hookEventName` comes
  from the `getSubagentHookEvent` mapping table
  (`agent-framework/src/assembly/background-task-hooks.ts`).
- `WorktreeCreate` / `WorktreeRemove` — `runHooks(options.hooks, event, …)` where `event` is a
  `fireWorktreeHook` parameter passed the string literal at each call-site
  (`agent-executor/src/subagents/worktree-subagent-runner.ts`).

`scan-hook-catalog.mjs` resolves a firing event name from any of: (a) a string literal passed to
`runHooks(`; (b) a `hook_event_name:` field literal; (c) the string literals returned by
`getSubagentHookEvent` and the literals passed as the `event` argument at each `fireWorktreeHook`
call-site — so all 16 events, including the variable-dispatched four, are covered.

## Naming note

The `PermissionDecision` **hook event** (a `THookEvent` member that _reports_ a decision) is distinct
from — and does not extend — (a) the `TPermissionDecision` permissions enum
`'auto' | 'approve' | 'deny'` (`packages/agent-core/src/permissions/types.ts`), and (b) the internal
`IRunHooksResult.permissionDecision` field `'allow' | 'deny' | 'ask' | 'defer'`
(`packages/agent-core/src/hooks/hook-runner.ts`, the highest-priority PreToolUse decision).
