# Agent Command Invocation Specification

Status: Proposed
Created: 2026-05-01
Related specs:

- `.agents/specs/background-task-layer.md`
- `.agents/specs/subagent-process-manager.md`

## Scope

This specification defines how Robota turns slash commands, injected command metadata, skills, and model-callable command tools into deterministic agent command execution behavior.

The goal is to prevent the assistant from merely describing agent execution when the user requested actual subagent execution. Robota must expose agent commands as owner-provided descriptors in startup context and as model-callable command tools so the model can choose the command and the runtime can execute it through the same command handler used by slash input.

`built-in` does not mean the command must be hardcoded into every SDK session. In this spec, a built-in command is a command module that a composition root can inject as part of the default product assembly. If an SDK consumer does not inject the agent command module, that session must not expose `/agent`, model-visible `/agent` descriptors, or the `Agent` tool.

This spec spans `agent-sdk`, `agent-command-agent`, `agent-cli`, `agent-runtime`, `agent-sessions`, and transport packages because the feature touches command module metadata, prompt/context assembly, model-callable command execution, runtime background task creation, TUI projection, and non-interactive/headless behavior.

## Prior Art Research

### Claude Code

- `CLAUDE.md` files are project/user/org instructions loaded into session context. Claude documentation distinguishes persistent project guidance from skills and recommends moving repeated procedures into skills instead of growing `CLAUDE.md`.
- Skills expose a frontmatter `description` that is available in context so Claude can decide when to invoke a skill. The full skill body is loaded only when the skill is invoked.
- Custom slash commands have been merged into skills. Commands and skills can share slash invocation, but built-in commands remain CLI-coded behavior.
- The commands reference distinguishes built-in commands from bundled skills. Built-in commands execute fixed CLI behavior; bundled skills are prompt-based workflows.
- Agent-related surfaces include `/agents`, `/tasks`, `/batch`, `/simplify`, and background task management. Some are built-in commands, while others are bundled skills that orchestrate work.
- Claude's subagent troubleshooting guidance says that if delegation does not happen, the Agent tool must be available, the prompt should mention the subagent explicitly, and the subagent description must clearly describe when to use it.

References:

- https://code.claude.com/docs/en/memory
- https://code.claude.com/docs/en/slash-commands
- https://code.claude.com/docs/en/commands
- https://code.claude.com/docs/en/agent-sdk/subagents

### Codex

- Codex subagent workflows spawn specialized agents in parallel and then collect results. Codex only spawns subagents when the user explicitly asks it to.
- Codex CLI exposes `/agent` as a built-in command to switch active agent threads and inspect ongoing subagent work.
- Codex handles orchestration across agents, including spawning agents, routing follow-up instructions, waiting for results, and closing threads.

References:

- https://developers.openai.com/codex/subagents
- https://developers.openai.com/codex/cli/slash-commands

### Gemini CLI

- Gemini CLI supports both automatic delegation and explicit forced subagent invocation with `@agent-name`.
- `/agents` is a built-in command for managing local and remote subagents.
- Gemini documentation emphasizes that subagent descriptions should clearly state expertise, when to use the agent, and example scenarios so the main agent can route reliably.

References:

- https://geminicli.com/docs/core/subagents/
- https://geminicli.com/docs/reference/commands/

## Problem

Robota currently has working background/subagent runtime pieces, but agent invocation lacks a clear bridge between model-visible command descriptions and actual command execution.

Observed failure mode:

1. The user asks for developer and designer subagents to analyze work in parallel.
2. The assistant describes the plan and claims agents are running.
3. No model-callable command or `Agent` tool call is emitted.
4. No `background_task_created` event appears.
5. No background task row appears in the TUI.

This is a product bug. If Robota exposes agent execution as a user-facing capability, the capability must have a descriptor, a model-callable execution surface, and a deterministic command handler. Robota must not add a separate natural-language pre-router that interprets user prose before the model. Natural language remains model input; command execution happens when the model calls the model-callable command tool or when the user enters a slash command directly.

## Design Principles

