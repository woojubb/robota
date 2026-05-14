# Agent CLI Commands and Provider Flow

Source-verified against `develop` on 2026-05-15.

Command-layer boundaries, provider setup, profile switching, and model catalog flow.

## Built-in Command Layer

```mermaid
flowchart LR
  Product["agent-cli\ncomposition root"]
  Module["@robota-sdk/agent-command-*\nICommandModule owner"]
  SDKContracts["agent-sdk command-api\nICommandModule, ISystemCommand,\nICommandResult, effects, interactions"]
  SDKCommon["agent-sdk common APIs\nprovider setup, model catalog,\nprompt file references,\nsession/context/background helpers"]
  Session["InteractiveSession\nSystemCommandExecutor"]
  TUI["agent-cli TUI\nslash prefix, generic prompts,\ntyped host effects"]
  HostAdapters["CLI host adapters\nsettings, plugin UI, local shell services"]

  Product --> Module
  Module --> SDKContracts
  Module --> SDKCommon
  Product --> Session
  Product --> TUI
  Product --> HostAdapters
  Session --> SDKContracts
  TUI --> Session
  TUI --> HostAdapters
  HostAdapters --> Module
```

| Responsibility                                                         | Owner                                                       |
| ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| Slash prefix detection and unknown-command rendering                   | `agent-cli`                                                 |
| Command metadata, subcommands, lifecycle policy, interactions, effects | Owning `agent-command-*` package                            |
| Command contracts, registry, executor, effect/interaction types        | `agent-sdk`                                                 |
| Reusable command common APIs and ports                                 | `agent-sdk/src/command-api/*`                               |
| Prompt `@file` parsing, workspace-bound resolution, diagnostics        | `agent-sdk/src/context/prompt-file-reference-*.ts`          |
| Context reference inventory and manual reference state                 | `agent-sdk/src/context/context-reference-inventory.ts`      |
| Host persistence, local process actions, UI shell actions              | `agent-cli` host adapters and TUI effect handlers           |
| Provider setup semantics for `/provider`                               | `agent-command-provider` consuming SDK provider common APIs |
| Model-change request semantics for `/model`                            | `agent-command-model` consuming SDK model common APIs       |

Forbidden: command packages must not import `agent-cli` or React/Ink code; `agent-sdk` must not
import `agent-command-*`; CLI hooks must not reimplement command-specific setup flows; provider
packages must not know slash commands or TUI behavior.

## Provider and Model State Flow

```mermaid
sequenceDiagram
  participant Args as parseCliArgs()
  participant Setup as provider-setup.ts
  participant Factory as provider-factory.ts
  participant Defs as IProviderDefinition[]
  participant SDKCommon as SDK provider common APIs
  participant Command as agent-command-provider
  participant CLI as agent-cli host adapters
  participant Session as InteractiveSession

  Args->>Setup: --configure / --configure-provider / startup setup
  Setup->>Defs: render setupSteps and defaults generically
  Setup->>SDKCommon: suggest model-derived profile key with duplicate suffixes
  Setup->>Factory: update settings document through settings-io
  Args->>Factory: --provider and --model overrides
  Factory->>Factory: merge user, project, project-local, and compatibility settings
  Factory->>Defs: find provider definition by type or alias
  Factory->>Defs: definition.createProvider(config)
  Factory-->>CLI: IAIProvider plus selected model id
  CLI->>Session: new InteractiveSession({ provider, commandModules })
  CLI->>Command: inject providerDefinitions and settings adapter
  Command->>SDKCommon: create setup flow, validate profile, build settings patch
  Command->>CLI: typed session-restart-requested effect after /provider use or add
  CLI->>CLI: apply typed effect by shutting down so next process uses new settings
```

Settings ownership:

- `agent-cli` owns concrete settings file paths and provider instance construction.
- `agent-command-provider` owns `/provider` command semantics and settings patches.
- `agent-sdk` owns common provider settings/setup/probe APIs and generated profile-key suggestions.
- Provider packages own defaults, setup metadata, validation, aliases, probes, options, and `createProvider()`.
- Profile identity is the settings profile key — not provider type/model uniqueness.
- Model catalog refresh: provider packages own `refreshModelCatalog` and `modelCatalogCacheTtlSeconds`; SDK model command common APIs orchestrate TTL-based auto-refresh; CLI/TUI renders freshness state only.
