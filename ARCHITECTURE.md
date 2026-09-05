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
│  Runtime host    agent-framework buildRuntimeSession /      │
│                  startRuntimeHost (robota --serve seam)     │
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
│                  packages/agent-cli-web (CLI monitor SPA);          │
│                  apps/agent-app (Electron desktop GUI)      │
│  Remote          agent-remote-client                        │
└────────────────────────────────────────────────────────────┘
```

> **Type contracts are being decomposed (ARCH-100 · issue #2080).** `agent-interface-transport` is
> named for transport but currently owns eleven contract families — session, command, workspace,
> execution, analytics and more — and 15 packages reach it for session contracts alone. The
> contract-family **owner map**, the proven-acyclic target graph, and the migration order live in
> [`.agents/project-structure.md`](.agents/project-structure.md) § Interface Package Rule and are
> enforced by the `interface-family-owner` scan. The box above lists the packages that exist **today**;
> the five new owners appear in it as their migration leaves (the leaves from issue #2108 through issue #2113) land.

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

## Dependency and interface rule identifiers

Each identifier below is the tag a harness scan prints in its finding (`[FORBIDDEN-DEP] …`). A rule
that is enforced and stated nowhere can only be tripped over — never complied with deliberately,
cited, or amended — so every emitted identifier has exactly one normative sentence here. The
`rule-statement-floor` scan (`scan-rule-statement-floor.mjs`) fails when a scan emits an identifier
no normative document states. Package placement and the layer diagram these rules police are owned
by [`.agents/project-structure.md`](.agents/project-structure.md); this list states the rules only.

- `FORBIDDEN-DEP` — a production dependency edge listed as forbidden (each entry carries its reason)
  may not appear in the depending package's `dependencies`; the list is empty today, and the rule
  exists so that a future entry is refused by the scan rather than by review.
  Enforced by: `deps` (`check-dependency-direction.mjs`)
- `CORE-ZERO-DEPS` — the foundation package (`agent-core`) has no production dependency on any other
  `@robota-sdk/agent-*` package; a dependency from the bottom of the layer diagram to a package above
  it is a cycle through the foundation.
  Enforced by: `deps` (`check-dependency-direction.mjs`, rule 3)
- `PLUGIN-LAYER` — an `agent-plugin-*` package may depend, among `@robota-sdk/*` packages, only on the
  set `internalDeps.pluginLayerAllowed` declares in `.agents/harness.config.json` (today:
  `agent-core`): plugins register with the foundation and never reach into the framework above it.
  Enforced by: `deps` (`check-dependency-direction.mjs`, rule 4)
- `FAMILY-SIBLINGS` — the package name hierarchy is the dependency detector (패키지 이름 계층 참조 규칙):
  an `agent-<family>-<child>` package (family = the second dash segment) may depend on its parent
  `agent-<family>` and on lower families, never on a sibling `agent-<family>-<other>` at any depth
  (`agent-transport-webrtc-web` is a sibling of `agent-transport-ws`); the bare parent never depends
  on a child; and the composer/foundation (`agent-framework`, `agent-core`) never depends on a
  transport or UI child (`agent-transport-*`, `agent-ui-*`). Code two siblings share belongs in the
  parent (or a parent subpath) — never in a sibling-named substrate (`-common`, `-shared`,
  `-protocol`, `-defaults`, `-builtin`). Judged over `dependencies` + `peerDependencies`; the
  `agent-interface-*` family is judged once, by `INTERFACE-DEPS`. Sibling edges that predate the rule
  are frozen shrink-only in `scripts/harness/family-sibling-baseline.json`; a stale entry is a finding.
  Enforced by: `deps` (`check-dependency-direction.mjs`, rule 11)
- `UNDECLARED-IMPORT` — every `@robota-sdk/*` workspace package a production source file imports is
  declared in one of the importing package's `dependencies`, `peerDependencies` or
  `devDependencies`; "undeclared" is absence from all three, so a manifest rule such as
  `FAMILY-SIBLINGS` cannot be walked around by an import the manifest never names.
  Enforced by: `deps` (`check-dependency-direction.mjs`, rule 12)
- `INTERFACE-DEPS` — an `agent-interface-*` package depends only on `agent-core` and on a LOWER-layer
  peer interface package, never on an implementation package; the layer table is
  `.agents/specs/contract-family-owner-map.md` and the full statement is
  `.agents/project-structure.md` § Interface Package Rule.
  Enforced by: `deps` (`check-dependency-direction.mjs`, rule 5)
- `DAG-NODES-LEAF` — a `dag-node-*` leaf package may depend, among `dag-*` packages, only on the
  node-contract owners `dag-core` and `dag-node` — never on an orchestrator/runtime/adapter layer
  and never on a sibling `dag-node-*`, so a node stays composable by any orchestrator.
  Enforced by: `deps` (`check-dependency-direction.mjs`, rule 7)
- `DEV-CYCLE` — the full workspace graph over `dependencies` + `devDependencies` +
  `peerDependencies` is acyclic; a dev-only edge that closes a cycle is refused because the build
  order it implies has no valid topological sort.
  Enforced by: `deps` (`check-dependency-direction.mjs`)
- `ENTRY-POINT-ONLY` — a guarded composition aggregator (a package whose entry statically pulls a
  whole catalog, e.g. the default DAG node set or the default tool set) may be imported STATICALLY only
  by an application entry point (`apps/*`) or a package sanctioned by name in the scan's
  `GUARDED_AGGREGATORS` table; a mid-layer library reaches it only through a dynamic `import()`.
  Enforced by: `deps` (`check-dependency-direction.mjs`, rule 8)
- `PACKAGE-NAME` — the canonical architecture documents (`architectureDocs` in
  `.agents/harness.config.json`, plus every `packages/*/docs/SPEC.md`) reference only real workspace
  package names; a scoped name that resolves to no package is drift unless its line is marked
  "planned".
  Enforced by: `deps` (`check-dependency-direction.mjs`, rule 9)
- `RE-EXPORT` — no package barrel re-exports another workspace package wholesale
  (`export * from '<scope>/<other>'`); a public surface is owned, not forwarded.
  Enforced by: `deps` (`check-dependency-direction.mjs`, rule 2)
- `INTERFACE-IMPORT` — an implementation package imports a contract the interface package exports
  from that interface package, never through `@robota-sdk/agent-framework`; the full statement is
  `.agents/project-structure.md` § Interface Package Rule.
  Enforced by: `interface-imports` (`check-interface-imports.mjs`)

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
