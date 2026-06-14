# Agent CLI Layering Audit

Source-verified against `develop` on 2026-06-14.

Resolved audit findings, durable lessons, and mechanical guard candidates.

> **Evidence policy**: An item may not be marked "resolved" without a verification artifact — a
> commit hash, PR number, or grep-output confirming the fix is present in the codebase.

## Layering Audit

### CLI-AUDIT-001: CLI imports `agent-session` directly

Status: resolved — PR #205.

Session persistence construction now lives behind framework-owned APIs in
`agent-framework/src/interactive/session-persistence.ts`. CLI calls `createProjectSessionStore(cwd)` and
related facades from `@robota-sdk/agent-framework`; it has no direct dependency on
`@robota-sdk/agent-session`.

Mechanical guard: `scripts/harness/check-command-layering.mjs` flags production CLI imports from
`@robota-sdk/agent-session`.

### CLI-AUDIT-002: TUI command effects were queued by mutating `InteractiveSession`

Status: resolved — `fix/cli-command-effect-boundary`.

`CommandEffectQueue` (`agent-transport/src/tui/command-interaction.ts`) now owns the explicit
effect transport. `InteractiveSession` is no longer used as an `ISideEffects` mutable carrier.

Mechanical guard: `scripts/harness/check-command-layering.mjs` flags `_pendingCommandInteraction`,
`_pendingCommandEffects`, and `InteractiveSession & ISideEffects` usage.

### CLI-AUDIT-003: Provider model catalog refresh layer incomplete

Status: resolved — PR #401 (`feat(prov-001)`).

Live refresh adapters exist for Anthropic, Gemini, Qwen, OpenAI, and DeepSeek via
provider-owned `refreshModelCatalog` hooks. TTL-based auto-refresh (`modelCatalogCacheTtlSeconds`)
is wired in `model-command-api.ts`. CLI/TUI renders freshness state only.

### CLI-AUDIT-004: Legacy assembly architecture doc was stale

Status: resolved — `packages/agent-cli/docs/ASSEMBLY-ARCHITECTURE.md` now redirects to this map.

### CLI-AUDIT-005: CLI command compatibility shims blur command ownership

Status: resolved — `refactor/cli-command-shims-retirement`.

`agent-cli/src/commands/` compatibility surface removed. TUI imports `CommandRegistry` and command
contract types directly from `@robota-sdk/agent-framework`.

Mechanical guard: command-layering harness scans for new CLI command shim files under
`packages/agent-cli/src/commands`.

### CLI-AUDIT-006: Local runtime adapters need owner boundary audit

Status: resolved.

| File                                                                          | Classification                                                            |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `agent-executor/src/background-tasks/runners/managed-shell-process-runner.ts` | Executor adapter — Node spawn, stdin, cancellation (moved from agent-cli) |
| `agent-subagent-runner/src/child-process-subagent-runner.ts`                  | Optional package — Node fork, worker path, payload (moved from agent-cli) |
| `agent-subagent-runner/src/child-process-subagent-ipc.ts`                     | Optional package — IPC protocol types                                     |
| `agent-subagent-runner/src/child-process-subagent-worker.ts`                  | Optional package — worker entry point                                     |
| `agent-subagent-runner/src/worker-path-resolver.ts`                           | Optional package — bundled worker path resolver                           |
| `agent-executor/src/subagents/git-worktree-isolation-adapter.ts`              | Executor adapter — worktree port impl                                     |
| `agent-executor/src/background-tasks/log-pages.ts`                            | Runtime primitive — bounded output + pagination                           |

### CLI-AUDIT-007: SDK public exports hide package ownership

Status: resolved.

SDK public surface is classified in `packages/agent-framework/docs/PUBLIC-SURFACE.md`. `agent-executor`
re-exports are allowed only from `agent-framework/src/background-tasks/index.ts` and
`agent-framework/src/subagents/index.ts`.

Mechanical guard: `pnpm harness:scan:sdk-public-surface` rejects broad `export *` barrels and
pass-through exports from `agent-core`, `agent-session`, or `agent-tools`.

### CLI-AUDIT-008: Prompt file references must not move into TUI input handling

Status: resolved — `feat/cli-at-file-reference-import`.

`agent-framework` owns `@file` token parsing, workspace-root enforcement, byte limits, diagnostics, and
structured `prompt-file-reference` history records. CLI routes non-slash text to
`InteractiveSession.submit()` unchanged.

