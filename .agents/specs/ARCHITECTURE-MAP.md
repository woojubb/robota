# System Architecture Map

Source-verified against `develop` on 2026-05-07. This file is the stable router for repository
architecture. Detailed architecture content lives under [architecture-map/](architecture-map/).

Package `docs/SPEC.md` files remain the owner contracts for each package. Architecture-map
subdocuments explain cross-package structure, dependency direction, deployment topology, and durable
architecture lessons without duplicating package-level contract truth.

## Reading Order

1. Start with [architecture-map/README.md](architecture-map/README.md) for the full document tree.
2. Read [architecture-map/repository-overview.md](architecture-map/repository-overview.md) for package family orientation.
3. Read [architecture-map/dependency-direction.md](architecture-map/dependency-direction.md) before adding, removing, or moving a package edge.
4. Read [architecture-map/agent-system.md](architecture-map/agent-system.md) before changing agent runtime, SDK, commands, providers, transports, playground, or remote execution.
5. Read [architecture-map/agent-cli-composition.md](architecture-map/agent-cli-composition.md) before changing the concrete `agent-cli` startup path, TUI hooks, provider/model flow, or execution modes; it routes to focused files under `architecture-map/agent-cli/`.
6. Read [architecture-map/apps-and-deployment.md](architecture-map/apps-and-deployment.md) before changing app hosting, docs build, or deploy behavior.
7. Read [architecture-map/cross-cutting-contracts.md](architecture-map/cross-cutting-contracts.md) before changing shared command, provider, auth, credits, event, session, background, or verification contracts.
8. Read [architecture-map/architecture-lessons.md](architecture-map/architecture-lessons.md) before resolving or adding architecture audit findings.

## Document Tree

```text
.agents/specs/
├── ARCHITECTURE-MAP.md                  # this router and reading guide
└── architecture-map/
    ├── README.md                        # map index and update policy
    ├── repository-overview.md           # package/app family orientation
    ├── dependency-direction.md          # layer ownership and target dependency rules
    ├── agent-system.md                  # agent stack and playground boundaries
    ├── agent-cli-composition.md         # CLI architecture router
    ├── agent-cli/                       # CLI target, composition, command, provider, mode, inventory, and audit slices
    ├── apps-and-deployment.md           # app/service/docs deployment topology
    ├── cross-cutting-contracts.md       # contract owner index and shared boundaries
    └── architecture-lessons.md          # resolved audits and durable update policy
```

## Distribution Policy

Architecture maps are intentionally split by architecture ownership. The earlier preference to keep
all architecture detail in one file is withdrawn for this map family.

- Keep this file concise and stable as the repository architecture entrypoint.
- Put subsystem details in the smallest relevant file under [architecture-map/](architecture-map/).
- Add a new subdocument only when an existing architecture slice becomes too large or mixes unrelated ownership areas.
- Link to package-owned `packages/*/docs/SPEC.md` files instead of duplicating package contracts.
- Package-local architecture map files may remain as short routers when detailed content is grouped here.

## Update Requirement

Update the relevant architecture-map subdocument in the same PR whenever a change affects any of
these:

- cross-package dependency direction among agent, app, or docs packages;
- a new product shell, transport, CLI, MCP server, HTTP client, or deployment boundary;
- movement of an owner contract between packages;
- package composition, execution mode, or class/interface ownership documented in a package-local map;
- an architecture decision that cannot be described accurately inside one package `SPEC.md`.

Before merging a system architecture change, use [architecture-map/architecture-lessons.md](architecture-map/architecture-lessons.md)
for the current audit and verification checklist.
