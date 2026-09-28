# Hook Event Catalog

Hooks let a user or host run their own checks and notifications at points in a session's
lifecycle: before a tool runs, after a turn completes, when a subagent starts, and so on. This
catalog lists every event in `THookEvent` (`packages/agent-core/src/hooks/types.ts`), what each one
receives, where it fires, and whether it can block.

The `THookEvent` union is the single source of truth for event names, and the fire sites in source
define the timing. Update this catalog when either changes.

Every event is dispatched through the one `runHooks` engine
(`packages/agent-core/src/hooks/hook-runner.ts`). There is no second hook tier or parallel registry.

## Configuration

A hooks configuration (`THooksConfig`) maps an event name to a list of hook groups. Each group
(`IHookGroup`) has:

- `matcher` — a regular expression tested against the event's matcher target (see the Events
  table). An empty matcher matches everything; a group with a non-empty matcher does not run for an
  event that has no matcher target. A matcher that is not a valid regular expression is compared as
  an exact string.
- `hooks` — the hook definitions to run, in order.
- `env` — optional environment variables added to the hook input's `env` for this group.

A hook definition (`THookDefinition`) has one of five types. Each type needs a registered executor
(`IHookTypeExecutor`):

| Type        | What it does                                                              | Executor                                                                                  |
| ----------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `command`   | Runs a shell command with the hook input as JSON on stdin                 | `CommandExecutor` (`@robota-sdk/agent-core/node`); a default when no executors are passed |
| `http`      | POSTs the hook input as JSON to a URL                                     | `HttpExecutor` (`@robota-sdk/agent-core/node`); a default when no executors are passed    |
| `prompt`    | Asks a model to judge the hook input                                      | `PromptExecutor` (`@robota-sdk/agent-framework`), which needs a provider factory          |
| `agent`     | Runs a subagent session on the hook input                                 | `AgentExecutor` (`@robota-sdk/agent-framework`), which needs a session factory            |
| `guardrail` | Runs registered guardrail functions in parallel; the first failure blocks | `GuardrailExecutor` (`@robota-sdk/agent-core`), which needs the guardrails registered     |

## How a hook answers

Each execution produces one outcome (`THookOutcome`):

- **`allow`** — the hook approved. For a `command` hook this is exit code `0`; for `http`, `prompt`
  and `agent` hooks it is a JSON response `{ "ok": true }`.
- **`deny`** — the hook refused, with a reason. For a `command` hook this is exit code `2` (stderr
  is the reason); for the other types it is `{ "ok": false, "reason": "..." }`.
- **`error`** — the hook reached no verdict: a timeout, a process or connection that never started,
  a transport failure, a non-2xx HTTP status, a response that cannot be decoded, or any other exit
  code. `runHooks` reports every one on `IRunHooksResult.errors` and never treats it as approval.

A response whose `ok` field is not exactly `true` or `false` is an `error`, unless the same body
carries an explicit block directive (below), in which case it is a `deny`.