- Project instruction context and capability metadata are separate.
- `AGENTS.md`, `CLAUDE.md`, and equivalent memory files define persistent project guidance. They are not the owner of built-in command behavior.
- `system-prompt-builder` must not hardcode operational guidance. It may compose sections supplied by instruction, command, skill, tool, provider, permission, and agent registries, but it must not author behavior text itself.
- Built-in command modules, skills, model-callable tools, and agent definitions must each have owner-provided descriptors.
- The first model turn may include capability descriptors, but those descriptors must come from registries, not hand-written feature sections in a generic prompt builder.
- Side-effectful command behavior must have a deterministic handler, but natural-language prompts must not be pre-routed by a CLI heuristic layer.
- Model-invocable command selection is driven by owner-provided descriptors rendered into startup context and exposed through model-callable command tools.
- The assistant must not claim an agent is running unless Robota has observed an `agentId`, `background_task_created`, or equivalent runtime event.
- Capability modules are optional and must be composed through interfaces. SDK core must be able to run without the agent module.

## Context Assembly Model

Robota startup context is assembled from owner-provided sources.

| Source                 | Owner                                                     | Loaded when                              | Purpose                                                                     |
| ---------------------- | --------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| Project instructions   | `AGENTS.md`, `CLAUDE.md`, `.robota`/future config readers | Session startup or path-scoped discovery | Persistent repository guidance and rules                                    |
| Runtime descriptors    | SDK/session/runtime configuration                         | Before the first user prompt             | Current cwd, provider/model, language, permission mode, and trust metadata  |
| Command descriptors    | Injected command registries and plugin command registries | Before the first user prompt             | Short descriptions of available slash commands and model-invocable commands |
| Skill descriptors      | `SkillCommandSource` and plugin skill sources             | Before the first user prompt             | Short descriptions that help the model decide whether a skill is relevant   |
| Tool descriptors       | Tool registry entries                                     | Before the first user prompt             | Short descriptions and safety metadata for model-callable tools             |
| Agent descriptors      | Built-in and custom agent registries                      | Before the first user prompt             | Short descriptions of available subagent identities and expertise           |
| Provider capabilities  | Active provider adapter                                   | Before the first user prompt             | Provider-owned capability notes such as web search/fetch/tool availability  |
| Framework instructions | Versioned Robota instruction source                       | Before the first user prompt             | Minimal product-level role and interaction contract                         |

Full command, skill, or agent bodies must not be dumped into the startup prompt unless the corresponding feature explicitly requires preloading. Descriptions are the default model-visible surface.

No source should be represented by ad hoc text inside a generic prompt builder. Each source must expose a descriptor or instruction section owned by the package that owns the behavior.

## Capability Module Composition

Agent support MUST be represented as an optional capability module, not as unconditional SDK behavior.

Minimum module shape:

```ts
interface ICommandModule {
  readonly name: string;
  readonly commandSources?: readonly ICommandSource[];
  readonly systemCommands?: readonly ISystemCommand[];
  readonly commandDescriptors?: readonly ICapabilityDescriptor[];
  readonly sessionRequirements?: readonly TCommandModuleSessionRequirement[];
}
```

Rules:

- SDK core owns the command module interface and composition points.
- `@robota-sdk/agent-command-agent` owns the `/agent` command handler, `/agent` command descriptor, agent command palette entry, and request for agent runtime/tool wiring.
- The Robota binary composition root may inject the agent module for the Robota CLI product.
- Programmatic SDK consumers may omit the agent module and receive a session without `/agent`, model-visible `/agent` descriptors, or the `Agent` tool.
- Other future command modules must be injected through the same feature or command source mechanism.
- Command palette metadata and model-visible descriptors must come from the injected module, not from separate hardcoded lists.

## Capability Descriptor Contract

Command, skill, and agent metadata must share one model-visible descriptor shape.

```ts
interface ICapabilityDescriptor {
  readonly name: string;
  readonly kind: 'builtin-command' | 'skill' | 'agent' | 'tool';
  readonly description: string;
  readonly userInvocable: boolean;
  readonly modelInvocable: boolean;
  readonly argumentHint?: string;
  readonly safety?: 'read-only' | 'write' | 'process' | 'network' | 'background-agent';
}
```

Rules:

- Descriptor content is owned by the registry entry that implements the capability.
- The prompt composer may render descriptors, but must not author feature-specific prose.
- `disableModelInvocation` maps to `modelInvocable: false`.
- `userInvocable: false` capabilities may still be shown to the model if `modelInvocable: true`.
- Descriptions must state when to use the capability, not implementation internals.

## `/agent` Agent Capability Command

Robota CLI's product composition MAY inject `/agent` as a default product command through `@robota-sdk/agent-command-agent`. It is command-like in the UI and skill-like in metadata because it has a descriptor that can be shown to the model, but its execution is coded in an agent command module.

