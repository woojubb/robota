# Architecture Map Review — Senior Developer

Source-verified against codebase on 2026-05-18 (branch: develop).

---

## Executive Summary

The architecture map is structurally sound and covers the correct packages, dependency layers, and interface ownership. The class-interface-inventory.md is accurate for the vast majority of entries, and all resolved audit items in layering-audit.md are confirmed in code. The primary issues are: (1) composition-tree.md documents the pre-refactor function signatures and startup sequence rather than the current `createAgentRuntime`-based architecture, making it stale and misleading for developers reading startup code; (2) the WebSocket Sidecar Mode in execution-modes.md documents a feature with no current implementation in the codebase; (3) project-structure.md lists two packages (`auth/`, `credits/`) and one app path (`apps/agent-web-ui`) that do not exist on disk.

---

## Verified Accurate

The following were cross-checked against actual code and confirmed correct.

**File path accuracy (class-interface-inventory.md)**
All 28 file paths in the inventory table were verified. 27 exist on disk. The single miss is noted under Issues.

**Interface ownership:**

- `ITransportAdapter` → `packages/agent-interface-transport/src/transport-adapter.ts` ✓
- `IConfigurableTransport` → `packages/agent-interface-transport/src/transport-config.ts` ✓
- `ITuiCommandInteraction` → `packages/agent-interface-tui/src/command-interaction.ts` ✓
- `ICommandModule`, `ICommandResult`, `TCommandEffect` → `packages/agent-framework/src/command-api/` ✓
- `CommandRegistry` → `packages/agent-framework/src/commands/command-registry.ts` ✓
- `InteractiveSession` → `packages/agent-framework/src/interactive/interactive-session.ts` ✓

**Package dependency direction (agent-cli/package.json verified):**

- `agent-cli` production deps: `agent-command`, `agent-core`, `agent-provider`, `agent-framework`, `agent-subagent-runner`, `agent-transport` — all permitted by dependency-direction.md.
- `agent-executor` is a `devDependency` only in `agent-cli` (used in tests), not a production dep — correct.
- `agent-command` in `agent-transport` is a `devDependency` only (test fixtures) — not a production violation.
- `agent-subagent-runner` prod deps: `agent-core`, `agent-executor`, `agent-framework`, `agent-provider` — no `agent-command` or `agent-cli` dependency, matching the documented rule "must not import from agent-command or agent-cli."
- `agent-framework` prod deps: `agent-core`, `agent-interface-transport`, `agent-executor`, `agent-session`, `agent-tools` — no upward dep. ✓

**Resolved audit findings confirmed:**

- CLI-AUDIT-005: `packages/agent-cli/src/commands/` directory is absent. ✓
- CLI-AUDIT-010: `createDefaultTuiCliAdapter` in `packages/agent-transport/src/tui/create-default-tui-cli-adapter.ts`. ✓
- CLI-AUDIT-018/021: `PrintTerminal` and `promptInput` in `packages/agent-transport/src/headless/`. ✓
- CLI-AUDIT-019: `TransportRegistry` and `createDefaultTransportRegistry` in `packages/agent-transport/src/transport-registry.ts`. `packages/agent-cli/src/transports/` is absent. ✓
- CLI-AUDIT-020: `createDefaultProviderDefinitions` in `packages/agent-provider/src/default-provider-definitions.ts`. ✓
- CLI-AUDIT-023: `packages/agent-command/src/plugins/default-plugin-command-adapter.ts` and `default-plugin-command-source-loader.ts` exist. `packages/agent-cli/src/plugins/` is absent. ✓
- CLI-AUDIT-022: `packages/agent-subagent-runner/` package exists with `child-process-subagent-runner.ts`, `worker-path-resolver.ts`, `child-process-subagent-worker.ts`. ✓

**Actual package list vs repository-overview.md:**
All packages listed in repository-overview.md exist in `packages/`. Packages directory (as of develop): `agent-cli`, `agent-command`, `agent-core`, `agent-executor`, `agent-framework`, `agent-interface-transport`, `agent-interface-tui`, `agent-playground`, `agent-plugin`, `agent-provider`, `agent-remote-client`, `agent-session`, `agent-subagent-runner`, `agent-team`, `agent-tool-mcp`, `agent-tools`, `agent-transport`, `agent-web-ui`. Apps: `agent-server`, `agent-web`, `blog`, `docs`.

