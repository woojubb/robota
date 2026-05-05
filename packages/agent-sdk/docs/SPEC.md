# @robota-sdk/agent-sdk SPEC

## Overview

Robota SDK is a programming SDK built by **assembling** existing Robota packages.
It is provider-neutral: the consumer (CLI, server, worker, etc.) creates the provider and passes it to the SDK.
The primary entry point is `InteractiveSession({ cwd, provider })`. A `createQuery({ provider })` factory is also provided for single-shot prompt use.

## Core Principles

1. **Assembly first**: All features are implemented using existing packages. Independent implementation is prohibited.
2. **No duplication**: If the same functionality exists in an existing package, use it. Refactor the existing package if needed.
3. **Connection required**: All features in agent-sdk must be connected to the Robota package ecosystem.
4. **General/specialized separation**: General-purpose features (permissions, hooks, tools) belong in their respective packages; only SDK-specific features (config, context) are kept in agent-sdk.

## Architecture

### Package Dependency Chain

```
agent-core           ← types, abstractions, utilities (unchanged)
agent-runtime        ← background task + subagent lifecycle primitives (unchanged)
agent-sessions       ← Session, permissions, compaction (unchanged)
agent-tools          ← tool infrastructure + 8 built-in tools (unchanged)
agent-provider-*     ← provider implementations (unchanged)

agent-sdk            ← InteractiveSession (single entry point)
  ├── embedded: SystemCommandExecutor (session.executeCommand())
  ├── embedded: CommandRegistry, BuiltinCommandSource, SkillCommandSource, PluginCommandSource
  ├── common API: command effects/interactions, lifecycle metadata, session replay validation, provider settings/profile helpers
  ├── common API: prompt file-reference parsing, resolution, diagnostics, and structured records
  ├── extension: ICommandModule command/source/session-requirement injection
  ├── optional: Agent tool + AgentDefinitionLoader when a module requests agent-runtime
  ├── composed: agent-runtime BackgroundTaskManager, SubagentManager, runner ports
  ├── internal: createSession(), createDefaultTools(), loadConfig(), loadContext()
  ├── optional: sandboxClient injection for sandbox-aware built-in tool execution
  ├── optional: workspaceManifest application through agent-tools sandbox ports
  ├── optional: sandbox snapshot hydration through agent-tools sandbox ports
  ├── exposed: createQuery({ provider }) → (prompt) => result
  └── NO provider dependency (provider-neutral)

agent-command-*      ← built-in/optional command modules
  ├── consumes SDK command interfaces
  ├── consumes SDK common APIs like third-party modules
  └── NO dependency from agent-sdk back to command modules

agent-cli            ← minimal TUI
  ├── creates provider (reads config, picks provider package)
  ├── selects product-default command modules such as @robota-sdk/agent-command-agent
  ├── creates InteractiveSession({ cwd, provider, commandModules })
  ├── subscribes to events → renders to terminal
  └── owns: slash prefix parsing, Ink components, paste handling, CJK input
```

SDK is provider-neutral. The consumer (CLI, server, etc.) creates the provider and passes it to the SDK. Assembly (wiring tools, provider, system prompt) happens inside the SDK, but the provider itself comes from the consumer.

SDK command code is split between generic infrastructure and command-facing common APIs. The SDK responsibility is the command contract layer: command contracts, registries/executors, lifecycle metadata, effects/interactions, and reusable command-facing common APIs. User-visible internal commands must be implemented as command modules selected by composition roots; `agent-sdk` no longer owns user-visible built-in command behavior.

Model command common APIs are provider-aware but provider-neutral. They resolve the effective active provider profile from the provider settings document, read model catalog fallback metadata from injected `IProviderDefinition` records, can explicitly invoke provider-owned catalog refresh hooks, and produce command descriptors without hardcoding CLI/TUI provider branches. If a live refresh fails or a provider does not expose catalog metadata, `/model` remains manually invocable and the command result must surface stale/unavailable catalog state rather than showing another provider's models.

### Client–SDK–Session Relationship

```
Any client (CLI, web, API server, worker)
    │
    │  1. creates provider:  new AnthropicProvider({ apiKey })
    │  2. creates session:   new InteractiveSession({ cwd, provider })
    │  3. subscribes:        session.on('text_delta', ...)
    ↓
InteractiveSession  (agent-sdk — pure TypeScript, no React)
    │  submit(input, displayInput?, rawInput?)
    │  executeSkillCommand(skill, args, displayInput?, rawInput?)
    │  executeCommand(name, args)
    │  abort() / cancelQueue()
    │  getMessages() / getContextState() / getActiveTools()
    │  (config/context loaded internally from cwd)
    ↓
Session  (agent-sessions — generic run loop)
    ↓
Robota engine + Provider  (agent-core / agent-provider-*)

agent-cli (Ink TUI — thin bridge layer)
    creates provider → passes to InteractiveSession({ cwd, provider, commandModules })
    subscribes to InteractiveSession events → maps to React/Ink state
    routes /commands → session.executeCommand()
```

The SDK layer has **no React dependency** and **no provider dependency**. The CLI is a TUI-only layer that creates the provider and bridges InteractiveSession events to React state.

### Package Roles

| Package               | Role                                                                                                                                     | General/Specialized |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| **agent-core**        | Robota engine, execution loop, provider abstraction, permissions, hooks                                                                  | General             |
| **agent-runtime**     | Background task and subagent lifecycle primitives, runner ports, worktree runner decorator                                               | General             |
| **agent-tools**       | Tool creation infrastructure, sandbox execution ports, and 8 built-in tools                                                              | General             |
| **agent-sessions**    | Generic Session class, SessionStore (persistence)                                                                                        | General             |
| **agent-sdk**         | Assembly layer: InteractiveSession (single entry point), command contracts/common APIs, createQuery(), config, context                   | SDK-specific        |
| **agent-command-\***  | Built-in/optional command modules that consume SDK command interfaces/common APIs and can be selected by composition roots               | Command-specific    |
| **agent-cli**         | Ink TUI and product composition. Creates provider, selects command modules, passes both to InteractiveSession. No agent-sessions import. | CLI-specific        |
| **agent-provider-\*** | AI provider implementations. CLI depends on these directly; SDK does not.                                                                | Provider-specific   |

### Feature Layout (Current Implementation State)