### CLI-AUDIT-009: CLI-visible features must not become CLI-owned features

Status: active guardrail.

`agent-cli` may own: terminal rendering, input handling, keyboard navigation, ephemeral selection
state, and concrete local host adapters.

`agent-cli` must not own: durable feature behavior, lifecycle state machines, task registries,
command behavior, provider semantics, permission policy, persistence contracts, retention policy,
background task grouping, or transport-visible contracts.

If a TUI component needs data or behavior not exposed by `agent-framework` or a lower owner, add the
framework/executor/command/provider capability first.

### CLI-AUDIT-010: createTuiCliAdapter belongs in agent-transport

Status: resolved — commit c4282565c (refactor/arch-002-slim-agent-cli, 2026-05-17).

`createDefaultTuiCliAdapter` moved to `packages/agent-transport/src/tui/create-default-tui-cli-adapter.ts`.
`cli.ts` imports and calls it — no local definition.

### CLI-AUDIT-011: cli.ts contains behavior logic — must be pure composition root

Status: resolved — commit c4282565c (refactor/arch-002-slim-agent-cli, 2026-05-17).

All behavior functions extracted:

- `readVersion` → `src/startup/version.ts`
- `resetConfig` → `src/startup/reset-config.ts`
- `buildAppendSystemPrompt` → `src/startup/append-system-prompt.ts`
- `buildCommandSetup` → `src/startup/command-setup.ts`
- `runPrintMode` → `src/modes/print-mode.ts`
- `createDefaultTransportRegistry` → `src/transports/transport-registry.ts`

`cli.ts` defines no behavior helper functions — all such logic lives in `src/startup/*`, `src/modes/*`,
and lower packages. As of 2026-06-14 the file is 316 lines (grown from 196 by the PRESET-002/004/007/011
selection wiring, the first-run/onboarding gate, and the `diagnose` / `session analyze` / `init`
early-exit gates), but it remains import-and-wire only: `startCli()` sequences gates and assembly inline
without local helper definitions.

### CLI-AUDIT-012: `getSettingsPathForScope` belongs in agent-framework

Status: resolved — branch refactor/arch-002-slim-agent-cli (2026-05-17).

`getSettingsPathForScope(cwd, scope: string | undefined)` in `utils/provider-setup.ts` is
pure path resolution logic with no CLI-type dependencies. Equivalent path-resolution functions
(`getUserSettingsPath`, `resolveProviderSettingsWriteTargetPath`) already live in agent-framework.

Target: rename to `resolveSettingsPathForScope`, move to agent-framework, validate scope values
in agent-cli before calling.

### CLI-AUDIT-013: `utils/provider-setup.ts` is startup orchestration, not a utility

Status: resolved — branch refactor/arch-002-slim-agent-cli (2026-05-17).

`provider-setup.ts` moved to `src/startup/provider-startup.ts`. Old file and test deleted.
New test at `src/startup/__tests__/provider-startup.test.ts`.

### CLI-AUDIT-014: `ensureConfig` and `runInteractiveProviderSetup` coupled to `IParsedCliArgs`

Status: resolved — branch refactor/arch-002-slim-agent-cli (2026-05-17).

`ensureConfig(cwd, args: IParsedCliArgs, ...)` and `runInteractiveProviderSetup(cwd, args: IParsedCliArgs, ...)`
use only `args.provider` and `args.settingsScope` respectively. Passing the full CLI arg struct
prevents these functions from moving to `agent-command` (where their setup flow logic naturally belongs).

Target: extract `IProviderSetupContext { provider?: string; settingsScope?: string | undefined }`
interface in agent-command. Move `ensureConfig` and `runInteractiveProviderSetup` to agent-command.
CLI maps `IParsedCliArgs` → `IProviderSetupContext` at call site.

### CLI-AUDIT-015: agent-cli plugin files have uncovered catch blocks

Status: resolved — branch refactor/arch-002-slim-agent-cli (2026-05-17).

`plugin-command-source-loader.ts` and `plugin-command-adapter.ts` catch blocks now have
`// allow-fallback: <reason>` comments (added inline; formatter moved to next line on disk).

### CLI-AUDIT-016: `isInteractiveTerminal` — terminal I/O check leaked into agent-command

Status: resolved — branch refactor/arch-002-slim-agent-cli (2026-05-17).

`agent-command/src/provider/provider-startup.ts` contained `process.stdin.isTTY` /
`process.stdout.isTTY` — a terminal I/O concern that belongs in the CLI layer.