---

## Issues Found

### Critical (stale or wrong — will mislead developers)

| ID   | File                         | Documented                                                                                                                                                                                                                      | Actual                                                                                                                                                                                                                                                                                                                          | Impact                                                                                                                              |
| ---- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| C-01 | composition-tree.md          | `startCli()` calls `buildCommandSetup()`, `readProviderSettings()`, `createProviderFromSettings()`, `createDefaultBackgroundTaskRunners()`, `createProjectSessionStore()`, `createChildProcessSubagentRunnerFactory()` directly | `startCli()` calls `createCommandSetup()`, `createProviderSetup()`, `createSessionSetup()`, then `createAgentRuntime()` — background task runners and session store assembly are inside `createAgentRuntime()`; subagent setup is inside `createProviderSetup()`                                                                | Developer reading startup code will not find the documented call sequence; every documented function name is wrong or misattributed |
| C-02 | composition-tree.md          | `cli.ts` is "196 lines, zero function definitions, pure import-and-call"                                                                                                                                                        | `cli.ts` is **98 lines** (verified: `wc -l` = 98)                                                                                                                                                                                                                                                                               | Developer trusts the line count as a health metric for the "pure composition root" constraint; a doubled value breaks that signal   |
| C-03 | composition-tree.md          | `new InteractiveSession({...})` is constructed inside `runPrintMode()` and `useInteractiveSession()`                                                                                                                            | `runPrintMode()` calls `runtime.createSession()` (via `IAgentRuntime`); `new InteractiveSession` is constructed inside `use-interactive-session-init.ts::initializeSession()`, not directly in `useInteractiveSession()`                                                                                                        | Misleads developers looking for where session construction occurs during startup                                                    |
| C-04 | class-interface-inventory.md | `createProviderFromSettings()` is owned by `agent-cli/src/utils/provider-factory.ts`                                                                                                                                            | File does not exist. `createProviderFromSettings()` is exported from `@robota-sdk/agent-framework`; it is called from `packages/agent-cli/src/startup/provider-setup.ts::createProviderSetup()`                                                                                                                                 | A developer looking to modify the provider factory will look in the wrong package                                                   |
| C-05 | execution-modes.md           | WebSocket Sidecar Mode documents `startWebSidecarServer()` from `agent-cli/src/web-sidecar/web-sidecar-server.ts`, `--web` flag, `robota --web [--web-port N]`                                                                  | Neither `web-sidecar/` directory, `startWebSidecarServer`, nor `--web` flag exist anywhere in `packages/agent-cli/src/`. No reference in `cli-args.ts`, `tui-mode.ts`, or `preflight.ts`. The `agent-web-ui/docs/SPEC.md` references `startWebSidecarServer` as a known entity in agent-cli, but it is absent from the codebase | Developer will waste time searching for dead code; a new feature implementing this will not know if it was deleted or never built   |
| C-06 | composition-tree.md          | `new TuiTransport({ cwd, provider, ..., transportRegistry, cliAdapter })` — TuiTransport takes these fields directly                                                                                                            | `TuiTransport` constructor takes `options: ITuiRenderOptions` which has a `runtime: IAgentRuntime` field; `renderApp()` destructures `{ runtime, ...tuiOptions }` and spreads `runtime` fields onto `App`                                                                                                                       | Developer adding a TuiTransport option will pass the wrong shape                                                                    |

### Major (missing or incomplete)