```
agent-core
├── src/permissions/          ← permission-gate, permission-mode, types
├── src/hooks/                ← hook-runner, hook types
└── (existing) Robota, execution, providers, plugins

agent-runtime (reusable runtime primitives — depends only on agent-core)
├── src/background-tasks/     ← BackgroundTaskManager, state machine, task runner ports
└── src/subagents/            ← SubagentManager, subagent runner port, worktree runner decorator

agent-tools
├── src/builtins/             ← bash, read, write, edit, glob, grep, web-fetch, web-search tools
├── src/sandbox/              ← ISandboxClient, workspace manifest contracts, snapshot ports, E2B structural adapter, and in-memory contract adapter
├── src/types/tool-result.ts  ← TToolResult
└── (existing) FunctionTool, createZodFunctionTool, schema conversion

agent-sessions (generic — depends only on agent-core)
├── src/session.ts                ← Session: orchestrates run loop, delegates to sub-components
├── src/permission-enforcer.ts    ← PermissionEnforcer: tool wrapping, permission checks, hooks, truncation
├── src/context-window-tracker.ts ← ContextWindowTracker: token usage, auto-compact threshold
├── src/compaction-orchestrator.ts ← CompactionOrchestrator: conversation summarization via LLM
├── src/session-logger.ts         ← ISessionLogger + FileSessionLogger / SilentSessionLogger
├── src/session-store.ts          ← SessionStore (JSON file persistence)
└── src/index.ts

agent-sdk (assembly layer — SDK-specific features only)
├── src/interactive/
│   ├── interactive-session.ts  ← InteractiveSession: event-driven wrapper over Session
│   ├── session-persistence.ts  ← SDK-owned session store facade and resumable-session summaries
│   └── types.ts                ← IToolState, IExecutionResult, IInteractiveSessionEvents
├── src/command-api/            ← Command module contracts, host context, effects/interactions, session/provider/model common APIs
│   ├── contracts.ts            ← ISystemCommand + lifecycle metadata
│   ├── command-module.ts       ← ICommandModule composition contract
│   ├── host-context.ts         ← ICommandHostContext narrow facade for command modules
│   ├── host-adapters.ts        ← generic host adapter contracts
│   ├── provider/               ← provider settings/profile/setup/probe common APIs
│   ├── model/                  ← provider-aware model catalog common APIs and refresh orchestration
│   ├── session/                ← session-history and replay-validation command common APIs
│   └── background/             ← background task command common APIs
├── src/commands/
│   ├── command-registry.ts     ← CommandRegistry: aggregates ICommandSource instances
│   ├── builtin-source.ts       ← BuiltinCommandSource: command palette metadata derived from executable built-ins
│   ├── skill-source.ts         ← SkillCommandSource: discovers SKILL.md files
│   ├── plugin-source.ts        ← PluginCommandSource: discovers plugin commands (moved from agent-cli)
│   └── system-command.ts       ← empty SDK-default command factory retained for composition tests
├── src/assembly/               ← Session factory: createSession (internal), createDefaultTools (internal)
├── src/config/                 ← settings.json loading (6-layer merge, $ENV substitution)
├── src/context/                ← AGENTS.md/CLAUDE.md/memory discovery, project detection, system prompt
│   ├── context-reference-inventory.ts ← session context reference metadata, active/observed status, and bounded inventory policy
│   ├── prompt-file-reference-*.ts ← `@file` prompt reference parser/resolver, path policy, formatting, and diagnostics
│   └── task-context.ts         ← active `.agents/tasks/*.md` discovery, selection, formatting, and status updates
├── src/memory/                 ← project memory store, reusable capture policy, retrieval services
├── src/checkpoints/            ← edit checkpoint store + Write/Edit tool snapshot wrapper
├── src/self-hosting/           ← self-hosting verification planner + lifecycle state machine
├── src/tools/agent-tool.ts     ← Agent sub-session tool (SDK-specific: uses createSession)
├── src/subagents/              ← SDK in-process runner + explicit compatibility exports from agent-runtime
├── src/background-tasks/       ← explicit compatibility exports from agent-runtime
├── src/permissions/            ← permission-prompt.ts (terminal approval prompt)
├── src/paths.ts                ← projectPaths / userPaths helpers
├── src/types.ts                ← internal terminal type aliases; not a top-level public barrel
├── src/query.ts                ← createQuery() factory (provider-neutral; provider injected by consumer)
└── src/index.ts                ← SDK-owned APIs plus explicit SDK facade exports

agent-cli (Ink TUI — CLI-specific)
├── src/commands/               ← Compatibility re-export shims and skill prompt helpers;
│                                  no built-in command execution ownership
├── src/ui/                     ← App, MessageList, InputArea, StatusBar, PermissionPrompt,
│                                  SlashAutocomplete, CjkTextInput, WaveText, InkTerminal, render
├── src/permissions/            ← permission-prompt.ts (terminal arrow-key selection)
├── src/types.ts                ← ITerminalOutput, ISpinner (duplicate — SSOT is agent-sessions)
├── src/cli.ts                  ← CLI argument parsing, Ink render
└── src/bin.ts                  ← Binary entry point
```

## Feature Details

### Session Management

- **Package**: `agent-sessions` (generic, depends only on agent-core)
- **Implementation**: Session accepts pre-constructed tools, provider, and system message. Internal concerns are delegated to PermissionEnforcer, ContextWindowTracker, and CompactionOrchestrator.
- **Assembly**: `agent-sdk/assembly/` provides `createSession()` (internal — not exported) which wires tools, provider, and system prompt from config/context. Consumers use `InteractiveSession({ cwd, provider })` instead.
- **Persistence**: `SessionStore` defaults to `~/.robota/sessions/{id}.json` for generic session consumers. SDK exposes `createProjectSessionStore(cwd)` and resumable-session helpers so CLI composition can use project-local `.robota/sessions` without importing `agent-sessions` directly.
- **Replay validation common API**: SDK command APIs expose `validateCommandSessionReplayLog()` and formatting helpers that load the current session's project-local `.robota/logs/{sessionId}.jsonl` file through `agent-sessions` replay validators. Command modules consume this API; `agent-cli` must not read replay logs or implement replay validation directly.

### Permission System

- **Package**: `agent-core` (general-purpose security layer)
- **Implementation**: 3-step evaluation — deny list → allow list → mode policy
- **Modes**: `plan` (read-only), `default` (write requires approval), `acceptEdits` (write auto-approved), `bypassPermissions` (all auto-approved)
- **Pattern syntax**: `Bash(pnpm *)`, `Read(/src/**)`, `Write(*)` etc. with glob matching
- **Terminal prompt**: `agent-sdk/src/permissions/permission-prompt.ts` is the SSOT implementation of the terminal approval prompt. Used by both `InteractiveSession`/`createQuery()` and `agent-cli` (which imports from `@robota-sdk/agent-sdk`).
- **Default allow patterns**: `createSession()` automatically adds allow patterns for config folder access: `Read(.agents/**)`, `Read(.claude/**)`, `Read(.robota/**)`, `Glob(.agents/**)`, `Glob(.claude/**)`, `Glob(.robota/**)`. These are merged with user-configured permissions.

### Hooks System

- **Package**: `agent-core` (general-purpose extension points)
- **Events**: `PreToolUse`, `PostToolUse`, `PreCompact`, `PostCompact`, `SessionStart`, `Stop`
- **Implementation**: Executes shell commands, passes JSON via stdin, determines allow(0)/deny(2) by exit code
- **Matcher**: Tool name regex pattern matching

### Tool System

- **Infrastructure**: `agent-tools` (createZodFunctionTool, FunctionTool, Zod→JSON conversion)
- **Built-in tools**: `agent-tools/builtins/` — Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch
- **Agent tool**: `agent-sdk/tools/agent-tool.ts` — sub-agent Session creation (SDK-specific). Registered only when the composed command modules request agent runtime support. The tool description is the owner-provided model contract for direct subagent delegation: explicit user requests to create, run, spawn, delegate to, or use agents/subagents should start `Agent` tool calls immediately unless impossible or unsafe; one `Agent` tool call creates one background subagent job and waits for terminal completed/failed/timed-out result data before returning to the parent conversation.
- **Edit checkpoint wrapper**: `agent-sdk/checkpoints/edit-checkpoint-tools.ts` wraps `Write` and `Edit` at SDK session assembly time. The underlying tool package stays generic; the SDK wrapper snapshots the target file before the first mutation in each prompt turn.
- **Tool result type**: `TToolResult` in `agent-tools/types/tool-result.ts`

### Sandbox Execution

- **Port owner**: `agent-tools/sandbox/` owns `ISandboxClient`, `ISandboxRunOptions`, and `ISandboxRunResult`.
- **Workspace manifest owner**: `agent-tools/sandbox/` owns `IWorkspaceManifest`, manifest path validation, and generic manifest application. SDK and CLI must not redeclare the manifest shape or implement manifest application algorithms.
- **Adapter owner**: `agent-tools` owns structural sandbox adapters such as `E2BSandboxClient` and `InMemorySandboxClient`. It does not install provider SDKs; application composition roots may install `e2b` or another provider and wrap its sandbox object.
- **SDK assembly**: `createSession()` and `InteractiveSession` accept `sandboxClient?: ISandboxClient`. When present, SDK-created Bash, Read, Write, and Edit tools are created through sandbox-aware factories and route command/filesystem operations through the injected client.
- **Fresh workspace setup**: `InteractiveSession` accepts `workspaceManifest?: IWorkspaceManifest` with `sandboxClient`. The async interactive construction path applies the manifest once before creating the `Session`, using the current project `cwd` as the host root for relative `localFile` and `localDir` sources. The internal synchronous `createSession()` factory does not apply manifests; direct low-level consumers call `applyWorkspaceManifest()` from `agent-tools` before session creation.
- **Snapshot hydration**: If `sessionStore` and a sandbox client with `snapshot()` are provided, `InteractiveSession.shutdown()` captures a provider-owned `sandboxSnapshotId` and stores it in the session record. On non-fork `resumeSessionId`, SDK initialization loads the saved id and calls `sandboxClient.restore(snapshotId)` before constructing the underlying `Session` and before deferred saved-message injection. When a snapshot is restored, fresh `workspaceManifest` application is skipped to avoid overwriting hydrated state.
- **Reversible execution**: If `reversibleExecution.mode` is enabled and no explicit isolation is set, a supplied `sandboxClient` makes the SDK classify Bash and sandbox-routed file mutations as `provider-sandbox` isolated instead of host checkpoint-backed mutations.
- **Boundary**: `agent-cli` and other hosts only decide whether to provide a sandbox client and, if they parse manifest files, convert them into the `agent-tools` manifest contract. They must not implement sandbox command/file/manifest algorithms or provider-specific restore behavior in UI code.

### Edit Checkpointing

- **Package**: `agent-sdk/checkpoints/` (SDK-specific session safety layer)
- **Storage**: Project-local `.robota/checkpoints/{session-id}/{turn-id}/manifest.json` plus copied pre-image files under `files/`.
- **Turn model**: Every cwd-backed `InteractiveSession.submit()` prompt starts a turn-level checkpoint. The checkpoint is finalized after the run finishes, even when no file was edited, so prompt turns can be listed consistently. Injected sessions without `cwd` do not implicitly create project checkpoints; they must provide `cwd` or use explicit checkpoint APIs.
- **Capture model**: `Write` and `Edit` tools are wrapped during `createSession()` assembly when an `IEditCheckpointRecorder` is present. A file is captured once per turn before the first tool mutation. Repeated edits to the same file in the same turn reuse the first pre-image.
- **Inspection model**: `inspect(sessionId, checkpointId)` returns captured files, workspace-relative display paths, snapshot availability, and the restore/rollback checkpoint ranges before a caller mutates the workspace.
- **Restore model**: `restoreToCheckpoint(sessionId, checkpointId)` rolls back later checkpoints in reverse sequence order, restores copied pre-images, deletes files that did not exist at capture time, and removes later checkpoint directories. This provides code-only rewind to the selected prompt turn.
- **Boundary**: `agent-tools` does not know about sessions, prompts, `.robota`, or checkpoints. CLI/TUI does not implement checkpoint algorithms; it only exposes SDK command output and future picker UI.
- **Current scope**: `Write` and `Edit` mutations are tracked. Shell-side filesystem changes from `Bash` are not tracked by this layer.

### Reversible Execution Mode

- **Package**: `agent-sdk/reversible-execution/` (SDK-specific safety classification and opt-in tool wrapper)
- **Mode**: `createSession({ reversibleExecution: { mode: 'local-first' } })` enables local-first reversible execution enforcement. The mode is opt-in while provider sandbox snapshots are still future work.
- **File mutations**: `Write` and `Edit` are reversible only when an edit checkpoint recorder is present. Without a checkpoint, local-first mode blocks the tool before mutation.
- **Shell/process side effects**: `Bash` and `BackgroundProcess` are not checkpoint-restorable in the parent workspace. Local-first mode requires `worktree` or `provider-sandbox` isolation before allowing those side effects.
- **Agent jobs**: `Agent` jobs are reversible through the worktree layer only when the request or all batch jobs specify `isolation: 'worktree'`, or when the outer execution context is already isolated.
- **Read-only tools**: `Read`, `Glob`, `Grep`, `WebFetch`, and `WebSearch` are classified as read-only and do not require rollback.
- **Boundary**: The policy is SDK-owned and provider-neutral. It does not execute Git commands, manage provider sandboxes, or render UI. Runtime shells and provider adapters supply actual worktree/sandbox isolation.

### Self-Hosting Verification

- **Package**: `agent-sdk/self-hosting/` (SDK-specific planning layer)
- **Purpose**: Describes the safe edit/build/verify loop for Robota modifying its own source tree without replacing the currently running process.
- **Planner**: `planSelfHostingVerification()` returns ordered steps for checkpoint creation, atomic file mutation, external process handoff, targeted package verification, harness verification, and rollback recovery.
- **State machine**: `transitionSelfHostingLoop()` enforces deterministic lifecycle transitions from `idle` through checkpoint/edit/verify success or failure recovery.
- **Handoff model**: The current process remains the old runtime and keeps already-loaded modules. Verification commands run in child processes against the new on-disk tree.
- **Boundaries**: The SDK planner does not implement file writing, checkpoint storage, CLI rendering, or provider behavior. Atomic write behavior belongs to `agent-tools`; checkpoint storage belongs to `agent-sdk/checkpoints`; CLI/TUI only invokes SDK APIs and renders results.
- **Verification defaults**: For supplied package scopes, the default plan includes `test`, `typecheck`, and `build` commands before `pnpm harness:verify -- --base-ref <ref> --skip-record-check`. The harness verification step is always present.

### Web Search

- **Local tools**: `WebSearch` and `WebFetch` are ordinary Robota function tools from `@robota-sdk/agent-tools`. They are available to CLI sessions as explicit local tools and are separate from provider-native hosted web features.
- **Provider-native tools**: Anthropic server web search and Qwen Responses web search/fetch are exposed through provider-owned capability reports. Provider capability text must come from the provider adapter or tool descriptor; the system prompt composer must not inject hardcoded web-search behavior instructions.
- **Activation**: Session layers use the provider-neutral `configureNativeWebTools()` hook when a provider chooses to expose automatic hosted web behavior. SDK must not branch on concrete provider names or mutate provider-specific fields directly.
- **Callback**: `onServerToolUse` fires during streaming when a provider-owned server tool executes, allowing the UI to display search status.

### Streaming

- **Implementation**: `TTextDeltaCallback` type (IChatOptions in agent-core)
- **Behavior**: AnthropicProvider uses the streaming API, returning the completed message while calling the callback for each text delta
- **UI connection**: Session → onTextDelta → InteractiveSession `text_delta` event → client

### InteractiveSession (SDK-Specific)

- **Package**: `agent-sdk/interactive/`
- **Pattern**: Composition over Session (holds a `Session` instance, does not extend it)
- **Constructor**: Accepts `{ cwd, provider }` plus optional composition inputs such as `commandModules`. Config and context are loaded internally from `cwd`.
- **Responsibility**: Streaming accumulation, tool state tracking, prompt queue (max 1), abort orchestration, full history management (`IHistoryEntry[]`), embedded command execution
- **Tool execution history**: Each `tool_start` and `tool_end` event is recorded as an individual `IHistoryEntry` with `category: 'event'` and `type: 'tool-start'` or `type: 'tool-end'`. Data includes `toolName`, `firstArg`, `isRunning`, and `result`. For completed Edit tools, `IToolState` also carries `diffFile` and `diffLines` derived from the Edit tool arguments plus the tool result `startLine`. For completed command tools, `IToolState` carries `toolResultData` so transports can render bounded command output previews while raw tool messages remain persisted. The `tool-summary` entry (aggregated) is still pushed at execution completion and preserves the same per-tool metadata for persisted UI rendering.
- **Events**: `text_delta`, `tool_start`, `tool_end`, `thinking`, `complete`, `error`, `context_update`, `interrupted`
- **submit() signature**: `submit(input, displayInput?, rawInput?)` — `displayInput` overrides what appears in the client's message list; `rawInput` is passed to `Session.run()` for hook matching
- **Prompt file references**: Before a non-command prompt reaches `Session.run()`, `InteractiveSession` delegates to the SDK-owned prompt file-reference resolver. Path-like tokens such as `@AGENTS.md`, `@./Makefile`, and `@docs/spec.md` are resolved relative to the session `cwd`, constrained to the workspace root, bounded by explicit file/total byte limits, and expanded into model-only prompt context blocks. The user-visible history keeps the original prompt and records a `prompt-file-reference` event with structured records (`sourcePath`, `relativePath`, `originalReference`, `reason`, `depth`, `byteLength`) without storing file contents in the event. Missing, outside-root, directory, circular, max-depth, and size-limit failures are blocking diagnostics and the prompt is not sent to the provider.
- **executeCommand()**: `executeCommand(name, args)` — executes a named system command via the embedded `SystemCommandExecutor`. Product composition roots inject command modules such as `/compact`; SDK-default user-visible commands are intentionally empty.
- **Edit checkpoints**: `listEditCheckpoints()` returns checkpoint summaries for the active session. `inspectEditCheckpoint(id)` returns captured files and restore/rollback plans. `restoreEditCheckpoint(id)` restores code to a prior checkpoint and records a system history entry. It is rejected while a prompt is running.
- **listCommands()**: `listCommands()` — returns `Array<{ name, description }>` of all registered system commands. Used by transport adapters (e.g., MCP) to expose commands as tools.
- **Queue behavior**: If `executing` is true, the incoming prompt is queued. The queued prompt auto-executes after the current one completes. Only one prompt can be queued at a time.
- **Abort**: `abort()` clears the queue and delegates to `session.abort()`. An `interrupted` event fires when the abort completes.
- **No-op terminal**: Uses a built-in NOOP_TERMINAL so no `ITerminalOutput` implementation is required by callers
- **Session persistence**: When an SDK-owned `sessionStore` facade is provided in options, auto-persists session state (messages, history, cwd, timestamps, system prompt, tool schemas, memory events, used memory references, and provider sandbox snapshot ids when available) after each `submit()` completion and on shutdown. The SDK facade delegates to the concrete `SessionStore` implementation from `agent-sessions` internally and exposes resumable-session summaries for hosts such as the CLI. Session JSON is the fast snapshot, while append-only JSONL replay logs are the recovery source when the JSON snapshot is missing.
- **Session restore**: When `resumeSessionId` is provided, loads the saved session record and restores AI context. The project session store first reads `.robota/sessions/{id}.json`; if it is missing, it replays `.robota/logs/{id}.jsonl` through `agent-sessions` replay readers and reconstructs messages/history from `history_mutation` events. For non-fork resumes with `sandboxSnapshotId`, the SDK restores the sandbox before constructing the underlying Session and before injecting messages. Messages are stored as `pendingRestoreMessages` and injected via `session.injectMessage()` after async initialization completes (deferred injection pattern). Memory event history and the last used memory references are restored for `/memory used` and debugging. This avoids injection failures caused by the Session not yet being fully initialized when the constructor runs.
- **forkSession option**: `forkSession?: boolean` (default `false`). When `false` (resume), the original session ID is passed to the Session constructor so it reuses the same file. When `true` (fork), `sessionId` is omitted, generating a fresh UUID — the original session remains untouched.
- **getName()/setName(name)**: Get or set the session's user-facing name. Persists to the session record when a store is configured.
- **attachTransport(transport)**: `attachTransport(transport: ITransportAdapter)` — attaches a transport adapter to this session. Calls `transport.attach(this)`. Used by consumers to compose transports consistently: `session.attachTransport(transport); await transport.start();`
- **Testing**: Accepts an optional pre-built `Session` via `options.session` to enable unit testing without I/O setup

### Command API Layer (SDK-Specific)

- **Package**: `agent-sdk/command-api/`
- **Purpose**: Stable SDK-owned API layer consumed by built-in and third-party command modules. It is pure TypeScript, render-agnostic, provider-neutral, and has no CLI/TUI dependency.
- **Contracts**:
  - `ISystemCommand` — command metadata, lifecycle, model/user visibility, and execute function.
  - `ICommandModule` — composition unit contributing command sources, executable commands, descriptors, and session requirements.
  - `ICommandHostContext` — narrow command-facing facade over session/context/runtime capabilities. Command modules must not require `InteractiveSession`, React state, CLI settings files, or TUI hooks directly.
  - `ICommandResult` — command output, structured diagnostics, typed host effects, and generic interactions.
  - `TCommandEffect` — typed host-applied effects such as model/language change, restart, exit, session picker, plugin UI, plugin registry reload, rename, and statusline patch.
  - `ICommandInteraction` / `TCommandInteractionPrompt` — generic command-owned follow-up prompts rendered by host UIs.
- **Provider common APIs**: `agent-sdk/command-api/provider/` owns provider settings document types, provider profile merge/validation helpers, environment reference helpers, setup-flow primitives, provider profile name suggestion helpers, provider command settings adapter contracts, and provider probe defaults. `/provider` command behavior lives in `@robota-sdk/agent-command-provider` and consumes these APIs as an external command module.
- **Context/compact common APIs**: `agent-sdk/command-api/context/` owns command-facing context-state reads, automatic compact policy reads, active-session policy updates, settings-adapter persistence helpers, and manual compact host-facade helpers. `/context` and `/compact` command behavior lives in `@robota-sdk/agent-command-context` and `@robota-sdk/agent-command-compact`; both consume these APIs as external command modules.
- **Model common APIs**: `agent-sdk/command-api/model/` owns model-command metadata constants and subcommand projection helpers. `/model` command behavior lives in `@robota-sdk/agent-command-model` and consumes these APIs as an external command module.
- **Language common APIs**: `agent-sdk/command-api/language/` owns language-command metadata constants, recommended subcommands, argument parsing, and usage formatting. `/language` command behavior lives in `@robota-sdk/agent-command-language` and consumes these APIs as an external command module.
- **Memory common APIs**: `agent-sdk/command-api/memory/` owns memory-command metadata constants, subcommand projection helpers, project/pending memory store facades, sensitive-content checks, used-memory reference reads, and memory-event recording helpers. `/memory` command behavior lives in `@robota-sdk/agent-command-memory` and consumes these APIs as an external command module.
- **Background common APIs**: `agent-sdk/command-api/background/` owns background-command metadata constants, subcommand projection helpers, task-list/log formatting helpers, and list/read/cancel/close facades over `ICommandHostContext`. `/background` command behavior lives in `@robota-sdk/agent-command-background` and consumes these APIs as an external command module.
- **Help common APIs**: `agent-sdk/command-api/help/` owns help-command metadata constants and generic command-list formatting. `/help` command behavior lives in `@robota-sdk/agent-command-help` and consumes this API as an external command module.
- **Permission common APIs**: `agent-sdk/command-api/permissions/` owns permission-mode constants, descriptor subcommands, validation, permission-state reads, permission-state formatting, and command-facing adapter resolution. `/mode` command behavior lives in `@robota-sdk/agent-command-mode`; `/permissions` command behavior lives in `@robota-sdk/agent-command-permissions`. Both consume these APIs as external command modules.
- **Statusline common APIs**: `agent-sdk/command-api/statusline/` owns statusline command metadata constants, subcommand projection helpers, default settings shape, typed settings patch contracts, and patch validation. `/statusline` command behavior lives in `@robota-sdk/agent-command-statusline` and emits typed host-applied effects instead of importing CLI settings utilities.
- **Plugin common APIs**: `agent-sdk/command-api/plugin/` owns plugin command metadata constants, subcommand projection helpers, `ICommandPluginAdapter`, reload result contracts, and plugin host effect factories. `/plugin` and `/reload-plugins` command behavior lives in `@robota-sdk/agent-command-plugin` and consumes these APIs as an external command module while hosts keep concrete plugin storage/UI wiring.
- **Session common APIs**: `agent-sdk/command-api/session/` owns command-facing session-history helpers, session-name parsing, session-info reads, and effect factories for host-rendered history/name/picker/exit state. `/clear`, `/rename`, `/resume`, and `/cost` command behavior lives in `@robota-sdk/agent-command-session`; `/exit` command behavior lives in `@robota-sdk/agent-command-exit`. Both consume these APIs as external command modules.
- **Settings/process effects**: `agent-sdk/command-api/effects.ts` owns the typed `settings-reset-requested` effect. `/reset` command behavior lives in `@robota-sdk/agent-command-reset` and emits that effect without importing host settings file I/O.
- **Checkpoint common APIs**: `agent-sdk/command-api/checkpoint/` owns command-facing checkpoint metadata constants, subcommand projection helpers, and inspect/list/restore/rollback facades over `ICommandHostContext`. `/rewind` command behavior lives in `@robota-sdk/agent-command-rewind` and consumes these APIs as an external command module.
- **Boundary**: `command-api` may define contracts and reusable command-facing helpers. It must not own product UI, concrete settings file I/O, process restart/exit, provider construction, or command-specific flows that can live in `agent-command-*` packages.

### System Command System (SDK-Specific)

- **Package**: `agent-sdk/commands/`
- **Purpose**: SDK command infrastructure and SDK-default command factories — pure TypeScript, no React, no TUI dependency
- **Embedding**: `SystemCommandExecutor` is embedded inside `InteractiveSession`. Consumers normally call `session.executeCommand(name, args)` directly. `SystemCommandExecutor` and `createSystemCommands()` are exported so independent command modules can compose and test against the same command contract.
- **Classes**:
  - `SystemCommandExecutor` — registry + executor for `ISystemCommand` instances (internal to InteractiveSession)
  - `createSystemCommands()` — empty SDK-default executable command factory retained for composition tests
  - `createBuiltinCommandModule()` — SDK-default command module that exposes the same executable commands as palette/autocomplete metadata
- **Design**: Commands return `ICommandResult` with `message`, `success`, and optional SDK-owned `effects` and `interaction` contracts. `data` remains available for command-specific diagnostic payloads, but callers must not invent command-specific side-effect keys. User-facing follow-up prompts are represented by `ICommandInteraction`, and host actions such as restart, shutdown, plugin UI, plugin registry reload, session picker, model/language changes, session rename, and status-line updates are represented by typed `TCommandEffect` values.
- **Single owner rule**: SDK-default built-in command metadata is derived from executable `ISystemCommand` records. A built-in command must not be added to autocomplete/help metadata without an executable owner module.
- **Lifecycle policy**: `ISystemCommand` may declare command lifecycle metadata. Blocking foreground commands share the same `InteractiveSession` execution guard and `thinking` events as prompt execution. Inline commands execute immediately and must not call model-backed long-running operations.
- **SDK-default built-in commands**: none. User-visible internal commands are provided by product-composed command modules.
- **Product-composed built-in command modules**: `/help` is provided by `@robota-sdk/agent-command-help` and renders the composed command list through SDK help common APIs.
- **Product-composed built-in command modules**: `/model` is provided by `@robota-sdk/agent-command-model`, reuses SDK model-command common APIs for subcommand metadata, and emits `model-change-requested` effects for host application.
- **Product-composed built-in command modules**: `/mode` is provided by `@robota-sdk/agent-command-mode`, reuses SDK permission-mode common APIs for validation/subcommand metadata, and updates permission mode through the command host adapter facade.
- **Product-composed built-in command modules**: `/permissions` is provided by `@robota-sdk/agent-command-permissions`, reuses SDK permission common APIs for state reads/formatting, and stays user-invocable only.
- **Product-composed built-in command modules**: `/language` is provided by `@robota-sdk/agent-command-language`, reuses SDK language command common APIs for usage/subcommand metadata, and emits `language-change-requested` effects for host application.
- **Product-composed built-in command modules**: `/statusline` is provided by `@robota-sdk/agent-command-statusline`, reuses SDK statusline common APIs for subcommand metadata and typed patch effects, and leaves status bar rendering/settings persistence to the host.
- **Product-composed built-in command modules**: `/clear`, `/rename`, `/resume`, and `/cost` are provided by `@robota-sdk/agent-command-session`. `/clear` reuses SDK session command common APIs to clear SDK session history and emits `conversation-history-cleared` so hosts clear rendered history through their own UI state. `/rename` reuses SDK session command common APIs to normalize the requested name and emits `session-renamed` so hosts update title/status/persistence through their own adapters. `/resume` emits `session-picker-requested` so hosts display saved-session picker UI through their own adapters. `/cost` reads session id and message count through SDK session command common APIs.
- **Product-composed built-in command modules**: `/reset` is provided by `@robota-sdk/agent-command-reset`. It emits `settings-reset-requested` so hosts apply concrete settings deletion and shutdown at their own adapter/UI boundary.
- **Product-composed built-in command modules**: `/rewind` is provided by `@robota-sdk/agent-command-rewind`. It reuses SDK checkpoint command common APIs to list prompt-turn checkpoints, inspect captured files and restore plans, restore code to a selected checkpoint, or roll back through a selected checkpoint.
- **Product-composed built-in command modules**: `/memory` is provided by `@robota-sdk/agent-command-memory`. It reuses SDK memory command common APIs to inspect project memory, save durable entries, review pending candidates, record memory audit events, and report memory provenance.
- **Product-composed built-in command modules**: `/background` is provided by `@robota-sdk/agent-command-background`. It reuses SDK background command common APIs to list tasks, read logs, cancel queued/running work, and close terminal task records without SDK core embedding command registration.
- **Product-composed built-in command modules**: `/context` is provided by `@robota-sdk/agent-command-context` and reports context window usage plus auto-compact policy through the SDK command host facade. `/context auto ...` uses the same common API layer to update the active session immediately and persist through host-provided settings adapters.
- **Product-composed built-in command modules**: `/compact` is provided by `@robota-sdk/agent-command-compact`, declares blocking lifecycle metadata through the same `ISystemCommand` contract, and is exposed as a model-invocable `write` capability. Auto-compaction remains a deterministic session policy and emits structured compaction events instead of relying on the model to decide routine compaction.
- **Product-composed built-in command modules**: `/exit` is provided by `@robota-sdk/agent-command-exit`. It reuses the SDK session-exit effect helper, stays user-invocable only, and leaves concrete shutdown/process exit to the host effect handler.
- **Product-composed built-in command modules**: `/plugin` and `/reload-plugins` are provided by `@robota-sdk/agent-command-plugin`. They reuse SDK plugin command common APIs, send host UI opening through `plugin-tui-requested`, refresh host plugin command sources through `plugin-registry-reload-requested`, and perform install/uninstall/enable/disable/marketplace/reload operations through a host-provided `ICommandPluginAdapter`.
- **Model-invocable built-ins**: Product-composed command modules such as `/memory` and `/compact` expose descriptors so explicit user/model requests can execute through the generic command execution bridge. The descriptor owns usage metadata and autonomous-use guidance; the system prompt composer must not add separate behavior instructions.
- **`/rewind`**: User-invocable product-composed code checkpoint command. `rewind list` lists prompt-turn checkpoints; `rewind inspect <checkpoint-id>` shows captured files plus restore/rollback ranges; `rewind restore <checkpoint-id>` and `rewind code <checkpoint-id>` restore files to the selected checkpoint. It is not model-invocable by default.
- **Command modules**: Optional `ICommandModule` instances may contribute `ICommandSource` palette metadata, `ISystemCommand` handlers, model-visible descriptors, and session requirements. The SDK does not know command names contributed by modules in advance. Product assemblies can inject host-owned built-ins such as plugin and product-composed command packages such as exit and statusline without adding CLI-specific code to SDK core.

### Slash Command Registry (SDK-Specific)

- **Package**: `agent-sdk/commands/` — SSOT owner; agent-cli re-exports from here
- **Classes**:
  - `CommandRegistry` — aggregates multiple `ICommandSource` instances; filters by prefix; resolves plugin-qualified names
  - `BuiltinCommandSource` — provides palette/autocomplete metadata derived from SDK-default executable slash commands; currently empty because user-visible built-ins are product-composed modules
  - `SkillCommandSource` — discovers SKILL.md files from project and user directories; parses YAML frontmatter; lazy-caches results
  - `PluginCommandSource` — discovers commands exposed by installed bundle plugins (moved from agent-cli to agent-sdk)
- **Migration note**: These classes were previously in `agent-cli/src/commands/`. They were moved to `agent-sdk` so any client can use slash command discovery without a TUI dependency. `PluginCommandSource` was also moved from `agent-cli` to `agent-sdk` as part of the scope redesign.

### Config Loading (SDK-Specific)

- **Package**: `agent-sdk/config/`
- **Rationale**: `.robota/settings.json` file-based configuration is for local development environments only (servers use environment variables/DB)
- **Implementation**: settings file merge, `$ENV:VAR` substitution for provider API keys, Zod validation, provider profile resolution
- **Provider profiles**: settings may define `currentProvider` and `providers`. The active profile is resolved from `providers[currentProvider]`, then normalized into `IResolvedConfig.provider`. Profile identity is the profile key, not the provider type or model pair. Setup helpers suggest readable model-derived keys and append numeric suffixes when the key already exists.
- **Legacy compatibility**: legacy `provider` settings remain supported and are used when no active provider profile is configured.

Provider profile shape:

```json
{
  "currentProvider": "supergemma4-26b-uncensored-v2",
  "providers": {
    "supergemma4-26b-uncensored-v2": {
      "type": "gemma",
      "model": "supergemma4-26b-uncensored-v2",
      "apiKey": "lm-studio",
      "baseURL": "http://localhost:1234/v1"
    },
    "gpt-4o": {
      "type": "openai",
      "model": "gpt-4o",
      "apiKey": "$ENV:OPENAI_API_KEY"
    },
    "qwen3-6-plus": {
      "type": "qwen",
      "model": "qwen3.6-plus",
      "apiKey": "$ENV:DASHSCOPE_API_KEY",
      "options": {
        "builtInWebTools": {
          "webSearch": true,
          "webFetch": true
        }
      }
    }
  }
}
```

Gemma-family local models should be configured through `type: "gemma"` so provider-specific stream projection is applied. `type: "openai"` remains a model-family neutral OpenAI-compatible transport profile.

Provider profile `options` are preserved as provider-owned data. SDK config loading validates that the value is universal/JSON-like and passes it through; SDK code must not interpret provider-specific option keys. OpenAI-compatible local endpoints such as LM Studio should use local `WebSearch`/`WebFetch` function tools for web access unless their concrete provider package documents and enables provider-native hosted web capabilities.

Generated provider profile keys are normalized to lowercase ASCII slugs. The setup flow prefers the selected model id, falls back to provider type, and appends `-2`, `-3`, etc. for duplicates. Secrets, organizations, accounts, and API key fragments must not be included in generated keys.

Resolved provider fields:

| Field     | Description                                                                                         |
| --------- | --------------------------------------------------------------------------------------------------- |
| `name`    | Provider type used by session model config (`anthropic`, `openai`, `gemma`)                         |
| `model`   | Active model id                                                                                     |
| `apiKey`  | API key or local placeholder token                                                                  |
| `baseURL` | Optional OpenAI-compatible endpoint override                                                        |
| `timeout` | Optional provider idle timeout in milliseconds. Also passed to provider construction when supported |
| `options` | Optional provider-owned options bag preserved for CLI/provider composition                          |

### Context Loading (SDK-Specific)

- **Package**: `agent-sdk/context/`
- **Rationale**: AGENTS.md/CLAUDE.md walk-up discovery is for local development environments only
- **Implementation**: Directory traversal from cwd to root, project type/language detection, `.robota/memory/MEMORY.md` startup memory loading, active task context loading, system prompt assembly
- **Response Language**: `IResolvedConfig.language` (from settings.json `language` field) is rendered as neutral metadata by `buildSystemPrompt()`. Persists across compaction because system message is preserved.
- **Compact Instructions**: Extracts "Compact Instructions" section from CLAUDE.md and passes to Session for compaction
- **Skill Discovery Paths**: Skills are discovered from `.agents/skills/*/SKILL.md` (project) and `~/.robota/skills/*/SKILL.md` (user). Used by agent-cli's `SkillCommandSource` for slash command autocomplete

### Active Task Context (SDK-Specific)

- **Package**: `agent-sdk/context/task-context.ts`
- **Purpose**: Treat active `.agents/tasks/*.md` files as bounded working-memory metadata for the current session.
- **Discovery**: Only direct Markdown files under `.agents/tasks/` are eligible. `README.md` and files under `.agents/tasks/completed/` are excluded.
- **Selection**: Task selection is bounded. Matching `- **Branch**:` metadata for the current git branch takes precedence, followed by `in-progress`, `todo`, then unknown status. Completed tasks are excluded.
- **Formatting**: `formatTaskContext()` renders selected task metadata as neutral Markdown under `Active Task Context`. It includes path, title, status, branch, scope, objective, and unchecked completion items. It must not add behavior instructions.
- **Prompt integration**: `loadContext()` stores formatted task context in `ILoadedContext.taskContext`; `buildSystemPrompt()` renders it after project memory and before runtime metadata. Compaction preserves it because the system message is preserved.
- **Status synchronization**: `updateTaskFileStatus()` updates or inserts the task status metadata and appends a dated progress entry when a progress message is supplied. The function accepts an injected clock for deterministic tests.

### Project Memory (SDK-Specific)

- **Package**: `agent-sdk/memory/`
- **Storage**: `.robota/memory/MEMORY.md` is the project memory index; `.robota/memory/topics/*.md` stores topic details.
- **Startup injection**: `loadContext()` reads the memory index into `ILoadedContext.memoryMd`; `buildSystemPrompt()` renders it under the neutral `Project Memory` section. Topic files are not injected at startup.
- **Caps**: Startup memory is capped to the first 200 lines and at most 25KB.
- **Command-driven access**: `/memory` is the model-visible project memory interface when the product composes `@robota-sdk/agent-command-memory`. It is exposed through the `ExecuteCommand` tool using the injected command descriptor. The descriptor guides the model to inspect memory when stored context may help, add only durable reusable facts, review pending candidates, report provenance, and avoid storing secrets.
- **Sensitive data policy**: Candidate policy must skip obvious secret, token, password, private-key, payment-card, and national-ID style content instead of silently saving it. Additional extractors may be composed later, but they must feed the same policy/store contracts.
- **No hidden turn side effects**: `InteractiveSession` must not automatically prepend topic memory to user prompts and must not create pending memory candidates after a completed turn. Topic retrieval and memory writes happen through explicit `/memory` command execution, whether user-invoked or model-invoked.
- **Reusable retrieval/capture internals**: `MemoryRetrievalService`, `MemoryCandidateExtractor`, `MemoryPolicyEvaluator`, and `PendingMemoryStore` remain reusable building blocks for explicit commands or future command modules. They are not wired as implicit session lifecycle side effects.
- **Deduplication**: `ProjectMemoryStore.append()` returns `deduplicated` and must avoid repeating the same normalized topic entry.
- **Command**: `memory list | show [topic] | add <user|feedback|project|reference> <topic> <text> | pending | approve <id> | reject <id> | used`.
- **Audit trail**: `/memory approve`, `/memory reject`, and future explicit memory workflows append memory events to the session record as `memoryEvents` for resume/debugging. High-frequency streaming data is not part of the memory event stream.
- **Ownership**: SDK owns memory stores, memory policy primitives, and command-facing memory APIs. `@robota-sdk/agent-command-memory` owns command behavior. CLI only composes the module and renders command results/autocomplete metadata.
- **Prompt composition boundary**: The system prompt may include the neutral `Project Memory` startup index and the `/memory` descriptor under `Built-in Commands`; it must not include extra hardcoded memory behavior instructions outside descriptor data.

### Context Window Management

- **Token tracking**: `agent-sessions` Session tracks cumulative input tokens from provider response metadata
- **Usage state**: `session.getContextState()` returns `IContextWindowState` (usedTokens, maxTokens, usedPercentage)
- **Auto-compaction**: Triggers at the configured context-window threshold, defaults to ~83.5%, and can be disabled per session
- **Manual compaction**: `session.compact(instructions?)` generates LLM summary, replaces history
- **Model sizes**: Lookup table per model (200K for Sonnet/Haiku, 1M for Opus)
- **Compact Instructions**: Extracted from CLAUDE.md "Compact Instructions" section, passed to summary prompt
- **Hooks**: PreCompact/PostCompact events in agent-core, fired before/after compaction
- **Callbacks**: `onCompact` in `createQuery()` options for notification when compaction occurs

## Public API

### InteractiveSession — Central Client-Facing API

Wraps `Session` (composition) to provide event-driven interaction for any client (CLI, web, API server, worker). Manages streaming text accumulation, tool execution state tracking, prompt queuing, abort orchestration, and message history. Logic previously embedded in CLI React hooks.

The SDK is pure TypeScript with no React dependency. The CLI is a thin TUI-only layer that subscribes to `InteractiveSession` events and maps them to React/Ink state.

```typescript
import { InteractiveSession } from '@robota-sdk/agent-sdk';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

// Consumer creates provider and passes it to InteractiveSession.
// Config and context are loaded internally from cwd.
const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
const session = new InteractiveSession({ cwd: process.cwd(), provider });

// Event-driven — subscribe to state changes
session.on('text_delta', (delta: string) => { /* streaming text chunk */ });
session.on('tool_start', (state: IToolState) => { /* tool execution began */ });
session.on('tool_end', (state: IToolState) => { /* tool execution finished */ });
session.on('thinking', (isThinking: boolean) => { /* execution state changed */ });
session.on('complete', (result: IExecutionResult) => { /* prompt completed */ });
session.on('error', (error: Error) => { /* execution error */ });
session.on('context_update', (state: IContextWindowState) => { /* token usage updated */ });
session.on('interrupted', (result: IExecutionResult) => { /* abort completed */ });