The command must not be part of the SDK's unconditional core command set. It becomes a built-in command only in assemblies that inject the agent command module.

`agent-sdk` and reusable `agent-cli` UI code must not import or special-case the `/agent` command module. They may accept generic `ICommandModule` values. A product entrypoint may choose to include `@robota-sdk/agent-command-agent`.

Recommended descriptor:

```text
/agent — Start, inspect, steer, stop, and close subagent jobs. Use this when the user explicitly asks to create, spawn, delegate to, run, or manage agents, especially for parallel or background work.
```

### Required Subcommands

| Command                          | Behavior                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `/agent`                         | List available agent definitions and active/terminal agent jobs, or open a picker when the host supports it.    |
| `/agent PROMPT`                  | Spawn one `general-purpose` background agent with the natural-language prompt and return `agentId` immediately. |
| `/agent AGENT_NAME PROMPT`       | Spawn the named background agent when `AGENT_NAME` matches an available agent definition.                       |
| `/agent run [AGENT_NAME] PROMPT` | Compatibility alias for background agent spawn. Defaults to `general-purpose` when omitted.                     |
| `/agent parallel <spec>`         | Spawn multiple background agents from a structured spec and return all `agentId` values immediately.            |
| `/agent read AGENT_ID [OFFSET]`  | Read retained transcript/log output for an agent job.                                                           |
| `/agent send AGENT_ID PROMPT`    | Send follow-up input to a running/open agent when supported.                                                    |
| `/agent stop AGENT_ID [REASON]`  | Cancel a running/queued agent job.                                                                              |
| `/agent close AGENT_ID`          | Close a terminal agent job.                                                                                     |
| `/agent open AGENT_ID`           | Switch or focus the TUI agent thread/detail view when the TUI supports it.                                      |

`/background` remains the generic task manager command. `/agent` is the agent-specific control surface and may delegate task reads/cancel/close to the shared background task registry.

Agent spawn commands are background-first. The user-facing syntax does not require `--background`; the flag is accepted only as a compatibility no-op.

### Parallel Invocation Syntax

The first implementation should support a simple deterministic syntax:

```text
/agent parallel \
  developer=general-purpose:"Analyze implementation risks for DAG-BL-011" \
  designer=Plan:"Analyze architecture boundaries for DAG-BL-011"
```

The command parser may later support JSON input for headless clients:

```json
{
  "mode": "background",
  "jobs": [
    {
      "label": "developer",
      "agent": "general-purpose",
      "prompt": "Analyze implementation risks for DAG-BL-011"
    },
    {
      "label": "designer",
      "agent": "Plan",
      "prompt": "Analyze architecture boundaries for DAG-BL-011"
    }
  ]
}
```

`parallel` MUST spawn all valid jobs before waiting for any result. It MUST return created job IDs immediately.

The first implementation MUST also support a simpler `label:"prompt"` parallel token. In that form, the label is used for display and the agent type defaults to `general-purpose`, unless the label itself matches an available agent definition.

## Model-Routed Command Invocation

Robota MUST NOT add a natural-language pre-router that decides whether prose should become an agent command before the model sees it.

Instead, Robota exposes model-invocable command descriptors and a command execution tool generated from the command registry. The model receives concise descriptions of commands such as `/agent` in startup context. When the user asks for agent work in natural language, the model can choose the command execution tool and pass the selected command plus natural-language arguments.

The model-callable command execution tool is a generic bridge over registered commands, not a second implementation of command behavior.

Recommended tool contract:

```ts
interface IExecuteCommandToolInput {
  readonly command: string;
  readonly args: string;
}
```

Rules:

- Only command registry entries with `modelInvocable: true` may be exposed through the model-callable command tool.
- The command execution tool must validate that the requested command exists and is model-invocable before running it.
- The command execution tool must call the same command handler used by user-entered slash commands.
- The command execution tool must return structured command results, including `agentId` values for created background agents.
- Prompt text alone is not command execution. If the model writes `/agent ...` as assistant text instead of calling the command tool, no agent job has started.
- Tag-like assistant markup is not command execution. Owner-provided command descriptors should explicitly point model-routed execution at the `ExecuteCommand` tool without showing tag-shaped examples that local models may copy.
- If the model does not call the command tool, Robota must not synthesize an agent job from natural language after the fact.
- User-entered prompts that begin with `/agent` may bypass the model and execute the slash command handler directly.

## Model-Callable `Agent` Tool

The `Agent` tool remains necessary for model-initiated delegation. It must continue to support:

