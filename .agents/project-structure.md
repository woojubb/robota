# Project Structure

```text
packages/
├── agent-core/                  # Foundation contracts, engine, events, hooks, permissions
├── agent-executor/               # Reusable background task and subagent lifecycle/state/ports
├── agent-session/               # Session lifecycle and persistence
├── agent-session-analytics/     # Session-log timing analysis + reporting (pure; depends on agent-interface-transport + agent-core)
├── agent-tools/                 # Tool factories (createFunctionTool/createZodFunctionTool → core's FunctionTool), built-ins, sandbox ports/manifests
├── agent-tool-mcp/              # MCP tool implementations
├── agent-framework/             # SDK assembly layer: InteractiveSession, command contracts/common APIs
├── agent-preset/                # Preset contract (IPreset) + resolvePreset + built-in presets (depends on agent-framework only)
├── agent-subagent-runner/       # Optional: child-process subagent runner + worker (depends on agent-framework + agent-provider)
├── agent-command/               # Command modules: agent, background, compact, context, exit, help, language, memory, mode, model, permissions, plugin, provider, reset, rewind, session, settings, skills, statusline, user-local
├── agent-command-*/             # Command-module bridge packages to other subsystems (e.g. agent-command-workflows: surfaces the DAG engine as `/workflows`, composing dag-framework)
├── agent-cli/                   # Terminal UI and local runtime adapters
├── agent-cli-web/               # GUI-007 — the CLI's built-in web monitor SPA (Vite; index.html → SessionMonitor over localhost WS); `private` product-shell; agent-cli builds its dist + serves it over localhost HTTP. Not deployable
├── agent-provider-*/            # Provider family (per-vendor split, ARCH-PROVIDER-002): agent-provider-anthropic, -bytedance, -gemini, -openai, -openai-compatible, -defaults (default-set aggregator), -replay (deterministic session-log replay provider; depends on agent-core + agent-session). There is NO bare `agent-provider` package. deepseek/qwen/gemma are `openai-compatible` *definitions* surfaced by agent-provider-openai-compatible, not standalone packages
├── agent-playground/            # Playground UI package
├── agent-remote-client/         # Remote execution client
├── agent-remote-pairing/        # Isomorphic pairing + DTLS-fingerprint channel binding (WebCrypto only, zero workspace deps; host + Stage-D browser reuse) (REMOTE-001)
├── agent-interface-*/           # Interface/contract packages: pure type contracts; MAY also export pure, dependency-free derivation accessors over their own owned types (no classes, no I/O) — e.g. agent-interface-transport's read* helpers over InteractionEvent. Mechanized by scripts/harness/scan-interface-runtime.mjs (harness:scan `interface-runtime`, INFRA-035): FAILS on any bare/external value import-or-re-export or any class/enum declaration in these packages' src (zero runtime dependency edges).
├── agent-transport/             # Transport core: headless adapter + transport registry + scripted-provider testing fixtures (pure TS)
├── agent-transport-protocol/    # Transport-neutral session bridge + WS wire protocol (createWsHandler, TClientMessage/TServerMessage); shared by -ws and -webrtc (deps: interface-transport only)
├── agent-transport-*/           # Per-concern transport implementations: agent-transport-tui (React/Ink), agent-transport-gui (React GUI presentation core — session reducer + view components + desktop shell + SessionMonitor web shell; the GUI analog of -tui, consumed by apps/agent-app, packages/agent-cli-web (CLI-served monitor), and agent-transport-webrtc-web; deps: interface-transport + transport-protocol only, GUI-005/006), agent-transport-webrtc-web (BROWSER WebRTC peer — native RTCPeerConnection answerer + RemoteClient + useRtcSession over the GUI core; browser mirror of node -webrtc; deps: agent-transport-gui + agent-remote-pairing + transport-protocol, GUI-006), -ws (WebSocket), -http (Hono), -mcp (MCP), -webrtc (P2P RTCDataChannel, optional werift peer dep, REMOTE-001); -ws/-http/-mcp are contract-pure (deps: interface-transport + transport-protocol only). -webrtc additionally depends on agent-remote-pairing (REMOTE-008): the pairing gate must live in wireChannel, where the DTLS fingerprints (offer/answer SDP) and pre-session channel frames are visible — agent-remote-pairing is a zero-dep isomorphic leaf, so this adds no cycle.
├── agent-testing/               # General test framework: domain-free test-environment tooling (PTY runner spawnPty/spawnPtyFixture); zero @robota-sdk deps, devDependency. Charter+placement rule in its SPEC (contracts→agent-interface-*, doubles→owner /testing, drivers→owning module)
├── agent-process/               # Domain-free child-process termination primitives (killProcessTree: SIGTERM→grace→SIGKILL, process-group aware); zero @robota-sdk deps, leaf. Consumed by agent-executor/agent-tools/agent-subagent-runner (CORE-023)
├── agent-plugin/                # Plugins: conversation-history, logging, usage, performance, execution-analytics, error-handling, limits, event-emitter, webhook
│
│   # DAG subsystem (workflow engine; absorbed via WORKFLOW-001, decoupled from the external workflow runtime)
├── dag-core/                    # DAG foundation: runtime-provider + workflow-file contracts, engine types, lifecycle services
├── dag-framework/               # DAG assembly: createDagFramework, local in-process runtime provider, default node registry
├── dag-runtime/                 # DAG run orchestration services: create/start/query/cancel run lifecycle
├── dag-worker/                  # DAG worker-loop driver and in-process execution
├── dag-node/                    # DAG node-definition assembly + manifests
├── dag-builder/                 # DAG definition ↔ `.dag.json` workflow-file conversion
├── dag-projection/              # DAG run projection / read models
├── dag-cost/                    # DAG cost-metadata domain types
├── dag-orchestration-client/    # Thin HTTP client + contracts for DAG orchestration endpoints
├── dag-api/                     # DAG server-side API response mapping/contracts
├── dag-cli/                     # DAG command-line product (`robota-dag`): run/validate/build/catalog/mcp
├── dag-mcp-server/              # Standalone MCP server exposing DAG orchestration tools
├── dag-scheduler/               # DAG scheduled-run triggering
├── dag-adapters-local/          # DAG in-memory persistence/queue/clock adapters
├── dag-adapters-sqlite/         # DAG SQLite persistence adapter
├── dag-nodes/*/                 # DAG node-family packages (`@robota-sdk/dag-node-*`): llm-text providers, image edit, text-to-image, seedance-video, skill, http, file r/w, mcp-tool, in-process tool, router, instant-node
└── dag-nodes-default/           # DAG default node-set aggregator (composition leaf): createDefaultNodeRegistry(); consumed at composition roots by dag-cli + agent-command-workflows, lazy-loaded by dag-framework via a dynamic import() (its sole optionalDependency)
apps/
├── action/                 # Official GitHub Action wrapper for the CLI (robota-sdk/action)
├── agent-web/              # Deployed web app (Next.js/Vercel): /playground host + /remote Stage-D page (GUI-007). The public web surface
├── blog/                   # Blog/content application
├── docs/                   # Documentation site
├── starter-nextjs/         # Next.js SDK starter template (PM-029)
├── www/                    # Marketing site (robota.io)
├── agent-server/           # AI provider proxy + Playground WebSocket
├── dag-runtime-server/     # Native DAG runtime HTTP server (`/v1/dag/*` over Hono); serves dag-framework's IDagOrchestrationPort, native runtime surface, no external-runtime API (WORKFLOW-002)
├── remote-signaling/       # Minimal content-blind WebRTC signaling relay (SDP/ICE rendezvous); dumb relay, no @robota-sdk deps, no session content (REMOTE-001/002 Stage A)
└── agent-app/              # Electron desktop application (macOS/Linux/Windows); the desktop GUI surface. Runs STANDALONE — the user never launches agent-cli first. agent-cli (TUI) and agent-app (GUI) are SIBLING presentations over the same shared runtime; the GUI does NOT control the CLI. The app DRIVES a shared headless runtime — it spawns `robota --serve` (RUNTIME-001), the CLI's headless runtime-host entry that runs `startRuntimeHost` from `agent-framework` and serves the loopback-WS + required nonce auth, rendering NO ink; both the TUI and the GUI sit over the one runtime host (in the `agent-framework` assembly layer). The app renders the shared GUI presentation core agent-transport-gui. Depends on the agent RUNTIME, not the CLI's terminal UI; NO agent-framework/agent-core dep. Remote WebRTC (agent-transport-webrtc-web) is an optional in-app feature, not a requirement (GUI-002 foundation, GUI-005/006 taxonomy)
```

## App Inventory and Approved Stack

UI surfaces and their frameworks (SSOT; the framework RULES — React only, Next.js for SSR,
Tailwind only — live in [rules/frontend.md](rules/frontend.md)):

| App / Package                         | Framework               | Why                                                                                       |
| ------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| `apps/agent-web`                      | Next.js 15              | Deployed web app — App Router + React 19; `/playground` host + `/remote` Stage-D page     |
| `apps/docs`                           | Next.js 15              | Docs site — App Router + MDX + pagefind, static export (`output: 'export'`)               |
| `apps/www`                            | Next.js 15              | Marketing site — static export                                                            |
| `apps/starter-nextjs`                 | Next.js 15              | SDK starter template (PM-029)                                                             |
| `apps/blog`                           | Astro                   | Content site — Astro components only                                                      |
| `apps/agent-app`                      | Electron + React (Vite) | Desktop GUI shell rendering the shared GUI core `agent-transport-gui`                     |
| `packages/agent-transport-gui`        | React                   | Shared GUI presentation core — `SessionMonitor` + session reducer                         |
| `packages/agent-transport-webrtc-web` | React                   | Browser WebRTC peer over the GUI core                                                     |
| `packages/agent-cli-web`              | React + Vite            | CLI-served browser monitor SPA (GUI-007; replaces the dissolved `apps/agent-web-monitor`) |
| `packages/agent-playground`           | React                   | Playground UI package (`private` product shell)                                           |

### Interactive Tools — Placement Decision

If a new interactive tool or page needs:

- Complex state, routing, or API calls → build it in `apps/agent-web` (Next.js).
- Simple read-only display or calculator embeddable in docs → a React client component in `apps/docs`.

## Layered Assembly Architecture

The monorepo follows a strict bottom-up assembly model. Each layer builds on the layer below, never bypassing it.

```
agent-core        ← foundation: interfaces, abstractions, DI, events, plugins
  ↑
agent-executor    ← reusable runtime lifecycle/state/ports for background tasks and subagents
  ↑
agent-session     ← session lifecycle, wraps core with permissions/hooks
agent-tools       ← tool implementations (FunctionTool, builtins)
agent-provider    ← AI provider implementations
agent-plugin      ← cross-cutting concerns (logging, usage, etc.)
  ↑
agent-framework   ← assembly layer: command contracts, common APIs, session/tool/provider composition
  ↑
agent-command     ← built-in/optional command modules that consume framework contracts like third-party modules
  ↑
agent-cli         ← product/UI layer: consumes agent-framework and selected command modules
```

**Rules:**

- **No hardcoding of cross-cutting concerns.** Logging, persistence, analytics, and other side concerns MUST use the existing plugin/event architecture, not direct I/O (e.g., `fs.appendFileSync`, `console.log`). If no suitable plugin exists, create one or extend an existing one.
- **No invented prompt/protocol directives.** Do not add arbitrary parser syntax, instruction strings, pseudo tool-call markers, model/provider heuristics, or magic command text in code or tests to force behavior. Protocol handling must come from an owned SPEC, a public external standard, or an injected adapter/strategy selected by composition.
- **Prompt section labels are metadata, not behavior.** System-prompt composition may add neutral section titles such as "Built-in Commands", "Skills", or "Agents" and list owner-provided descriptors under them. The composer must not add behavioral instructions, imperative routing guidance, or ad hoc examples to make a model choose a path. Behavior text belongs to the owning command/tool/skill/agent descriptor or SPEC.
- **Execution claims require runtime evidence.** Tool, command, agent, and background-task state may be reported only from structured runtime results or events. Assistant text, tag-like markup, or model-authored descriptions are never evidence that work started, completed, failed, or timed out.
- **Provider domain neutrality.** Provider packages may translate provider-specific wire formats into universal messages and tool calls only through declared tool schemas, provider-owned protocol adapters, or injected projection strategies. A provider must not hardcode Robota domain tools, command names, slash commands, agent/subagent concepts, backlog concepts, CLI/TUI behavior, or product workflow semantics. If a model emits XML-like tool artifacts, the provider may parse generic XML and match only the request's declared tool names; it must not infer undeclared tool calls from tag names, role labels, or free-form command-like text.
- **No user-session examples in model-facing guidance.** Do not promote ad hoc examples from user conversations into system prompts, tool descriptions, command descriptors, package specs, or tests. Model-facing examples must be generic, language-neutral, and owned by the relevant SPEC or command/tool contract.
- **No layer skipping.** CLI must not directly use agent-core internals that should be wired through agent-session or agent-framework. Each layer consumes only its direct dependency's public API.
- **Composition over integration.** Features should be assembled from existing building blocks (plugins, event service, tool registry) rather than baked into a single class. A 500-line Session class with hardcoded file I/O is a design smell.
- **Interface-first extension.** When adding a capability (e.g., session logging), define the interface in agent-core, implement in a plugin or session package, and wire in agent-framework. Never implement directly in the consuming layer.
- **Side concerns are injectable.** Any behavior that could vary by deployment (logging destination, storage path, analytics) must be injected, not imported directly.
- **Factory context auto-forwarding.** When a factory function receives a config/context object, optional parameters derivable from that object must use it as the default value (`options.x ?? context.x`). Callers must not be required to manually extract and forward values that the factory already has access to. Explicit overrides take precedence.
- **Composable material first.** Reusable capabilities must be shaped as small composable packages, ports, adapters, classes, and pure functions before they are wired into SDK or UI flows. The SDK should assemble reusable materials; CLI/TUI should render and inject runtime adapters. Do not let a feature become a CLI-only or SDK-only monolith when it has its own lifecycle, state model, adapters, or non-UI consumers.
- **Package extraction trigger.** Before adding a substantial capability to an existing package, ask whether it is reusable outside that package's primary role. If the answer is yes, prefer a dedicated lower-level package or a clearly isolated module with public ports. A runtime capability with multiple adapters, transport projections, or independent tests is a strong candidate for package extraction.
- **Orchestrator/adapter split.** Lifecycle orchestration, state transitions, and handoff metadata belong in reusable lower layers. Concrete I/O such as `child_process`, local files, Git commands, HTTP servers, and React/Ink rendering belongs in injected adapters or shell packages.
- **Command module isolation.** Built-in and optional command packages (`agent-command`) consume framework command interfaces and are selected by composition roots. `agent-framework` must not import or special-case command packages. Product shells such as `agent-cli` may import selected command modules to assemble a default product experience.
- **Slash-free command identity.** SDK command identifiers are canonical names such as `skills`, `agent`, or `memory`. `ICommand.name`, `ISystemCommand.name`, `ICapabilityDescriptor.name`, and projected model-command reverse mappings must not include a leading slash. Slash syntax such as `/skills` or `/agent` is a user input/display convention owned by UI/transport shells.
- **Built-in means default composition, not SDK ownership.** A user-visible internal command must be implemented as an `ICommandModule` owner with metadata, execution, lifecycle policy, interactions, and effects in one place. "Built-in" means the product composes the module by default. It does not mean the command behavior belongs in `agent-cli`, TUI hooks, SDK orchestration classes, or provider packages.
- **Framework command common API boundary.** `agent-framework` may own generic command contracts (`ICommandModule`, `ISystemCommand`, command effects/interactions, lifecycle metadata), registries/executors, and reusable common APIs or ports needed by commands. For example, provider settings/profile helpers may be SDK common APIs, while `/provider` command flow must consume those APIs as a command module would from a third-party package. When a command needs settings I/O, restart, picker, plugin UI, or provider creation, expose a typed port/adapter contract instead of importing concrete CLI/TUI code.
- **CLI/TUI command thinness.** `agent-cli` may parse the leading slash, register composed command modules, render generic command prompts, apply typed host effects, and provide host adapters. It must not own command-specific state machines, setup flows, provider profile mutation, command metadata, command-specific switch branches, or duplicated command descriptors when an `ICommandModule` can own them.
- **Legacy SDK-embedded commands are not precedent.** Existing SDK-embedded command behavior is migration debt unless it is only generic command infrastructure. New internal commands must be implemented as command modules first; expanding SDK command implementation files requires a SPEC-backed migration plan and a mechanical check exception.
- **Per-product assembly ownership — no shared product factory.** Each deployable product (the CLI, a second CLI, an embedded host, an app) owns its own composition/wiring of provider, preset, and command modules. The reusable, product-agnostic capability lives in the framework/transport layers (e.g., the interaction runtime and the in-process/built-binary driver adapters over a shared interaction contract). Do NOT extract a shared cross-product assembly factory (e.g., a `createCliAgent`): a product shell is one assembler among many, not a shared utility. Reuse is achieved by sharing lower-layer materials, not by sharing the product's assembly. See `feedback_no_shared_cli_factory`.

## Library Neutrality Rule (packages/ vs apps/)

Everything under `packages/` is a **library and must be universal and neutral** — usable by any
consumer for any payload/application domain:

- No app main loops: a library must not own the consumer's orchestration loop. If a class "runs
  the show" and the app merely configures it, it is a finished product imitating an ingredient
  (ROOM-001 withdrawal, 2026-07-03).
- No library-authored prompt content: model-facing text in `packages/` is limited to
  mechanism-level enforcement strings (schema-violation feedback, round-limit notices). Anything
  that shapes an application's voice, persona, or conversation style belongs to the consumer.
- No application-domain concepts in library types: fields/interfaces like persona, room, topic,
  STT/TTS adapters are app-domain contracts (TRANS-001 rescope) — libraries ship content-neutral
  mechanics that any domain can carry.
- `apps/` is the product tier and plays by product rules (opinionated UX, domain concepts, its own
  prompts). `examples/` may likewise be full products — that is their job. A small **product-shell
  tier lives in `packages/`** and is exempt from library neutrality: `packages/agent-cli` (the
  published reference product), `packages/agent-playground` (a `private` product shell), and
  `packages/agent-cli-web` (GUI-007 — the CLI's `private` built-in web monitor SPA, served by
  `agent-cli` over localhost HTTP). These are sanctioned products assembled FROM the libraries — their
  preset/persona/UI surfaces are product behavior, not library behavior. (The former
  `packages/agent-web-ui` was retired in GUI-006; the CLI-served monitor SPA is now
  `packages/agent-cli-web`, and the Stage-D browser remote page lives in the deployed `apps/agent-web`
  over the shared GUI core.)

When a use case seems to need a domain feature in a library, the answer is: verify the neutral
ingredients exist, then show the assembly in `examples/` or a guide.

**Why this is the north-star, not just hygiene.** [`VISION.md`](../VISION.md) targets a _general_
development agent (one capable enough to build even Robota); "Robota builds Robota" is a **validation
benchmark**, never a licence to couple `packages/` to the Robota domain. Robota-specific content in a
library makes the agent LESS general, i.e. moves it away from the goal. So neutrality here is the goal
restated — a self-hosting / "build Robota" motivation must still land as a neutral mechanism usable on
any project, with the Robota-specific assembly (if any) staying in `agent-cli` / `apps/`.

## Forward-Provisioned Surface Rule

A public surface in `packages/` with zero in-repo consumers is **not dead code**. Libraries and
frameworks ship surfaces FOR external consumers; deliberate forward-provisioning ("built ahead so
it is available when needed") is a legitimate product state (owner decision, 2026-07-04 re-audit).

- Removal of an unconsumed public surface is a PRODUCT decision — never a grep-based cleanup.
  Propose it as a user decision item with options; do not file it as "dead code".
- Forward-provisioned surfaces carry the same first-class quality bar as consumed ones: accurate
  SPEC/README, tests, and bug fixes are unconditional — "nobody uses it yet" never downgrades a
  defect on such a surface.
- Consumption-based detectors (orphan-export style scans) must not treat in-repo non-consumption
  of `packages/` public surfaces as a violation. (Pass-through re-exports remain banned — that
  rule is about ownership, not consumption.)

## Planned Packages (Not Yet Created)

The following packages are planned but do not yet exist on disk. Do not attempt to import from them.
See [capability-placement.md](specs/architecture-map/capability-placement.md) for their TBD ownership status.

| Package             | Planned Purpose                                       |
| ------------------- | ----------------------------------------------------- |
| `packages/auth/`    | Auth contracts, verifier ports, scope policy          |
| `packages/credits/` | Credit account, reservation, and settlement contracts |

## Documentation Map

Source-to-site mapping for robota.io and package docs (SSOT; the documentation UPDATE gates —
same-PR doc updates, document-role sync — live in
[rules/documentation-sync.md](rules/documentation-sync.md)):

- `content/README.md` is the robota.io home page source (`/`).
- `content/getting-started/README.md` is `/getting-started/`.
- `content/guide/README.md` is `/guide/`.
- `content/guide/building-agents.md` is `/guide/building-agents.html`.
- `content/guide/sdk.md` is `/guide/sdk.html`.
- `content/guide/cli.md` is `/guide/cli.html`.
- `content/guide/architecture.md` is `/guide/architecture.html`.
- `content/guide/permissions-and-hooks.md` is `/guide/permissions-and-hooks.html`.
- `content/guide/context-management.md` is `/guide/context-management.html`.
- `content/examples/*.md` is `/examples/*`.
- `packages/<pkg>/docs/README.md` is copied into robota.io as `/packages/<pkg>/`.
- `packages/<pkg>/docs/SPEC.md` is package contract truth, not marketing docs.
- `packages/<pkg>/README.md` is the npm/GitHub package README.
- `apps/docs/out/` and `apps/docs/.next/` are generated build outputs (Next.js static export + pagefind). Do not edit them directly.

## Related Documents

| Document                                                                                         | Content                                   |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| [specs/ARCHITECTURE-MAP.md](specs/ARCHITECTURE-MAP.md)                                           | Repository-level architecture map router  |
| [specs/architecture-map/README.md](specs/architecture-map/README.md)                             | Architecture-map document tree            |
| [publish-registry.md](publish-registry.md)                                                       | npm publish rules, package registry table |
| [../packages/agent-cli/docs/ARCHITECTURE-MAP.md](../packages/agent-cli/docs/ARCHITECTURE-MAP.md) | CLI architecture map router               |

## Interaction Channel Contract

`agent-interface-transport` owns the `IInteractionChannel` contract (INFRA-010/025);
`agent-framework` owns the `createInteractiveRuntime` factory that wires it. Together they define
the contract between the session runtime and transport implementations.

- `IInteractionChannel` — the interface that all interactive transports implement (TUI, headless, future web/remote); SSOT in `agent-interface-transport`
- `InteractionEvent` — the union type of one-way display events emitted by the runtime to the channel
- `TActionRequest` / `TActionResponse` — the disambiguation dialog protocol (permission prompts)
- `createInteractiveRuntime` — the factory that wires `IInteractionChannel` ↔ `InteractiveSession`

The transport packages own concrete implementations: `TuiInteractionChannel` (TUI mode, in `agent-transport-tui`) and `HeadlessInteractionChannel` (print mode, in `agent-transport` core). `TuiInteractionChannel` implements `IInteractionChannel` directly; `HeadlessInteractionChannel` does not, because doing so would lose access to session events outside the `InteractionEvent` union.

## Command Package Rule

User-visible internal commands belong in `agent-command` or command-module owners that consume `@robota-sdk/agent-framework` command contracts. `agent-framework` owns command infrastructure and reusable common APIs; `agent-cli` composes selected modules and renders generic UI.

## Interface Package Rule

`agent-interface-*` packages contain **only type contracts and interfaces — no implementation**.
They are the SSOT for cross-cutting contracts shared between implementation families.

- `agent-interface-transport` — transport contracts (`ITransportAdapter`, `IConfigurableTransport`, `ITransportConfig`) plus, post-DATA-001, the session (`IInteractiveSessionRecord`/`Store`, `IInteractiveSession`), workspace (`IExecutionWorkspace*`), command (`ICommand`/`ICommandResult`), event (`InteractionEvent`, session-event payloads), and usage (`IBackgroundTaskUsage`) contract families
- `agent-interface-tui` — TUI interaction contracts (`ITuiPickerItem`, `ITuiCommandInteraction`, `ITuiPickerInteraction`, `ITuiConfirmInteraction`, `TAnyTuiCommandInteraction`, `TOnMissingArgsAction`)
- Future: `agent-interface-provider`, `agent-interface-plugin` if those families need isolated contracts

Rules:

- An `agent-interface-*` package must not contain classes or runtime logic.
- An `agent-interface-*` package's internal dependencies are a subset of `{agent-core}` —
  contracts never depend on implementation packages (INFRA-025; mechanized as the
  `INTERFACE-DEPS` rule in the `deps` scan). `agent-interface-transport` owns the
  background-task/subagent/compaction data contracts and, post-DATA-001, the
  session/workspace/command/event/usage contract families; `agent-executor`/`agent-session` import
  them and keep only runtime SPI.
- Implementation packages (`agent-transport` with subpath `/headless`; the per-concern `agent-transport-tui` / `-ws` / `-http` / `-mcp` packages; `agent-provider` with subpaths `/anthropic`, `/openai`, etc.; `agent-command`) depend on the corresponding `agent-interface-*` package, not on `agent-framework`, for interface types. The transport-facing contract types (command, interaction, event, workspace, session, and transport contracts) live in `agent-interface-transport` as their SSOT (per INFRA-010). This is **mechanically enforced** by `scripts/harness/check-interface-imports.mjs` (wired into `pnpm harness:scan` as the `interface-imports` scan): any implementation package that imports an `agent-interface-transport`-exported symbol from `@robota-sdk/agent-framework` fails the gate. Runtime values and framework-owned types (e.g. `TInteractiveSessionOptions`, `ICommandHostContext`, `ICommandModule`, `TSettingsData`) still come from `agent-framework`.
- `agent-framework` depends on the `agent-interface-transport` package to consume the contracts it needs (it does not depend on `agent-interface-tui`, which only `agent-transport-tui` consumes).
- Do not place interface packages in `agent-core` — `agent-core` is zero-deps and owns foundational primitives only.

## Preset Package Rule

`agent-preset` owns the `IPreset` contract, the `resolvePreset` precedence merger, and built-in
preset definitions. It produces option data only — it performs no session assembly and must not
re-export `agent-framework`.

- Dependency edge: `agent-preset → agent-framework` (consumes option types as SSOT, e.g.
  `ICreateSessionOptions['permissionMode']`). This is the package's only workspace dependency.
- Consumers: `agent-cli` depends on both `agent-preset` (resolver) and `agent-framework` (assembly
  entry); `agent-command` consumes the resolver/list surface for the `/preset` command module. The
  reverse edges (`agent-framework → agent-preset`, `agent-preset → agent-cli`) must never exist.
- The edge is derived dynamically from `package.json` by
  `scripts/harness/check-dependency-direction.mjs`; keeping the dependency one-way is sufficient for
  the gate (no separate allowlist entry required).

## Family Decomposition Rule

When a group of related capabilities forms a "family" (providers, DAG nodes, plugins, commands),
decide package granularity by ONE driver: **is the member independently installed or registered by a
consumer / third party?**

- **Split into per-member packages** when a member is a unit a consumer (or a third party) adds à la
  carte — installed from npm and/or registered at an extension point. A heavy **independent third-party
  SDK** is the _strongest signal_ of this (each vendor SDK is a distinct dependency the consumer opts
  into), but it is **not** the definition: a light, co-released member is still its own package when it is
  an independently registrable extension-point member.
- **Consolidate into a single package** when members are **internal runtime behaviors selected by config**,
  not npm-installed or registered à la carte by consumers.

Reconcile any new family against the four existing shapes (this rule is the SSOT that must keep matching
them):

| Family                                               | Shape            | Why                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Providers (`agent-provider-*`)                       | per-member split | each vendor is consumer-selectable AND carries a distinct heavy SDK (ARCH-PROVIDER-002)                                                                                                                                                                                                                                          |
| DAG nodes (`dag-node-*`)                             | per-member split | each node is a registry-registered extension-point member a consumer/3rd party adds à la carte — split **even when light + co-released** (e.g. `dag-node-text-output` depends only on `dag-core`/`dag-node`/`zod` at the family version, yet is its own package). This case is why the driver is installability, not dep-weight. |
| Plugins / Commands                                   | single package   | config-selected internal behaviors with shared deps, not consumer-installed                                                                                                                                                                                                                                                      |
| Defaults aggregator (`-defaults` / `-nodes-default`) | composition leaf | assembles the family's default set for a zero-config entry point; imported only at composition roots (entry-point-only)                                                                                                                                                                                                          |

Consequence: adding a family member = one more package (split families) or one more internal module
(consolidated families) — never collapse a split extension-point family into one package on a naive
"no heavy dep" reading, and never split an internal config-selected behavior into its own package.

## Composition-Root Exemption (Import-Layering Scans)

`agent-cli` must not import `@robota-sdk/agent-executor` directly — it consumes SDK
workspace projections through `agent-framework`. The single permitted exception is the
**composition root**: the app assembly point may wire concrete implementations (e.g.
`cli.ts` wiring `createDefaultBackgroundTaskRunners`, `modes/print-mode.ts` consuming the
type-only `IBackgroundTaskRunner` contract). Routing these through an `agent-framework`
re-export is NOT an alternative — it would violate the no-pass-through-re-exports rule
above.

Enforced by the `cli-agent-executor-import` rule in
`scripts/harness/check-background-workspace-conformance.mjs`. Every exemption entry MUST
carry a reason string and is reported (never silent) on each scan run; composition-root
wiring is the only valid exemption category. (HARNESS-011)