Fix: added `isInteractive?: () => boolean` to `IEnsureProviderConfigOptions`. `agent-command`
defaults the check to `() => false` (safe: non-interactive). `agent-cli` supplies the real
TTY check via `isInteractive: () => process.stdin.isTTY === true && process.stdout.isTTY === true`.

### CLI-AUDIT-017: `process.cwd()` fallback hidden in `createSkillsCommandModule`

Status: resolved — branch refactor/arch-002-slim-agent-cli (2026-05-17).

`agent-command/src/skills/skills-command-module.ts` used `options.cwd ?? process.cwd()`,
making `cwd` silently depend on the process working directory when omitted.

Fix: `cwd` is now required in `ISkillsCommandModuleOptions`. All callers already supplied it
explicitly; no call-site changes needed.

### CLI-AUDIT-018: `PrintTerminal` — stdio adapter owned by CLI, belongs in agent-transport/headless

Status: resolved — branch refactor/arch-002-slim-agent-cli (2026-05-17).

`packages/agent-cli/src/print-terminal.ts` implemented `ITerminalOutput` using Node.js `readline`
and `process.stdout`/`stderr`. This is a terminal I/O adapter for print/headless mode — the same
category as `HeadlessTransport` which already lives in `packages/agent-transport/src/headless/`.

Fix: moved to `packages/agent-transport/src/headless/print-terminal.ts`. Exported from
`@robota-sdk/agent-transport/headless`. `agent-cli/src/cli.ts` now imports from
`@robota-sdk/agent-transport/headless`. Original file deleted.

### CLI-AUDIT-019: `TransportRegistry` — settings-backed transport manager owned by CLI, belongs in agent-transport

Status: resolved — branch refactor/arch-002-slim-agent-cli (2026-05-17).

`packages/agent-cli/src/transports/transport-registry.ts` had zero CLI-specific type dependencies.
It used only `TUniversalValue` from agent-core, `IInteractiveSession` / settings-io from
agent-framework, and `IConfigurableTransport` / `ITransportConfig` / `ITransportEntry` from
agent-interface-transport — all framework-layer contracts.

Fix: moved to `packages/agent-transport/src/transport-registry.ts`. Exported `TransportRegistry`
and `createDefaultTransportRegistry` from `@robota-sdk/agent-transport` root. `agent-cli/src/cli.ts`
now imports `createDefaultTransportRegistry` from `@robota-sdk/agent-transport`. Original file and
`transports/` directory deleted.

### CLI-AUDIT-020: `DEFAULT_PROVIDER_DEFINITIONS` — default provider set owned by CLI, belongs in agent-provider

Status: resolved — branch refactor/arch-002-slim-agent-cli (2026-05-17).

`packages/agent-cli/src/utils/provider-default-definitions.ts` assembled the standard set of all
`IProviderDefinition` instances. It had zero CLI-specific type dependencies — only `IProviderDefinition`
from `agent-core` and factory functions from `@robota-sdk/agent-provider/*` sub-paths.

The decision of "which providers are available by default" is a provider package concern.
`agent-provider` already re-exports all providers from its root.

Fix: added `createDefaultProviderDefinitions()` to `packages/agent-provider/src/default-provider-definitions.ts`,
exported from `@robota-sdk/agent-provider` root. All callers in `agent-cli` now import from
`@robota-sdk/agent-provider`. Original file deleted.

### CLI-AUDIT-021: `promptInput` — raw stdin adapter owned by CLI, belongs in agent-transport/headless

Status: resolved — branch refactor/arch-002-slim-agent-cli (2026-05-17).

`packages/agent-cli/src/utils/cli-input.ts` implemented raw-mode stdin reading for masked
API key entry. It had zero CLI-specific type dependencies — same category as `PrintTerminal`
which already moved to `agent-transport/headless`.

Fix: moved to `packages/agent-transport/src/headless/cli-input.ts`. Exported `promptInput`
from `@robota-sdk/agent-transport/headless`. `agent-cli/src/cli.ts` imports `promptInput`
alongside `PrintTerminal` from `@robota-sdk/agent-transport/headless`. Original file deleted.

### CLI-AUDIT-022: `ChildProcessSubagentRunner` + worker — concrete runtime owned by agent-framework/agent-cli, belongs in dedicated package

Status: resolved — branch refactor/arch-002-slim-agent-cli (2026-05-17).

