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
│   apps/web       │ │   apps/dag-studio     │
│   Agent          │ │   DAG Designer        │
│   Playground     │ │   (Next.js, port 3002)│
│   (Next.js)      │ │                       │
└──────┬───────────┘ └──────┬────────────────┘
       │                    │
       ▼                    ▼
┌──────────────────┐ ┌───────────────────────┐
│ apps/agent-server│ │ apps/dag-orchestrator- │
│ AI Provider Proxy│ │ server                │
│ + WebSocket      │ │ Robota API Gateway    │
│ (Express)        │ │ (Express, cost/auth)  │
└──────┬───────────┘ └──────┬────────────────┘
       │                    │
       │                    ▼
       │             ┌───────────────────────┐
       │             │ apps/dag-runtime-     │
       │             │ server                │
       │             │ ComfyUI-compatible    │
       │             │ Prompt API (Express)  │
       │             └───────────────────────┘
       │
       ▼
┌──────────────────────────────────────────┐
│              SDK Packages                │
│                                          │
│  agents / anthropic / openai / google    │
│  sessions / team / workflow / remote     │
│  playground                              │
└──────────────────────────────────────────┘
```

## DAG Subsystem Architecture

```
dag-core          ← SSOT: interfaces, types, state machines, execution engine
  ↑
dag-cost          ← Cost domain: CEL evaluator, cost meta types, storage port
dag-adapters-local← Local adapters: in-memory ports + file-based storage
dag-node          ← Node infrastructure: base class, IO, registries, schemas
  ↑
dag-nodes/*       ← Concrete node implementations (10 packages)
dag-orchestrator  ← Orchestration layer: cost, retry, auth policies
dag-runtime       ← Runtime: execution engine, state transitions
dag-worker        ← Worker: node execution, resource management
dag-scheduler     ← Scheduler: execution ordering, parallelism
dag-projection    ← Read-model: event projection, query views
dag-api           ← Composition: API surface assembly
dag-designer      ← Web designer: React Flow canvas, node catalog
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
