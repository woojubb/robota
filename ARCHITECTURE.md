# Architecture — Robota Monorepo

High-level system architecture for the Robota AI agent monorepo: which packages exist, how they
depend on each other, and which apps are built from them.

## System Overview

Libraries sit below, composition roots on top. Rows are ordered by dependency: a package's production
dependencies are only packages in its own row or in lower rows, never in a higher row (test-only
dependencies may reach up). Everything under
`packages/` is neutral; product opinions live in the composition roots.

```
Composition roots
  packages/agent-cli        robota: terminal UI, print mode, --serve host, workspace daemon,
                            background sessions, mcp serve (published as a self-contained bundle)
  apps/agent-app            Electron desktop app: loads agent-gui-web and attaches to the
                            workspace daemon, starting one if none is running
  apps/agent-web            Next.js host for the browser remote client
  apps/starter-nextjs       Next.js chat starter over agent-framework
  apps/dag-runtime-server   Hono HTTP server over dag-framework
  apps/remote-signaling     Content-blind WebRTC signaling relay for remote control
  apps/action               GitHub Action that runs agent-cli
  apps/docs, apps/www, apps/blog
                            Docs site, marketing site, blog (no SDK dependency)
        │
        │ built from
        ▼
SDK packages (@robota-sdk/*)
  Product composition   agent-product · pack-coding · agent-capability-pack ·
                        agent-command · agent-preset · agent-subagent-runner
  Presentation          agent-ui-terminal (React + Ink)
                        agent-ui-web · agent-gui-web · agent-transport-webrtc-web (private GUI)
  Assembly              agent-framework: InteractiveSession, createQuery, createAgentRuntime,
                        runtime host (buildRuntimeSession / startRuntimeHost behind robota --serve)
  Transports            agent-transport (wire protocol, delivery), and the carriers built on it:
                        agent-transport-ws · -http · -mcp · -webrtc
  Runtime               agent-session · agent-executor · agent-tool-defaults ·
                        agent-provider-replay (private: replays recorded provider responses in tests) ·
                        agent-roundtable-robota (private: runs Session/Robota as roundtable
                        participants and selectors)
  Building blocks       agent-tools · agent-plugin · agent-mcp · agent-session-analytics ·
                        agent-provider-{anthropic,openai,openai-compatible,gemini,bytedance} ·
                        agent-builtin-providers
  Contracts (type-only) agent-interface-{session,session-mobility,command,execution,
                        analytics,transport,tui}
  Foundation            agent-core
  Leaves                agent-process · agent-file-authority · agent-remote-pairing ·
                        agent-roundtable (no @robota-sdk dependency)

DAG / workflow subsystem (private; depends on the SDK packages, never the reverse)
  dag-core ← dag-node, dag-runtime, dag-worker, dag-builder, dag-cost, dag-api, … ← dag-framework
  dag-core, dag-node ← dag-node-* leaves ← dag-nodes-default
  dag-framework, dag-nodes-default ← agent-command-workflows (/workflows in agent-cli)
  (A ← B: B depends on A)
```

The main package-level edges are drawn in [`diagrams/robota-architecture.mmd`](diagrams/robota-architecture.mmd).

> **What the rows do not show.** Providers are injected: `agent-framework` never depends on an
> `agent-provider-*` package; the composition root constructs the provider and hands it in.
> The transport family builds on `agent-core`, the contract packages and `agent-remote-pairing`,
> not on `agent-framework`; `agent-ui-terminal` depends on both. `agent-subagent-runner` sits above the
> framework because it assembles child sessions through it. `agent-mcp` depends only on
> `agent-core`; the CLI connects it to the session.

> **Type contracts.** Each `agent-interface-*` package owns one contract family and contains type
> declarations plus, at most, small pure accessors: sessions and interaction channels
> (`-session`), peer messaging and handoff (`-session-mobility`), commands (`-command`),
> background tasks and subagent jobs (`-execution`), usage and run traces (`-analytics`),
> transport adapters, admission, access tokens and external events (`-transport`), and terminal UI
> interactions (`-tui`). They depend only on `agent-core` and on lower contract packages.

> **DAG / workflow subsystem.** The `dag-*` and `agent-command-workflows` packages are private and
> not published on their own. The product `/workflows` path is composed in `agent-command-workflows`;
> there is no standalone DAG CLI. The code used by the CLI's `/workflows` path is bundled into
> `@robota-sdk/agent-cli`: its local runtime exposes the 23-node synchronous base catalog plus saved
> instant nodes. The private async workspace catalog can reach 29 nodes when all optional loaders
> succeed; it is not a CLI capability. `apps/dag-runtime-server` exposes the same in-process DAG
> framework over HTTP.

## Key Architectural Decisions

- **Strict one-way dependency direction** — No bidirectional production dependencies. A package owns
  its public surface instead of forwarding another package's (see `RE-EXPORT`).
- **Robota-owned DAG runtime contract** — The DAG runtime executes Robota's own domain model; no
  external-runtime API or compatibility layer lives in this repository.
- **Ports and adapters** — Core packages define port interfaces. Adapters implement them. No direct infrastructure coupling.
- **SPEC as contract** — Each package's `docs/SPEC.md` records its purpose, contract, invariants and
  design decisions; a change to a contract rewrites the matching SPEC sentence.
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
  topological build order. No current check proves this full manifest graph acyclic.
  `pnpm deps:check` (run in CI) covers source imports only: its `no-circular` rule fails the build
  on a circular import it can resolve, but it does not read manifest edges.
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

| Topic                        | Document                                                               |
| ---------------------------- | ---------------------------------------------------------------------- |
| Project direction            | [`VISION.md`](VISION.md)                                               |
| Agent guidelines and routing | [`AGENTS.md`](AGENTS.md)                                               |
| Contributing                 | [`CONTRIBUTING.md`](CONTRIBUTING.md)                                   |
| Package dependency graph     | [`diagrams/robota-architecture.mmd`](diagrams/robota-architecture.mmd) |
| Architecture guide (users)   | [`content/guide/architecture.md`](content/guide/architecture.md)       |
| Skills and workflows         | [`.agents/skills/`](.agents/skills/)                                   |
| Package contracts            | `packages/*/docs/SPEC.md`                                              |
| App specifications           | `apps/*/docs/SPEC.md`                                                  |
