# @robota-sdk/agent-framework

The assembly layer of the Robota SDK. It composes `@robota-sdk/agent-core`,
`@robota-sdk/agent-session`, `@robota-sdk/agent-tools`, `@robota-sdk/agent-tool-defaults` and
`@robota-sdk/agent-executor` into one provider-neutral SDK for building agents: sessions with
tools, permissions, hooks, streaming, context loading, commands, subagents and persistence.

It has three main entry points:

- **`InteractiveSession`** — an event-driven session that any client (terminal UI, web app, API
  server, worker) drives by submitting prompts and listening to events.
- **`createQuery()`** — a one-shot function: prompt in, response text out.
- **`createAgentRuntime()`** — a composition root that creates many `InteractiveSession`s sharing
  one configuration, for headless and multi-session hosts.

The package has no React dependency, and it never imports a concrete provider: you create the
provider (for example from `@robota-sdk/agent-provider-anthropic`) and pass it in. The `robota` CLI
(`@robota-sdk/agent-cli`) is a reference app built on this package.

For walkthroughs, see the [SDK guide](../../content/guide/sdk.md) and
[Building agents](../../content/guide/building-agents.md).

## Installation

```bash
npm install @robota-sdk/agent-framework @robota-sdk/agent-provider-anthropic
```

Requires Node.js 22.12 or later. `InteractiveSession` and `createQuery` work with any Robota provider
package given a `model`; without one they use the settings files, or Anthropic's default model.

## Quick start

```typescript
import { createQuery } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
const query = createQuery({ provider });

const response = await query('List the TypeScript files in this directory');

// With options
const verboseQuery = createQuery({
  provider,
  cwd: '/path/to/project',
  permissionMode: 'acceptEdits',
  maxTurns: 10,
  onTextDelta: (delta) => process.stdout.write(delta),
});
const analysis = await verboseQuery('Analyze the code');
console.log(response, analysis);
```

`createQuery()` uses the `default` permission mode. With no `permissionHandler`, a tool call that
would ask for approval is denied, so an unattended run only does what the mode allows without asking.
List the tools that may run anyway in `allowedTools` (your own `additionalTools`, say), pass a
`permissionHandler` to decide each request, or pass `permissionMode: 'bypassPermissions'` explicitly
if the run should approve everything. `deniedTools` are never offered to the model.

Pass `model` with any provider other than Anthropic: without it the model comes from the settings
files, and without one the session asks the provider for `claude-opus-4-5`. Calls run one at a time,
each answered by its own turn, and `query.shutdown()` ends the session.