- `prompt`
- `subagent_type`
- `model`
- `background`
- `isolation`

But the `Agent` tool is no longer the only model path for user-requested agent execution. Explicit slash commands and model-callable command tool invocations may call runtime APIs directly.

The model-visible `Agent` tool description should stay tool-local, but it must be explicit enough for smaller OpenAI-compatible local models to understand that subagent work starts only through a real tool call.

Rules:

- If the user explicitly asks to create, spawn, run, delegate to, or use subagents/agents, the assistant should call the `Agent` tool in the same assistant turn instead of replying with a plan.
- For multiple or parallel subagents, the assistant should emit one `Agent` tool call per requested role in the same assistant turn.
- Agent tool calls are background-first. `background` defaults to `true`; `background: false` is only for an explicit foreground/wait request.
- The assistant must not print tag-like assistant markup as a substitute for a tool call.
- The assistant must not say an agent is running unless the tool result returned an `agentId` or an equivalent runtime event exists.
- Role naming should prefer available agent definitions. Developer, implementation, and engineering requests map to `general-purpose` when no more specific agent exists. Designer, planning, and architecture requests map to `Plan` when available.
- If the user asks to analyze one backlog/task/item, the assistant may choose a reasonable target when visible context lists candidates. If no candidate is currently visible, it should include target selection/discovery inside each subagent prompt instead of first replying with an inspection plan.
- Tool and command descriptors may include short multilingual examples for common local usage patterns when they materially improve model reliability. For Korean, phrases such as "백로그 중에 하나를 분석할건데..." must be interpreted as an immediate execution request when the sentence also asks to create/run subagents.

The `Agent` tool MUST be registered only when an injected command module requests the `agent-runtime` session requirement.

## Prompt Builder Requirements

`system-prompt-builder` should be replaced or reduced to a pure prompt composer. The composer may own ordering, filtering, and markdown joining of supplied sections, but it must not contain hardcoded behavioral instructions.

The composer input should be data-first:

```ts
interface ISystemPromptSection {
  readonly id: string;
  readonly title?: string;
  readonly priority: number;
  readonly content: string;
  readonly source:
    | 'framework'
    | 'project-instructions'
    | 'runtime'
    | 'permissions'
    | 'provider'
    | 'command'
    | 'skill'
    | 'tool'
    | 'agent';
}
```

Rules:

- The composer must not author role text, web-search instructions, permission explanations, tool descriptions, agent guidance, skill guidance, or slash-command behavior.
- The composer may render section titles only when the title is provided by the section owner.
- Framework-level role text, if needed, must live in a versioned Robota instruction source, not inline in builder code.
- Permission text must come from permission/trust-mode descriptors.
- Provider capability text must come from the active provider adapter.
- Tool text must come from tool descriptors.
- Command and skill text must come from command/skill descriptors.
- Agent text must come from agent definitions and the injected `/agent` command descriptor.
- Tests must be able to prove that a new capability can appear in the system prompt by registering a descriptor, without editing the composer.

Required refactor:

- Remove hardcoded role, permission, web search, tool, skill, and subagent prose from `system-prompt-builder`.
- Introduce section providers for framework instructions, project instructions, runtime metadata, permission metadata, provider capabilities, command descriptors, skill descriptors, tool descriptors, and agent descriptors.
- Render `/agent`, skills, tools, and agent definitions from their registries through `ICapabilityDescriptor` or `ISystemPromptSection` providers.
- Keep project instructions loaded from `AGENTS.md`/`CLAUDE.md` before capability metadata unless an explicit section priority says otherwise.
- Make the composer deterministic and side-effect free so it can be unit-tested with synthetic section providers.

## Runtime Execution Contract

The `/agent` command handler and model-callable command tool MUST execute through the same runtime stack as the `Agent` tool:

```text
Slash Input or Model Command Tool
  -> InteractiveSession agent command API
    -> SubagentManager
      -> BackgroundTaskManager
        -> configured SubagentRunner
```

Rules:

- CLI and TUI components must not instantiate child processes directly.
- SDK command handlers may call `SubagentManager` or `BackgroundTaskManager` through `InteractiveSession` APIs.
- CLI remains responsible for composing concrete runner factories.
- Runtime packages remain responsible for lifecycle and registry state.
- The command path must emit the same background task events as the tool path.

## Runtime Evidence Reporting Contract

Robota MUST use runtime evidence as the only authoritative source for agent execution state.

