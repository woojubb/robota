# Agent CLI Composition Architecture Map

Source-verified against `develop` on 2026-05-07.

This file is the stable router for the `@robota-sdk/agent-cli` architecture slice. Detailed CLI
composition content is split under [agent-cli/](agent-cli/) so readers can load only the relevant
area. Package `SPEC.md` files remain the source of truth for ownership contracts.

## Reading Order

1. Read [agent-cli/target-architecture.md](agent-cli/target-architecture.md) before changing package dependencies, owner boundaries, SDK facades, provider edges, or runtime adapter ownership.
2. Read [agent-cli/composition-tree.md](agent-cli/composition-tree.md) before changing `startCli()`, provider/module composition, TUI hook composition, or print-mode startup.
3. Read [agent-cli/commands-and-provider-flow.md](agent-cli/commands-and-provider-flow.md) before changing built-in commands, `/provider`, `/model`, provider setup, profile switching, or model catalog flow.
4. Read [agent-cli/execution-modes.md](agent-cli/execution-modes.md) before changing interactive TUI behavior, headless print mode, transports, or execution flags.
5. Read [agent-cli/class-interface-inventory.md](agent-cli/class-interface-inventory.md) before changing class/interface ownership or moving contracts across CLI, SDK, command packages, providers, runtime, sessions, tools, or core.
6. Read [agent-cli/layering-audit.md](agent-cli/layering-audit.md) before resolving or adding CLI layer audit findings.
7. Use [../ARCHITECTURE-MAP.md](../ARCHITECTURE-MAP.md) as the repo-wide architecture router before changing package boundaries outside the CLI detail path.

## Document Tree

```text
.agents/specs/architecture-map/
├── agent-cli-composition.md      # this router
└── agent-cli/
    ├── README.md                 # CLI architecture submap index
    ├── target-architecture.md    # target ownership model and package graph
    ├── composition-tree.md       # concrete startup and render tree
    ├── commands-and-provider-flow.md
    ├── execution-modes.md
    ├── class-interface-inventory.md
    └── layering-audit.md
```

## Repository Architecture Relationship

This map is the companion detail router for the `@robota-sdk/agent-cli` startup path, TUI hooks,
command-layer inventory, and CLI-specific audits. The repository-wide architecture router lives at
[../ARCHITECTURE-MAP.md](../ARCHITECTURE-MAP.md) and routes to the broader agent, DAG, MCP, app,
and deployment structure documents.

If a future CLI feature integrates DAG orchestration or MCP behavior, update this CLI router and the
relevant repository architecture subdocument in the same PR.

## Governance and Update Policy

Update the smallest relevant file under [agent-cli/](agent-cli/) in the same PR whenever a change
affects any of these:

- `packages/agent-cli/src/cli.ts` composition of providers, command modules, transports, or runtime adapters;
- `packages/agent-cli/src/ui/hooks/useInteractiveSession.ts`, `useSlashRouting.ts`, or `useSideEffects.ts`;
- a new or removed `@robota-sdk/agent-command-*` module in the default CLI product;
- provider setup, provider switching, model catalog, or model switching flow;
- interactive vs non-interactive execution mode flags or transport behavior;
- package dependencies among CLI, SDK, command packages, provider packages, runtime, sessions, tools, or core;
- any future CLI composition of DAG/MCP/deployment capabilities.

Before merging a CLI architecture change, check this router, the relevant subdocument, and the
owning package `SPEC.md` files for boundary drift.