| ID   | File                                             | Issue                                                                                                                                                                                                                                                                                                                                                                                                                | Impact                                                                                                                                                                                            |
| ---- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| M-01 | composition-tree.md                              | Startup layer decomposition into `args-to-options.ts`, `config-phase.ts`, `preflight.ts`, `session-setup.ts`, `subagent-setup.ts`, `update-notice.ts` is not shown                                                                                                                                                                                                                                                   | Developer refactoring startup will miss the actual module boundaries; the boundary between "preflight" (early-exit) and "assembly" layers is a key architectural decision not visible in the tree |
| M-02 | composition-tree.md                              | `App.tsx` render tree is incomplete: `StreamingIndicator`, `TransportTUI`, `UpdateNotice`, `usePluginCallbacks`, `useStatusLineSettings`, `TuiCliAdapterProvider` are all imported and used in `App.tsx` but absent from the composition tree. `StatusBar` is listed but it is a sub-component of `SessionStatusBar`, not a direct App.tsx child. `SlashAutocomplete` is imported inside `InputArea`, not `App.tsx`. | A developer adding a new TUI component or modifying App.tsx will have a false mental model of the render tree                                                                                     |
| M-03 | composition-tree.md                              | `CommandEffectQueue` is documented as owned by `agent-transport/src/tui/command-interaction.ts` (both in the tree and the inventory); actual class is in `hooks/command-effect-queue.ts`. `command-interaction.ts` is a thin re-export of types from `agent-interface-tui`.                                                                                                                                          | Developers looking for the `CommandEffectQueue` implementation will open the wrong file                                                                                                           |
| M-04 | project-structure.md                             | Lists `packages/auth/` and `packages/credits/` as existing packages                                                                                                                                                                                                                                                                                                                                                  | Neither directory exists on disk (`ls packages/auth` → NOT FOUND, `ls packages/credits` → NOT FOUND). They appear to be planned packages                                                          | Developers reading this as current state will look for non-existent code; CI tooling relying on this list would break |
| M-05 | project-structure.md                             | Lists `apps/agent-web-ui/` as the web app                                                                                                                                                                                                                                                                                                                                                                            | Actual directory is `apps/agent-web/` (package name `@robota-sdk/agent-web-ui` is the _packages/_ entry, not apps). repository-overview.md correctly says `apps/agent-web`.                       | A new developer cloning the repo and following project-structure.md will navigate to the wrong path                   |
| M-06 | class-interface-inventory.md                     | `reloadPluginCommandSource()` documented as owned by `agent-command/src/plugins/default-plugin-command-source-loader.ts`; used by `startCli()` and `TUI adapter`                                                                                                                                                                                                                                                     | The function is passed as a closure from `command-setup.ts` through `tui-mode.ts` into `TuiTransport` options — the composition chain is not described                                            | Developer adding plugin reload wiring will miss the actual pass-through path                                          |
| M-07 | repository-overview.md / dependency-direction.md | No mention of `auth` and `credits` as future/planned packages, even as a note                                                                                                                                                                                                                                                                                                                                        | Project-structure lists them with descriptions; the overview should either drop them or mark them `[planned]` to disambiguate current from future state                                           |

### Minor (improvements)

| ID    | File                              | Issue                                                                                                                                                                                                                                                                                                  | Impact                                                                                                                                                    |
| ----- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| mn-01 | composition-tree.md               | Source-verified date is 2026-05-17 against `refactor/arch-002-slim-agent-cli`, but that branch has since merged to `develop`. The date is current but the branch reference is stale.                                                                                                                   | Low — date is still useful, but the branch ref is no longer meaningful                                                                                    |
| mn-02 | layering-audit.md                 | CLI-AUDIT-012 (getSettingsPathForScope → agent-framework) status is "resolved" but no commit hash or PR number is provided, violating the evidence policy stated at the top of the file. Same for CLI-AUDIT-013 through CLI-AUDIT-023 — they all cite only the branch name.                            | Evidence policy ("may not be marked resolved without a verification artifact — commit hash, PR number, or grep-output") is violated for 12 of 23 findings |
| mn-03 | class-interface-inventory.md      | `ITerminalOutput` documented as "agent-core (re-exported via agent-framework)." The actual ownership location in agent-core is unspecified, making it hard to find                                                                                                                                     | Minor discoverability gap                                                                                                                                 |
| mn-04 | execution-modes.md                | Non-interactive print mode diagram shows `CLI->>SDK: new InteractiveSession(...)` but actual code uses `runtime.createSession(...)` via `IAgentRuntime`                                                                                                                                                | Diagram is pre-`createAgentRuntime` refactor; matches the C-03 stale pattern                                                                              |
| mn-05 | commands-and-provider-flow.md     | Provider flow sequence diagram references `provider-setup.ts` but the actual file is `startup/provider-setup.ts` (moved per CLI-AUDIT-013). Path mismatch is minor given no absolute path is claimed.                                                                                                  | No confusion if reading alongside the startup file listing                                                                                                |
| mn-06 | agent-cli-composition.md (router) | References `packages/agent-cli/src/bin.ts` in governance update triggers. `bin.ts` is a single-line entry point that just calls `startCli()`. The meaningful composition file is `cli.ts` — which the router also lists. `bin.ts` is not a composition root and does not need architecture governance. | Cosmetic; developer will correctly proceed to `cli.ts`                                                                                                    |