Robota-owned UI, transport, logs, and command results may report that agents are running only when one of these is true:

- an `Agent` tool call completed with `background: true` and returned an `agentId`;
- `/agent PROMPT`, `/agent run`, or `/agent parallel` returned one or more `agentId` values;
- a `background_task_created` event was observed for each claimed job.

Rules:

- Robota must not parse assistant prose to synthesize or infer that an agent job exists.
- Robota must not create agent jobs after the fact because assistant prose mentioned agents.
- If no command/tool execution occurred, structured runtime state must remain "no agent job started" for that turn.
- If a user-entered slash command was incomplete, the command handler returns an explicit missing-parameter error.
- Tests must validate runtime evidence state and command/tool results, not arbitrary natural-language claim detection.

## TUI Requirements

The TUI should keep React/Ink components thin:

- input text beginning with a slash command is routed through the command handler before model submission;
- natural-language input is sent to the model with command descriptors and model-callable command tools available;
- `/agent` command results update the same background task projection used by `BackgroundTaskPanel`;
- active agent jobs can be inspected with `/agent list`, `/agent read`, and future thread-focus UI;
- completed clean background jobs may leave the always-visible panel according to `.agents/specs/background-task-layer.md`, but remain accessible through command APIs.

## Headless and Transport Requirements

Headless and protocol transports must expose deterministic agent invocation without depending on TUI input parsing.

Required behavior:

- headless prompt beginning with `/agent` executes the command handler;
- natural-language headless prompts can execute agent jobs only when the model calls the model-callable command tool or `Agent` tool;
- structured transport clients can request agent run/list/read/stop/close operations;
- `stream-json` includes background task events for agent jobs;
- failure responses include explicit errors when a requested agent was not started.

## Security and Permission Policy

Agent invocation can amplify side effects because multiple workers can run concurrently.

Rules:

- Background write-capable agent work should default to worktree isolation when available.
- Background agents inherit the current permission mode and allowlist, but fresh approval requests from background threads must be source-attributed.
- If a fresh approval cannot be surfaced in the active UI or transport, the background action must fail closed.
- Robota must not silently start write-capable parallel agents from ambiguous natural language without a slash command, model command tool call, or structured transport request.
- `/agent parallel` must have a configurable max jobs limit and respect `BackgroundTaskManager.maxConcurrent`.

## Implementation Plan

1. Add `ISystemPromptSection` and `ICapabilityDescriptor` models plus registry projections in `agent-sdk`.
2. Replace `system-prompt-builder` with a data-driven prompt composer and move existing hardcoded role, permission, web search, tool, skill, and subagent prose into owner-provided section/descriptor providers.
3. Add an optional `@robota-sdk/agent-command-agent` package that contributes `/agent` command metadata, `/agent` command execution, and agent runtime/tool enablement through the generic command module contract.
4. Keep core SDK system commands free of agent-specific behavior unless the agent command module is injected.
5. Add a model-callable command execution tool that projects `modelInvocable` command registry entries and calls the same command handlers.
6. Add `InteractiveSession` APIs that let command handlers spawn/list/read/send/stop/close agent jobs through the existing runtime manager.
7. Add `/agent PROMPT`, `/agent run`, and `/agent parallel` parsers with deterministic background spawn behavior.
8. Wire CLI/TUI slash input, headless slash input, and model command tool calls through the same command handler path.
9. Add runtime evidence tests that fail when Robota-owned execution state reports agent execution without a runtime event or returned `agentId`.
10. Persist the exact composed system prompt, registered tool schemas, provider messages, UI history, and diagnostic run data under the project `.robota` tree so resume and debugging inspect the same source of truth.
11. Update package SPEC files after code matches this cross-cutting spec.

## Test Plan

### Unit Tests