// Submit prompt. Queues if already executing (max 1 queued).
// displayInput: shown in UI (e.g., "/audit") instead of full built prompt
// rawInput: passed to Session.run() for hook matching
await session.submit(input, displayInput?, rawInput?);

// Execute a discovered skill command. Non-fork skills submit into the current session.
// `context: fork` skills run through an isolated subagent session.
await session.executeSkillCommand(skillCommand, args, displayInput?, rawInput?);

// Execute a named system command (embedded SystemCommandExecutor)
const result = await session.executeCommand('context', '');
// result.message — human-readable string
// result.success — boolean
// result.data   — command-specific structured data

// List all registered system commands (for transport adapters)
const commands = session.listCommands(); // Array<{ name, description }>

// Abort current execution and clear queue
session.abort();

// Cancel queued prompt without aborting current execution
session.cancelQueue();

// Graceful shutdown: reject new prompts, abort foreground work, cancel managed background tasks,
// persist final session state, and fire SessionEnd through agent-sessions.
await session.shutdown({ reason: 'prompt_input_exit', message: 'User requested exit' });

// State queries
session.isExecuting();       // boolean
session.getPendingPrompt();  // string | null
session.getMessages();       // TUniversalMessage[] — backward-compatible; returns chat entries only
session.getFullHistory();    // IHistoryEntry[] — full history including event entries (tool summaries, skill invocations)
session.getContextState();   // IContextWindowState
session.getStreamingText();  // string (accumulated so far)
session.getActiveTools();    // IToolState[]
```

### Self-Hosting Verification Planner

The SDK exports pure planning/state helpers for clients that need to drive a safe edit/build/verify loop without coupling to CLI or TUI rendering.

```typescript
import { planSelfHostingVerification, transitionSelfHostingLoop } from '@robota-sdk/agent-sdk';