Without `projectAccess`, a query runs **Restricted**: it can use its tools in `cwd`, but it loads
no project context, settings, memory or session files. See [Project access](#project-access).

## InteractiveSession

`InteractiveSession` wraps an `agent-session` `Session` and turns it into an event stream. It keeps
the prompt queue, streaming text, running-tool state, abort handling and message history, so a
client only renders events and forwards user input.

```typescript
import { InteractiveSession } from '@robota-sdk/agent-framework';
import type { IAIProvider } from '@robota-sdk/agent-core';

declare const provider: IAIProvider;

const session = new InteractiveSession({
  cwd: process.cwd(),
  provider,
  permissionMode: 'default',
  maxTurns: 10,
});

session.on('text_delta', (delta) => process.stdout.write(delta));
session.on('tool_start', (state) => console.log(`Running: ${state.toolName}`));
session.on('tool_end', (state) => console.log(`Done: ${state.toolName} (${state.result})`));
session.on('permission_request', ({ id, toolName }) => {
  // Ask the user, then answer. The first answer wins, from any attached surface.
  session.resolvePermission(id, toolName === 'Read');
});
session.on('complete', (result) => console.log('\n', result.response));
session.on('error', (error) => console.error(error));

// submit() resolves once the prompt is accepted; the handle identifies this turn
// even if it waits in the queue behind another one.
const handle = await session.submit('Explain the code in src/');
const result = await handle.completed;
console.log(result.toolSummaries.length, 'tool calls');

await session.shutdown();
```

### Common options

| Option                                                      | Purpose                                                                                         |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `cwd`, `provider`                                           | Required. The working directory and the provider instance.                                      |
| `projectAccess`                                             | The host's trust decision for the project. Absent means Restricted.                             |
| `permissionMode`                                            | `plan`, `default`, `acceptEdits`, `bypassPermissions` or `auto`.                                |
| `maxTurns`                                                  | Cap on agentic rounds per prompt.                                                               |
| `model`, `effort`, `temperature`                            | Model selection for this session.                                                               |
| `systemPrompt`, `appendSystemPrompt`                        | Replace or extend the assembled system prompt.                                                  |
| `additionalTools`                                           | Tools added to the default set.                                                                 |
| `defaultTools`                                              | Replaces the default tool set from `@robota-sdk/agent-tool-defaults`; `[]` removes it.          |
| `allowedTools`, `deniedTools`                               | Tool name patterns to allow or deny for this session.                                           |
| `commandModules`                                            | Command modules the session can execute (for example from `@robota-sdk/agent-command`).         |
| `sessionStore`, `resumeSessionId`, `forkSession`            | Persistence, and resuming or forking a stored session.                                          |
| `userSettingsSources`, `projectSettingsPaths`               | Settings files to read. Absent means no settings file is read.                                  |
| `contributionSources`, `skillRoots`, `agentDefinitionRoots` | Where to discover skills and agent definitions. Absent means no discovery.                      |
| `sandboxClient`, `workspaceManifest`                        | Run tools in a sandbox, prepared from a manifest (see [Sandbox execution](#sandbox-execution)). |
| `guardrails`                                                | Named guardrail functions for `guardrail` hooks.                                                |
| `responseFormat`                                            | Request structured output.                                                                      |

Every location the framework reads or writes (settings files, skill and agent roots, plugin
directories, storage roots) is supplied by the host. The framework never falls back to a default
path; an omitted location means that feature is off.

### Events

| Event                                                      | Payload                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `text_delta`                                               | A streamed text chunk                                                                |
| `thinking`                                                 | `true` when a turn starts, `false` when it ends                                      |
| `tool_start`, `tool_end`                                   | `IToolState` (`toolName`, `firstArg`, `isRunning`, `result`, …)                      |
| `complete`, `interrupted`                                  | `IExecutionResult` (`response`, `history`, `toolSummaries`, `contextState`, `usage`) |
| `error`                                                    | `Error`                                                                              |
| `context_update`                                           | `IContextWindowState` (token usage)                                                  |
| `compact`                                                  | Compaction trigger and before/after context state                                    |
| `permission_request`, `ask_request`, `prompt_resolved`     | A pending approval or question, and its settlement                                   |
| `background_task_event`, `background_job_group_event`      | Subagent and background task lifecycle                                               |
| `goal_event`, `plan_event`, `branch_event`, `memory_event` | Goal, plan, checkpoint-branch and memory changes                                     |
| `session_renamed`, `history_cleared`, `status_changed`     | Session state changes                                                                |

### Main methods

- `submit(input, displayInput?, rawInput?, options?)` returns a turn handle (`{ turnId, completed }`).
  `completed` rejects with an error that `isTurnNotRunError()` (from
  `@robota-sdk/agent-interface-session`) recognizes if the queued prompt never ran: replaced by a
  later prompt, dropped from a full queue, or cleared by abort, cancel or shutdown.
- `abort()` stops the running turn and clears the queue; `cancelQueue()` drops queued prompts only.
- `executeCommand(name, args)` runs a command; `listCommands()` lists them.
- `resolvePermission(id, result)` and `resolveAsk(id, response)` answer pending requests.
- `getMessages()`, `getContextState()`, `getStreamingText()`, `getActiveTools()`, `isExecuting()`.
- `compactContext(instructions?)` summarizes the conversation to free context space.
- `setGoal(objective)` pursues an objective over several turns; `setPlan(objective)` and
  `approvePlan()` drive explicit plan mode.
- `getName()` / `setName(name)`, `getSession()` (the underlying `Session`), `shutdown()`.

In a trusted project, path-like `@file` references in a prompt are read (bounded in size and
recursion), added to the model's input, and recorded in history as a structured event.

## Project access

A `cwd` alone gives the session no access to project content. Project context files
(`AGENTS.md`, `CLAUDE.md`), project settings, memory, checkpoints and stored sessions are reachable
only through a trusted `TWorkspaceProjectAccess` decision that the host obtains from a
`WorkspaceTrustService`. Without one the session is Restricted.

```typescript
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  InteractiveSession,
  createNodeWorkspaceTrustService,
  createProjectSessionStore,
  getWorkspaceProjectStateStorage,
} from '@robota-sdk/agent-framework';
import type { IAIProvider } from '@robota-sdk/agent-core';

declare const provider: IAIProvider;
const cwd = process.cwd();

// The host chooses where trust grants are stored and where project state lives
// (directories relative to the project root).
const trust = createNodeWorkspaceTrustService(join(homedir(), '.my-app', 'workspace-trust.json'), {
  sessions: '.my-app/sessions',
  'session-logs': '.my-app/logs',
  memory: '.my-app/memory',
  checkpoints: '.my-app/checkpoints',
});

// inspect() reports the current decision; grant() trusts the project after the user agrees.
const projectAccess = await trust.inspect(cwd);

const sessionStore =
  projectAccess.status === 'trusted'
    ? createProjectSessionStore(
        getWorkspaceProjectStateStorage(projectAccess.authority, 'sessions'),
        getWorkspaceProjectStateStorage(projectAccess.authority, 'session-logs'),
      )
    : undefined;

const session = new InteractiveSession({ cwd, provider, projectAccess, sessionStore });
```

Trust is bound to the Git worktree and repository identity. Non-Git paths, a replaced repository,
a revoked grant or a trust-store error all resolve to Restricted, and a revoked authority stops
working immediately. The `cwd` must be the trusted root or inside it.

## Headless and multi-session runtime

`createAgentRuntime()` holds one configuration (provider, `cwd`, project access, command modules,
session store, transports) and creates `InteractiveSession`s from it:

```typescript
import { createAgentRuntime } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const runtime = createAgentRuntime({
  cwd: process.cwd(),
  provider: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }),
});

// Each call creates a new InteractiveSession that inherits the runtime configuration.
const session = runtime.createSession({ permissionMode: 'plan' });
```

`buildRuntimeSession()` is the one place a session is built from resolved options, and
`startRuntimeHost()` adds transport start/stop and a bounded shutdown on top of it; the CLI's
`robota --serve` uses both. `SessionPool` keeps several live sessions for a runtime that serves more
than one client. Headless output is available through `createHeadlessRunner` and
`createHeadlessTransport`, and `createProgrammaticAgent` drives a session from code.

## Permissions

Every tool call is decided by `evaluatePermission` from `@robota-sdk/agent-core`: deny rules first,
then ask rules and the protections that are never auto-approved (such as deleting the workspace or
writing into `.git`), then allow rules (skipped in `bypassPermissions`, which approves everything
that got this far), then what the mode says about the kind of action:

| Mode                | Read-only tools (Read, Glob, Grep) | Edits (Write, Edit) | Commands (Shell, Bash) |
| ------------------- | :--------------------------------: | :-----------------: | :--------------------: |
| `plan`              |                auto                |        deny         |          deny          |
| `default`           |                auto                |         ask         |          ask           |
| `acceptEdits`       |                auto                |        auto         |          ask           |
| `bypassPermissions` |                auto                |        auto         |          auto          |
| `auto`              |                auto                |        auto         |    model classifier    |

A shell command that only reads (such as `ls`, `cat` or `git status`) with every path inside the
workspace counts as read-only. In `auto` mode a model classifier approves or blocks what the mode
leaves open, and after repeated
refusals the session falls back to asking a person. `ask` rules ask even in `bypassPermissions`; in
`plan` mode anything that would change something is refused instead of asked. See the
[permissions and hooks guide](../../content/guide/permissions-and-hooks.md).

## Hooks

Sessions run the hooks configured in settings (or passed by the host) at lifecycle events such as
`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SessionStart`, `SessionEnd`,
`PreCompact`, `SubagentStart` and `PreModelCall`. Only `PreToolUse` can block. The full list, input
fields and blocking rules are in the [hook event catalog](../agent-core/docs/HOOK-CATALOG.md).

This package adds two hook executors to the `command` and `http` executors from `agent-core`:

| Executor         | Hook type | What it does                                                                      |
| ---------------- | --------- | --------------------------------------------------------------------------------- |
| `PromptExecutor` | `prompt`  | Asks a model (from a provider factory you supply) for an `{ ok, reason }` verdict |
| `AgentExecutor`  | `agent`   | Runs a subagent session (from a session factory you supply) for a verdict         |

## Commands

The framework owns the command infrastructure: `SystemCommandExecutor`, `CommandRegistry`, command
sources (`BuiltinCommandSource`, `SkillCommandSource`, `PluginCommandSource`) and the common APIs
command modules use. It does not own the user-visible built-in commands; those are command modules
from `@robota-sdk/agent-command` that the host composes. Command names are slash-free (`help`,
`compact`); a UI renders them as `/help`, `/compact`.

A command module is a plain object:

```typescript
import { InteractiveSession } from '@robota-sdk/agent-framework';
import type { ICommandModule } from '@robota-sdk/agent-framework';
import type { IAIProvider } from '@robota-sdk/agent-core';

declare const provider: IAIProvider;

const statusModule: ICommandModule = {
  name: 'status',
  systemCommands: [
    {
      name: 'status',
      description: 'Show agent status',
      execute: (context, args) => ({ message: `OK ${args}`, success: true }),
    },
  ],
};

const session = new InteractiveSession({
  cwd: process.cwd(),
  provider,
  commandModules: [statusModule],
});
const result = await session.executeCommand('status', '');
console.log(result?.message);
```

Skills are discovered only from the contribution sources and roots the host passes. A model can run
a model-invocable command through a projected tool named `command_<name>` by default;
`modelCommandToolPrefix` changes the prefix.

## Subagents

- `IAgentDefinition` describes a reusable agent: `name`, `description`, `systemPrompt`, and
  optionally `model`, `effort`, `role`, `maxTurns`, `tools` and `disallowedTools`.
- `BUILT_IN_AGENTS` holds `general-purpose`, `Explore` and `Plan`; `Explore` and `Plan` cannot use
  `Write` or `Edit`.
- Custom definitions come from `agentDefinitions` or from the host-supplied `agentDefinitionRoots`.
  The CLI chooses which directories those are.
- `createAgentTool()` gives the model an `Agent` tool that starts subagents, including several in
  parallel through its `jobs` argument. Subagents run as background tasks managed by
  `@robota-sdk/agent-executor`; `createSubagentSession()` builds the child session from the
  parent's resolved configuration.
- `runSequential`, `runParallel`, `runHandoff`, `runHierarchical` and `runGroupChat` run multi-agent
  orchestration patterns over the contracts in `agent-core`. `runGroupChat` is a facade over
  `@robota-sdk/agent-roundtable`'s `Roundtable`: the core runs the only turn loop, one participant per
  step id, while the neutral contract (`IGroupChatOrchestrationSpec`, `SelectNextStep`) is unchanged.

## Sandbox execution

A session can run its commands and file tools in a sandbox through a provider-neutral
`ISandboxClient` from `@robota-sdk/agent-tools`. `E2BSandboxClient` adapts an E2B sandbox that your
application creates; `@robota-sdk/agent-framework` does not depend on E2B.

```typescript
import { InteractiveSession } from '@robota-sdk/agent-framework';
import { E2BSandboxClient } from '@robota-sdk/agent-tools';
import type { IAIProvider } from '@robota-sdk/agent-core';
import type { IE2BSandboxAdapter, IWorkspaceManifest } from '@robota-sdk/agent-tools';

declare const provider: IAIProvider;
declare const sandbox: IE2BSandboxAdapter; // e.g. `await Sandbox.create()` from the `e2b` package

const workspaceManifest: IWorkspaceManifest = {
  entries: {
    'task.md': { type: 'file', content: 'Review this repository.\n' },
    repo: { type: 'gitRepo', url: 'https://github.com/example/project.git', ref: 'main' },
    output: { type: 'dir' },
  },
};

const session = new InteractiveSession({
  cwd: process.cwd(),
  provider,
  sandboxClient: new E2BSandboxClient({ sandbox }),
  workspaceManifest,
});
```

The manifest is applied once before the session starts. With a `sessionStore` and a sandbox client
that supports snapshots, `shutdown()` stores the sandbox snapshot ID, and resuming the session
(without forking) restores the sandbox before the saved messages are replayed.

## More capabilities

| Capability                  | Exports                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------- |
| Model fallback              | `FallbackProvider`, `resolveModelFallbackChain`, `applyModelFallback`                                 |
| Advisor (second-model tool) | `AdvisorController`, `createAdvisorTool`                                                              |
| Edit checkpoints and rewind | `EditCheckpointStore`, `wrapEditCheckpointTools`                                                      |
| Reversible execution        | `evaluateReversibleToolSafety`, `wrapReversibleExecutionTools` (session option `reversibleExecution`) |
| Project and user memory     | `ProjectMemoryStore`, `WorkspaceMemoryStore`, `SemanticMemoryStore`, `listUserLocalMemoryItems`       |
| Evals                       | `defineEval`, `runEval`, `createSessionRunFn`, matchers such as `exactMatch` and `usedTool`           |
| Bundle plugins              | `BundlePluginLoader`, `BundlePluginInstaller`, `MarketplaceClient`                                    |
| Settings                    | `readSettings`, `writeSettings`, `inspectSettingsLayers`, `createNodeHostSettingsSource`              |
| Self-hosting verification   | `planSelfHostingVerification`, `transitionSelfHostingLoop`                                            |

Bundle plugins use the Claude Code plugin layout: a directory with `.claude-plugin/plugin.json`
(`name`, `version`, `description`, `features`) that can contribute skills, commands, hooks, MCP
server configuration and agent definitions.

## Settings

Settings are JSON files merged in the order the host gives them, later layers winning.
`$ENV:NAME` values in provider credentials are replaced with the environment variable. The Robota
CLI reads `~/.robota/settings.json`, `~/.claude/settings.json`, `.robota/settings.json`,
`.robota/settings.local.json`, `.claude/settings.json` and `.claude/settings.local.json`, in that
order; project files are read only in a trusted project.

```json
{
  "currentProvider": "anthropic",
  "providers": {
    "anthropic": {
      "type": "anthropic",
      "model": "claude-sonnet-4-6",
      "apiKey": "$ENV:ANTHROPIC_API_KEY"
    }
  },
  "permissions": {
    "allow": ["Bash(pnpm *)"],
    "deny": ["Bash(rm -rf *)"]
  }
}
```

`currentProvider` selects the active entry in `providers`. Other keys include `hooks`, `env`,
`language`, `preset`, `autoCompactThreshold`, `sandbox` and `enabledPlugins`.

## Dependencies

| Package                                                                                               | Used for                                            |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `@robota-sdk/agent-core`                                                                              | Agent engine, provider contract, permissions, hooks |
| `@robota-sdk/agent-session`                                                                           | `Session`, logging and persistence ports            |
| `@robota-sdk/agent-tools`                                                                             | Tool factories and sandbox clients                  |
| `@robota-sdk/agent-tool-defaults`                                                                     | The default tool set (loaded on first use)          |
| `@robota-sdk/agent-executor`                                                                          | Background tasks and subagent managers              |
| `@robota-sdk/agent-file-authority`                                                                    | Bounded, root-relative project file reads           |
| `@robota-sdk/agent-interface-*` (analytics, command, execution, session, session-mobility, transport) | Shared contracts                                    |
| `yaml`, `zod`                                                                                         | Frontmatter parsing and settings validation         |

## Documentation

- [docs/SPEC.md](./docs/SPEC.md) — package contract, boundaries and design decisions
- [SDK guide](../../content/guide/sdk.md) and [Building agents](../../content/guide/building-agents.md)
- [Hook event catalog](../agent-core/docs/HOOK-CATALOG.md)

From `packages/agent-framework` in the repository, `pnpm scenario:verify` runs the offline
examples (no provider credentials needed).

## License

Robota is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