- Given synthetic prompt sections, when startup context is built, then the composer orders and joins the supplied sections without adding behavioral text of its own.
- Given framework, permission, provider, command, skill, tool, and agent section providers, when startup context is built, then each section's content appears from its owner provider.
- Given a new capability descriptor is registered, when startup context is built, then the capability appears without editing the composer.
- Given no agents are configured, when startup context is built, then no subagent-specific section is rendered.
- Given the SDK session is created without the agent command module, when commands/tools/system prompt are assembled, then `/agent`, `Agent`, and agent descriptors are absent.
- Given the Robota product composition injects the agent command module, when commands/tools/system prompt are assembled, then `/agent`, `Agent`, and agent descriptors are present.
- Given an unrelated command module such as `/diagnose` is injected, when the command registry and system executor are assembled, then `/diagnose` is visible/executable without adding any command-specific code to `agent-sdk`.
- Given the composer source is scanned, then it contains no hardcoded instructions for role behavior, web search, permissions, tools, skills, slash commands, or agents.
- Given `/agent` is injected with `modelInvocable: true`, when model tools are built, then the command execution tool allows `/agent` and rejects non-model-invocable commands.
- Given `/agent "analyze this"` is submitted, when the command executes, then it defaults to `general-purpose` and starts a background job without waiting for completion.
- Given `/agent Plan "draft architecture"` is submitted, when the command executes, then `SubagentManager.spawn()` receives `mode: "background"` and the command returns an `agentId` without awaiting completion.
- Given `/agent run "analyze this"` is submitted without an agent type, when the command executes, then it remains a compatibility alias for the same background behavior.
- Given `/agent parallel developer=general-purpose:"x" designer=Plan:"y"`, when the command executes, then two background jobs are spawned before any wait path is called.
- Given `/agent parallel developer:"x" designer:"y"`, when the command executes, then two background jobs are spawned with labels `developer` and `designer` and default agent type `general-purpose`.
- Given an explicit unknown agent type is requested, when the command executes, then it returns a structured command failure listing available agents instead of throwing an unhandled rejection.
- Given natural-language input asks for two named agents in parallel, when the model calls the command execution tool, then Robota executes `/agent parallel` through the command handler.
- Given natural-language input asks about agents but the model does not call a tool, when the turn completes, then Robota starts no background jobs.
- Given no `agentId` or `background_task_created` event exists, when runtime execution state is projected, then it reports no started agent jobs.
- Given a real `background_task_created` event for each created job, when runtime execution state is projected, then it reports those jobs as started.
- Given a model emits the `Agent` tool without a `background` argument, when the tool executes, then it starts a background job and returns immediately with an `agentId`.
- Given a model emits the `Agent` tool with `background: false`, when the tool executes, then it uses the explicit foreground/wait path.
- Given the `Agent` tool schema is exposed, when its description is inspected, then it states that real subagent execution requires calling the tool and parallel roles require multiple same-turn tool calls, without exposing tag-shaped execution examples.
- Given a CLI session is created, when it is persisted, then the record is written under project `.robota/sessions` and includes provider messages, UI history, the exact system prompt, and registered tool schemas.
- Given diagnostic logs are inspected, when the session has run, then `session_init`, `pre_run`, and `assistant` events contain full prompt/input/history/response data instead of only lengths or truncated assistant text.

### Integration Tests

- In TUI flow, submit `/agent parallel ...` and verify visible background rows appear while the prompt remains usable.
- In headless text mode, submit `/agent general-purpose "..."` and verify the command returns an agent ID immediately.
- In `stream-json`, submit `/agent parallel` and verify background task events are emitted.
- Submit a natural-language explicit parallel-agent request with a test model that calls the command execution tool and verify jobs start before runtime-owned status reports execution.

### Verification Commands

```bash
pnpm --filter @robota-sdk/agent-sdk test
pnpm --filter @robota-sdk/agent-cli test
pnpm --filter @robota-sdk/agent-runtime test
pnpm --filter @robota-sdk/agent-transport-headless test
pnpm --filter @robota-sdk/agent-transport-ws test
pnpm harness:scan
pnpm harness:verify -- --scope packages/agent-sdk --base-ref origin/develop
pnpm harness:verify -- --scope packages/agent-cli --base-ref origin/develop
```

## Acceptance Criteria

- Operational guidance is not hardcoded in `system-prompt-builder`; it is supplied by owner section providers and descriptors.
- Startup prompt context includes model-visible capability descriptors sourced from registries.
- `/agent` exists as an injected CLI default command with user-visible and model-visible metadata.
- SDK core can be assembled without the agent command module.
- `/agent PROMPT` starts an actual background agent and returns an `agentId`.
- `/agent parallel` starts multiple background agents before waiting for any result.
- Natural-language requests for agent execution can succeed when the model selects the command execution tool from registered descriptors.
- Robota-owned execution state cannot report background agents as running unless runtime evidence exists.
- Existing `Agent` tool behavior remains compatible for model-initiated delegation.
- Project-local `.robota/sessions` and `.robota/logs` contain enough raw data to debug prompt composition and restore session context, including command descriptors such as `/agent` and the `ExecuteCommand` tool schema when injected.