const plan = planSelfHostingVerification({
  changedFiles: ['packages/agent-sdk/src/index.ts'],
  packageScopes: ['@robota-sdk/agent-sdk'],
  baseRef: 'origin/develop',
});

let state = transitionSelfHostingLoop('idle', 'checkpoint_created');
state = transitionSelfHostingLoop(state, 'edits_started');
state = transitionSelfHostingLoop(state, 'edits_applied');
state = transitionSelfHostingLoop(state, 'verify_passed');
```

`plan.steps` is an ordered, provider-neutral command plan. Consumers execute commands in child processes and keep the current SDK process alive as the old runtime. The planner does not write files, restore checkpoints, or render UI.

### Task Context Helpers

The SDK exports pure helpers for discovering, selecting, formatting, and updating active task files.

```typescript
import { loadTaskContext, updateTaskFileStatus } from '@robota-sdk/agent-sdk';

const taskContext = loadTaskContext(process.cwd(), {
  currentBranch: 'feat/context-injection-task-files',
  maxTasks: 3,
});

updateTaskFileStatus('.agents/tasks/CLI-BL-017-context-injection-from-task-files.md', 'completed', {
  progressMessage: 'Verified task context injection.',
});
```

These helpers operate on Markdown files under `.agents/tasks/`. They do not render UI and do not inject behavior instructions into the prompt; the formatted task context is neutral metadata.

**IToolState:**

```typescript
interface IToolState {
  toolName: string;
  firstArg: string;
  isRunning: boolean;
  result?: 'success' | 'error' | 'denied';
  diffLines?: IDiffLine[];
  diffFile?: string;
  toolResultData?: string;
}
```

`diffLines` is structured Edit tool display metadata. For completed Edit tools, `InteractiveSession` derives it from the Edit arguments, tool result `startLine`, and the modified file contents when readable. Diff lines may include `type: 'hunk'`, `context`, `remove`, and `add`. `toolResultData` is the already-truncated tool result payload emitted by the permission/session layer; transports may derive bounded previews from it, but SDK/session records remain the source for full transcript recovery. The SDK persists this metadata so all transports can replay the same tool summary; CLI owns visual rendering only.

**IExecutionResult:**

```typescript
interface IExecutionResult {
  response: string;
  history: IHistoryEntry[]; // Full history including chat + event entries
  toolSummaries: IToolSummary[];
  contextState: IContextWindowState;
  usage?: IUsageSnapshot;
}
```

`IUsageSnapshot` is the SDK-owned provider-neutral execution usage record:

```typescript
interface IUsageSnapshot {
  kind: 'exact' | 'estimated';
  scope: 'turn';
  totalTokens: number;
  promptTokens?: number;
  completionTokens?: number;
  contextUsedTokens: number;
  contextMaxTokens: number;
  contextUsedPercentage: number;
  costStatus: 'unknown' | 'estimated' | 'exact';
}
```

`InteractiveSession` appends a `usage-summary` event entry after the assistant response when exact provider usage is available. The entry is persisted in `IHistoryEntry[]` so `/resume`, headless transports, and debugging can display usage without reparsing assistant prose.

**IInteractiveSessionEvents:**

```typescript
interface IInteractiveSessionEvents {
  text_delta: (delta: string) => void;
  tool_start: (state: IToolState) => void;
  tool_end: (state: IToolState) => void;
  thinking: (isThinking: boolean) => void;
  complete: (result: IExecutionResult) => void;
  error: (error: Error) => void;
  context_update: (state: IContextWindowState) => void;
  interrupted: (result: IExecutionResult) => void;
  background_task_event: (event: TBackgroundTaskEvent) => void;
}
```

**ITransportAdapter:**

```typescript
interface ITransportAdapter {
  /** Human-readable transport name (e.g., 'http', 'ws', 'mcp', 'headless') */
  readonly name: string;