`packages/agent-framework/src/subagents/child-process-subagent-runner.ts` (runner + factory) and
`packages/agent-cli/src/subagents/child-process-subagent-worker.ts` (worker entry point) were split
across two packages with no clear owner. The runner having no provider dependencies forced either
bundling `agent-provider` into `agent-framework` (bloating all framework consumers with 6 provider
SDKs) or keeping the worker in `agent-cli` (which should be a composition-only root).

Subagent support is optional — applications that don't need child-process subagents should not
carry the dependency. The correct design makes child-process execution an opt-in package.

Fix: created new package `@robota-sdk/agent-subagent-runner`. Moved to it:

- `ChildProcessSubagentRunner`, `createChildProcessSubagentRunnerFactory` (from agent-framework)
- `child-process-subagent-worker.ts` (from agent-cli)
- IPC types (`child-process-subagent-ipc.ts`)
- Transport/result helpers
- `getDefaultSubagentWorkerPath()` (new — resolves bundled worker path within the package)

`agent-framework` retains only `TSubagentRunnerFactory` (port type) and `createInProcessSubagentRunner`
(depends on `InteractiveSession`, cannot leave). `agent-cli` now imports
`createChildProcessSubagentRunnerFactory` and `getDefaultSubagentWorkerPath` from
`@robota-sdk/agent-subagent-runner`; the manual worker path construction is removed.

### CLI-AUDIT-023: `plugin-command-adapter` + `plugin-command-source-loader` — plugin bridge owned by agent-cli, belongs in agent-command

Status: resolved — branch refactor/arch-002-slim-agent-cli (2026-05-17).

`packages/agent-cli/src/plugins/plugin-command-adapter.ts` and `plugin-command-source-loader.ts`
had zero CLI-specific type dependencies — only `agent-framework` types and Node.js stdlib.
Both bridge BundlePlugin system (agent-framework) → CommandSource / ICommandPluginAdapter
(agent-command contracts).

Original plan was to move to `agent-framework`, but `agent-framework` cannot import from
`agent-command` (stack order violation). The correct owner is `agent-command`, which already
depends on `agent-framework` and owns all command-layer contracts.

Fix:

- Created `packages/agent-command/src/plugins/default-plugin-command-adapter.ts`
  (renamed `createCliPluginCommandAdapter` → `createDefaultPluginCommandAdapter`)
- Created `packages/agent-command/src/plugins/default-plugin-command-source-loader.ts`
- Exported both from `@robota-sdk/agent-command`
- `agent-cli` imports both from `@robota-sdk/agent-command`; `plugins/` directory deleted

### CLI-AUDIT-024: preset wiring must stay a thin shell — feature logic belongs in agent-preset/agent-framework

Status: resolved — PRESET-002/004/007/011 (3.0.0-beta.75).

The CLI gained `--preset <id>` (`utils/cli-args.ts`) plus startup preset selection. The risk is that
preset feature logic (precedence merge, posture mapping, default identity, external preset loading,
application to a session) leaks into the CLI shell.

Resolution — the CLI owns selection glue only:

- `src/startup/preset-selection.ts` exposes `selectPresetId(args, settingsPreset)` (`--preset` >
  `settings.preset` > `'default'`) and `resolveCliPreset(args, settingsPreset)`, which only builds the
  CLI-flag override set and calls `resolvePreset` (agent-preset). The precedence merge lives entirely
  inside `resolvePreset`, never in the CLI.
- `cli.ts` calls `loadExternalPresets()` (agent-preset) to register `~/.robota/presets/*.json`; per-file
  validation errors are surfaced as warnings and are non-fatal.
- Preset profile data, `resolvePreset`, `loadExternalPresets`, and `DEFAULT_AGENT_NAME` are owned by
  `@robota-sdk/agent-preset`. Application of the resolved option bundle to a session
  (`applyPresetToSession`) is owned by `@robota-sdk/agent-framework`.
- The CLI forwards the resolved bundle (model override, persona, agentName, activePresetId,
  permissionMode, enabled/disabled command modules, enableParallelSubagents, selfVerification) into
  `buildCommandSetup`, `runPrintMode`, and `renderApp` without re-applying any preset semantics.

Mechanical guard candidate: scan `packages/agent-cli/src` for preset precedence/merge logic (a
`resolvePreset`-equivalent merge implemented outside `@robota-sdk/agent-preset`) and reject it.
