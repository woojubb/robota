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
├── agent-web-ui/                # Browser React component library for monitoring a CLI session over WebSocket (product shell, browser-only)
├── agent-provider/              # Provider packages: anthropic, openai, openai-compatible, deepseek, gemma, qwen, gemini, google, bytedance
├── agent-provider-*/            # Provider-family variants (e.g. agent-provider-replay: deterministic session-log replay provider; depends on agent-core + agent-session)
├── agent-playground/            # Playground UI package
├── agent-remote-client/         # Remote execution client
├── agent-interface-*/           # Interface/contract packages: pure type contracts; MAY also export pure, dependency-free derivation accessors over their own owned types (no classes, no I/O) — e.g. agent-interface-transport's read* helpers over InteractionEvent. Mechanized by scripts/harness/scan-interface-runtime.mjs (harness:scan `interface-runtime`, INFRA-035): FAILS on any bare/external value import-or-re-export or any class/enum declaration in these packages' src (zero runtime dependency edges).
├── agent-transport/             # Transport core: headless adapter + transport registry + scripted-provider testing fixtures (pure TS)
├── agent-transport-*/           # Per-concern transport implementations: agent-transport-tui (React/Ink), -ws (WebSocket), -http (Hono), -mcp (MCP); -ws/-http/-mcp are contract-pure (deps: interface-transport + core only)
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
└── dag-nodes/*/                 # DAG node-family packages (`@robota-sdk/dag-node-*`): llm-text providers, image edit, text-to-image, seedance-video, skill, http, file r/w, mcp-tool, in-process tool, router, instant-node
apps/
├── action/                 # Official GitHub Action wrapper for the CLI (robota-sdk/action)
├── agent-web/              # Web application (Agent Playground)
├── blog/                   # Blog/content application
├── docs/                   # Documentation site
├── starter-nextjs/         # Next.js SDK starter template (PM-029)
├── www/                    # Marketing site (robota.io)
├── agent-server/           # AI provider proxy + Playground WebSocket
└── dag-runtime-server/     # Native DAG runtime HTTP server (`/v1/dag/*` over Hono); serves dag-framework's IDagOrchestrationPort, native runtime surface, no external-runtime API (WORKFLOW-002)
```

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
  published reference product), `packages/agent-playground`, and `packages/agent-web-ui` (both
  `private` product shells). These are sanctioned products assembled FROM the libraries — their
  preset/persona/UI surfaces are product behavior, not library behavior.

When a use case seems to need a domain feature in a library, the answer is: verify the neutral
ingredients exist, then show the assembly in `examples/` or a guide.

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