  /** Attach an InteractiveSession to this transport. */
  attach(session: InteractiveSession): void;

  /** Start serving. What this means depends on the transport. */
  start(): Promise<void>;

  /** Stop serving and clean up resources. */
  stop(): Promise<void>;
}
```

Common interface for all transport adapters. Defined in `src/interactive/types.ts` and exported from `@robota-sdk/agent-sdk`. Each `agent-transport-*` package provides a factory that returns an `ITransportAdapter` implementation.

### Background and Subagent Runtime Exports

`BackgroundTaskManager` is re-exported from `agent-runtime` as the generic runtime registry for long-running work. It owns task IDs, queueing, bounded concurrency, lifecycle events, targeted cancellation, shutdown, terminal close/dismiss, optional send/log controls, watchdogs, and immutable state snapshots.

Runner adapters receive `IBackgroundTaskStart.emit(event)` for progress reporting. The manager stamps task IDs onto runner events, updates `currentAction` for tool start/end events, and forwards the resulting `TBackgroundTaskEvent` to subscribers.

Background task runtime exports:

| Export                           | Kind      | Description                                                             |
| -------------------------------- | --------- | ----------------------------------------------------------------------- |
| `BackgroundTaskManager`          | class     | Generic in-memory background task registry and scheduler                |
| `BackgroundTaskError`            | class     | Typed background task error with category and recoverability            |
| `createLimitedOutputCapture`     | function  | Runtime-owned UTF-8-safe bounded output capture helper                  |
| `appendPrefixedLogLines`         | function  | Runtime-owned source-prefixed log line projection helper                |
| `createBackgroundTaskLogPage`    | function  | Runtime-owned cursor-based log pagination helper                        |
| `IBackgroundTaskManager`         | interface | Generic manager API for spawn/wait/list/get/cancel/close/shutdown/send  |
| `IBackgroundTaskRunner`          | interface | Port implemented by agent/process runner adapters                       |
| `ILimitedOutputCapture`          | interface | Runtime-owned bounded output capture contract                           |
| `TBackgroundTaskIdFactory`       | type      | Request-aware task ID factory used by composed managers                 |
| `IBackgroundTaskState`           | interface | Runtime lifecycle state for one background task                         |
| `IBackgroundTaskRequest`         | type      | Discriminated union of agent/process background task requests           |
| `IBackgroundTaskResult`          | interface | Completed background task output                                        |
| `TBackgroundTaskEvent`           | type      | Runtime-owned lifecycle/progress event union                            |
| `TBackgroundTaskRunnerEvent`     | type      | Runner-owned progress event union without task IDs                      |
| `TBackgroundTaskMode`            | type      | `foreground` or `background`                                            |
| `TBackgroundTaskStatus`          | type      | Shared task lifecycle status union                                      |
| `TBackgroundTaskTimeoutReason`   | type      | Watchdog reason union projected onto failed task state                  |
| `transitionBackgroundTaskStatus` | function  | Pure lifecycle transition function                                      |
| `BackgroundJobOrchestrator`      | class     | SDK-owned grouping/wait layer above `BackgroundTaskManager`             |
| `IBackgroundJobGroupState`       | interface | Parent-session-scoped background task group snapshot                    |
| `IBackgroundJobGroupSummary`     | interface | Presentation-neutral group completion counts and result lines           |
| `TBackgroundJobWaitPolicy`       | type      | `detached`, `wait_all`, `wait_any`, or `manual` group completion policy |

Background agent watchdog configuration is provider-neutral. Agent requests may set `idleTimeoutMs`, `maxRuntimeMs`, `outputLimitBytes`, `maxTextDeltas`, `repetitionWindow`, and `repetitionThreshold`; the runtime refreshes `lastActivityAt` from runner progress events and fails runaway jobs with `timeoutReason`.

`InteractiveSession` subscribes to background task events, persists every event including streaming text deltas into the session record for local debugging/resume, and emits `background_task_event` for transports and TUI state projection. It also maps background agent lifecycle events into Claude Code-compatible `SubagentStart` and `SubagentStop` hooks.

`BackgroundJobOrchestrator` is the SDK-owned layer above `BackgroundTaskManager` for parent-request orchestration. It groups related task IDs, applies a wait policy, emits group lifecycle events, and produces result envelopes with task IDs, labels, terminal status, concise output summaries, output references, and errors. It also exposes presentation-neutral summary helpers for command/transport/UI adapters. The orchestrator does not run processes, own provider calls, mutate TUI state, or inject hardcoded prompt instructions.

`InteractiveSession` exposes background job group controls:

| API                                  | Behavior                                                       |
| ------------------------------------ | -------------------------------------------------------------- |
| `createBackgroundJobGroup(request)`  | Create a parent-session-scoped group over existing task IDs    |
| `listBackgroundJobGroups()`          | Return cloned group snapshots                                  |
| `getBackgroundJobGroup(groupId)`     | Return one cloned group snapshot                               |
| `waitBackgroundJobGroup(groupId)`    | Resolve when the group's wait policy reaches a terminal result |
| `summarizeBackgroundJobGroup(group)` | Return counts and concise result lines for an existing group   |

`InteractiveSession` emits `background_job_group_event` with `TBackgroundJobGroupEvent`. When session persistence is enabled, group snapshots and group events are stored alongside background task snapshots/events so resume/debugging can reconstruct group provenance.

`SubagentManager` and its associated types are exported for clients that need to compose managed subagent execution. It is now a compatibility facade over `BackgroundTaskManager` for `kind: 'agent'` tasks, preserving the existing subagent API while moving lifecycle semantics to the shared background layer.

```typescript
import { SubagentManager } from '@robota-sdk/agent-sdk';
import type { ISubagentRunner } from '@robota-sdk/agent-sdk';

const runner: ISubagentRunner = createRunner();
const manager = new SubagentManager({ runner, maxConcurrent: 2 });

const job = await manager.spawn({
  type: 'general-purpose',
  label: 'General purpose',
  parentSessionId: 'session_parent',
  mode: 'foreground',
  depth: 1,
  cwd: process.cwd(),
  prompt: 'Review the codebase',
});

