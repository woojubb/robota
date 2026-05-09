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
│  Playground      │ │   (Cloudflare Pages)  │
│  (Next.js)       │ │                       │
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
┌──────────────────────────────────────────┐
│              SDK Packages                │
│                                          │
│  agent-core / auth / credits             │
│  agent-sessions / agent-runtime          │
│  agent-sdk / agent-command-*             │
│  agent-tools / agent-tool-mcp            │
│  agent-transport-* / agent-provider-*    │
│  agent-plugin-* / agent-team             │
│  agent-playground / agent-remote-client  │
│  agent-event-service                     │
└──────────────────────────────────────────┘
```

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
