# Agent Invocation Router Specification

Status: Proposed
Created: 2026-05-01
Related specs:

- `.agents/specs/background-task-layer.md`
- `.agents/specs/subagent-process-manager.md`

## Scope

This specification defines how Robota turns user intent, slash commands, built-in command metadata, skills, and model-callable tools into deterministic agent invocation behavior.

The goal is to prevent the assistant from merely describing agent execution when the user requested actual subagent execution. Robota must have a command and routing layer that can start, inspect, steer, stop, and close agent jobs without relying only on the model deciding to call the `Agent` tool.

This spec spans `agent-sdk`, `agent-cli`, `agent-runtime`, `agent-sessions`, and transport packages because the feature touches command registry metadata, prompt/context assembly, interactive routing, runtime background task creation, TUI projection, and non-interactive/headless behavior.

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

Robota currently has working background/subagent runtime pieces, but agent invocation still depends too much on model discretion.

Observed failure mode:

1. The user asks for developer and designer subagents to analyze work in parallel.
2. The assistant describes the plan and claims agents are running.
3. No `Agent` tool call is emitted.
4. No `background_task_created` event appears.
5. No background task row appears in the TUI.

This is a product bug even if the model is weak at tool calling. If Robota exposes agent execution as a user-facing capability, explicit user commands must have a deterministic execution path.

## Design Principles

- Project instruction context and capability metadata are separate.
- `AGENTS.md`, `CLAUDE.md`, and equivalent memory files define persistent project guidance. They are not the owner of built-in command behavior.
- `system-prompt-builder` must not hardcode operational guidance. It may compose sections supplied by instruction, command, skill, tool, provider, permission, and agent registries, but it must not author behavior text itself.
- Built-in commands, skills, model-callable tools, and agent definitions must each have owner-provided descriptors.
- The first model turn may include capability descriptors, but those descriptors must come from registries, not hand-written feature sections in a generic prompt builder.
- Side-effectful or explicitly requested command behavior must have a deterministic handler before the model is allowed to improvise.
- The assistant must not claim an agent is running unless Robota has observed an `agentId`, `background_task_created`, or equivalent runtime event.

## Context Assembly Model

Robota startup context is assembled from owner-provided sources.

| Source                 | Owner                                                     | Loaded when                              | Purpose                                                                     |
| ---------------------- | --------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| Project instructions   | `AGENTS.md`, `CLAUDE.md`, `.robota`/future config readers | Session startup or path-scoped discovery | Persistent repository guidance and rules                                    |
| Runtime descriptors    | SDK/session/runtime configuration                         | Before the first user prompt             | Current cwd, provider/model, language, permission mode, and trust metadata  |
| Command descriptors    | Built-in and plugin command registries                    | Before the first user prompt             | Short descriptions of available slash commands and model-invocable commands |
| Skill descriptors      | `SkillCommandSource` and plugin skill sources             | Before the first user prompt             | Short descriptions that help the model decide whether a skill is relevant   |
| Tool descriptors       | Tool registry entries                                     | Before the first user prompt             | Short descriptions and safety metadata for model-callable tools             |
| Agent descriptors      | Built-in and custom agent registries                      | Before the first user prompt             | Short descriptions of available subagent identities and expertise           |
| Provider capabilities  | Active provider adapter                                   | Before the first user prompt             | Provider-owned capability notes such as web search/fetch/tool availability  |
| Framework instructions | Versioned Robota instruction source                       | Before the first user prompt             | Minimal product-level role and interaction contract                         |

Full command, skill, or agent bodies must not be dumped into the startup prompt unless the corresponding feature explicitly requires preloading. Descriptions are the default model-visible surface.

No source should be represented by ad hoc text inside a generic prompt builder. Each source must expose a descriptor or instruction section owned by the package that owns the behavior.

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

## `/agent` Built-In Command

Robota MUST add `/agent` as a built-in command. It is command-like in the UI and skill-like in metadata because it has a descriptor that can be shown to the model, but its execution is coded in the SDK/CLI command handler.

Recommended descriptor:

```text
/agent — Start, inspect, steer, stop, and close subagent jobs. Use this when the user explicitly asks to create, spawn, delegate to, run, or manage agents, especially for parallel or background work.
```

### Required Subcommands