const result = await manager.wait(job.id);
```

Agent subagent requests may set `isolation: 'worktree'`. The SDK treats this as a contract flag and propagates it through `Agent` tool arguments, `ISubagentSpawnRequest`, and background task metadata. Worktree isolation is explicit unless a host assembly provides and documents a capability-aware default policy; SDK core must not silently infer or fallback between isolated and non-isolated execution. `agent-runtime` owns `WorktreeSubagentRunner`, which decorates any `ISubagentRunner` with worktree lifecycle, metadata, cleanup, and hook behavior. Runtime shells provide an `ISubagentWorktreeAdapter` implementation for concrete local Git/filesystem operations. If a preserved worktree is returned by a runner, `IBackgroundTaskResult.metadata.worktreePath`, `branchName`, `worktreeStatus`, `worktreeNextAction`, `worktreeBaseRevision`, and `parentWorktreeStatus` are projected onto matching `IBackgroundTaskState` fields.

`createBackgroundProcessTool(deps)` is exported for SDK composition. The tool is registered only when a runtime shell injects a `process` background runner through `createSession({ backgroundTaskRunners })`; default `Bash` foreground behavior remains unchanged.

`createSession()` also accepts `subagentRunnerFactory?: TSubagentRunnerFactory`. When omitted, SDK composition uses `createInProcessSubagentRunner`. Runtime shells such as `agent-cli` may inject a factory that receives the same assembled dependency bundle and returns a process-backed `ISubagentRunner`.

Exported subagent runtime types:

| Export                          | Kind      | Description                                                               |
| ------------------------------- | --------- | ------------------------------------------------------------------------- |
| `SubagentManager`               | class     | Re-export from `agent-runtime`; in-memory subagent job facade             |
| `createInProcessSubagentRunner` | function  | Runner adapter that executes subagent jobs with `createSubagentSession()` |
| `WorktreeSubagentRunner`        | class     | Re-export from `agent-runtime`; worktree isolation runner decorator       |
| `createWorktreeSubagentRunner`  | function  | Factory for `WorktreeSubagentRunner`                                      |
| `createDefaultTools`            | function  | Default tool assembly helper exported for CLI fork-worker composition     |
| `ISubagentManager`              | interface | Re-export from `agent-runtime`; manager API                               |
| `ISubagentRunner`               | interface | Re-export from `agent-runtime`; single-job runner port                    |
| `ISubagentWorktreeAdapter`      | interface | Re-export from `agent-runtime`; concrete worktree I/O port                |
| `IPreparedSubagentWorktree`     | interface | Re-export from `agent-runtime`; prepared worktree handoff                 |
| `IInProcessSubagentRunnerDeps`  | interface | Dependencies captured by the in-process runner adapter                    |
| `TSubagentRunnerFactory`        | type      | Factory seam for runtime shells to replace the default subagent runner    |
| `ISubagentJobHandle`            | interface | Re-export from `agent-runtime`; targeted job handle                       |
| `ISubagentJobState`             | interface | Re-export from `agent-runtime`; subagent job projection                   |
| `ISubagentSpawnRequest`         | interface | Re-export from `agent-runtime`; spawn request                             |
| `ISubagentJobResult`            | interface | Re-export from `agent-runtime`; completion output and metadata            |
| `TSubagentJobMode`              | type      | Re-export from `agent-runtime`; `foreground` or `background`              |
| `TSubagentJobStatus`            | type      | Re-export from `agent-runtime`; lifecycle status union                    |

### History Entry Types

`InteractiveSession` manages history as `IHistoryEntry[]`. Each entry has a `category` field:

| Category  | Description                                                                                 |
| --------- | ------------------------------------------------------------------------------------------- |
| `'chat'`  | A standard conversation message (`TUniversalMessage`). Returned by `getMessages()` as-is.   |
| `'event'` | A structured non-message event (tool summary, skill invocation, system notification, etc.). |

**Tool summary entry** (appended by `InteractiveSession` after each execution round):

```typescript
// category: 'event', type: 'tool-summary'
{
  id: string;
  timestamp: Date;
  category: 'event';
  type: 'tool-summary';
  data: {
    summary: string;
    tools: Array<{
      toolName: string;
      firstArg: string;
      isRunning: boolean;
      result?: 'success' | 'error' | 'denied';
      diffLines?: IDiffLine[];
      diffFile?: string;
      toolResultData?: string;
    }>;
  }
}
```

**Usage summary entry** (appended by `InteractiveSession` after each completed turn when usage exists):

```typescript
{
  category: 'event',
  type: 'usage-summary',
  data: {
    kind: 'exact',
    scope: 'turn',
    promptTokens: 1000,
    completionTokens: 200,
    totalTokens: 1200,
    contextUsedTokens: 1200,
    contextMaxTokens: 200000,
    contextUsedPercentage: 0.6,
    costStatus: 'unknown',
  }
}
```

**Skill invocation entry** (appended by `InteractiveSession` when a skill slash command is executed):

```typescript
// category: 'event', type: 'skill-invocation'
{
  id: string;
  timestamp: Date;
  category: 'event';
  type: 'skill-invocation';
  data: {
    skillName: string;
    displayInput: string;
  }
}
```

Consumers that need only AI messages call `getMessages()` (returns `TUniversalMessage[]` — backward-compatible). Consumers that need the full picture (e.g., rendering a rich message list) call `getFullHistory()` (returns `IHistoryEntry[]`).

### System Commands — Embedded in InteractiveSession

`SystemCommandExecutor` is embedded inside `InteractiveSession`. Consumers access system commands via `session.executeCommand(name, args)`. Command module packages may import `ISystemCommand`, `ICommandModule`, `SystemCommandExecutor`, and `createSystemCommands()` for composition tests.

The command types and result interface are exported for consumers that need to inspect results:

```typescript
import type { ICommandResult, ISystemCommand } from '@robota-sdk/agent-sdk';

// Execute a named command on the session (returns null if command not found)
const result: ICommandResult | null = await session.executeCommand('context', '');
// result.message — human-readable string
// result.success — boolean
// result.data   — command-specific structured data
```

**Product-composed command modules:**

| Command       | Description                                                                  |
| ------------- | ---------------------------------------------------------------------------- |
| `help`        | Command module for rendering registered commands                             |
| `clear`       | Optional command module for clearing conversation and rendered host history  |
| `compact`     | Compress context window (optional focus instructions)                        |
| `mode [m]`    | Show or change permission mode                                               |
| `language`    | Request response language update through `language-change-requested` effect  |
| `cost`        | Optional session command module for session ID and message count             |
| `context`     | Token usage: used / max / percentage                                         |
| `permissions` | Current mode and session-approved tools                                      |
| `statusline`  | Optional command module for statusline visibility and git branch patch flows |
| `memory`      | List/show/add/review project memory and report used memory references        |
| `rewind`      | List edit checkpoints, restore later edits, or rollback through a checkpoint |
| `reset`       | Requests settings reset through `settings-reset-requested` effect            |
| `resume`      | Optional command module for requesting session picker through effect         |
| `rename`      | Optional command module for requesting session rename through effect         |
| `provider`    | Optional command module for provider current/list/use/add/test flows         |

**ISystemCommand:**

```typescript
interface ISystemCommand {
  name: string;
  description: string;
  modelInvocable?: boolean;
  userInvocable?: boolean;
  argumentHint?: string;
  safety?: TCapabilitySafety;
  subcommands?: readonly ICommand[];
  lifecycle?: 'inline' | 'blocking' | 'background';
  execute(context: ICommandHostContext, args: string): Promise<ICommandResult> | ICommandResult;
}
```

`ICommandHostContext` is the command-facing facade supplied by the SDK executor. Command implementations must depend on the specific context methods or typed host adapters they need rather than accepting `InteractiveSession`, CLI state, or UI hooks.

`ICommandHostAdapters` is the host-provided adapter bag exposed through `ICommandHostContext.getCommandHostAdapters()`. It currently includes settings persistence, process lifecycle, permission-mode access, and plugin-management adapters. Command modules may request only the adapter they need; they must not import a concrete CLI/TUI implementation.

**ICommandModule:**

```typescript
interface ICommandModule {
  name: string;
  commandSources?: readonly ICommandSource[];
  systemCommands?: readonly ISystemCommand[];
  commandDescriptors?: readonly ICapabilityDescriptor[];
  sessionRequirements?: readonly TCommandModuleSessionRequirement[];
}
```

`sessionRequirements` is how command modules request optional SDK wiring. The current requirement is `agent-runtime`, which enables `Agent` tool registration, agent definitions, and the shared background/subagent managers.

**ICommandResult:**

```typescript
interface ICommandResult {
  message: string;
  success: boolean;
  data?: Record<string, TCommandResultDataValue>;
  effects?: readonly TCommandEffect[];
  interaction?: ICommandInteraction;
}

type TCommandEffect =
  | { type: 'model-change-requested'; modelId: string }
  | { type: 'language-change-requested'; language: string }
  | { type: 'settings-reset-requested' }
  | { type: 'session-exit-requested'; reason?: TSessionEndReason; message?: string }
  | { type: 'session-restart-requested'; reason: TSessionEndReason; message: string }
  | { type: 'plugin-tui-requested' }
  | { type: 'plugin-registry-reload-requested' }
  | { type: 'session-picker-requested' }
  | { type: 'session-renamed'; name: string }
  | { type: 'conversation-history-cleared' }
  | { type: 'statusline-settings-patch'; patch: TStatusLineCommandSettingsPatch };

interface ICommandInteraction {
  prompt: ICommandInteractionPrompt;
  submit(value: string): Promise<ICommandResult> | ICommandResult;
  cancel?(): Promise<ICommandResult> | ICommandResult;
}
```

`ICommandInteractionPrompt` is the generic prompt descriptor used by UI hosts. It supports choice and text prompts with masked text and validation metadata. Hosts render the prompt and pass submitted values back to the interaction; they do not inspect command-specific state.

### CommandRegistry, BuiltinCommandSource, SkillCommandSource, PluginCommandSource

Command discovery and aggregation for clients that expose a slash command palette or autocomplete UI. Owned by `agent-sdk`; agent-cli re-exports `CommandRegistry` from here. `PluginCommandSource` was moved from `agent-cli` to `agent-sdk` so all clients benefit from plugin command discovery. Command modules can be added through `registry.addModule(module)` without the registry knowing their command names. Hosts can call `registry.replaceSource(name, source)` to refresh dynamic sources such as plugin-provided commands after a successful reload effect.

```typescript
import {
  CommandRegistry,
  BuiltinCommandSource,
  SkillCommandSource,
  PluginCommandSource,
} from '@robota-sdk/agent-sdk';

const registry = new CommandRegistry();
registry.addSource(new BuiltinCommandSource());
registry.addModule(commandModule);
registry.addSource(new SkillCommandSource(process.cwd()));

