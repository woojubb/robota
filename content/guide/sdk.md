# Using the SDK

`@robota-sdk/agent-framework` assembles the lower Robota packages — `agent-core`, `agent-session`,
`agent-tools` and `agent-executor` — into a ready-to-use agent session: built-in file, shell and web
tools, permission checks, hooks, context tracking and compaction, slash commands, subagents, and
optional persistence. You construct the provider and pass it in; the framework never imports a
provider package itself.

## Choosing an entry point

| You want to…                                               | Use                                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Drive a long-lived agent from your own UI, server or bot   | `new InteractiveSession({ cwd, provider })`                                    |
| Ask a question and get a string back                       | `createQuery({ provider })`                                                    |
| Create many sessions that share one configuration          | `createAgentRuntime({ cwd, provider })` — see [Embedding](./embedding.md)      |
| Expose a session over HTTP, WebSocket or MCP               | `agent-transport-{http,ws,mcp}` — see [Deployment](./deployment.md)            |
| Build a small agent with only your own tools, no framework | `new Robota()` from `agent-core` — see [Building Agents](./building-agents.md) |
| Assemble your own session loop from the parts              | `new Session()` from `agent-session`, with your own provider and tools         |

## InteractiveSession

`InteractiveSession` is the main entry point. It is event-driven and queue-aware: you submit
prompts, listen for events, and the session runs one turn at a time.

```typescript
import { InteractiveSession } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const session = new InteractiveSession({
  cwd: process.cwd(),
  provider: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }),
  permissionMode: 'default',
});

session.on('text_delta', (delta) => process.stdout.write(delta));
session.on('error', (error) => console.error('Turn failed:', error.message));

const handle = await session.submit('Summarize the README in this directory');
const result = await handle.completed;
console.log('\n', result.toolSummaries.length, 'tool calls');

await session.shutdown();
```

- `submit(input)` resolves to an `ITurnHandle` with a fresh `turnId` and a `completed` promise.
  `completed` resolves with that turn's `IExecutionResult` (`response`, `history`, `toolSummaries`,
  `contextState`, `usage`), or rejects with the error the turn failed on. On an idle session,
  `submit()` itself resolves only after the turn has finished.
- A prompt submitted while a turn is running waits in a queue. A newer prompt from the same driver
  (`submit(input, undefined, undefined, { driverId })`) replaces the one still waiting; prompts from
  different drivers wait one after another. A prompt that never runs has its `completed` reject with
  a `TurnNotRunError` whose `reason` is `'coalesced'` (replaced), `'dropped'` (the queue was full)
  or `'cancelled'` (the queue was cleared); `isTurnNotRunError()` from `agent-interface-session`
  recognizes it.
- `abort()` stops the running turn and clears the queue. The partial reply is kept with
  `state: 'interrupted'`, the `interrupted` event fires, and `completed` resolves with
  `interrupted: true`. `cancelQueue()` clears the queue and leaves the running turn alone.
- `shutdown()` aborts any running turn, stops background work, saves the session if a store is
  configured, and removes all listeners. It is safe to call more than once. `submit()` after
  `shutdown()` rejects.

### What a session loads

The framework reads only what its host passes to it. It never guesses a settings file, a project
directory or a storage location. With only `cwd` and `provider`, a session:

- has the default tools (`Shell`, `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `WebFetch`,
  `WebSearch`, `AskUserQuestion`), with file tools confined to `cwd`;
- applies permission checks for the chosen `permissionMode`;
- reads **no** settings file, **no** `AGENTS.md` or `CLAUDE.md`, and discovers **no** skills, agent
  definitions or plugins;
- persists nothing.

Each of those is switched on by an explicit option:

| To…                                                  | Pass                                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| Read project settings and instruction files          | A trusted `projectAccess` (see [Project context](#project-context-and-settings)) |
| Read user settings files                             | `userSettingsSources`                                                            |
| Discover skills                                      | `contributionSources` and `skillRoots`                                           |
| Load bundle plugins                                  | `pluginDirectories`                                                              |
| Save and resume sessions                             | `sessionStore` (for example `createNodeHostSessionStore(dir)`)                   |
| Write replayable session logs                        | `sessionLogSink`                                                                 |
| Replace the default tools                            | `defaultTools` (an empty array removes them all)                                 |
| Add your own tools                                   | `additionalTools`                                                                |
| Add to, or replace, the system prompt                | `appendSystemPrompt`, or `systemPrompt` to replace it                            |
| Skip instruction files and plugins even when trusted | `bare: true`                                                                     |

The `robota` CLI is one host that makes these choices for you; see [CLI](./cli.md).

### Events

Subscribe with `on(event, listener)` and unsubscribe with `off(event, listener)`. The payload types
are exported from `@robota-sdk/agent-interface-session` (`IContextWindowState` from
`@robota-sdk/agent-core`).

| Event                | Payload                   | When                                                                              |
| -------------------- | ------------------------- | --------------------------------------------------------------------------------- |
| `text_delta`         | `string`                  | A chunk of streamed reply text                                                    |
| `tool_start`         | `IToolState`              | A tool call started (`toolName`, `firstArg`, …)                                   |
| `tool_end`           | `IToolState`              | A tool call ended; `result` is `'success'`, `'error'` or `'denied'`               |
| `thinking`           | `boolean`                 | `true` while the session is waiting on the model, `false` when it stops           |
| `context_update`     | `IContextWindowState`     | Token usage changed                                                               |
| `compact`            | `ICompactEvent`           | The conversation was compacted (`trigger`, `before`, `after`)                     |
| `complete`           | `IExecutionResult`        | A turn finished normally                                                          |
| `interrupted`        | `IExecutionResult`        | A turn was aborted; the result holds the partial reply                            |
| `error`              | `Error`                   | A turn (or background work) failed                                                |
| `permission_request` | `IPermissionRequestEvent` | A tool call needs approval; answer with `resolvePermission(id, result)`           |
| `ask_request`        | `IAskRequestEvent`        | A tool or command asks the user something; answer with `resolveAsk(id, response)` |
| `prompt_resolved`    | `IPromptResolvedEvent`    | A pending permission or ask prompt was answered                                   |
| `status_changed`     | `ISessionStatusSnapshot`  | The mode, model, effort, goal or name changed                                     |

The full list, including background-task, skill, goal, plan and checkpoint events, is
`IInteractiveSessionEvents` in `agent-interface-session`.

### Answering permission prompts

In `default` mode, reading and searching proceed on their own, while writing files, running commands
and calling tools that declare no risk class (including your own `additionalTools`) need approval.
The session emits `permission_request` and waits for an answer. **If nothing is listening, the
request is denied at once**, so an unattended session never hangs.

```typescript
import type { InteractiveSession } from '@robota-sdk/agent-framework';

declare const session: InteractiveSession;

session.on('permission_request', ({ id, toolName, toolArgs }) => {
  // Allow writing Markdown files; deny everything else that asks.
  const allowed = toolName === 'Write' && String(toolArgs.filePath ?? '').endsWith('.md');
  session.resolvePermission(id, allowed); // true, false, 'allow-session' or 'allow-project'
});
```

A tool you write has no risk class until you declare one where you define it, with
`registerToolPermissionProfile(name, { riskClass })` from `@robota-sdk/agent-core` (`'inspect'`,
`'modify'` or `'execute'`); the modes then decide it like the built-in tools of that kind.

The modes are `plan` (read-only), `default`, `acceptEdits` (file edits proceed, commands still ask),
`bypassPermissions` (everything proceeds except the always-ask safeguards) and `auto` (a model
classifier decides what the mode leaves open). Rules and hooks are covered in
[Permissions and Hooks](./permissions-and-hooks.md).

### History

`getFullHistory()` returns the session's `IHistoryEntry[]` — one timeline of chat messages and
session events, used for display and persistence.

```typescript
import type { InteractiveSession } from '@robota-sdk/agent-framework';
import type { IHistoryEntry } from '@robota-sdk/agent-core';

declare const session: InteractiveSession;

const history: IHistoryEntry[] = session.getFullHistory();
const chat = history.filter((entry) => entry.category === 'chat');
```

An entry with `category: 'chat'` is a user or assistant message; `category: 'event'` entries record
things such as `tool-start`, `tool-end`, `tool-summary` and `skill-activation`. Only chat entries are
sent to the model.

## createQuery()

`createQuery({ provider })` returns a function that takes a prompt and resolves with the reply text.
It builds one `InteractiveSession` when you call `createQuery`, and every call of the returned
function is a new turn in that same conversation.

```typescript
import { createQuery } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const query = createQuery({
  provider: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }),
  cwd: '/path/to/project',
  onTextDelta: (delta) => process.stdout.write(delta),
});