---

## Detailed Findings

### C-01, C-02, C-06: composition-tree.md is pre-refactor

The composition tree was authored against `refactor/arch-002-slim-agent-cli` and shows the pre-`createAgentRuntime` call sequence. The actual `cli.ts` (98 lines, not 196) is:

```
startCli()
  parseArgsOrExit()
  readVersion()
  new PrintTerminal()
  handlePreflightCommands()         // early-exit gate
  toConfigPhaseOptions()            // args boundary
  runUserLocalDirectCommandIfRequested()
  createCommandSetup()              // was: buildCommandSetup()
  handleConfigPhase()               // was: runInteractiveProviderSetup() / ensureConfig()
  createProviderSetup()             // was: readProviderSettings() + createProviderFromSettings() inline
  createSessionSetup()              // was: createProjectSessionStore()
  createAgentRuntime({ ... })       // assembles background runners + session store internally
  runPrintMode(sessionOpts, runtime)  // not: new InteractiveSession()
  OR runTuiMode({ runtime, ... })   // not: new TuiTransport({ cwd, provider, ... })
```

The `createDefaultBackgroundTaskRunners()` is called inside `agent-framework/src/runtime/agent-runtime.ts`, not in `cli.ts`.

`TuiTransport` constructor takes `ITuiRenderOptions` which has `runtime: IAgentRuntime`. The tree documents `{ cwd, provider, ..., transportRegistry, cliAdapter }` — these fields are extracted from `runtime` inside `renderApp()` / `App.tsx`.

### C-03: InteractiveSession construction location

The tree documents `new InteractiveSession({...})` inside both `runPrintMode()` and `useInteractiveSession()`. In reality:

- `runPrintMode()` calls `runtime.createSession()` (avoids direct `InteractiveSession` dep in modes/).
- `new InteractiveSession(...)` is constructed in `packages/agent-transport/src/tui/hooks/use-interactive-session-init.ts::initializeSession()`, which is called from `useInteractiveSession()` via a `useRef`-guarded initialization block.

### C-04: createProviderFromSettings ownership

Inventory row: `createProviderFromSettings` owned by `agent-cli/src/utils/provider-factory.ts` — this file does not exist. The function lives in `@robota-sdk/agent-framework` and is imported in `packages/agent-cli/src/startup/provider-setup.ts::createProviderSetup()`:

```typescript
import { ..., createProviderFromSettings } from '@robota-sdk/agent-framework';
```

The test file `__tests__/provider-factory-integration.test.ts` also imports it from agent-framework, confirming ownership.

### C-05: WebSocket Sidecar Mode not implemented

`execution-modes.md` documents a complete WebSocket Sidecar Mode including `--web` and `--web-port` flags, `startWebSidecarServer()`, and `agent-cli/src/web-sidecar/web-sidecar-server.ts`. None of these exist:

```
find packages/agent-cli/src -name "*sidecar*" -o -name "*web-sidecar*"  # no results
grep -r "startWebSidecarServer" packages/                               # one SPEC reference, no source
grep -r "\-\-web\b" packages/agent-cli/src/                             # no results
```

The `agent-web-ui/docs/SPEC.md` mentions `startWebSidecarServer` as if it exists in agent-cli, suggesting this was planned or once existed but was removed. The execution-modes.md document should either mark this section `[planned]` or remove it until implemented.

### M-02: App.tsx render tree incomplete

Components in `App.tsx` not in composition-tree.md:

| Component/Hook            | File                                 |
| ------------------------- | ------------------------------------ |
| `<StreamingIndicator>`    | `tui/StreamingIndicator.tsx`         |
| `<TransportTUI>`          | `tui/TransportTUI.tsx`               |
| `<UpdateNotice>`          | `tui/UpdateNotice.tsx`               |
| `usePluginCallbacks()`    | `tui/hooks/usePluginCallbacks.ts`    |
| `useStatusLineSettings()` | `tui/hooks/useStatusLineSettings.ts` |
| `<TuiCliAdapterProvider>` | `tui/tui-cli-adapter-context.tsx`    |

