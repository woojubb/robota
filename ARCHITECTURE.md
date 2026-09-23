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
│                                                              │
│  Domain          agent-core (auth, credits planned)         │
│  Assembly        agent-framework                            │
│  Runtime host    agent-framework buildRuntimeSession /      │
│                  startRuntimeHost (robota --serve seam)     │
│  Runtime/Session agent-session / agent-executor             │
│  Preset/Options  agent-preset                               │
│  Commands/CLI    agent-command / agent-cli                  │
│  Subagents       agent-subagent-runner                      │
│  Tools/MCP       agent-tools / agent-mcp                    │
│  Transports      agent-framework (headless/registry hosts);   │
│                  standalone: agent-transport-{http,ws,mcp};  │
│                  presentation: agent-ui-terminal             │
│  Type contracts  agent-interface-transport /                │
│                  agent-interface-tui                         │
│  Providers       agent-provider                             │
│  Plugins         agent-plugin                               │
│  Playground      agent-playground                           │
│  GUI/Web         agent-ui-web (GUI core);            │
│                  agent-transport-webrtc-web (browser peer); │
│                  packages/agent-cli-web (CLI monitor SPA);          │
│                  apps/agent-app (Electron desktop GUI)      │
│  Remote          agent-remote-client                        │
└────────────────────────────────────────────────────────────┘
```

> **Type contracts are being decomposed (ARCH-100 · issue #2080).** `agent-interface-transport` is
> named for transport but currently owns eleven contract families — session, command, workspace,
> execution, analytics and more — and 15 packages reach it for session contracts alone. The box above
> lists the packages that exist **today**; the five new owners appear in it as their migration leaves
> (the leaves from issue #2108 through issue #2113) land.

> **DAG / workflow subsystem.** The `dag-*` and `agent-command-workflows` packages are private and
> not published on their own. The code used by the CLI's `/workflows` path is bundled into
> `@robota-sdk/agent-cli` (INFRA-028): its local runtime exposes the 23-node synchronous base
> catalog plus saved instant nodes. The private async workspace catalog can reach 29 nodes when
> all optional loaders succeed; it is not a CLI capability. The diagram above stays
> agent-SDK-focused; the workflow engine ships in the CLI.
> DAG-specific MCP servers and the external-MCP workflow node are removed by issue #2817;
> the default `/workflows` node catalog is unchanged.

## Key Architectural Decisions

- **Strict one-way dependency direction** — No bidirectional production dependencies. No pass-through re-exports.
- **Runtime/Orchestrator separation** — Runtime API mirrors ComfyUI (immutable). Only Orchestrator API is Robota-owned and modifiable.
- **Ports and adapters** — Core packages define port interfaces. Adapters implement them. No direct infrastructure coupling.
- **Spec-first development** — Every contract boundary change requires a SPEC.md update before implementation.
- **No fallback for required capabilities** — Terminal failures stay terminal. Optional discovery may
  omit absent nodes; the private async DAG catalog currently skips any media/skill import or
  construction failure, so callers requiring those nodes inject them explicitly.

## Dependency and interface rule identifiers

The identifiers below name architecture boundaries. The former broad dependency scans were removed
by the minimal-harness reset; no bundle-source graph gate currently exists. This list is not a claim
that each boundary has an automated gate. Package placement and dependency direction are shown in
the System Overview diagram above. Current checks are defined in `AGENTS.md` and CI.

- `FORBIDDEN-DEP` — a production dependency edge listed as forbidden (each entry carries its reason)
  may not appear in the depending package's `dependencies`; the list is empty today. A future
  restriction needs an explicit owner and a check justified under the minimal-harness policy.
- `CORE-ZERO-DEPS` — the foundation package (`agent-core`) has no production dependency on any other
  `@robota-sdk/agent-*` package; a dependency from the bottom of the layer diagram to a package above
  it is a cycle through the foundation.
- `PLUGIN-LAYER` — an `agent-plugin-*` package may depend, among `@robota-sdk/*` packages, only on the
  allowed set (today: `agent-core`): plugins register with the foundation and never reach into the
  framework above it.
- `FAMILY-SIBLINGS` — the package name hierarchy is the dependency detector (패키지 이름 계층 참조 규칙):
  an `agent-<family>-<child>` package (family = the second dash segment) may depend on its parent
  `agent-<family>` and on lower families, never on a sibling `agent-<family>-<other>` at any depth
  (`agent-transport-webrtc-web` is a sibling of `agent-transport-ws`); the bare parent never depends
  on a child; and the composer/foundation (`agent-framework`, `agent-core`) never depends on a
  transport or UI child (`agent-transport-*`, `agent-ui-*`). Code two siblings share belongs in the
  parent (or a parent subpath) — never in a sibling-named substrate (`-common`, `-shared`,
  `-protocol`, `-defaults`, `-builtin`). Judged over `dependencies` + `peerDependencies`; the
  `agent-interface-*` family is judged once, by `INTERFACE-DEPS`.
- `UNDECLARED-IMPORT` — every `@robota-sdk/*` workspace package a production source file imports is
  declared in one of the importing package's `dependencies`, `peerDependencies` or
  `devDependencies`; "undeclared" is absence from all three, so a manifest rule such as
  `FAMILY-SIBLINGS` cannot be walked around by an import the manifest never names.
- `INTERFACE-DEPS` — an `agent-interface-*` package depends only on `agent-core` and on a LOWER-layer
  peer interface package, never on an implementation package.
- `DAG-NODES-LEAF` — a `dag-node-*` leaf package may depend, among `dag-*` packages, only on the
  node-contract owners `dag-core` and `dag-node` — never on an orchestrator/runtime/adapter layer
  and never on a sibling `dag-node-*`, so a node stays composable by any orchestrator.
- `DAG-NODE-COMPOSITION` — every `@robota-sdk/dag-node-*` package receives concrete provider
  definitions/factories from its composition root. A DAG node must not declare or import a concrete
  `agent-provider-*` SDK or read ambient credentials; persisted provider names are validated against
  the injected registry, and media definitions resolve credentials only at execution time.
- `DEV-CYCLE` — the full workspace graph over `dependencies` + `devDependencies` +
  `peerDependencies` should be acyclic; a dev-only edge that closes a cycle leaves no valid
  topological build order. No current check proves this full manifest graph acyclic;
  `pnpm deps:check` reports source-import cycles as warnings instead.
- `ENTRY-POINT-ONLY` — a guarded composition aggregator (a package whose entry statically pulls a
  whole catalog, e.g. the default DAG node set or the default tool set) belongs at an application
  entry point or explicit composition root; mid-layer libraries use an injected port or a safe lazy
  import. The former `GUARDED_AGGREGATORS` scan table no longer exists.
- `PACKAGE-NAME` — the canonical architecture documents (plus every `packages/*/docs/SPEC.md`)
  reference only real workspace package names; a scoped name that resolves to no package is drift
  unless its line is marked "planned".
- `RE-EXPORT` — no package barrel re-exports another workspace package wholesale
  (`export * from '<scope>/<other>'`); a public surface is owned, not forwarded.
- `INTERFACE-IMPORT` — an implementation package imports a contract the interface package exports
  from that interface package, never through `@robota-sdk/agent-framework`.

## Detailed Documentation

| Topic                        | Document                             |
| ---------------------------- | ------------------------------------ |
| Agent guidelines and routing | [`AGENTS.md`](AGENTS.md)             |
| Skills and workflows         | [`.agents/skills/`](.agents/skills/) |
| Package contracts            | `packages/*/docs/SPEC.md`            |
| App specifications           | `apps/*/docs/SPEC.md`                |