The output of an `allow` (a command's stdout, or the response body for the other types) is read with
the Claude Code compatible response protocol:

- Plain text (not a JSON object) is collected as output.
- `{ "continue": false }` blocks on every event; `stopReason` is used as the reason.
- On `PreToolUse`, `hookSpecificOutput.permissionDecision` may be `allow`, `ask`, `defer` or
  `deny`; `deny` blocks. With several hooks, the highest-priority decision wins
  (`deny` > `ask` > `defer` > `allow`), and the `hookSpecificOutput.updatedInput` sent with the
  winning decision travels with it. Only a `command` hook's decision and `updatedInput` are read;
  any other hook type can only block, because a `prompt` or `agent` hook answers from a model that
  reads the tool input it would be approving.
- On `UserPromptSubmit`, `{ "decision": "block" }` blocks, and
  `hookSpecificOutput.additionalContext` is collected as output.
- `systemMessage` is collected as output.

"Blocks" here means `runHooks` returns `blocked: true`. Whether that stops anything depends on the
event: see the next section.

## Blocking semantics

The **only** blocking event is `PreToolUse`. This section is the one place that lists the causes
that deny a tool call there; anything else that needs them links here. There are four:

1. a hook whose executor returns the `deny` outcome;
2. an `allow` whose stdout carries `hookSpecificOutput.permissionDecision: "deny"` or
   `continue: false`;
3. a hook that returns `error` (timeout, spawn failure, transport failure, HTTP status, malformed
   response, unexpected exit code), because a hook that reached no verdict has not approved;
4. a configured hook type with **no registered executor**, because a gate that nothing evaluated
   must not allow silently.

Causes 1 and 2 set `IRunHooksResult.blocked`. Causes 3 and 4 are read from `errors` and
`unknownHookTypes` at the gate (`agent-session/src/tool-hook-helpers.ts : runPreToolGate`), which
checks `isEnforcing('PreToolUse')`. In every case the tool's `execute` never runs; the model
receives a failed tool result whose reason names the cause, and for an `error` it names the failure
kind and the executor type.

A `PreToolUse` hook that does not deny can still steer the call. The permission gate
(`agent-session/src/permission-enforcer.ts`) applies the winning `permissionDecision` after the
permission rules and mode:

- `allow` answers the prompt a person would otherwise get. It never outweighs a deny rule, a refusal
  from the mode, the `auto` mode classifier, or an ask that must reach a person (an `ask` rule, a
  protected path, a policy that asks about everything).
- `ask` sends the call to a person even when the mode or a remembered consent would run it, and is
  not remembered. Where no one can answer, the call is refused.
- `defer` leaves the call to the normal flow.

`updatedInput` is reported on the result but not applied: the call runs the input it was made with.
An `allow` sent with an `updatedInput` approved another input, so it is not applied either.

`HOOK_ENFORCEMENT_POLICY` (`packages/agent-core/src/hooks/enforcement-policy.ts`) records which
events enforce. `PreToolUse` is the only event whose fire site awaits `runHooks` and consults the
result, so every other event is `advisory`: each row's `enforcementReachable` field records that its
fire site could not honour an enforcing posture. Review the fire sites when that field changes.

Every other event is **informational**: its result cannot veto or change the action it observes. In
particular:

- `PreModelCall`, `PostModelCall` and `PermissionDecision` are informational despite their names.
  They fire without being awaited, so they cannot block or change the provider call or the
  permission outcome.
- `UserPromptSubmit` is awaited, but only its collected output is used: it is added to the prompt
  inside a `<system-reminder>` block. A `{ "decision": "block" }` or `continue: false` response
  does not stop the prompt.
- `SessionStart` output is added the same way to the session's first prompt.

The block directives are scoped by event in both the runner and the `{ ok }` verdict decoder
(`decodeHookVerdict`): `continue: false` on every event, `decision: "block"` only on
`UserPromptSubmit`, `permissionDecision: "deny"` only on `PreToolUse`.

## Common input fields

Every hook receives `session_id`, `cwd` and `hook_event_name`. Most events also carry
`permission_mode` and `transcript_path` when the session has them. Command hooks get the input as
JSON on stdin; HTTP hooks get it as the request body.

`env` holds environment variables for command hook processes. The session, stop, prompt,
model-call, permission and subagent events set `CLAUDE_PROJECT_DIR` and `CLAUDE_SESSION_ID`;
`PreToolUse`, `PostToolUse`, `PreCompact`, `PostCompact`, `WorktreeCreate` and `WorktreeRemove` do
not. A group's `env` is merged on top.

## Events

| Event                | Timing                                                 | Fire site (file : function)                                                         | Event-specific input fields                                                                                   | Matcher target | Blocking            |
| -------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------- | ------------------- |
| `PreToolUse`         | Before a tool executes                                 | `agent-session/src/tool-hook-helpers.ts : runPreToolGate`                           | `tool_name`, `tool_input`                                                                                     | `tool_name`    | **BLOCKING** (gate) |
| `PostToolUse`        | After a tool executes                                  | `agent-session/src/tool-hook-helpers.ts : firePostToolHook`                         | `tool_name`, `tool_input`, `tool_output`                                                                      | `tool_name`    | Informational       |
| `SessionStart`       | When a `Session` is constructed                        | `agent-session/src/session-lifecycle.ts : fireSessionStartHook`                     | (common fields only)                                                                                          | none           | Informational       |
| `SessionEnd`         | Session shutdown                                       | `agent-session/src/session-lifecycle.ts : fireSessionEndHook`                       | `reason`                                                                                                      | `reason`       | Informational       |
| `Stop`               | After a turn's response completes                      | `agent-session/src/session-run.ts : executeRun`                                     | `response` (first 500 characters), `last_assistant_message`, `stop_hook_active`                               | none           | Informational       |
| `StopFailure`        | When a turn fails                                      | `agent-session/src/session-run.ts : executeRun`                                     | `reason` (the error message), `stop_hook_active`                                                              | none           | Informational       |
| `PreCompact`         | Before context compaction                              | `agent-session/src/compaction-orchestrator.ts : compact`                            | `trigger` (`auto` or `manual`)                                                                                | none           | Informational       |
| `PostCompact`        | After the history is replaced by the summary           | `agent-session/src/session-history-ops.ts : compact`                                | `trigger`, `compact_summary`                                                                                  | none           | Informational       |
| `UserPromptSubmit`   | Before the user prompt is sent to the model            | `agent-session/src/session-run.ts : executeRun`                                     | `user_message`, `prompt` (the same text)                                                                      | none           | Informational       |
| `SubagentStart`      | When a subagent (background `agent` task) starts       | `agent-framework/src/assembly/background-task-hooks.ts : fireSubagentLifecycleHook` | `agent_id`, `agent_type`, `agent_transcript_path` (when known)                                                | `agent_type`   | Informational       |
| `SubagentStop`       | When a subagent completes, fails or is cancelled       | `agent-framework/src/assembly/background-task-hooks.ts : fireSubagentLifecycleHook` | `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`, `reason` (on failure or timeout) | `agent_type`   | Informational       |
| `WorktreeCreate`     | When an isolated worktree is created for a subagent    | `agent-executor/src/subagents/worktree-subagent-runner.ts : fireWorktreeHook`       | `tool_name` (`Agent`), `tool_input` (`taskId`, `agentType`, `worktreePath`, `branchName`, `removed: false`)   | `tool_name`    | Informational       |
| `WorktreeRemove`     | When a subagent's worktree is removed                  | `agent-executor/src/subagents/worktree-subagent-runner.ts : fireWorktreeHook`       | `tool_name` (`Agent`), `tool_input` (`taskId`, `agentType`, `worktreePath`, `branchName`, `removed: true`)    | `tool_name`    | Informational       |
| `PreModelCall`       | As a provider request goes out (each round)            | `agent-session/src/session-run.ts : fireModelCallHook`                              | `model`, `provider`, `effort`, `round`                                                                        | none           | Informational       |
| `PostModelCall`      | After the provider response is normalized (each round) | `agent-session/src/session-run.ts : fireModelCallHook`                              | `model`, `provider`, `effort`, `round`                                                                        | none           | Informational       |
| `PermissionDecision` | Right after `evaluatePermission` decides a tool call   | `agent-session/src/permission-enforcer.ts : firePermissionDecisionHook`             | `tool_name`, `tool_input`, `permission_decision` (`auto`, `approve` or `deny`)                                | `tool_name`    | Informational       |

Notes on specific fields:

- `SubagentStart`/`SubagentStop`: `session_id` is the parent session's ID, `agent_type` is the
  task's agent type (or its label when it has none), and `transcript_path` is set to the subagent's
  transcript when one exists. A host can also pass the agent ID and type to command hooks under
  environment variable names it chooses (`subagentHookEnvironmentNames`).
- `WorktreeCreate`/`WorktreeRemove`: `session_id` is the parent session's ID and `cwd` is the
  repository root.
- `PreModelCall`/`PostModelCall`: `effort` is the selection for that call (`auto` when none is set);
  `round` is present when the execution loop reports it.
- `UserPromptSubmit`: `user_message` and `prompt` carry the raw input when the caller supplied one,
  otherwise the submitted message.

## Fire-site dispatch note

Most events pass their name to `runHooks('<Event>', …)` as a string literal. Six are dispatched
through a variable, so the name never appears as a literal first argument. Check their helper
mappings and call sites when this catalog changes:

- `SubagentStart` / `SubagentStop` — `runHooks(hooks, hookEventName, …)`, where `hookEventName`
  comes from the `getSubagentHookEvent` mapping (`agent-framework/src/assembly/background-task-hooks.ts`).
- `WorktreeCreate` / `WorktreeRemove` — `runHooks(options.hooks, event, …)`, where `event` is a
  `fireWorktreeHook` parameter given the literal at each call site
  (`agent-executor/src/subagents/worktree-subagent-runner.ts`).
- `PreModelCall` / `PostModelCall` — `runHooks(…, hookEvent, …)`, where `hookEvent` is a
  `fireModelCallHook` parameter given the literal at each call site
  (`agent-session/src/session-run.ts`).

## Naming note

The `PermissionDecision` **hook event** (a `THookEvent` member that _reports_ a decision) is distinct
from, and does not extend, (a) the `TPermissionDecision` type `'auto' | 'approve' | 'deny'`
(`packages/agent-core/src/permissions/types.ts`), and (b) the `IRunHooksResult.permissionDecision`
field `'allow' | 'deny' | 'ask' | 'defer'` (`packages/agent-core/src/hooks/hook-runner.ts`), the
highest-priority `PreToolUse` decision.
