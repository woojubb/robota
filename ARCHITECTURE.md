# Architecture — Robota Monorepo

The architecture supports one direction: [our agents develop and advance our agents](VISION.md).
Owned layers provide a reusable construction and execution foundation; the SDK and maintained
interfaces are ways to build and use agents on it. This structure supports the ambition without
claiming that autonomous self-development is already achieved.

This document describes which packages exist, how they depend on each other, and which apps are
built from them.

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
                        agent-transport-ws · -http · -mcp · -acp · -webrtc ·
                        -link (the owner link: proven admission to a local runtime)
  Runtime               agent-session · agent-executor · agent-tool-defaults ·
                        agent-roundtable-robota (runs a session or agent as a roundtable participant and
                        selectors) ·
                        agent-provider-replay (private: replays recorded provider responses in tests)
  Building blocks       agent-tools · agent-plugin · agent-mcp · agent-session-analytics ·
                        agent-telemetry-otel ·
                        agent-provider-{anthropic,openai,openai-compatible,gemini,bytedance} ·
                        agent-builtin-providers
  Contracts (type-only) agent-interface-{session,session-mobility,command,execution,
                        analytics,transport,tui}
  Foundation            agent-core
  Leaves                agent-process · agent-file-authority · agent-remote-pairing ·
                        agent-keyring (key custody and public-key sealing on node:crypto) ·
                        agent-organization (public canonical JSON and budget contracts) ·
                        agent-organization-host (private Node broker and durable authority) ·
                        agent-roundtable (no @robota-sdk dependency)

External workflow library
  @robota-sdk/workflows/command ← agent-cli (/workflows)
  (The workflow artifact depends on host SDK peers, never the reverse.)