| Command                                    | Behavior                                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `/agent list`                              | List available agent definitions and active/terminal agent jobs.                                     |
| `/agent run <agent> <prompt>`              | Run one agent in foreground mode and return its result.                                              |
| `/agent run <agent> --background <prompt>` | Spawn one background agent and return `agentId` immediately.                                         |
| `/agent parallel <spec>`                   | Spawn multiple background agents from a structured spec and return all `agentId` values immediately. |
| `/agent read <agentId> [offset]`           | Read retained transcript/log output for an agent job.                                                |
| `/agent send <agentId> <prompt>`           | Send follow-up input to a running/open agent when supported.                                         |
| `/agent stop <agentId> [reason]`           | Cancel a running/queued agent job.                                                                   |
| `/agent close <agentId>`                   | Close a terminal agent job.                                                                          |
| `/agent open <agentId>`                    | Switch or focus the TUI agent thread/detail view when the TUI supports it.                           |

`/background` remains the generic task manager command. `/agent` is the agent-specific control surface and may delegate task reads/cancel/close to the shared background task registry.

### Parallel Invocation Syntax

The first implementation should support a simple deterministic syntax:

```text
/agent parallel \
  developer=general-purpose:"Analyze implementation risks for DAG-BL-011" \
  designer=Plan:"Analyze architecture boundaries for DAG-BL-011" \
  --background
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

`parallel` MUST spawn all valid jobs before waiting for any result. It MUST return created job IDs immediately when `--background` is present.

## Natural-Language Agent Intent Router

Robota SHOULD add a pre-model intent router for explicit agent requests. This router runs after slash command parsing and before sending a normal prompt to the model.

The router does not replace the model. It only handles explicit user requests that would be misleading if no agent job is created.

### Positive Signals

The router may trigger when the user prompt contains explicit intent such as:

- "create/spawn/run/call/use an agent"
- "developer agent and designer agent"
- "subagent"
- "parallel agents"
- "background agents"
- `@agent-name`-style forced invocation if Robota adopts that syntax

### Negative Signals

The router must not trigger when:

- the user asks conceptually how agents work;
- the user asks for a plan only;
- the target agent names are ambiguous and no default mapping is safe;
- the request would require write-capable background work without an explicit permission/isolation policy.

### Router Outcomes

| Outcome              | Behavior                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| Deterministic route  | Convert the user input into `/agent run` or `/agent parallel` and execute the command handler. |
| Clarification needed | Ask a concise question for missing agent names, target task, or foreground/background mode.    |
| No route             | Send the prompt to the model unchanged.                                                        |

When the router triggers, the assistant response must be grounded in actual command results, not speculative text.

## Model-Callable `Agent` Tool

The `Agent` tool remains necessary for model-initiated delegation. It must continue to support:

- `prompt`
- `subagent_type`
- `model`
- `background`
- `isolation`

But the `Agent` tool is no longer the only path for user-requested agent execution. Explicit slash commands and router-selected command handlers may call runtime APIs directly.

The model-visible `Agent` tool description should stay concise and tool-local. Broader instructions about `/agent` command usage must come from command descriptors.

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
- Agent text must come from agent definitions and the `/agent` command descriptor.
- Tests must be able to prove that a new capability can appear in the system prompt by registering a descriptor, without editing the composer.

Required refactor:

- Remove hardcoded role, permission, web search, tool, skill, and subagent prose from `system-prompt-builder`.
- Introduce section providers for framework instructions, project instructions, runtime metadata, permission metadata, provider capabilities, command descriptors, skill descriptors, tool descriptors, and agent descriptors.
- Render `/agent`, skills, tools, and agent definitions from their registries through `ICapabilityDescriptor` or `ISystemPromptSection` providers.
- Keep project instructions loaded from `AGENTS.md`/`CLAUDE.md` before capability metadata unless an explicit section priority says otherwise.
- Make the composer deterministic and side-effect free so it can be unit-tested with synthetic section providers.

## Runtime Execution Contract

The `/agent` command handler and intent router MUST execute through the same runtime stack as the `Agent` tool:

```text
Command/Router
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

## Assistant Claim Guard

Robota MUST prevent false execution claims.

If a user asks to run agents and the assistant says agents are running, one of these must be true:

- an `Agent` tool call completed with `background: true` and returned an `agentId`;
- `/agent run --background` or `/agent parallel --background` returned one or more `agentId` values;
- a `background_task_created` event was observed for each claimed job.

If none of those occurred, Robota must either:

- execute the deterministic command route; or
- report that no agent was started and ask for missing parameters.

This guard should be testable without calling a real model.

## TUI Requirements

The TUI should keep React/Ink components thin:

- input text is routed through a pure command/intent flow before model submission;
- `/agent` command results update the same background task projection used by `BackgroundTaskPanel`;
- active agent jobs can be inspected with `/agent list`, `/agent read`, and future thread-focus UI;
- completed clean background jobs may leave the always-visible panel according to `.agents/specs/background-task-layer.md`, but remain accessible through command APIs.

## Headless and Transport Requirements

Headless and protocol transports must expose deterministic agent invocation without depending on TUI input parsing.

Required behavior:

- headless prompt beginning with `/agent` executes the command handler;
- structured transport clients can request agent run/list/read/stop/close operations;
- `stream-json` includes background task events for agent jobs;
- failure responses include explicit errors when a requested agent was not started.

## Security and Permission Policy

Agent invocation can amplify side effects because multiple workers can run concurrently.

Rules:

- Background write-capable agent work should default to worktree isolation when available.
- Background agents inherit the current permission mode and allowlist, but fresh approval requests from background threads must be source-attributed.
- If a fresh approval cannot be surfaced in the active UI or transport, the background action must fail closed.
- The router must not silently start write-capable parallel agents from ambiguous prompts.
- `/agent parallel` must have a configurable max jobs limit and respect `BackgroundTaskManager.maxConcurrent`.

## Implementation Plan

1. Add `ISystemPromptSection` and `ICapabilityDescriptor` models plus registry projections in `agent-sdk`.
2. Replace `system-prompt-builder` with a data-driven prompt composer and move existing hardcoded role, permission, web search, tool, skill, and subagent prose into owner-provided section/descriptor providers.
3. Add a built-in `/agent` command descriptor and command handler in the SDK command layer.
4. Add `InteractiveSession` APIs that let command handlers spawn/list/read/send/stop/close agent jobs through the existing runtime manager.
5. Add `/agent run` and `/agent parallel` parsers with deterministic background spawn behavior.
6. Add a pure natural-language agent intent router for explicit agent execution requests.
7. Wire CLI/TUI prompt flow through the router before normal model submission.
8. Add assistant claim guard tests that fail when a response claims agent execution without a runtime event or returned `agentId`.
9. Update package SPEC files after code matches this cross-cutting spec.

## Test Plan

### Unit Tests

- Given synthetic prompt sections, when startup context is built, then the composer orders and joins the supplied sections without adding behavioral text of its own.
- Given framework, permission, provider, command, skill, tool, and agent section providers, when startup context is built, then each section's content appears from its owner provider.
- Given a new capability descriptor is registered, when startup context is built, then the capability appears without editing the composer.
- Given no agents are configured, when startup context is built, then no subagent-specific section is rendered.
- Given the composer source is scanned, then it contains no hardcoded instructions for role behavior, web search, permissions, tools, skills, slash commands, or agents.
- Given `/agent run Plan --background "draft architecture"`, when the command executes, then `SubagentManager.spawn()` receives `mode: "background"` and the command returns an `agentId` without awaiting completion.
- Given `/agent parallel developer=general-purpose:"x" designer=Plan:"y" --background`, when the command executes, then two background jobs are spawned before any wait path is called.
- Given an explicit natural-language request to run two named agents in parallel, when the router handles it, then it returns a deterministic `/agent parallel` route instead of sending the prompt directly to the model.
- Given an ambiguous request to "think about agents", when the router handles it, then it does not route.
- Given a response claims "agents are running" but no `agentId` or `background_task_created` event exists, when the claim guard runs, then it reports a violation.
- Given a real `background_task_created` event for each claimed job, when the claim guard runs, then it allows the response.
- Given a model emits the `Agent` tool with `background: true`, when the tool executes, then existing background runtime behavior remains unchanged.

### Integration Tests

- In TUI flow, submit `/agent parallel ... --background` and verify visible background rows appear while the prompt remains usable.
- In headless text mode, submit `/agent run general-purpose --background "..."` and verify the command returns an agent ID immediately.
- In `stream-json`, submit `/agent parallel` and verify background task events are emitted.
- Submit a natural-language explicit parallel-agent request and verify the pre-router starts jobs before any assistant text claims execution.

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
- `/agent` exists as a built-in command with user-visible and model-visible metadata.
- `/agent run --background` starts an actual background agent and returns an `agentId`.
- `/agent parallel --background` starts multiple background agents before waiting for any result.
- Explicit natural-language requests for agent execution can route deterministically without relying on model tool-call compliance.
- The assistant cannot claim background agents are running unless runtime evidence exists.
- Existing `Agent` tool behavior remains compatible for model-initiated delegation.