const answer = await query('Which files define the public API?');
const followUp = await query('And which of those have tests?');
```

Options: `provider` (required), `cwd` (default `process.cwd()`), `permissionMode` (default
`'default'`), `permissionHandler`, `onTextDelta`, `additionalTools`, `maxTurns`, `responseFormat`,
`projectAccess` and `userSettingsSources`. With no `permissionHandler`, any call that would need
approval is denied; pass one to decide, or pass `permissionMode: 'bypassPermissions'` only when the
agent may do anything in `cwd` unattended.

```typescript
import { createQuery } from '@robota-sdk/agent-framework';
import type { IAIProvider } from '@robota-sdk/agent-core';

declare const provider: IAIProvider;

const query = createQuery({
  provider,
  permissionMode: 'acceptEdits',
  permissionHandler: async (toolName) => toolName !== 'Bash' && toolName !== 'Shell',
});
```

For deployment patterns — servers, bots, serverless, batch jobs — see [Embedding](./embedding.md).

## Project context and settings

A session reads project files only when its host has decided the project is trusted. That decision
is a `projectAccess` value. `WorkspaceTrustService` produces one from a trust store you choose; trust
is recorded per Git repository, and a directory outside a Git repository stays Restricted.

```typescript
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  InteractiveSession,
  createContributionSourcesForProjectAccess,
  createNodeHostSettingsSource,
  createNodeWorkspaceTrustService,
} from '@robota-sdk/agent-framework';
import type { IAIProvider } from '@robota-sdk/agent-core';

declare const provider: IAIProvider;
const cwd = '/path/to/repo';

const trust = createNodeWorkspaceTrustService(
  join(homedir(), '.my-app', 'trusted-workspaces.json'),
);
// inspect() reports the stored decision; grant() records trust — call it only when the user agrees.
const projectAccess = await trust.inspect(cwd);

const session = new InteractiveSession({
  cwd,
  provider,
  projectAccess,
  userSettingsSources: [
    createNodeHostSettingsSource('user', join(homedir(), '.my-app', 'settings.json')),
  ],
  projectSettingsPaths: [{ scope: 'project', relativePath: '.my-app/settings.json' }],
  contributionSources: createContributionSourcesForProjectAccess(projectAccess, homedir()),
  skillRoots: [{ root: '.agents/skills', kind: 'skills' }],
});
```

With a trusted `projectAccess` the session:

- reads the project settings paths you listed, after the user settings sources (later layers
  override earlier ones, except that permission lists are merged and the most restrictive
  `defaultTrustLevel` wins);
- reads `AGENTS.md` and `CLAUDE.md` from the working directory up to the repository root and adds
  them to the system prompt (unless `bare: true`);
- adds the "Compact Instructions" section of `CLAUDE.md`, if there is one, to the prompt it uses
  when it compacts the conversation.

A Restricted `projectAccess` (or none) reads no project file; user-level sources still apply.

### Settings file format

Settings files are JSON. The keys the framework reads include `permissions` (`allow`, `deny`, `ask`
rule lists), `hooks`, `defaultTrustLevel` (`safe`, `moderate` or `full`), `env`, and provider
profiles (`currentProvider` and `providers`). A value written as `$ENV:NAME` is read from the
environment variable `NAME`.

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
  "defaultTrustLevel": "moderate",
  "permissions": {
    "allow": ["Read(*)", "Glob(*)", "Grep(*)"],
    "deny": ["Bash(rm -rf *)"]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [{ "type": "command", "command": "bash .hooks/log-tool.sh" }]
      }
    ]
  }
}
```