Components in composition-tree.md that are **indirect** (not direct App.tsx children):

- `<StatusBar>` — rendered inside `<SessionStatusBar>`, not directly by App.tsx
- `<SlashAutocomplete>` — rendered inside `<InputArea>`, not directly by App.tsx

### M-03: CommandEffectQueue file location

Inventory and tree both say `agent-transport/src/tui/command-interaction.ts` owns `CommandEffectQueue`.

Actual:

- `command-interaction.ts` contains only `export type { ... }` re-exports from `@robota-sdk/agent-interface-tui` (9 lines).
- `CommandEffectQueue` class is in `agent-transport/src/tui/hooks/command-effect-queue.ts` (verified: `export class CommandEffectQueue implements ICommandEffectQueue`).

### M-04, M-05: project-structure.md phantom entries

```
ls packages/auth     # No such file or directory
ls packages/credits  # No such file or directory
ls apps/agent-web-ui # No such file or directory (correct path: apps/agent-web/)
```

`project-structure.md` lists both `auth/` and `credits/` at the top with descriptions. These are future packages; they have no source code. The `apps/agent-web-ui/` path is wrong — the actual directory is `apps/agent-web` (package name `@robota-sdk/agent-web-ui` belongs to `packages/agent-web-ui/`, the browser monitor library).

### mn-02: Layering-audit evidence policy violations

The evidence policy requires "a commit hash, PR number, or grep-output." Of 23 audit items, 12 (CLI-AUDIT-012 through CLI-AUDIT-023) are marked resolved with only a branch name: `branch refactor/arch-002-slim-agent-cli (2026-05-17)`. The branch has since merged and the name no longer identifies a uniquely verifiable artifact in `git log`. The fixes are real and verified — the documentation just needs the merge commit or PR number added.

---

## Recommendations

**Priority 1 — Fix before next developer onboarding (misleads immediately):**

1. **Rewrite composition-tree.md startup section** to match the actual `createAgentRuntime`-based startup. Replace the old flat call-sequence with the actual layered structure: preflight → config-phase → command/provider/session setup → `createAgentRuntime()` → `runPrintMode(runtime)` / `runTuiMode({ runtime, ... })`. Correct the line count (98, not 196) and the `TuiTransport` constructor signature.

2. **Fix class-interface-inventory.md row for `createProviderFromSettings`**: change owner to `agent-framework` and remove the stale `agent-cli/src/utils/provider-factory.ts` path. Note it is called via `createProviderSetup()` in `agent-cli/src/startup/provider-setup.ts`.

3. **Mark or remove WebSocket Sidecar Mode in execution-modes.md**: add a `> [Planned — not yet implemented]` callout or remove the section until the feature exists. The absence of `web-sidecar/` is confusing given the detailed implementation diagram.

**Priority 2 — Fix before architecture review or dependency audit:**

4. **Fix `CommandEffectQueue` owner in class-interface-inventory.md**: change `agent-transport/src/tui/command-interaction.ts` to `agent-transport/src/tui/hooks/command-effect-queue.ts`.

5. **Fix project-structure.md phantom entries**: remove `packages/auth/` and `packages/credits/` or mark them `[planned — not yet created]`; correct `apps/agent-web-ui/` to `apps/agent-web/`.

6. **Add missing startup modules to composition-tree.md**: at minimum note `startup/args-to-options.ts` (arg-to-typed-option boundary), `startup/preflight.ts` (early-exit gate), `startup/config-phase.ts`, and `startup/subagent-setup.ts`. These reflect architectural decisions worth preserving in documentation.

**Priority 3 — Evidence and completeness improvements:**

7. **Add merge commit or PR numbers to CLI-AUDIT-012 through CLI-AUDIT-023** to satisfy the evidence policy the document itself declares.

8. **Extend App.tsx render tree** in composition-tree.md to include `StreamingIndicator`, `TransportTUI`, `UpdateNotice`, `usePluginCallbacks`, `useStatusLineSettings`, and `TuiCliAdapterProvider`. Correct the parent attribution for `StatusBar` (inside `SessionStatusBar`) and `SlashAutocomplete` (inside `InputArea`).

9. **Non-interactive print mode sequence in execution-modes.md**: update the `CLI->>SDK: new InteractiveSession(...)` arrow to `CLI->>SDK: runtime.createSession(...)` for accuracy.
