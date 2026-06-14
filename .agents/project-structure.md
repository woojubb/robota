# Project Structure

```text
packages/
├── agent-core/                  # Foundation contracts, engine, events, hooks, permissions
├── agent-executor/               # Reusable background task and subagent lifecycle/state/ports
├── agent-session/               # Session lifecycle and persistence
├── agent-session-analytics/     # Session-log timing analysis + reporting (pure; depends on agent-interface-transport + agent-core)
├── agent-tools/                 # Tool implementations: FunctionTool, built-ins, schema helpers, sandbox ports/manifests
├── agent-tool-mcp/              # MCP tool implementations
├── agent-framework/             # SDK assembly layer: InteractiveSession, command contracts/common APIs
├── agent-preset/                # Preset contract (IPreset) + resolvePreset + built-in presets (depends on agent-framework only)
├── agent-subagent-runner/       # Optional: child-process subagent runner + worker (depends on agent-framework + agent-provider)
├── agent-command/               # Command modules: agent, background, compact, context, exit, help, language, memory, mode, model, permissions, plugin, provider, reset, rewind, session, settings, skills, statusline, user-local
├── agent-cli/                   # Terminal UI and local runtime adapters
├── agent-web-ui/                # Browser React component library for monitoring a CLI session over WebSocket (product shell, browser-only)
├── agent-provider/              # Provider packages: anthropic, openai, openai-compatible, deepseek, gemma, qwen, gemini, google, bytedance
├── agent-playground/            # Playground UI package
├── agent-remote-client/         # Remote execution client
├── agent-interface-*/           # Interface/contract packages: pure type contracts with no implementation (e.g. agent-interface-transport)
├── agent-transport/             # Transport core: headless adapter + transport registry + scripted-provider testing fixtures (pure TS)
├── agent-transport-*/           # Per-concern transport implementations: agent-transport-tui (React/Ink), -ws (WebSocket), -http (Hono), -mcp (MCP)
└── agent-plugin/                # Plugins: conversation-history, logging, usage, performance, execution-analytics, error-handling, limits, event-emitter, webhook
apps/
├── action/                 # Official GitHub Action wrapper for the CLI (robota-sdk/action)
├── agent-web/              # Web application (Agent Playground)
├── blog/                   # Blog/content application
├── docs/                   # Documentation site
├── starter-nextjs/         # Next.js SDK starter template (PM-029)
├── www/                    # Marketing site (robota.io)
└── agent-server/           # AI provider proxy + Playground WebSocket
```

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

`agent-framework` owns the `IInteractionChannel` interface and `createInteractiveRuntime` factory. These define the contract between the session runtime and transport implementations.

- `IInteractionChannel` — the interface that all interactive transports implement (TUI, headless, future web/remote)
- `InteractionEvent` — the union type of one-way display events emitted by the runtime to the channel
- `IActionRequest` / `IActionResponse` — the disambiguation dialog protocol (permission prompts)
- `createInteractiveRuntime` — the factory that wires `IInteractionChannel` ↔ `InteractiveSession`

The transport packages own concrete implementations: `TuiInteractionChannel` (TUI mode, in `agent-transport-tui`) and `HeadlessInteractionChannel` (print mode, in `agent-transport` core). Neither class implements `IInteractionChannel` directly if doing so would lose access to session events outside the `InteractionEvent` union.

## Command Package Rule

User-visible internal commands belong in `agent-command` or command-module owners that consume `@robota-sdk/agent-framework` command contracts. `agent-framework` owns command infrastructure and reusable common APIs; `agent-cli` composes selected modules and renders generic UI.

## Interface Package Rule

`agent-interface-*` packages contain **only type contracts and interfaces — no implementation**.
They are the SSOT for cross-cutting contracts shared between implementation families.

- `agent-interface-transport` — transport contracts (`ITransportAdapter`, `IConfigurableTransport`, `ITransportConfig`)
- `agent-interface-tui` — TUI interaction contracts (`ITuiPickerItem`, `ITuiCommandInteraction`, `ITuiPickerInteraction`, `ITuiConfirmInteraction`, `TAnyTuiCommandInteraction`)
- Future: `agent-interface-provider`, `agent-interface-plugin` if those families need isolated contracts

Rules:

- An `agent-interface-*` package must not contain classes or runtime logic.
- Implementation packages (`agent-transport` with subpath `/headless`; the per-concern `agent-transport-tui` / `-ws` / `-http` / `-mcp` packages; `agent-provider` with subpaths `/anthropic`, `/openai`, etc.; `agent-command`) depend on the corresponding `agent-interface-*` package, not on `agent-framework`, for interface types. The transport-facing contract types (command, interaction, event, workspace, session, and transport contracts) live in `agent-interface-transport` as their SSOT (per INFRA-010). This is **mechanically enforced** by `scripts/harness/check-interface-imports.mjs` (wired into `pnpm harness:scan` as the `interface-imports` scan): any implementation package that imports an `agent-interface-transport`-exported symbol from `@robota-sdk/agent-framework` fails the gate. Runtime values and framework-owned types (e.g. `TInteractiveSessionOptions`, `ICommandHostContext`, `ICommandModule`, `TSettingsData`) still come from `agent-framework`.
- `agent-framework` depends on the `agent-interface-transport` package to consume the contracts it needs (it does not depend on `agent-interface-tui`, which only `agent-transport-tui` consumes).
- Do not place interface packages in `agent-core` — `agent-core` is zero-deps and owns foundational primitives only.

## Preset Package Rule

`agent-preset` owns the `IPreset` contract, the `resolvePreset` precedence merger, and built-in
preset definitions. It produces option data only — it performs no session assembly and must not
re-export `agent-framework`.

- Dependency edge: `agent-preset → agent-framework` (consumes option types as SSOT, e.g.
  `ICreateSessionOptions['permissionMode']`). This is the package's only workspace dependency.
- `agent-cli` depends on both `agent-preset` (resolver) and `agent-framework` (assembly entry); the
  reverse edges (`agent-framework → agent-preset`, `agent-preset → agent-cli`) must never exist.
- The edge is derived dynamically from `package.json` by
  `scripts/harness/check-dependency-direction.mjs`; keeping the dependency one-way is sufficient for
  the gate (no separate allowlist entry required).

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
