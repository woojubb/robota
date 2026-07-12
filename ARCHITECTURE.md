# Architecture — Robota Monorepo

High-level system architecture for the Robota AI Agent SDK monorepo.

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│                        Clients                          │
│   (Browser, CLI, MCP Server, External API consumers)    │
└──────────┬──────────────────┬───────────────────────────┘
           │                  │
           ▼                  ▼
┌──────────────────┐ ┌───────────────────────┐
│  apps/agent-web  │ │   apps/docs           │
│  Agent           │ │   Documentation site  │
│  Playground      │ │   (Next.js static     │
│  (Next.js)       │ │   export)             │
└──────┬───────────┘ └───────────────────────┘
       │
       │              ┌───────────────────────┐
       │              │   apps/blog           │
       │              │   Blog site           │
       │              │   (Cloudflare Pages)  │
       │              └───────────────────────┘
       ▼
┌──────────────────┐
│ apps/agent-server│
│ AI Provider Proxy│
│ + WebSocket      │
│ (Express)        │
└──────┬───────────┘
       │
       ▼
┌────────────────────────────────────────────────────────────┐
│                       SDK Packages                          │
│  See .agents/project-structure.md for the SSOT inventory.    │
│                                                              │
│  Domain          agent-core (auth, credits planned)         │
│  Assembly        agent-framework                            │
│  Runtime/Session agent-session / agent-executor             │
│  Preset/Options  agent-preset                               │
│  Commands/CLI    agent-command / agent-cli                  │
│  Subagents       agent-subagent-runner                      │
│  Tools           agent-tools / agent-tool-mcp               │
│  Transports      agent-transport (headless/testing core);   │
│                  standalone: agent-transport-{tui,http,      │
│                  ws,mcp}                                     │
│  Type contracts  agent-interface-transport /                │
│                  agent-interface-tui                         │
│  Providers       agent-provider                             │
│  Plugins         agent-plugin                               │
│  Playground      agent-playground                           │
│  GUI/Web         agent-transport-gui (GUI core);            │
│                  agent-transport-webrtc-web (browser peer); │
│                  apps/agent-web-monitor (CLI SPA)           │
│  Remote          agent-remote-client                        │
└────────────────────────────────────────────────────────────┘
```

> **DAG / workflow subsystem.** The `dag-*` and `agent-command-workflows` packages are private and
> not published on their own. They are bundled into `@robota-sdk/agent-cli` (INFRA-028) and surfaced
> to users through the `/workflows` command (e.g. `/workflows create "<natural language>"`). The
> diagram above stays agent-SDK-focused; the workflow engine ships as part of the CLI bundle.

## Key Architectural Decisions

- **Strict one-way dependency direction** — No bidirectional production dependencies. No pass-through re-exports.
- **Runtime/Orchestrator separation** — Runtime API mirrors ComfyUI (immutable). Only Orchestrator API is Robota-owned and modifiable.
- **Ports and adapters** — Core packages define port interfaces. Adapters implement them. No direct infrastructure coupling.
- **Spec-first development** — Every contract boundary change requires a SPEC.md update before implementation.
- **No fallback policy** — Terminal failures stay terminal. No silent recovery or degraded modes.

## Detailed Documentation

| Topic                                | Document                                                       |
| ------------------------------------ | -------------------------------------------------------------- |
| Agent guidelines and routing         | [`AGENTS.md`](AGENTS.md)                                       |
| Package listing and dependency rules | [`.agents/project-structure.md`](.agents/project-structure.md) |
| Mandatory rules                      | [`.agents/rules/`](.agents/rules/)                             |
| Skills and workflows                 | [`.agents/skills/`](.agents/skills/)                           |
| Package contracts                    | `packages/*/docs/SPEC.md`                                      |
| App specifications                   | `apps/*/docs/SPEC.md`                                          |
| Design documents                     | [`.design/`](.design/)                                         |