registry.getCommands(); // ICommand[] — all commands
registry.getCommands('mod'); // filtered by prefix (for autocomplete)
registry.resolveQualifiedName('audit'); // "my-plugin:audit" or null
registry.getSubcommands('mode'); // ICommand[] — subcommands
```

`SkillCommandSource` scans (highest priority first):

1. `<cwd>/.claude/skills/*/SKILL.md`
2. `<cwd>/.claude/commands/*.md` (Claude Code compatible)
3. `~/.robota/skills/*/SKILL.md`
4. `<cwd>/.agents/skills/*/SKILL.md`

### createQuery() — Convenience Factory

`createQuery({ provider })` is a factory that returns a prompt-only function. The caller creates the provider; the factory captures it and returns a simple async function that accepts a prompt string.

```typescript
import { createQuery } from '@robota-sdk/agent-sdk';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
const query = createQuery({ provider });

const response = await query('Show me the file list');

const queryWithOptions = createQuery({
  provider,
  cwd: '/path/to/project',
  permissionMode: 'acceptEdits',
  maxTurns: 10,
  onTextDelta: (delta) => process.stdout.write(delta),
});

const detailedResponse = await queryWithOptions('Analyze the code');
```

`createSession()` is an **internal** assembly factory — it is not exported from `@robota-sdk/agent-sdk`. Config and context loading, tool assembly, and provider wiring happen inside `InteractiveSession` and `createQuery()`.

### Session — Direct Usage (Generic)

```typescript
import { Session } from '@robota-sdk/agent-sessions';

// Session requires pre-constructed tools, provider, and systemMessage
const session = new Session({ tools, provider, systemMessage, terminal });
const response = await session.run('Hello');
```

### Public Surface Ownership

The top-level `@robota-sdk/agent-sdk` entrypoint exposes SDK-owned APIs and explicit SDK facades.
It must not pass through general-purpose `agent-core`, `agent-sessions`, or `agent-tools` exports
only for convenience. See [PUBLIC-SURFACE.md](PUBLIC-SURFACE.md) for the export classification.

Allowed public classes:

- SDK-owned APIs: `InteractiveSession`, `createQuery`, command contracts/common APIs, project
  memory, checkpoints, reversible execution, plugin management, and task context helpers.
- SDK facades: project session store helpers, subagent assembly helpers, agent/background process
  tools, and command host/common APIs that narrow lower-level behavior through SDK contracts.
- Explicit runtime facades: background-task and subagent lifecycle contracts re-exported through
  `src/background-tasks/index.ts` and `src/subagents/index.ts`.

Owner-direct APIs:

- `agent-core` owns history helpers, provider interfaces, permissions, hooks, context window types,
  and generic message utilities.
- `agent-tools` owns direct built-in tool exports and tool result types.
- `agent-sessions` owns generic session APIs and terminal output primitives.

`pnpm harness:scan:sdk-public-surface` prevents broad `export *` barrels, top-level lower-owner
pass-through exports, and runtime re-exports outside the documented SDK facade barrels.

### History Types — Owner Package

```typescript
import {
  IHistoryEntry,
  isChatEntry,
  chatEntryToMessage,
  messageToHistoryEntry,
  getMessagesForAPI,
} from '@robota-sdk/agent-core';
```

| Export                  | Kind      | Description                                                                           |
| ----------------------- | --------- | ------------------------------------------------------------------------------------- |
| `IHistoryEntry`         | interface | Rich history entry: `id`, `timestamp`, `category` ('chat' \| 'event'), `type`, `data` |
| `isChatEntry`           | function  | Type guard that narrows `IHistoryEntry` to chat entries                               |
| `chatEntryToMessage`    | function  | Converts a chat `IHistoryEntry` to `TUniversalMessage`                                |
| `messageToHistoryEntry` | function  | Converts a `TUniversalMessage` to a chat `IHistoryEntry`                              |
| `getMessagesForAPI`     | function  | Extracts `TUniversalMessage[]` from `IHistoryEntry[]` (filters to chat entries only)  |

### Built-in Tools — Direct Usage

`@robota-sdk/agent-sdk` assembles built-in tools internally for SDK sessions. Direct tool usage
imports from `@robota-sdk/agent-tools`:

```typescript
import {
  bashTool,
  editTool,
  globTool,
  grepTool,
  readTool,
  webFetchTool,
  webSearchTool,
  writeTool,
} from '@robota-sdk/agent-tools';
```

### Permissions — Direct Usage

```typescript
import { evaluatePermission } from '@robota-sdk/agent-core';
```

## Import Rules

These rules define which packages each layer is allowed to import from. Violations break the layered architecture.

### CLI (`agent-cli`)

| Source             | Allowed                       | Notes                                                                     |
| ------------------ | ----------------------------- | ------------------------------------------------------------------------- |
| `agent-sdk`        | All SDK-owned public APIs     | InteractiveSession, createQuery, runtime contracts re-exported by SDK     |
| `agent-runtime`    | ❌ Direct import discouraged  | CLI should receive runtime ports through SDK composition/re-exports       |
| `agent-core`       | Public types + utilities only | TUniversalMessage, TPermissionMode, createSystemMessage, getModelName     |
| `agent-core`       | ❌ Internal engine classes    | Robota, ExecutionService, ConversationStore are forbidden                 |
| `agent-sessions`   | ❌ Forbidden                  | SDK provides its own session types; CLI must not import sessions directly |
| `agent-tools`      | ❌ Forbidden                  | SDK assembles tools internally                                            |
| `agent-provider-*` | Provider creation only        | AnthropicProvider, GeminiProvider (CLI picks which to use)                |

### SDK (`agent-sdk`)

| Source             | Allowed      | Notes                                                 |
| ------------------ | ------------ | ----------------------------------------------------- |
| `agent-core`       | Full access  |                                                       |
| `agent-runtime`    | Full access  | Background task/subagent lifecycle primitives         |
| `agent-sessions`   | Full access  |                                                       |
| `agent-tools`      | Full access  |                                                       |
| `agent-provider-*` | ❌ Forbidden | SDK is provider-neutral; provider comes from consumer |

### Transport packages (`agent-transport-*`)

| Source       | Allowed                                    | Notes |
| ------------ | ------------------------------------------ | ----- |
| `agent-sdk`  | InteractiveSession and related types       |       |
| `agent-core` | Public types only (TUniversalMessage etc.) |       |

## Design Decision Records

### Claude Code vs Claude Agent SDK Relationship (Research)

- Claude Agent SDK extracts the Claude Code runtime (running the CLI as a subprocess)
- Robota adopts a direct code sharing approach rather than subprocess
- Layer hierarchy: agent-cli → agent-sdk → agent-sessions → agent-core (upper layers import lower layers)
- Research document: `docs/superpowers/research/2026-03-19-claude-code-vs-agent-sdk.md`

### General/Specialized Separation Criteria

Each module's placement is determined by "Is this used only in the SDK, or is it general-purpose?":

| Module                 | Verdict                      | Rationale                                                                                                            |
| ---------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Permissions            | **General** → agent-core     | Tool permission checks are needed on servers too                                                                     |
| Hooks                  | **General** → agent-core     | Audit/validation is needed on servers too                                                                            |
| Built-in tools         | **General** → agent-tools    | File system tools are needed in playground/server environments too                                                   |
| Session                | **General** → agent-sessions | Session management is needed in any environment                                                                      |
| Config loading         | **SDK-specific** → agent-sdk | `.robota/settings.json` is for local environments only                                                               |
| Context loading        | **SDK-specific** → agent-sdk | AGENTS.md walk-up is for local environments only                                                                     |
| Agent tool             | **SDK-specific** → agent-sdk | Sub-session creation is an SDK assembly concern                                                                      |
| InteractiveSession     | **SDK-specific** → agent-sdk | Client-facing event wrapper; no CLI/React dependency; reusable by all clients                                        |
| SystemCommandExecutor  | **SDK-specific** → agent-sdk | Embedded in InteractiveSession; accessed via session.executeCommand(); exported for command module composition tests |
| CommandRegistry et al. | **SDK-specific** → agent-sdk | Slash command discovery is useful for any client; moved from CLI to SDK                                              |
| ITerminalOutput        | **General** → agent-sessions | Terminal I/O abstraction (SSOT in permission-enforcer.ts; agent-cli has a duplicate)                                 |

### Existing Package Refactoring History

- **agent-sessions**: Removed existing SessionManager/ChatInstance (zero consumers, no-op persistence), replaced with Session/SessionStore from agent-sdk
- **agent-tools**: Added 8 built-in tools in `builtins/` directory (Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch), added `TToolResult` type
- **agent-core**: Added `permissions/` and `hooks/` directories
- **agent-provider-anthropic**: Multi-block content handling (text + tool_use), streaming `chatWithStreaming`, `onTextDelta` support

## Hook Type Executors (SDK-Specific)

agent-sdk provides two additional `IHookTypeExecutor` implementations that extend the hook system beyond agent-core's built-in `command` and `http` executors:

| Executor         | Hook Type | Description                                                                                     |
| ---------------- | --------- | ----------------------------------------------------------------------------------------------- |
| `PromptExecutor` | `prompt`  | Injects the hook's prompt text into the session context as a system-level instruction           |
| `AgentExecutor`  | `agent`   | Creates a sub-agent session (via `createSession`) to process the hook input and return a result |

These executors are registered with `runHooks` via the `executors` map during session creation in `createSession()`.

## Settings Configuration

Settings are loaded with a 6-file precedence model (lowest priority first). `.robota/` is the primary configuration convention; `.claude/` paths are supported for Claude Code compatibility.

| Layer | Path                          | Scope                                   |
| ----- | ----------------------------- | --------------------------------------- |
| 1     | `~/.robota/settings.json`     | User global                             |
| 2     | `~/.claude/settings.json`     | User global (Claude Code compatible)    |
| 3     | `.robota/settings.json`       | Project                                 |
| 4     | `.robota/settings.local.json` | Project (local)                         |
| 5     | `.claude/settings.json`       | Project (Claude Code compatible)        |
| 6     | `.claude/settings.local.json` | Project (local, Claude Code compatible) |

The `.claude/settings.json` layers provide Claude Code compatibility — settings written by Claude Code are automatically picked up by Robota. Higher layers override lower layers via deep merge. `$ENV:VAR` substitution is applied after merge for provider API keys.

Provider resolution order:

1. `currentProvider` plus `providers[currentProvider]`
2. Legacy `provider`
3. Existing defaults

Provider profile schema:

| Field     | Description                                                                     |
| --------- | ------------------------------------------------------------------------------- |
| `type`    | Provider implementation type such as `anthropic` or `openai`                    |
| `model`   | Default model ID for the profile                                                |
| `apiKey`  | Literal key or `$ENV:<name>` reference                                          |
| `baseURL` | Optional OpenAI-compatible or provider-specific endpoint                        |
| `timeout` | Optional provider idle timeout and provider construction timeout when supported |

`currentProvider` must point to an existing profile key. Missing profiles and profiles without `type` are configuration errors. Profile keys are stable user-facing identifiers; two profiles may have the same `type` and `model` when they represent different credentials, accounts, endpoints, or operational defaults. Legacy `provider` remains accepted for backward compatibility, but it must not override an explicit active provider profile.

The SDK remains provider-neutral: it resolves provider metadata for session assembly, but consumers such as `agent-cli` still construct concrete provider instances. During session assembly, `config.provider.timeout` is forwarded to `Session.providerTimeout`; when omitted, SDK assembly uses a 120-second provider idle timeout so headless/TUI sessions cannot wait forever for a stalled provider call.

## Bundle Plugin System

Bundle plugins package reusable extensions (tools, hooks, permissions, system prompt additions) into installable units.

### Types

| Type                    | Description                                                     |
| ----------------------- | --------------------------------------------------------------- |
| `IBundlePluginManifest` | Plugin metadata: name, version, description, author, keywords   |
| `ILoadedBundlePlugin`   | Full bundle: manifest + tools, hooks, permissions, systemPrompt |

### Loader

`BundlePluginLoader` loads a bundle plugin from a directory path. It reads the manifest, resolves tool/hook definitions, and validates the bundle structure.

### Installer

`BundlePluginInstaller` manages plugin installation and uninstallation:

- Installs bundles to `~/.robota/plugins/` (user) or `.robota/plugins/` (project)
- Tracks installed plugins in a registry file
- Handles enable/disable state per plugin

## Marketplace Client

`MarketplaceClient` provides plugin discovery and installation from remote sources.

- **Source management**: Add, remove, and list marketplace sources
- **Default marketplace**: Built-in default source URL for the Robota plugin marketplace
- **Search**: Query available plugins by name, keyword, or category
- **Install**: Download and install plugins via `BundlePluginInstaller`

## System Prompt Skill and Agent Injection

Skills discovered from skill directories are exposed to the system prompt by metadata only: name and description. Full `SKILL.md` content is loaded only when a skill is invoked. Skills with `disable-model-invocation: true` are omitted from model-visible metadata.

Agent definitions are exposed to the system prompt by metadata only when an injected command module requests `agent-runtime`. Without that session requirement, `Agent` tool registration, agent definitions, and model-visible agent metadata are omitted.

When enabled, the `Agent` tool is part of the available tool set and is described in tool descriptors.

The `Agent` tool routes execution through a per-session `SubagentManager`, which delegates to the shared `BackgroundTaskManager` for `kind: 'agent'` tasks. It resolves unknown agent types before spawning so existing error results remain compatible.

The direct `Agent` tool always sets `mode: 'background'`, emits lifecycle updates through `background_task_event`, waits for terminal task completion, and returns `{ success, output, agentId }` or a failed terminal result. Detached fire-and-return agent orchestration belongs to command/runtime APIs such as `/agent parallel --detach`, not to direct model-emitted `Agent` tool parameters.

### Skill Execution Semantics

`InteractiveSession.executeSkillCommand(skill, args, displayInput?, rawInput?)` is the SDK-owned skill execution path.

| Skill metadata             | Behavior                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| no `context`               | Render skill content and submit it into the current session                                           |
| `context: fork`            | Run rendered skill content in an isolated subagent session using `skill.agent` or `general-purpose`   |
| `allowed-tools`            | Restrict fork-session tools to the listed names, after the selected agent definition denylist applies |
| `disable-model-invocation` | Hide from model-visible skill metadata; user slash invocation still works                             |
| `user-invocable: false`    | Hide from user slash menus; model metadata remains available unless model invocation is disabled      |

Fork skill execution must not rely on prompting the parent model to call the `Agent` tool. It must call `createSubagentSession()` directly through the per-session agent tool dependencies so the behavior is deterministic and unit-testable.

## Hook Wiring into Session Lifecycle

During `createSession()`, hooks from the merged settings configuration are wired into the session lifecycle:

1. Hook configuration is extracted from the resolved config
2. SDK-specific executors (`PromptExecutor`, `AgentExecutor`) are registered alongside core executors
3. `SessionStart` hooks fire during session initialization
4. `PreToolUse`/`PostToolUse` hooks are invoked by `PermissionEnforcer` around tool execution
5. `UserPromptSubmit` hooks fire before each user message is processed
6. `Stop` hooks fire on session termination

## Background Task Execution

`BackgroundTaskManager` is owned by `agent-runtime` and re-exported by `agent-sdk` through the explicit runtime facade. It is the generic lifecycle layer for foreground/background agent and process jobs. It is provider-neutral and depends only on injected runner ports.

Responsibilities:

- create addressable background task records
- enforce bounded concurrency across registered task kinds
- track lifecycle state: `queued`, `running`, `waiting_permission`, `completed`, `failed`, `cancelled`
- expose `spawn`, `wait`, `list`, `get`, `cancel`, `close`, `send`, `readLog`, and `subscribe`
- emit a single `TBackgroundTaskEvent` union for lifecycle/progress projection
- keep runner implementation details out of TUI, transports, and tool code

The manager does not create providers, sessions, child processes, worktrees, or TUI state directly. Those concerns belong to runner adapters and outer composition layers. SDK code composes the manager with SDK-owned tools and `InteractiveSession`; it does not own the lifecycle state machine.

SDK runtime facade barrels also re-export runtime-owned helper primitives for bounded output
capture and cursor-based log pagination so runtime shells can implement process adapters through
the documented SDK facade instead of importing `agent-runtime` directly.

`InteractiveSession` exposes background task controls:

| Method                         | Behavior                                      |
| ------------------------------ | --------------------------------------------- |
| `listBackgroundTasks(filter?)` | Return cloned background task state snapshots |
| `getBackgroundTask(taskId)`    | Return one cloned task snapshot               |
| `cancelBackgroundTask(...)`    | Targeted task cancellation                    |
| `closeBackgroundTask(taskId)`  | Remove a terminal task from the registry      |
| `sendBackgroundTask(...)`      | Forward optional input to a supporting runner |
| `readBackgroundTaskLog(...)`   | Read optional runner logs                     |

`InteractiveSession` emits `background_task_event` with `TBackgroundTaskEvent`.

When session persistence is enabled, `InteractiveSession` must persist background task state as part of the project-local session record. Lifecycle, tool start/end, permission, completion, failure, cancellation, and close events update the session JSON with the latest task snapshots and durable event summaries. High-frequency `background_task_text_delta` events must not rewrite the main session JSON per chunk; they are written to append-only JSONL session logs and task/subagent transcript files so debugging data is available while streaming is still in progress without risking partial JSON writes.

`createSession()` accepts `backgroundTaskRunners?: IBackgroundTaskRunner[]`. When a runner with `kind: 'process'` is present, SDK composition registers the model-callable `BackgroundProcess` tool:

- `BackgroundProcess` starts a command as `kind: 'process'`, `mode: 'background'`
- it returns `{ success, background: true, output: '', taskId, status, command }` immediately
- stdout/stderr inspection and cancellation are routed through the shared manager APIs
- existing `Bash` tool behavior is not changed

`createSession()` accepts `subagentRunnerFactory?: TSubagentRunnerFactory`. The SDK default remains `createInProcessSubagentRunner(agentToolDeps)`. A runtime shell may supply a factory to run `Agent` tool jobs through a process-backed runner while reusing the same config/context/tool dependency bundle assembled by the SDK.

Runner progress semantics:

- `background_task_text_delta` forwards partial output for preview surfaces
- `background_task_tool_start` sets `IBackgroundTaskState.currentAction`
- `background_task_tool_end` clears `currentAction` on success or stores the error/action on failure
- progress events do not complete, fail, cancel, or close tasks; lifecycle remains manager-owned
- progress and lifecycle events are diagnostic data, not just UI state; SDK composition must route them to session logging/persistence when those facilities are configured

The product-composed `/background` command module maps to these APIs:

| Command                               | Behavior                       |
| ------------------------------------- | ------------------------------ |
| `/background` or `/background list`   | List current background tasks  |
| `/background read <task-id> [offset]` | Read a task log page           |
| `/background cancel <task-id>`        | Cancel one running/queued task |
| `/background close <task-id>`         | Dismiss one terminal task      |

## Subagent Execution

### SubagentManager

`SubagentManager` is owned by `agent-runtime` and re-exported by `agent-sdk` through the explicit runtime facade. It is the managed subagent facade. It depends on an injected `ISubagentRunner` port or an injected `IBackgroundTaskManager` and maps subagent jobs to `BackgroundTaskManager` agent tasks.

Responsibilities:

- create addressable subagent job records
- enforce bounded concurrency
- track lifecycle state: `queued`, `running`, `waiting_permission`, `completed`, `failed`, `cancelled`
- expose `spawn`, `wait`, `list`, `get`, `cancel`, `close`, and `send` operations
- keep runner implementation details out of TUI and Agent tool code

`SubagentManager` does not create providers, sessions, child processes, worktrees, or TUI state directly. Those concerns belong to runner adapters and outer composition layers. It exposes `getBackgroundTaskManager()` so SDK `InteractiveSession` can forward generic background task events and controls without depending on subagent-specific types.

### SubagentRunner Port

`ISubagentRunner` is owned by `agent-runtime` and is the execution boundary for one subagent job. Implementations can run jobs in-process for tests or in a child process for CLI runtime.

```typescript
interface ISubagentRunner {
  start(job: ISubagentJobStart): ISubagentJobHandle;
}

interface ISubagentJobStart {
  jobId: string;
  request: ISubagentSpawnRequest;
  emit?: (event: TBackgroundTaskRunnerEvent) => void;
}

interface ISubagentJobHandle {
  readonly jobId: string;
  readonly pid?: number;
  readonly logPath?: string;
  readonly transcriptPath?: string;
  result: Promise<ISubagentJobResult>;
  cancel(reason?: string): Promise<void>;
  send?(prompt: string): Promise<void>;
  readLog?(cursor?: IBackgroundTaskLogCursor): Promise<IBackgroundTaskLogPage>;
}
```

The runner reports completion through its `result` promise and supports targeted cancellation through `cancel()`. Follow-up routing via `send()` is optional until a runner supports it. Log reading via `readLog()` is optional, but process-backed subagent runners should implement it so `/agent read AGENT_ID` can inspect append-only transcripts while a job is still running.

`createInProcessSubagentRunner(deps)` is the default SDK adapter for foreground compatibility. It resolves the requested agent definition, creates an isolated child `Session` with `createSubagentSession()`, runs the prompt, and maps the response to `ISubagentJobResult`.

### WorktreeSubagentRunner

`WorktreeSubagentRunner` is owned by `agent-runtime`. It keeps worktree isolation behavior reusable across CLI, headless, or future runtime shells while keeping concrete Git commands outside the reusable runtime layer.

The decorator depends on:

- an inner `ISubagentRunner` that performs the actual agent execution
- an `ISubagentWorktreeAdapter` port that can prepare, inspect, and remove worktrees
- optional `THooksConfig` and hook executors for worktree lifecycle notifications

When `job.request.isolation !== 'worktree'`, the decorator delegates to the inner runner without changing the request.

When `job.request.isolation === 'worktree'`, the decorator must:

- call `ISubagentWorktreeAdapter.prepare({ jobId, cwd })`
- invoke the inner runner with `cwd`, `worktreePath`, and `branchName` set to the prepared worktree
- emit `WorktreeCreate` hook notification after preparation
- remove clean worktrees exactly once on success, delegated failure, synchronous delegated start failure, or successful cancellation
- preserve dirty worktrees and return `worktreePath`, `branchName`, `worktreeStatus`, and `worktreeNextAction` in `ISubagentJobResult.metadata`
- include adapter-provided `baseRevision` and dirty parent checkout status in handoff metadata when available
- preserve existing result metadata while adding worktree metadata
- emit `WorktreeRemove` hook notification when a clean worktree is removed

### createSubagentSession(options)

Assembles an isolated child Session for subagent execution. Unlike `createSession`, this factory does not load config files or context from disk — it receives pre-resolved config and context from the parent session.

**Tool filtering order:**

1. Remove disallowed tools (denylist from agent definition)
2. Keep only allowed tools (allowlist from agent definition, if specified)
3. Always remove the `Agent` tool (subagents cannot spawn subagents)

**Model resolution:** Agent definition model override (with shortcut expansion: `sonnet`, `haiku`, `opus`) takes priority; falls back to parent config model.

### Agent Definitions

`IAgentDefinition` interface defines the shape for both built-in and custom agents:

| Field             | Type       | Required | Description                                     |
| ----------------- | ---------- | -------- | ----------------------------------------------- |
| `name`            | `string`   | Yes      | Unique agent identifier                         |
| `description`     | `string`   | Yes      | Human-readable purpose description              |
| `systemPrompt`    | `string`   | Yes      | Markdown body used as the agent's system prompt |
| `model`           | `string`   | No       | Model override (inherits parent when omitted)   |
| `maxTurns`        | `number`   | No       | Maximum agentic turns                           |
| `tools`           | `string[]` | No       | Allowlist of tool names                         |
| `disallowedTools` | `string[]` | No       | Denylist of tool names                          |

**Built-in agents:**

| Name              | Model Override | Tool Restrictions   | Purpose                     |
| ----------------- | -------------- | ------------------- | --------------------------- |
| `general-purpose` | (parent)       | None (inherits all) | Full-capability task agent  |
| `Explore`         | (parent)       | Denies Write, Edit  | Read-only code exploration  |
| `Plan`            | (parent)       | Denies Write, Edit  | Read-only planning/research |

### Model-Requested Agent Invocation

The parent session exposes an `Agent` function tool with parameters:

| Parameter       | Type                   | Required | Description                                                       |
| --------------- | ---------------------- | -------- | ----------------------------------------------------------------- |
| `prompt`        | `string`               | Yes      | Task prompt for the isolated agent session                        |
| `subagent_type` | `string`               | No       | Agent name. Defaults to `general-purpose` when omitted            |
| `model`         | `string`               | No       | Optional model override for this invocation                       |
| `isolation`     | `'none' \| 'worktree'` | No       | Run in the parent cwd or a runtime-managed Git worktree           |
| `jobs`          | `AgentJob[]`           | No       | Batch of subagent jobs to start in one tool call                  |
| `jobs[].label`  | `string`               | No       | Stable role label for a batch job, e.g. `developer` or `reviewer` |

When `jobs` is present and non-empty, the Agent tool runs in batch mode. Each `AgentJob` contains `prompt` plus optional `label`, `subagent_type`, `model`, and `isolation`. Batch mode starts all valid jobs before waiting for terminal results, returns one structured result per requested job, and includes a shared `groupId`/`agentIds` provenance envelope. The result must also expose `mode`, `requestedJobCount`, `startedJobCount`, `failedJobCount`, and a `provenance` object so session logs and parent-response checks can distinguish one batch tool call from separate single-job calls. Model-visible tool instructions must require final user-facing claims to be based on those returned mode/count fields; the assistant must not claim parallel or multi-agent execution unless the result proves those jobs started. The single-job fields remain supported for backwards compatibility and return `mode: "single"` plus matching count/provenance fields.

Unknown extra tool-call arguments are tolerated by the Agent tool runtime for provider compatibility, but they are not part of the public Agent parameter contract.

The parent model may call this tool when the user asks for an agent to be called or asks for delegation. For explicit multi-agent or parallel-agent requests, the canonical model-invocable path is one batch `Agent` tool call with `jobs`. The tool result is private to the model; the parent model must summarize the returned output for the user and must not claim that parallel execution happened unless the batch result shows the jobs were started.

When `isolation: 'worktree'` is requested, a runtime shell that supports worktree isolation must compose `WorktreeSubagentRunner` with a concrete `ISubagentWorktreeAdapter`. The runtime runner handles lifecycle, cleanup, handoff metadata, and `WorktreeCreate` / `WorktreeRemove` hook notifications; the shell adapter handles Git/filesystem I/O. Unsupported non-Git or shell states must fail with actionable messages unless the user explicitly requested non-isolated execution.

### AgentDefinitionLoader (Internal)

`AgentDefinitionLoader` is an internal class — it is not exported from `src/index.ts`. It scans directories for custom `.md` agent definitions with YAML frontmatter, merged with built-in agents. Custom agents override built-in agents on name collision.

**Scan directories (highest priority first):**

1. `<cwd>/.robota/agents/` — project-level (Robota native)
2. `<cwd>/.agents/agents/` — project-level (Robota repository convention)
3. `<cwd>/.claude/agents/` — project-level (Claude Code compatible)
4. `<home>/.robota/agents/` — user-level (Robota native)
5. `<home>/.claude/agents/` — user-level (Claude Code compatible)

### Framework System Prompt Suffixes

Two suffix modes appended to subagent system prompts:

- **Subagent suffix** (default): Instructs the agent to report concisely to the caller
- **Fork worker suffix** (`isForkWorker: true`): Instructs the agent to respond within 500 words, suitable for skill fork execution

### assembleSubagentPrompt(options)

Assembles the full system prompt for a subagent session:

1. Agent body (from agent definition `systemPrompt`)
2. CLAUDE.md content (from parent context)
3. AGENTS.md content (from parent context)
4. Framework suffix (subagent or fork worker)

### Subagent Transcript Logger

`createSubagentLogger(parentSessionId, agentId, baseLogsDir)` creates a `FileSessionLogger` for append-only subagent transcripts. Subagent sessions must run with `sessionId = agentId`, so the transcript is written to `{baseLogsDir}/{parentSessionId}/subagents/{agentId}.jsonl`.

Subagent transcript logs must include session initialization, prompts, tool calls/results, streaming `text_delta` chunks, final assistant output, context state, and errors. Parent sessions may store only transcript paths and task snapshots in `.robota/sessions/*.json`; the transcript JSONL remains the source of truth for high-frequency streaming data.

## Unconnected Packages (Future Integration Targets)

| Package                                    | Current State | Integration Direction                                               |
| ------------------------------------------ | ------------- | ------------------------------------------------------------------- |
| **agent-tool-mcp**                         | Unconnected   | Connect when MCP server is configured in InteractiveSession options |
| **agent-team**                             | Unconnected   | Replace agent-tool.ts with agent-team delegation pattern            |
| **agent-event-service**                    | Unconnected   | Publish Session lifecycle events                                    |
| **agent-plugin-\***                        | Unconnected   | Inject plugins during Session/Robota creation                       |
| **agent-provider-openai/google/bytedance** | Unconnected   | Consumer passes provider to InteractiveSession({ cwd, provider })   |