The session does not construct its provider from settings: the host resolves a provider profile
and passes the provider instance in. The `robota` CLI reads six layers, lowest priority first:
`~/.robota/settings.json`, `~/.claude/settings.json`, `.robota/settings.json`,
`.robota/settings.local.json`, `.claude/settings.json`, `.claude/settings.local.json`. Provider
profile options are listed in the [Providers Reference](./providers.md).

## Commands

The framework owns the command infrastructure — `CommandRegistry`, `SystemCommandExecutor`, and the
command sources `SkillCommandSource` and `PluginCommandSource` — but ships no user-visible commands
of its own. Commands come from command modules (`ICommandModule`) that the host passes as
`commandModules`; `@robota-sdk/agent-command` provides the modules the `robota` CLI uses
(`/help`, `/compact`, `/permissions`, `/skills` and the rest).

Call commands through the session (this assumes the host composed a module that provides
`compact`; `executeCommand()` resolves to `null` for a command no module provides):

```typescript
import type { InteractiveSession } from '@robota-sdk/agent-framework';

declare const session: InteractiveSession;

const commands = session.listCommands();
const result = await session.executeCommand('compact', 'focus on the API design');
```

User interfaces and transports parse slash input themselves and call `executeCommand()` before
submitting ordinary prompts. When the skills module is composed, an explicit `/skill-name` prompt is
routed to the `skills` command with `<skill-name> [args]`. Commands a module marks as
model-invocable are also offered to the model as tools named `<prefix><command>`; the prefix is
`command_` by default (the `robota` CLI uses `robota_command_`).

## Sandbox execution

`InteractiveSession` accepts `sandboxClient?: ISandboxClient`. With one, the default shell tools run
their commands through the sandbox; when the sandbox has its own filesystem, `Read`, `Write` and
`Edit` go through it too (and `Glob`/`Grep` are left out). Your application installs the sandbox
provider's SDK and passes an adapted client in; neither `agent-framework` nor `agent-tools` depends on
it.

<!-- doc-example-skip: imports the external `e2b` SDK, which consumers install at their composition root -->

```typescript
import { InteractiveSession } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import { E2BSandboxClient } from '@robota-sdk/agent-tools';
import type { IWorkspaceManifest } from '@robota-sdk/agent-tools';
import { Sandbox } from 'e2b';

const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
const sandbox = await Sandbox.create();
const workspaceManifest: IWorkspaceManifest = {
  entries: {
    'task.md': { type: 'file', content: 'Analyze this project.\n' },
    repo: { type: 'gitRepo', url: 'https://github.com/example/project.git', ref: 'main' },
    output: { type: 'dir' },
  },
};

const session = new InteractiveSession({
  cwd: process.cwd(),
  provider,
  sandboxClient: new E2BSandboxClient({ sandbox }),
  workspaceManifest,
  reversibleExecution: { mode: 'local-first' },
});
```

`workspaceManifest` (owned by `agent-tools`) prepares files, directories and Git repositories in a
fresh sandbox when the session starts; cloud mount entries report `unsupported` until a sandbox
adapter implements mounting. If the sandbox client implements `snapshot()` and `restore(snapshotId)`,
`shutdown()` saves the snapshot id in the session record, and resuming that session (not a fork)
restores the sandbox before the conversation is replayed.

## Subagents

A session can delegate work to subagents — child sessions with their own system prompt and a
filtered tool list. The framework ships three built-in agent definitions:

| Name              | Tools                         | Model                 | Purpose                         |
| ----------------- | ----------------------------- | --------------------- | ------------------------------- |
| `general-purpose` | All of the parent's tools     | Inherits the parent's | Carry out a delegated task      |
| `Explore`         | All except `Write` and `Edit` | Inherits the parent's | Read-only codebase exploration  |
| `Plan`            | All except `Write` and `Edit` | Inherits the parent's | Read-only research and planning |

A subagent never gets the tool that spawns further subagents. Hosts add their own definitions with
`agentDefinitions`, or let the session discover definition files in `agentDefinitionRoots` (the
`robota` CLI uses `.robota/agents`, `.agents/agents` and `.claude/agents`). The main fields of a
definition (`IAgentDefinition`):

| Field             | Type           | Description                                                  |
| ----------------- | -------------- | ------------------------------------------------------------ |
| `name`            | `string`       | Agent identifier                                             |
| `description`     | `string`       | What the agent does                                          |
| `systemPrompt`    | `string`       | The agent's system prompt (the Markdown body in a file)      |
| `model`           | `string`       | Model override: `sonnet`, `haiku`, `opus` or a full model id |
| `effort`          | `TModelEffort` | Reasoning-effort override                                    |
| `maxTurns`        | `number`       | Maximum agentic turns                                        |
| `tools`           | `string[]`     | Tool allowlist                                               |
| `disallowedTools` | `string[]`     | Tool denylist, applied before the allowlist                  |

The shortcuts resolve to `claude-sonnet-4-6`, `claude-haiku-4-5` and `claude-opus-4-6`.

The framework appends a short instruction to a subagent's system prompt asking for a concise report;
a fork worker is asked for a structured report of at most 500 words. A subagent's transcript is
written as JSONL to `{logsDir}/{parentSessionId}/subagents/{agentId}.jsonl` while it streams.

The `agent` command module (from `agent-command`) is how the model and the user start subagents as
background jobs. Its `parallel` form starts several jobs as one group and, unless `--detach` is
given, waits for all of them and returns a combined summary. Each job is `LABEL:"PROMPT"` or
`LABEL=AGENT_NAME:"PROMPT"`:

```
/agent parallel contract=Plan:"Review the API contract" risks=Explore:"Inspect implementation risks"
```

For lower-level control, `createSubagentSession(options: ISubagentOptions)` builds a child `Session`
directly from the parent's config, loaded instructions, tools and provider. Child-process subagents
are provided by the optional `@robota-sdk/agent-subagent-runner` package.

## Session logs

When the host passes a `sessionLogSink`, each run records provider requests, the provider's raw
request and response payloads, normalized responses, assistant messages, and tool calls and results
as append-only JSONL. These logs are for debugging and for replaying a session; a large payload is
stored beside the log and verified by length and SHA-256 digest when it is read back.

## Bundle plugins and marketplaces

Bundle plugins package skills, commands, hooks, agent definitions and MCP server definitions for
distribution. `MarketplaceClient` manages plugin marketplaces as shallow Git clones under the plugins
directory the host chooses (`new MarketplaceClient({ pluginsDir, exec })`; marketplaces go in
`<pluginsDir>/marketplaces/`). Sources can be GitHub repositories, other Git URLs, or local paths. The `robota` CLI uses
`~/.robota/plugins` and exposes this as `/plugin marketplace add|remove|list|update`. See
[Building Plugins](./plugins.md).

## Transports

A transport exposes a session over a protocol. `agent-transport-http` (Hono), `agent-transport-ws`
(WebSocket) and `agent-transport-mcp` (MCP server over stdio or Streamable HTTP) are separate
packages; each implements `ITransportAdapter` from `agent-interface-transport` and translates
protocol messages into session calls and session events back into messages. `agent-framework` itself
provides the non-interactive runner (`createHeadlessRunner`, with `text`, `json` or `stream-json`
output) and `TransportRegistry` for starting and stopping several transports together. The
[Deployment](./deployment.md) guide shows how to serve one session over several channels.