```

The main package-level edges are drawn in [`diagrams/robota-architecture.mmd`](diagrams/robota-architecture.mmd).

> **What the rows do not show.** Providers are injected: `agent-framework` never depends on an
> `agent-provider-*` package; the composition root constructs the provider and hands it in.
> The transport family builds on `agent-core`, the contract packages and `agent-remote-pairing`,
> not on `agent-framework`; `agent-ui-terminal` depends on both. `agent-subagent-runner` sits above the
> framework because it assembles child sessions through it. `agent-mcp` depends only on
> `agent-core`; the CLI connects it to the session. `agent-framework`'s `runGroupChat` is a facade
> over the `agent-roundtable` leaf's `Roundtable` (Assembly → Leaves, a downward edge): the core owns
> the only turn loop, and the framework never depends on `agent-roundtable-robota`, which sits in
> Runtime for the product's own Session/Robota participants.

> **Type contracts.** Each `agent-interface-*` package owns one contract family and contains type
> declarations plus, at most, small pure accessors: sessions and interaction channels
> (`-session`), peer messaging and handoff (`-session-mobility`), commands (`-command`),
> background tasks and subagent jobs (`-execution`), usage and run traces (`-analytics`),
> transport adapters, admission, access tokens and external events (`-transport`), and terminal UI
> interactions (`-tui`). They depend only on `agent-core` and on lower contract packages.

> **Workflows.** The CLI bundles the separately maintained workflow library, which uses host-owned
> SDK peers and preserves the `/workflows` command and saved workflow formats.

## Key Architectural Decisions

- **Strict one-way dependency direction** — No bidirectional production dependencies. A package owns
  its public surface instead of forwarding another package's (see `RE-EXPORT`).
- **Ports and adapters** — Core packages define port interfaces. Adapters implement them. No direct infrastructure coupling.
- **SPEC as contract** — Each package's `docs/SPEC.md` records its purpose, contract, invariants and
  design decisions; a change to a contract rewrites the matching SPEC sentence.
- **No fallback for required capabilities** — Terminal failures stay terminal.
- **Platform-neutral libraries** — A library's main entry runs wherever its consumer runs; host
  code sits behind a Node-only subpath and is injected (see Runtime platforms).

## Runtime platforms

A package's main entry is **platform-neutral** unless the package exists to drive a Node host.
Platform-neutral code runs unchanged in a browser, a Web Worker, Node, Deno and Bun: it uses only
web-standard globals (`fetch`, `crypto`, `TextEncoder`, `URL`, streams, `AbortController`, timers)
and never a Node built-in module or a Node global (`process`, `Buffer`, `__dirname`, `require`,
`setImmediate`) — not behind a lazy `import()`, and not behind a `typeof process` guard. Code that
needs a host (files, processes, sockets, the process environment) lives in a Node-only subpath,
conventionally `./node`, and reaches neutral code only by injection at a composition root: a neutral
library has no host default.

An export subpath is Node-only exactly when its `exports` entry maps `"browser": null`. Every other
subpath is platform-neutral under every condition, because a Worker, Deno or Bun resolves `default`,
not `browser`, so it ships one build and maps no `node` or `browser` condition. A third-party
dependency of a neutral entry may load a Node module only lazily, behind its own runtime detection.
`pnpm lint` runs `scripts/harness/check-platform-neutral.mjs`, which bundles every neutral subpath and
fails on any Node built-in, Node global or Node-only subpath it reaches, on a `node` or `browser`
condition a neutral subpath maps, and on any package whose manifest disagrees with the lists below.
It also runs `scripts/harness/browser-runtime-proof.mjs`, which evaluates every neutral subpath's bundle,
and a scenario for the packages that have one, in a realm that has only web-standard globals, so a Node
global that no scan of the source can see, such as a dependency reading `process.env` when it is called,
fails by name. That realm is Worker-shaped, with no `window` or `document`: the Browser (DOM) packages
are outside this proof. This checks import graphs and selected behavior, not every host, provider
configuration or network endpoint. In particular, a provider SDK may refuse client-side use; see
[Browser hosts](content/guide/providers.md#browser-hosts).

- **Platform-neutral**: `agent-interface-analytics`, `agent-interface-command`,
  `agent-interface-execution`, `agent-interface-session`, `agent-interface-session-mobility`,
  `agent-interface-transport`, `agent-interface-tui`, `agent-core`, `agent-organization`,
  `agent-remote-pairing`, `agent-roundtable`, `agent-roundtable-robota`, `agent-session-analytics`,
  `agent-telemetry-otel`, `agent-provider-anthropic`, `agent-provider-openai`,
  `agent-provider-openai-compatible`, `agent-provider-gemini`, `agent-provider-bytedance`,
  `agent-builtin-providers`, `agent-capability-pack`, `agent-transport`, `product-config`,
  `agent-plugin`, `agent-executor`, `agent-session`, `agent-transport-http`, `agent-mcp`,
  `agent-tools`, `agent-framework`, `agent-command`, `agent-preset`, `agent-product`
- **Browser (DOM)**: `agent-ui-web`, `agent-transport-webrtc-web`, `agent-gui-web` — free of Node
  like the neutral packages, and they also need a DOM.
- **Node host**: `agent-cli`, `agent-ui-terminal`, `agent-process`, `agent-file-authority`,
  `agent-organization-host`, `agent-tool-defaults`, `pack-coding`, `agent-subagent-runner`,
  `agent-transport-ws`, `agent-transport-mcp`, `agent-transport-acp`, `agent-transport-webrtc`,
  `agent-transport-link`, `agent-provider-replay`, `agent-keyring` — they exist to drive a Node host
  (a terminal, child processes, the file system, listeners, stdio, local sockets, `node:crypto` key
  custody), so their main entry is Node-only.

## Dependency and interface rule identifiers

The identifiers below name architecture boundaries. The former broad dependency scans were removed
by the minimal-harness reset; the one bundle-source graph gate is the runtime-platform check above.
This list is not a claim that each boundary has an automated gate. Package placement and dependency direction are shown in
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
- `FAMILY-SIBLINGS` — the package name hierarchy is the dependency detector:
  an `agent-<family>-<child>` package (family = the second dash segment) may depend on its parent
  `agent-<family>` and on lower families, never on a sibling `agent-<family>-<other>` at any depth
  (`agent-transport-webrtc-web` is a sibling of `agent-transport-ws`); the bare parent never depends
  on a child; and the composer/foundation (`agent-framework`, `agent-core`) never depends on a
  transport or UI child (`agent-transport-*`, `agent-ui-*`). Code two siblings share belongs in the
  parent (or a parent subpath) — never in a sibling-named substrate (`-common`, `-shared`,
  `-protocol`, `-defaults`, `-builtin`). Judged over `dependencies` + `peerDependencies`; the
  `agent-interface-*` family is judged once, by `INTERFACE-DEPS`. One exception:
  `agent-provider-openai` builds on `agent-provider-openai-compatible` (its `/shared` subpath), because
  the OpenAI wire protocol is the base both implement and there is no `agent-provider` parent to hold
  it. `pnpm deps:check` enforces the provider part of this rule.
- `UNDECLARED-IMPORT` — every `@robota-sdk/*` workspace package a production source file imports is
  declared in one of the importing package's `dependencies`, `peerDependencies` or
  `devDependencies`; "undeclared" is absence from all three, so a manifest rule such as
  `FAMILY-SIBLINGS` cannot be walked around by an import the manifest never names.
- `INTERFACE-DEPS` — an `agent-interface-*` package depends only on `agent-core` and on a LOWER-layer
  peer interface package, never on an implementation package.
- `DEV-CYCLE` — the full workspace graph over `dependencies` + `devDependencies` +
  `peerDependencies` should be acyclic; a dev-only edge that closes a cycle leaves no valid
  topological build order. No current check proves this full manifest graph acyclic.
  `pnpm deps:check` (run in CI) covers source imports only: its `no-circular` rule fails the build
  on a circular import it can resolve, but it does not read manifest edges.
- `ENTRY-POINT-ONLY` — a guarded composition aggregator (a package whose entry statically pulls a
  whole catalog, e.g. the default tool set) belongs at an application
  entry point or explicit composition root; mid-layer libraries use an injected port, never a lazy
  import of a default. The former `GUARDED_AGGREGATORS` scan table no longer exists.
- `PACKAGE-NAME` — the canonical architecture documents (plus every `packages/**/docs/SPEC.md`)
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
| Package contracts            | `packages/**/docs/SPEC.md`                                             |
| App specifications           | `apps/*/docs/SPEC.md`                                                  |
