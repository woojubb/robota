# SPEC.md — @robota-sdk/agent-cli

## Scope

Interactive terminal AI coding assistant. A React + Ink-based TUI, corresponding to Claude Code.
A **thin CLI layer** built on top of agent-sdk, responsible only for the terminal UI.

## Boundaries

- Does NOT own Session/SessionStore — handled internally by `@robota-sdk/agent-sdk`; CLI must NOT import from `@robota-sdk/agent-sessions`
- Does NOT own tools — assembled internally by `@robota-sdk/agent-sdk`; CLI must NOT import from `@robota-sdk/agent-tools`
- Does NOT own permissions/hooks — public types imported from `@robota-sdk/agent-core`; permission callback type (`TInteractivePermissionHandler`) owned by `@robota-sdk/agent-sdk`
- Does NOT own config/context loading — loaded internally by `InteractiveSession` constructor
- Does NOT own prompt file-reference parsing, path resolution, file reads, recursion limits, size
  limits, or diagnostics for `@file` syntax — handled by `@robota-sdk/agent-sdk`; CLI only passes
  submitted non-command prompt text to `InteractiveSession.submit()`
- Does NOT own context reference inventory or `/context add/remove/clear` file operations — handled
  by SDK command common APIs and `@robota-sdk/agent-command-context`; CLI/TUI only renders command output
- Does NOT own automatic project memory capture, retrieval, approval policy, or memory storage — handled by `@robota-sdk/agent-sdk`; CLI/TUI may only render command output and notices
- Does NOT own edit checkpoint capture, storage, or restore algorithms — handled by `@robota-sdk/agent-sdk`; CLI/TUI may only route `/rewind`, render command output, and later provide picker chrome over SDK data
- OWNS: Provider composition (receives provider definitions, reads config, selects an injected definition, creates instance, passes to `InteractiveSession`)
- Does NOT own `InteractiveSession` — imported from `@robota-sdk/agent-sdk`
- Does NOT own `CommandRegistry`, `ICommand`, or `ICommandSource` — command registry contracts are imported from `@robota-sdk/agent-sdk`; skill command metadata is provided by `@robota-sdk/agent-command-skills`
- Does NOT use `SystemCommandExecutor` directly — uses `session.executeCommand(name, args)` instead
- Does NOT own reusable background/subagent lifecycle contracts or log pagination helpers — these are owned by `@robota-sdk/agent-runtime` and consumed through `@robota-sdk/agent-sdk` re-exports
- Does NOT own transparent workflow action provenance, shared state vocabulary, memory inspection
  contracts, command execution eligibility, or retention policy — these are owned by SDK/runtime
  contracts described in the cross-cutting transparent workflow spec
- Does NOT own baseline workflow storage root resolution, repo-outside validation, category
  contracts, or item deletion/disable semantics — these are owned by SDK storage contracts
- Does NOT own user-local command behavior — `@robota-sdk/agent-command-user-local` owns the
  provider-free `user-local` command behavior while CLI only routes direct product invocation and
  prints command-owned output
- Does NOT own workflow manifests, harness command registry semantics, workflow artifact schemas,
  deterministic workflow hook policy, review/evidence gates, or workflow run lifecycle — these must
  be owned below the CLI by SDK/runtime/harness contracts before TUI screens are added
- Does NOT own ITerminalOutput/ISpinner — SSOT is `@robota-sdk/agent-sessions`; CLI keeps local duplicate UI adapter types and must not import `agent-sessions` in production source
- OWNS: Ink TUI components, permission-prompt (terminal UI), CLI argument parsing, `useInteractiveSession` hook
- OWNS: CLI package-version update checks and user-level update-check cache
- OWNS: Terminal UI command effect application and local command host adapters
- Does NOT own `PluginCommandSource` — imported from `@robota-sdk/agent-sdk`
- Does NOT own `plugin-hooks-merger` — moved to `@robota-sdk/agent-sdk`

## Import Rules

| Source             | Allowed                              | Examples                                                                                    |
| ------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------- |
| `agent-sdk`        | SDK-owned APIs and facades           | `InteractiveSession`, `TInteractivePermissionHandler`, runtime contracts re-exported by SDK |
| `agent-core`       | Public types + utilities only        | `TUniversalMessage`, `TPermissionMode`, `createSystemMessage`, `getModelName`               |
| `agent-core`       | ❌ Internal engine                   | ~~`Robota`~~, ~~`ExecutionService`~~, ~~`ConversationStore`~~                               |
| `agent-sessions`   | ❌ Forbidden                         | SDK provides its own session and permission types                                           |
| `agent-tools`      | ❌ Forbidden                         | SDK assembles tools internally                                                              |
| `agent-provider-*` | ✅ Provider definition assembly only | CLI composes injected `IProviderDefinition[]`; provider packages own defaults and factories |

## Architecture

For an LLM-scannable source-verified composition map, dependency graph, execution-mode diagrams,
and layer audit findings, see [ARCHITECTURE-MAP.md](ARCHITECTURE-MAP.md). This `SPEC.md` remains
the owner contract; the architecture map is the scan-friendly companion that must be updated when
CLI composition changes.

The CLI is a pure TUI layer. All business logic (session lifecycle, slash command execution, tool orchestration, abort handling) lives in `@robota-sdk/agent-sdk`'s `InteractiveSession`. The CLI:

1. Reads config to determine which provider profile to use.
2. Resolves the profile `type` against an injected `IProviderDefinition[]`.
3. Creates the provider instance by calling `definition.createProvider(config)`.
4. Creates `InteractiveSession({ cwd, provider, commandHostAdapters, sessionStore })` — config and context loading happen internally inside the SDK. CLI-owned adapters expose host services such as user-settings persistence and plugin management without letting command packages import CLI files. Session persistence is passed only through SDK-owned facade types.
5. Subscribes to `InteractiveSession` events and converts them to React state for rendering.

### Transparent Workflow Boundary

Transparent workflow rules are defined in
[../../../.agents/specs/transparent-workflow.md](../../../.agents/specs/transparent-workflow.md).
The CLI may render provenance, lifecycle state, memory/preference inspection, and disclosure fields
only from SDK/runtime projections. It may keep ephemeral terminal view state such as the selected
workspace entry, but it must not infer command origin, replay remembered commands, define state
transitions, choose retention policy, or inspect/delete memory outside SDK/command APIs.

### User-Local Storage Boundary

Baseline workflow storage rules are defined in
[../../../.agents/specs/user-local-storage.md](../../../.agents/specs/user-local-storage.md). The CLI
may render the effective storage root, category summaries, and delete/disable actions only from SDK
or command-module projections. It must not resolve baseline storage paths, write workflow
preferences into project `.robota/`, or remember commands as executable preferences.

Inspectable user-local memory and preference behavior is defined in
[../../../.agents/specs/user-local-memory.md](../../../.agents/specs/user-local-memory.md). The CLI
may display remembered values, storage location, source, last-used time, and delete/disable actions
only through SDK/command projections. It must not infer remembered items from repeated behavior or
execute commands from remembered values.

Existing CLI-owned operational cache such as `~/.robota/update-check.json` remains distribution UX,
not baseline workflow state. Existing project-local sessions, logs, checkpoints, and memory are
classified by the storage spec and must not be reused for new baseline workflow features without a
separate migration PR.

The direct product command `robota user-local storage list --format json` is provider-free. The CLI
detects the `user-local` positional command before provider setup, delegates parsing and output
formatting to `@robota-sdk/agent-command-user-local`, and exits without constructing an AI provider
or opening the TUI.

### Transparent Process Execution Boundary

Transparent process execution rules are defined in
[../../../.agents/specs/process-execution.md](../../../.agents/specs/process-execution.md). The CLI
may provide terminal-local process runner adapters and render command rows, output panes, and
controls from SDK/runtime projections. It must not infer canonical repo commands, score command
readiness, persist commands as executable preferences, interpret output as correctness evidence, or
own process lifecycle state.

### Repository Situational Awareness Boundary

Passive repository context display is defined in
[../../../.agents/specs/repository-situational-awareness.md](../../../.agents/specs/repository-situational-awareness.md).
The CLI may render cwd, repository root, branch, dirty summary, explicit references, and active
background workspace context only from SDK/command projections. It must not walk the workspace,
guess package managers, infer commands, score readiness, create setup profiles, or write repository
files for context display.

### Provider Profile Creation

The CLI owns provider profile resolution and provider definition composition. It must not branch on provider type names to decide defaults, required fields, setup prompts, endpoint probes, or constructor behavior. Those values come from injected `IProviderDefinition` records.

Settings may define an active provider profile. The profile key is the stable selection identity; it
is not required to equal provider `type`, and multiple profile keys may point at the same provider
type/model pair when they represent different credentials, endpoints, accounts, or operational
defaults:

```json
{
  "currentProvider": "supergemma4-26b-uncensored-v2",
  "providers": {
    "supergemma4-26b-uncensored-v2": {
      "type": "gemma",
      "model": "supergemma4-26b-uncensored-v2",
      "apiKey": "lm-studio",
      "baseURL": "http://localhost:1234/v1"
    },
    "gpt-4o": {
      "type": "openai",
      "model": "gpt-4o",
      "apiKey": "$ENV:OPENAI_API_KEY"
    },
    "qwen3-6-plus": {
      "type": "qwen",
      "model": "qwen3.6-plus",
      "apiKey": "$ENV:DASHSCOPE_API_KEY",
      "options": {
        "builtInWebTools": {
          "webSearch": true,
          "webFetch": true
        }
      }
    }
  }
}
```

Gemma-family local models served through LM Studio must use a `type: "gemma"` profile so the provider package can apply Gemma-specific channel-marker projection. DeepSeek API profiles must use `type: "deepseek"` so DeepSeek defaults, model catalog metadata, and thinking options remain provider-owned. `type: "openai"` remains model-family neutral and must not filter Gemma markers or carry DeepSeek-specific defaults.

Provider resolution order:

1. `currentProvider` plus `providers[currentProvider]`
2. Legacy `provider`
3. Defaults supplied by the resolved provider definition

Provider profiles may include `options` and provider-supported credential fields such as `apiKey`. The CLI passes provider-owned fields through to `definition.createProvider(config)` without interpreting provider-specific semantics. Provider packages own the shape, validation, defaults, credential requirements, and behavior for their options.

OpenAI-compatible local endpoints such as LM Studio are not assumed to provide provider-native web search/fetch. If a provider package rejects `options.builtInWebTools` or `options.nativeWebTools`, the CLI surfaces that provider-owned error directly. The CLI must not silently reroute provider-native web requests to local `WebSearch`/`WebFetch`; those remain ordinary Robota tools already advertised through tool schemas.

Provider definition contract:

| Field                                      | Owner                            | CLI behavior                                                       |
| ------------------------------------------ | -------------------------------- | ------------------------------------------------------------------ |
| `type`                                     | Provider package or CLI assembly | Match settings profile type to a definition                        |
| `aliases`                                  | Provider package                 | Optional compatibility names resolved by generic lookup            |
| `displayName`                              | Provider package                 | Optional human-readable provider label for setup lists             |
| `description`                              | Provider package                 | Optional provider description for setup lists and errors           |
| `defaults`                                 | Provider package                 | Fill omitted model/apiKey/baseURL/timeout values                   |
| `defaults.options`                         | Provider package                 | Optional provider-owned option defaults passed through generically |
| `setupSteps`                               | Provider package                 | Drive interactive setup prompts without type branches              |
| `credentialRequirement` / `requiresApiKey` | Provider package                 | Validate required credential alternatives consistently             |
| `probeProfile`                             | Provider package                 | Optional endpoint/profile test hook                                |
| `createProvider`                           | Provider package                 | Build concrete provider instance                                   |

The default CLI binary assembles definitions from provider packages. Alternate embeddings can pass their own definitions into `startCli({ providerDefinitions })`. Compatibility provider names such as `google` for the canonical Gemini provider must be represented as provider-definition aliases, not as CLI provider-name branches.

### Provider Configuration UX

The CLI owns provider setup and provider profile writes. Default first-run writes go to `~/.robota/settings.json`; `.claude/settings.json` compatibility is read-only for Robota-specific provider profile creation. Runtime provider/model command writes must target the settings document that wins for the effective active provider scope, so a lower-priority user write cannot be masked by project-local `.robota` settings on the next startup.

Supported setup flags:

| Flag                             | Behavior                                                            |
| -------------------------------- | ------------------------------------------------------------------- |
| `--configure`                    | Run interactive provider setup and exit                             |
| `--configure-provider <profile>` | Upsert a provider profile and exit unless a prompt is also provided |
| `--provider <profile>`           | Select an existing provider profile for this invocation             |
| `--set-current`                  | Persist the selected or configured profile as `currentProvider`     |
| `--type <type>`                  | Provider implementation type used by `--configure-provider`         |
| `--base-url <url>`               | Provider API base URL                                               |
| `--api-key <value>`              | Store a literal API key                                             |
| `--api-key-env <name>`           | Store `$ENV:<name>`, not the current environment value              |

First-run setup must offer the injected provider definitions as a selectable list when stdin/stdout are TTYs. The list is generated from `IProviderDefinition[]` and may render `displayName`, `type`, `description`, and provider-owned setup help links, but it must not branch on concrete provider names. Selecting a provider starts the same provider setup flow used by runtime provider setup.

Interactive setup generates a readable profile key from the selected model id through SDK provider
common APIs. If that key already exists, setup appends a numeric suffix such as `-2` or `-3`.
Generated keys must not include API keys, key fragments, account identifiers, organization ids, or
other sensitive credential hints. Explicit headless setup with `--configure-provider <profile>`
continues to use the caller-provided profile key.

Startup setup validation must evaluate the merged settings document and the provider selected for this invocation. A valid lower-priority legacy `provider` entry or another valid settings file must not mask an unusable `currentProvider` profile from a higher-priority layer or `--provider` override. When interactive startup setup is opened because a project `.robota` file already selects an unusable provider, the setup write target must be project-local settings so the new selection actually wins in the merged configuration.

Non-interactive print/headless execution must not prompt. Missing provider config must produce an actionable error generated from the injected provider definitions, pointing to `robota --configure` and `robota --configure-provider` without hardcoded provider-specific examples.

Environment-variable API key references use the `$ENV:NAME` form. If a required provider API key resolves to an unset environment variable, setup validation or provider construction must fail with a clear error before any provider request is sent. A literal unresolved `$ENV:NAME` string must never be sent as an API key.

Provider slash commands are command-module interactions rendered through generic TUI prompts. The default CLI composes `@robota-sdk/agent-command-provider`, which consumes SDK provider common APIs the same way a third-party command module would. The CLI must not implement provider-profile action rules; it only renders `choice` and `text` prompts returned by the command module and applies typed restart effects.

| Command                    | Behavior                                                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/provider`                | Show merged provider profiles and open a profile picker in interactive TUI mode                                                                      |
| `/provider current`        | Show active profile, type, model, and baseURL                                                                                                        |
| `/provider list`           | Show provider profiles from merged settings; interactive TUI mode can select a profile from the list                                                 |
| `/provider use <profile>`  | The provider command module confirms, persists `currentProvider` through its injected effective-scope settings adapter, and returns a restart effect |
| `/provider add`            | The provider command module starts setup without a selected type and returns a generic choice interaction generated from injected definitions        |
| `/provider add <type>`     | Start setup for the selected provider type and create a model-derived profile key with numeric suffixes for duplicates                               |
| `/provider test [profile]` | Validate fields and optionally probe the endpoint                                                                                                    |

Selecting a profile opens a provider-command-owned action menu with switch, edit, test, duplicate, delete, and cancel. Edit uses provider setup metadata with masked current values hidden from the prompt display. Delete confirms the action, blocks the last profile, and requires a replacement before deleting the active profile. Non-interactive/headless slash execution never blocks on these interactions; it prints the deterministic command message and exits.

Provider changes must follow the SDK command contract: the provider command module owns provider setup/edit/delete state, settings patch construction, writes through the injected settings adapter, and returns a generic `session-restart-requested` effect. The CLI/TUI only renders `ICommandInteractionPrompt` values including generic prompt descriptions, submits prompt values back to the active command interaction, and applies typed command effects.

The TUI status area must show enough active profile identity for users to verify the selected
runtime profile. When profile metadata is available, it renders profile key, provider type, and
model; when only model metadata is available, it falls back to the model label.

Provider setup prompt semantics must live outside Ink components and outside reusable CLI/TUI hooks. The provider command module owns provider setup steps, setup help descriptions, defaults, required-field validation, environment-reference validation, masked-field metadata, and final provider settings patch construction. Interactive rendering components must not import provider setup modules or provider definitions; they may only render generic SDK interaction descriptors and pass submitted values back to the active command interaction.

TUI input semantics must live outside Ink components. `src/ui/flows/*` owns prompt and input state transitions, shortcut meaning, selection bounds, slash autocomplete command selection, paste label insertion, and CJK cursor movement. Components may only translate `useInput` key data into flow actions, apply returned state, render the result, and call external callbacks.

Prompt file-reference semantics are not TUI input semantics. `@file` tokens in ordinary prompts are
passed through as user input; SDK-owned prompt preprocessing decides whether a token is a path-like
reference, reads bounded workspace-local file content, records structured context-reference events,
and sends the enriched model prompt to the session runtime. The CLI must not add Ink hooks, slash
router branches, or input-flow parsing for `@file` behavior.

Flow ownership:

| Flow module                 | Owns                                                                                        | Thin shell consumers                                             |
| --------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `text-prompt-flow.ts`       | text prompt editing, submit/cancel effects, validation state                                | `TextPrompt`, `InteractivePrompt` text rendering                 |
| `selection-flow.ts`         | bounded/wrapping selection, select/cancel effects, viewport scrolling                       | `ListPicker`, `MenuSelect`, `InteractivePrompt` choice rendering |
| `confirm-prompt-flow.ts`    | confirmation shortcuts and option selection                                                 | `ConfirmPrompt`                                                  |
| `permission-prompt-flow.ts` | permission shortcuts and `true`/`allow-session`/`false` decisions                           | `PermissionPrompt`                                               |
| `input-area-flow.ts`        | slash autocomplete movement, command completion, prompt history, queue cancel, paste labels | `InputArea`                                                      |
| `cjk-text-input-flow.ts`    | printable filtering, cursor movement, bracketed paste, submit effects                       | `CjkTextInput`                                                   |

```
bin.ts → cli.ts (arg parsing + provider definition composition)
              ├── createAgentCommandModule()      (from @robota-sdk/agent-command-agent)
              ├── createModelCommandModule()      (from @robota-sdk/agent-command-model)
              ├── createModeCommandModule()       (from @robota-sdk/agent-command-mode)
              ├── createLanguageCommandModule()   (from @robota-sdk/agent-command-language)
              ├── createCompactCommandModule()    (from @robota-sdk/agent-command-compact)
              ├── createContextCommandModule()    (from @robota-sdk/agent-command-context)
              ├── createExitCommandModule()       (from @robota-sdk/agent-command-exit)
              ├── createProviderCommandModule()   (from @robota-sdk/agent-command-provider)
              ├── createSessionCommandModule()    (from @robota-sdk/agent-command-session)
              ├── createResetCommandModule()      (from @robota-sdk/agent-command-reset)
              ├── createRewindCommandModule()     (from @robota-sdk/agent-command-rewind)
              ├── createStatusLineCommandModule() (from @robota-sdk/agent-command-statusline)
              └── ui/render.tsx → App.tsx (Ink TUI)
                    ├── useInteractiveSession (ONLY React↔SDK bridge)
                    │   ├── InteractiveSession({ cwd, provider })
                    │   │   (from @robota-sdk/agent-sdk; config/context loaded internally)
                    │   ├── TuiStateManager    (owned by agent-cli)
                    │   │   holds history: IHistoryEntry[]  ← primary state for message list
                    │   │   syncs from interactiveSession.getFullHistory() on each update
                    │   ├── CommandRegistry    (from @robota-sdk/agent-sdk)
                    │   │   ├── command modules        (including @robota-sdk/agent-command-skills)
                    │   │   └── PluginCommandSource    (from @robota-sdk/agent-sdk)
                    │   └── session.executeCommand()  (slash commands routed through injected command modules)
                    ├── MessageList.tsx        (renders IHistoryEntry[]; EntryItem dispatches on category)
                    ├── InputArea.tsx          (bottom input area, slash detection)
                    ├── SessionStatusBar.tsx   (connects statusline settings + git branch to renderer)
                    ├── StatusBar.tsx          (pure status bar renderer, shows primary activity state)
                    ├── PermissionPrompt.tsx   (arrow-key selection)
                    └── SlashAutocomplete.tsx  (command popup with scroll)
```

Dependency chain:

```
agent-cli ─→ agent-sdk ─→ agent-sessions ─→ agent-core
  │            ├─→ agent-tools ────────────→ agent-core
  │            └─────────────────────────→ agent-core  (direct: types, utilities)
  ├──────────────────────────────────────→ agent-core  (direct: public types only)
  └──────────────────────────────────────→ agent-provider-* (provider definitions)
```

## StatusBar Display

The StatusBar shows real-time session information:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Thinking  |  my-session  |  git: feat/x  |  Claude Sonnet 4.6  |  Context: 45% (90K/200K) │
└──────────────────────────────────────────────────────────────────────────┘
```

| Field    | Source                                     | Description                                            |
| -------- | ------------------------------------------ | ------------------------------------------------------ |
| Mode     | `session.getPermissionMode()`              | Current permission mode, shown only when not `default` |
| Model    | `getModelName(config.provider.model)`      | Human-readable model name (e.g., "Claude Sonnet 4.6")  |
| Git      | `resolveGitBranch(cwd)`                    | Current git branch when available and enabled          |
| Context  | `session.getContextState().usedPercentage` | Context usage with K/M formatting (e.g., "90K/1M")     |
| Session  | `session.getName()`                        | Session name (shown only when a name is set)           |
| Activity | CLI-derived display state                  | Left-side primary activity text without a field prefix |

Activity priority is deterministic and renderer-owned:

1. active tool calls (`Tools xN`)
2. foreground model waiting (`Thinking`)
3. active background work (`Background xN`)
4. queued prompt (`Queued`)
5. idle (`Idle`)

When a prompt is queued behind foreground work, the activity row keeps the active work as primary and appends `queued` as secondary metadata. `default` permission mode is the baseline and is hidden; non-default permission modes (`plan`, `acceptEdits`, `bypassPermissions`) are rendered as `Mode: <mode>`. SDK session state remains the source of truth; `StatusBar` receives derived display values and does not infer provider or execution semantics.

### `/statusline` Slash Command

`/statusline` is provided by `@robota-sdk/agent-command-statusline`, not by the CLI slash router or SDK core built-ins. The CLI composes it into `InteractiveSession` alongside other command modules so the SDK only sees the generic `ICommandModule` interface.

Supported commands:

| Command               | Behavior                                                       |
| --------------------- | -------------------------------------------------------------- |
| `/statusline on`      | Persist `statusline.enabled=true` in `~/.robota/settings.json` |
| `/statusline off`     | Persist `statusline.enabled=false`                             |
| `/statusline git on`  | Persist `statusline.gitBranch=true`                            |
| `/statusline git off` | Persist `statusline.gitBranch=false`                           |
| `/statusline reset`   | Restore default status line fields                             |

Defaults are `enabled=true` and `gitBranch=true`. The command emits the typed SDK `statusline-settings-patch` effect, `useSlashRouting` stores it as a pending command effect, and `useSideEffects` persists the setting and updates React state. `StatusBar` remains a pure renderer.

### Command Module Composition

Built-in commands are represented as `ICommandModule` instances injected into `InteractiveSession`. Command modules own command metadata and structured command results; the CLI hook layer owns rendering generic interactions and applying typed SDK command effects.

The CLI slash router must not own command-specific switch cases for built-ins when an injected command module can own the command. It may still own slash-prefix parsing, skill/plugin fallback lookup, result projection, and unknown-command rendering.

`/plugin` and `/reload-plugins` are provided by `@robota-sdk/agent-command-plugin`. The CLI owns only the local `ICommandPluginAdapter` implementation. It applies `plugin-tui-requested` by opening `PluginTUI` and applies `plugin-registry-reload-requested` by reloading the registry's plugin command source.

`/exit` is provided by `@robota-sdk/agent-command-exit`. The command package owns command metadata and emits `session-exit-requested`; the CLI applies that typed effect by gracefully shutting down the session and terminal UI.

### Session Name Display

Session name appears in three locations when set (via `--name` or `/rename`):

1. **Input box top border** — right-aligned title embedded in the border with background color matching the border and black bold text:
   ```
   ┌──────────────────────────────────────── "my-session" ──┐
   │ > Type a message                                       │
   └────────────────────────────────────────────────────────┘
   ```
2. **Terminal title** — ANSI escape `\x1b]0;Robota — <name>\x07` updates the terminal tab/window title
3. **StatusBar** — displayed in magenta alongside mode, model, and context info

### Context Color Coding

| Range  | Color  | Meaning                         |
| ------ | ------ | ------------------------------- |
| 0-69%  | Green  | Healthy                         |
| 70-89% | Yellow | Approaching limit               |
| 90%+   | Red    | Near limit, compaction imminent |

## TUI Visual Grammar

The CLI TUI renders structured session/runtime data. It must not parse assistant prose to infer state, and it must not add provider/model-specific presentation branches. Rendering components may format data they receive, but ownership of the data remains in the SDK/session/runtime layer.

### Output Surface Ownership

| Surface                      | Owner                                 | Data Source                            | Rendering Contract                                                                |
| ---------------------------- | ------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------- |
| Chat messages                | `MessageList`                         | `IHistoryEntry[]` chat entries         | Show stable role labels and markdown-rendered assistant content                   |
| Tool summaries               | `MessageList`                         | structured `tool-summary` event data   | Show compact one-line tool rows plus structured details such as diffs/output      |
| Streaming assistant response | `StreamingIndicator`                  | SDK text deltas                        | Show current assistant text without persisting duplicate rendered state           |
| Live tool execution          | `StreamingIndicator`                  | SDK tool state events                  | Show current tool state using the shared status marker set                        |
| Background work              | `BackgroundTaskPanel`                 | SDK execution workspace entries        | Show SDK default-visible background task entries as a compact one-level tree      |
| Execution workspace switcher | `ExecutionWorkspaceSwitcher`          | SDK execution workspace snapshot       | Switch between main-thread, background task, and group entries without mutation   |
| Transparent workflow facts   | TUI surfaces                          | SDK/runtime projections                | Render provenance, state, memory, and disclosure fields without owning semantics  |
| Status/activity              | `StatusBar` and `SessionStatusBar`    | session state, context state, settings | Show current activity and session metadata in the primary scan path               |
| Diff blocks                  | `ToolDiffBlock` and markdown renderer | structured diff lines                  | Render diff bodies through fenced `diff` markdown; keep metadata outside the body |
| Setup/permission prompts     | prompt components                     | CLI flow descriptors                   | Render generic interactions only; prompt semantics remain in flow modules         |

### Shared Markers

| State              | Marker | Meaning                                            |
| ------------------ | ------ | -------------------------------------------------- |
| Running/queued     | `□`    | Work exists but is not terminal                    |
| Completed/success  | `■`    | Work reached a successful terminal state           |
| Failed/error       | `■`    | Work reached an error state, colored as error      |
| Cancelled/denied   | `■`    | Work ended by user or policy decision              |
| Omitted transcript | `...`  | Additional persisted output is hidden from preview |

Colors remain renderer-owned: green for success/healthy state, yellow for warning or user-decision state, red for error/near-limit state, cyan for active assistant work, and dim text for secondary metadata.

### Layout Rules

- Prefer one-level trees for grouped activity: a short group label followed by aligned child rows.
- Keep labels human-readable. Avoid raw class names, untrimmed JSON, or provider-specific implementation names in user-facing rows.
- Keep previews bounded and whitespace-normalized. Long output must show a transcript/omitted-lines hint instead of expanding indefinitely.
- Keep persistent raw data in session/log records even when the TUI renders a compact preview.
- Place active state in the primary scan path. Passive metadata may remain dim or right-aligned, but model/tool/background activity must be visible without scanning the far edge of the terminal.
- Keep code/diff colorization centralized through markdown rendering or dedicated formatting helpers, not ad hoc line coloring in each component.

### Testing Requirements

- Pure formatting helpers must have unit tests for status markers, truncation, omitted-line counts, and narrow-output labels.
- Ink components must have render tests for the same states using representative structured data.
- Changes that add a new output surface must update this section or explain why an existing surface owns the behavior.

### Command Output Summary Rendering

Command-like tool summaries render a compact command row plus a bounded output preview. The contract is:

- Applies only to command execution tools (`Bash`, `BackgroundProcess`) that provide `toolResultData`.
- The visible preview shows at most four output lines.
- If output has additional lines, render `... +N lines (full output in session transcript)`.
- Non-zero command `exitCode`, `success=false`, or tool `result=error` renders the tool row as failed even when the tool transport itself completed.
- Structured `stdout` and `stderr` are kept distinct; stderr preview lines are prefixed with `[stderr]`.
- Empty successful output shows only the compact command row.
- Full result data remains in SDK/session records; the TUI renders only the bounded projection.

### Edit Diff Hunk Rendering

Edit tool summaries render context-aware hunks rather than isolated changed lines. The rendering contract is:

- Default context is three unchanged lines before and after the edited span when the modified file can be read.
- Diff bodies are fenced as `diff` markdown and rendered through the shared markdown renderer.
- Hunk headers, context lines, additions, and removals are represented as structured diff line data before rendering.
- File path, truncation state, and omitted-line counts remain outside the markdown body.
- If file context is unavailable, the renderer falls back to changed lines only rather than failing the tool summary.
- Large diffs are truncated by visible hunk groups when possible, preserving the first changed hunk before omitting additional lines.

### Usage Summary Rendering

Usage summary rows render persisted SDK `usage-summary` history entries. The CLI must:

- Render usage near the assistant turn that produced it rather than in a detached dashboard.
- Show whether usage is exact or estimated.
- Show prompt, completion, and total token counts when available.
- Label monetary cost as unknown unless the SDK provides exact or configured pricing data.
- Avoid provider/model branches; all display data comes from the SDK-owned `IUsageSnapshot`.
- Subscribe to `context_update` so the status bar refreshes when a request is sent and again after provider usage reconciliation.
- Subscribe to `compact` so auto-compaction events are reflected in the message history without special-casing `/compact` command execution.

## Context Management (CLI Layer)

### `/compact` Slash Command

```
/compact                          # Default compaction
/compact focus on API changes     # Custom focus instructions
```

- Routes through `InteractiveSession.executeCommand("compact", instructions)`
- Displays before/after context percentage
- Shows `Context compacted: 85% -> 32%` message

### Auto-Compaction Notification

When auto-compaction triggers (at ~83.5% threshold), the UI shows a system message notifying the user.

## Tool Call Display

### Real-Time Tool Execution (Streaming)

During `session.run()`, tool execution is displayed in real-time via the `onToolExecution` callback. The streaming display shows **Tools: first, then Robota:** in execution order:

```
Tools:

  ✓ Read(/src/index.ts)
  ✓ Bash(ls -la)
  ⟳ Glob(**/*.md)

Robota:

  Checking the file structure now...
```

**Behavior:**

- `onToolExecution` fires `start` when a tool begins and `end` when it completes
- Running tools show `⟳` (yellow), completed tools show `✓` (green)
- Format: `ToolName(firstArgValue)` — first argument truncated to 80 chars, matching post-run summary style
- Completed tools remain visible until `session.run()` finishes (not removed on `end`)
- `Tools:` and `Robota:` sections each have a blank line below the label and between sections
- When no tools and no streaming text, renders the `Thinking...` fallback while the model is active

### Post-Run Tool Summary

After each `session.run()` completes, tool calls from the session history are extracted and displayed as a single grouped message:

```
Tool: [5 tools]

  Read(/Users/jungyoun/Documents/dev/robota/.agents/tasks/apps-web-sep...)
  Bash(ls -la .agents/tasks/)
  Glob(**/*.md)
```

- All tool calls from a run are grouped into one `role: 'tool'` message
- Format: `ToolName(firstArgValue)` — first argument value extracted from JSON, truncated to 80 chars
- Displayed after the assistant response in the message list

## Slash Commands

| Command                   | Description                                                                |
| ------------------------- | -------------------------------------------------------------------------- |
| `/help`                   | Show available commands                                                    |
| `/clear`                  | Clear conversation history through the session module                      |
| `/model [model]`          | Select AI model through the injected model command module                  |
| `/language [lang]`        | Set response language (ko, en, ja, zh), saves and restarts                 |
| `/compact [instructions]` | Compress context window                                                    |
| `/cost`                   | Show session info through the session command module                       |
| `/context`                | Context window info, reference inventory, and `/context auto ...` controls |
| `/agent`                  | Run and manage background subagent jobs                                    |
| `/permissions [mode]`     | Permission rules and permission mode changes                               |
| `/memory`                 | Route project memory commands to the memory command module                 |
| `/rewind`                 | Route edit checkpoint list/restore commands to SDK                         |
| `/background`             | Route background task controls to the background command module            |
| `/plugin [subcommand]`    | Plugin management through the injected plugin command module               |
| `/resume`                 | Show session picker to resume a saved session                              |
| `/rename <name>`          | Rename the current session (name displayed in StatusBar)                   |
| `/exit`                   | Exit through the injected exit command module                              |

### Slash Command Autocomplete

Typing `/` as the first character in the input triggers an autocomplete popup. The popup filters commands in real-time as the user types.

**Interaction:**

- Arrow Up/Down: Navigate items
- Tab: Insert highlighted command into input field (does NOT execute). User can continue typing args or press Enter to execute.
- Enter: Insert and execute the highlighted command immediately
- Esc: Dismiss popup, keep typed text
- Backspace past `/`: Dismiss popup

**Subcommand Navigation:**

Commands with subcommands (e.g., `/permissions`, `/model`) show a nested submenu when selected:

```
> /permissions
+-------------------------------------+
|   plan                              |
|   default                           |
|   acceptEdits                       |
|   bypassPermissions                 |
+-------------------------------------+
```

**Visual Grouping:**

Commands are grouped by source with separators: built-in commands appear first, followed by discovered skill commands.

### `/model` — Model Change Flow

The `/model` command is provided by the `@robota-sdk/agent-command-model` module that the Robota binary composes into `InteractiveSession`. The command lists available models for the effective active provider when provider-owned catalog metadata is available. Model definitions come through the SDK model command common API and injected provider definitions; the CLI/TUI must not show Claude-only subcommands while another provider is active.

The `/permissions` command is provided by the `@robota-sdk/agent-command-permissions` module that the Robota binary composes into `InteractiveSession`. The CLI slash router does not inspect or mutate permission state directly; it routes `/permissions [mode]` into the generic command execution path, and the command module uses SDK permission common APIs. The default Robota CLI does not compose `/mode`; permission-mode changes belong under `/permissions`.

The `/language` command is provided by the `@robota-sdk/agent-command-language` module that the Robota binary composes into `InteractiveSession`. The command module emits `language-change-requested`; the CLI applies settings persistence and restart through the generic command effect handler.

The `/statusline` command is provided by the `@robota-sdk/agent-command-statusline` module that the Robota binary composes into `InteractiveSession`. The command module emits `statusline-settings-patch`; the CLI applies settings persistence and TUI state updates through the generic command effect handler.

The `/clear` command is provided by the `@robota-sdk/agent-command-session` module that the Robota binary composes into `InteractiveSession`. The command module clears SDK session history through SDK session command APIs and emits `conversation-history-cleared`; the CLI applies that effect by clearing `TuiStateManager` rendered history before adding the command result message.

The `/rename <name>` command is provided by the same `@robota-sdk/agent-command-session` module. The command module emits `session-renamed`; the CLI applies that effect through the generic command effect handler by updating `InteractiveSession.setName()` and local TUI session-name state.

The `/resume` command is provided by the same `@robota-sdk/agent-command-session` module. The command module emits `session-picker-requested`; the CLI applies that effect through the generic command effect handler by opening `SessionPicker`.

The `/cost` command is provided by the same `@robota-sdk/agent-command-session` module. The command module reads session id and message count through SDK session command APIs; the CLI only displays the command result.

The `/reset` command is provided by `@robota-sdk/agent-command-reset`. The command module emits `settings-reset-requested`; the CLI applies local settings deletion and shutdown through the generic command effect handler.

The `/exit` command is provided by `@robota-sdk/agent-command-exit`. The command module emits `session-exit-requested`; the CLI applies graceful shutdown and terminal exit through the generic command effect handler.

The `/plugin` command is provided by `@robota-sdk/agent-command-plugin`. The command module emits `plugin-tui-requested` for `/plugin` and `/plugin manage`, and uses the CLI-provided `ICommandPluginAdapter` for install/uninstall/enable/disable/marketplace subcommands.

The `/rewind` command is provided by `@robota-sdk/agent-command-rewind`. The CLI slash router only routes it into `session.executeCommand()` and renders the returned command result; checkpoint storage, restore, rollback ordering, and command output formatting live outside the CLI.

**Subcommand display:**

```
> /model
+-------------------------------------+
|   Claude Opus 4.6 (1M)             |
|   Claude Sonnet 4.6 (1M)           |
|   Claude Haiku 4.5 (200K)          |
+-------------------------------------+
```

**Model change flow:**

1. User selects a model from the subcommand list
2. The command returns a typed `model-change-requested` effect.
3. The CLI renders a `ConfirmPrompt` from the generic command-effect path.
4. If confirmed (Yes / `y`): settings are written to `~/.robota/settings.json` and the CLI exits so the next session uses the selected model
5. If cancelled (No / `n`): returns to normal input

### ListPicker Component

A generic list picker overlay (`ListPicker.tsx`) for selecting an item from a list. Used by the session resume flow to display saved sessions.

**Props:**

| Prop       | Type                      | Description                                                       |
| ---------- | ------------------------- | ----------------------------------------------------------------- |
| `title`    | `string`                  | Header text above the list                                        |
| `items`    | `Array<{ label, value }>` | Items to display. `label` is shown, `value` is returned on select |
| `onSelect` | `(value: string) => void` | Callback when an item is selected                                 |
| `onCancel` | `() => void`              | Callback when ESC is pressed                                      |

**Interaction:** Arrow Up/Down to navigate, Enter to select, ESC to cancel.

### ConfirmPrompt Component

A reusable confirmation prompt with arrow-key selection (`ConfirmPrompt.tsx`). Used by host-applied command effects such as `/model` change and available for other yes/no confirmations.

**Props:**

| Prop       | Type                      | Default         | Description                  |
| ---------- | ------------------------- | --------------- | ---------------------------- |
| `message`  | `string`                  | —               | Message above the options    |
| `options`  | `string[]`                | `['Yes', 'No']` | Options to select from       |
| `onSelect` | `(index: number) => void` | —               | Callback with selected index |

**Interaction:** Arrow keys to navigate, Enter to confirm. For 2-option prompts, `y` selects the first option, `n` selects the second.

### `/plugin` — Plugin Management

The `/plugin` command is owned by `@robota-sdk/agent-command-plugin`. The CLI supplies a local `ICommandPluginAdapter` that connects the command package and `PluginTUI` to `PluginSettingsStore`, `BundlePluginLoader`, `BundlePluginInstaller`, and `MarketplaceClient`.

Subcommands:

| Subcommand                               | Description                             |
| ---------------------------------------- | --------------------------------------- |
| `/plugin` or `/plugin manage`            | Open the interactive plugin manager TUI |
| `/plugin install <name>@<marketplace>`   | Install a plugin from a marketplace     |
| `/plugin uninstall <name>@<marketplace>` | Remove an installed plugin              |
| `/plugin enable <name>@<marketplace>`    | Enable a disabled plugin                |
| `/plugin disable <name>@<marketplace>`   | Disable a plugin without uninstalling   |
| `/plugin marketplace add <source>`       | Add a marketplace source                |
| `/plugin marketplace remove <name>`      | Remove a marketplace source             |
| `/plugin marketplace update <name>`      | Update a marketplace source             |
| `/plugin marketplace list`               | List configured marketplace sources     |

Installed plugins contribute skills via `PluginCommandSource`, which discovers skills from each plugin's bundle manifest and makes them available as slash commands alongside project and user skills.

## React↔SDK Bridge

`useInteractiveSession` is the single boundary between React and the SDK. It:

1. Creates `InteractiveSession({ cwd, provider, commandModules, commandHostAdapters })` and `CommandRegistry` once (via `useRef` — never recreated on re-render). The provider instance is passed in from the caller; `InteractiveSession` handles config/context loading internally. Host adapters are thin CLI-owned services such as settings read/write, not command implementations.
2. Creates a `TuiStateManager` instance that holds `history: IHistoryEntry[]` as the primary state for the message list and the latest SDK execution workspace snapshot for background/workspace rendering. On each execution update (when `thinking` transitions to `false`, or on `complete`/`interrupted`), the hook delegates to `TuiStateManager` to sync state from `interactiveSession.getFullHistory()` and `interactiveSession.getExecutionWorkspaceSnapshot()`.
3. Subscribes to `InteractiveSession` events (`text_delta`, `tool_start`, `tool_end`, `thinking`, `complete`, `interrupted`, `error`, `execution_workspace_event`) and converts them to React state.
4. Exposes `handleSubmit`, `handleAbort`, `handleCancelQueue`, and `handleShutdown` as stable callbacks to the TUI.
5. Routes slash commands via `session.executeCommand(name, args)` — no `SystemCommandExecutor` is instantiated directly by the CLI. Command-specific follow-up prompts are handled by `ICommandInteraction` and command-specific host actions are handled by typed `TCommandEffect` values.
6. Manages the permission queue (serialises concurrent permission requests).

No other hook or component interacts with `InteractiveSession` directly.

### Plugin Hook Merging

Plugin hook merging (resolving `${CLAUDE_PLUGIN_ROOT}` and merging hook groups) is handled internally by `@robota-sdk/agent-sdk`. The CLI does not perform hook merging.

### App.tsx

`App.tsx` is a thin JSX shell (~220 lines). It:

- Calls `useInteractiveSession` and `usePluginCallbacks`.
- Wraps `handleSubmit` only to render generic command interactions and apply typed command effects that require the local host shell (`useApp().exit`, settings writes already performed by command adapters, App remounts, PluginTUI, or SessionPicker).
- Contains no queue logic, no abort logic, no session business logic.

### Tool List Visibility

The `StreamingIndicator` (showing active tools) is rendered when `isThinking || activeTools.length > 0`. Streaming state (`streamBuf`, `activeTools`) is cleared at the **start** of a new execution (when `thinking: true`), not at the end. This means the tool list stays visible after execution completes or is aborted, until the next execution begins.

### Streaming Text Debounce

`TuiStateManager.onTextDelta` debounces `notify()` calls to reduce React re-render and markdown rendering frequency. Text deltas are accumulated in `streamBuf` immediately (no data loss), but `notify()` fires at most once per `STREAMING_DEBOUNCE_MS` (default 300ms). This limits `renderMarkdown()` invocations to ~3/second instead of per-token (hundreds/second). A `createDebouncedNotify` utility manages the timer lifecycle; `flush()` is called on completion/interruption/error to clean up.

## Command Registry Architecture

The slash command system uses an extensible registry pattern. Multiple `ICommandSource` implementations provide commands, and the `CommandRegistry` aggregates them. `CommandRegistry` is owned by `@robota-sdk/agent-sdk`; user-visible built-ins, including `/skills`, are provided by injected `ICommandModule` packages. Slash command execution is routed through `session.executeCommand(name, args)` — the CLI does not instantiate `SystemCommandExecutor` directly. The CLI adds plugin command sources and injected `ICommandModule` sources generically.

Reusable CLI/TUI code must not special-case command module names such as `/agent`. It accepts `commandModules` and registers them with the SDK registry. The package binary may choose product defaults by passing modules into `startCli()`.

### ICommandSource Interface

```typescript
interface ICommandSource {
  name: string;
  getCommands(): ICommand[];
}
```

### ICommand Interface

```typescript
interface ICommand {
  name: string;
  description: string;
  source: string;
  skillContent?: string; // Full SKILL.md content (skill commands only)
  subcommands?: ICommand[];
  execute?: (args: string) => void | Promise<void>;
}
```

### Command Sources

| Source   | Class                  | Owner                   | Description                                                                          |
| -------- | ---------------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| Built-in | `BuiltinCommandSource` | `@robota-sdk/agent-sdk` | SDK-default infrastructure commands; currently empty                                 |
| Modules  | `ICommandModule`       | Module package          | Command modules injected by composition, including `/skills`, `/help`, and `/memory` |
| Skills   | `SkillCommandSource`   | `@robota-sdk/agent-sdk` | SDK common API used by `agent-command-skills` for virtual skill palette entries      |
| Plugins  | `PluginCommandSource`  | `@robota-sdk/agent-sdk` | Skills provided by installed bundle plugins                                          |

### Skill Discovery (Multi-Path)

Skills are discovered at session start from directories scanned by `SkillCommandSource` (agent-sdk), in priority order (highest first, deduplicated by name). Paths are defined in agent-sdk's SPEC.md; the CLI uses them as-is:

| Priority | Path                          | Scope                            |
| -------- | ----------------------------- | -------------------------------- |
| 1        | `.claude/skills/*/SKILL.md`   | Project (Claude Code native)     |
| 2        | `.claude/commands/*.md`       | Project (Claude Code compatible) |
| 3        | `~/.robota/skills/*/SKILL.md` | User global (Robota native)      |
| 4        | `.agents/skills/*/SKILL.md`   | Project (Robota native)          |

### Skill Frontmatter Schema

Each `SKILL.md` may contain YAML frontmatter with the following fields:

| Field           | Type       | Required | Description                                            |
| --------------- | ---------- | -------- | ------------------------------------------------------ |
| `name`          | `string`   | No       | Display name (default: directory name)                 |
| `description`   | `string`   | No       | Short description for autocomplete                     |
| `allowed-tools` | `string[]` | No       | Tools the skill is allowed to use                      |
| `context`       | `string`   | No       | Execution context: `fork`, `agent`                     |
| `model`         | `string`   | No       | Override model for this skill                          |
| `max-turns`     | `number`   | No       | Maximum conversation turns                             |
| `invocation`    | `string`   | No       | Invocation method: `user`, `auto-invoke`, `model-only` |

If no frontmatter is found, the directory name is used as the command name.

### Variable Substitution

Skill content supports variable substitution before injection:

| Variable               | Description                               |
| ---------------------- | ----------------------------------------- |
| `$ARGUMENTS`           | User-provided arguments after the command |
| `${CLAUDE_SESSION_ID}` | Current session identifier                |
| `${CLAUDE_MODEL}`      | Current model identifier                  |
| `${PROJECT_DIR}`       | Project root directory path               |
| `${USER_HOME}`         | User home directory path                  |

Variables are substituted at invocation time, not at discovery time.

### Shell Command Preprocessing

Skill content supports inline shell command execution using the `` !`command` `` syntax. The shell command is executed and its stdout replaces the markup in the skill content before injection. This enables dynamic content like file listings or environment values.

### Skill Execution Features

| Feature          | Value          | Description                                                   |
| ---------------- | -------------- | ------------------------------------------------------------- |
| `context: fork`  | Fork context   | Skill runs in a forked session, preserving the parent context |
| `context: agent` | Agent context  | Skill runs as a sub-agent with its own isolated session       |
| `allowed-tools`  | Tool whitelist | Restricts which tools the skill can use during execution      |

### Skill Invocation Methods

| Method        | Trigger                 | Description                                            |
| ------------- | ----------------------- | ------------------------------------------------------ |
| `user`        | User types `/skillname` | Default — user explicitly invokes via slash command    |
| `auto-invoke` | Model decides           | Model can invoke the skill automatically when relevant |
| `model-only`  | Model-initiated only    | Not shown in user autocomplete, model-only access      |

### Skill Execution

When a skill slash command is selected, the CLI calls `interactiveSession.executeCommand(name, args)`
like any other slash command. The SDK normalizes virtual `/<skill-name>` aliases to the composed
`/skills <skill-name> [args]` command. `@robota-sdk/agent-command-skills` calls the SDK skill
activation host API, and the SDK emits `skill_activation` events and owns all skill execution
semantics. The CLI must not synthesize skill activation state or call skill-specific SDK methods.

Model-initiated skills also use the standard SDK-projected command route: `robota_command_skills`
with skill arguments in `args`. The startup prompt may show skill descriptors, but full skill
content is loaded only after `/skills` activates the skill. A plain assistant claim that a skill was
used is not treated as skill activation unless a `skill_activation` event exists.

## Type Ownership

| Type               | Location                | Purpose                                                        |
| ------------------ | ----------------------- | -------------------------------------------------------------- |
| ITerminalOutput    | `src/types.ts`          | Terminal I/O DI interface (duplicate — SSOT is agent-sessions) |
| ISpinner           | `src/types.ts`          | Spinner handle (duplicate — SSOT is agent-sessions)            |
| IPermissionRequest | `src/ui/types.ts`       | Permission prompt React state                                  |
| ICommand           | `@robota-sdk/agent-sdk` | SDK-owned command palette and slash command entry              |
| ICommandSource     | `@robota-sdk/agent-sdk` | SDK-owned command source contract                              |

## Public API Surface

| Export          | Kind     | Description               |
| --------------- | -------- | ------------------------- |
| startCli        | function | CLI entry point           |
| ITerminalOutput | type     | Terminal I/O DI interface |
| ISpinner        | type     | Spinner handle            |

Note: `createSession()` is internal to `agent-sdk` and is NOT re-exported. The CLI uses `InteractiveSession` directly. `index.ts` does not re-export SDK types; consumers should import those directly from `@robota-sdk/agent-sdk`.

## File Structure

```
src/
├── bin.ts                           ← Binary entry point
├── cli.ts                           ← Config loading, Ink render invocation
├── print-terminal.ts                ← ITerminalOutput for print mode (-p)
├── types.ts                         ← ITerminalOutput, ISpinner
├── index.ts                         ← Public CLI entry exports
├── plugins/
│   └── plugin-command-adapter.ts    ← CLI implementation of ICommandPluginAdapter
├── utils/
│   ├── cli-args.ts                  ← CLI argument parsing and validation
│   ├── settings-io.ts               ← Settings file read/write/update/delete
│   ├── provider-factory.ts          ← AI provider resolution from injected definitions
│   ├── interactive-prompt.ts        ← Re-export shim for SDK command interaction prompt descriptor types
│   ├── tool-call-extractor.ts       ← Tool call display extraction from history
│   ├── paste-labels.ts              ← Paste label insertion and expansion for multiline paste
│   └── edit-diff.ts                 ← Edit diff computation and formatting for display
└── ui/
    ├── App.tsx                      ← Thin JSX shell (~220 lines); no queue/abort/session logic
    ├── hooks/
    │   ├── useInteractiveSession.ts ← ONLY React↔SDK bridge; delegates to TuiStateManager for
    │   │                              history: IHistoryEntry[] state; converts InteractiveSession
    │   │                              events to React state (streamingText, activeTools, etc.)
    │   ├── TuiStateManager.ts       ← Holds history: IHistoryEntry[]; syncs from getFullHistory();
    │   │                              manages windowing (MAX_RENDERED_MESSAGES) and local event entries
    │   └── usePluginCallbacks.ts    ← Plugin TUI adapter memoization
    ├── flows/
    │   ├── text-prompt-flow.ts      ← Text prompt editing, validation, submit/cancel effects
    │   ├── selection-flow.ts        ← Shared bounded/wrapping selection state machine
    │   ├── confirm-prompt-flow.ts   ← Confirmation shortcuts and option selection
    │   ├── permission-prompt-flow.ts← Permission shortcuts and decision mapping
    │   ├── input-area-flow.ts       ← Slash autocomplete, prompt history, and paste-label input flow
    │   └── cjk-text-input-flow.ts   ← CJK-aware text editing and paste flow
    ├── render.tsx                   ← Ink render() invocation
    ├── MessageList.tsx              ← Renders IHistoryEntry[] via EntryItem (dispatches on category)
    ├── InputArea.tsx                ← Bottom fixed input (CjkTextInput), slash detection
    ├── SessionStatusBar.tsx         ← Statusline settings + git branch adapter
    ├── StatusBar.tsx                ← Activity, conditional mode, model, git branch, context %
    ├── PermissionPrompt.tsx         ← Allow/Deny arrow-key selection (useInput)
    ├── StreamingIndicator.tsx       ← Real-time Tools:/Robota: display during run()
    ├── SlashAutocomplete.tsx        ← Command autocomplete popup (scroll, highlight)
    ├── CjkTextInput.tsx             ← Custom text input with Korean IME support
    ├── ConfirmPrompt.tsx            ← Reusable arrow-key confirmation prompt
    ├── WaveText.tsx                 ← Wave color animation for waiting indicator
    ├── ListPicker.tsx               ← Generic list picker overlay (session resume, etc.)
    ├── InteractivePrompt.tsx        ← Generic choice/text prompt renderer for CLI interactions
    ├── ToolDiffBlock.tsx            ← Tool diff metadata shell with Markdown diff body rendering
    ├── MenuSelect.tsx               ← Arrow-key menu selection component (Plugin TUI)
    ├── PluginTUI.tsx                ← Plugin management TUI (screen stack navigation)
    ├── TextPrompt.tsx               ← Text input prompt component (Plugin TUI)
    ├── plugin-tui-handlers.ts       ← Plugin TUI action handlers (install, uninstall, etc.)
    ├── render-markdown.ts           ← Markdown rendering for terminal output
    ├── InkTerminal.ts               ← No-op ITerminalOutput
    └── types.ts                     ← IPermissionRequest
```

**Note:** `CommandRegistry`, `BuiltinCommandSource`, `SkillCommandSource`, `PluginCommandSource`, `SystemCommandExecutor`, `ICommand`, `ICommandSource`, and `executeSkill()` are owned by `@robota-sdk/agent-sdk`. The CLI does not use `SystemCommandExecutor` directly; slash command execution goes through `session.executeCommand(name, args)`. The CLI has no `src/commands/` compatibility surface. Plugin command discovery uses the SDK-owned `PluginCommandSource`; plugin command execution lives in `@robota-sdk/agent-command-plugin`; `src/plugins/plugin-command-adapter.ts` is the CLI's local adapter implementation. The CLI's `src/index.ts` exports only `startCli` and local CLI types.

## CLI Usage

```bash
robota                              # Interactive TUI
robota -p "prompt"                  # Print mode (one-shot)
robota -c                           # Continue last session (most recent by cwd)
robota --continue                   # Same as -c
robota -r <id>                      # Resume session by ID or name
robota --resume [id]                # Resume session (shows picker if no ID given)
robota -c --fork-session             # Fork from last session (new ID, restored context)
robota --name <name>                # Set session name on startup
robota --reset                      # Delete user settings and exit
robota --model <model>              # Model override
robota --language <lang>            # Response language (ko, en, ja, zh)
robota --permission-mode <mode>     # plan | default | acceptEdits | bypassPermissions
robota --max-turns <n>              # Limit turns
robota --output-format <fmt>        # text | json | stream-json (print mode only)
robota --system-prompt <text>       # Replace system prompt (print mode only)
robota --append-system-prompt <text> # Append to system prompt (print mode only)
robota --check-update               # Check npm for the latest CLI version and exit
robota --disable-update-check        # Skip interactive startup update check for this invocation
robota --version                    # Version
```

### Print Mode and Headless Transport

Print mode (`-p`) delegates execution to `@robota-sdk/agent-transport-headless` via `createHeadlessTransport`. The CLI creates an `InteractiveSession`, attaches the headless transport via `session.attachTransport(transport)`, calls `transport.start()`, then calls `session.shutdown({ reason: 'prompt_input_exit' })` before exiting with `transport.getExitCode()`.

Any command modules supplied to `startCli({ commandModules })` are passed to the same `InteractiveSession` in both print mode and TUI mode.

**`--output-format`** controls how the response is written to stdout:

| Format        | Description                                              |
| ------------- | -------------------------------------------------------- |
| `text`        | Plain text response (default)                            |
| `json`        | Single JSON object with `type`, `result`, `session_id`   |
| `stream-json` | Newline-delimited JSON with `content_block_delta` events |

**`--system-prompt`** and **`--append-system-prompt`** are parsed but not yet connected to InteractiveSession. Requires SDK-level support for custom system prompt injection. Flags are reserved for future implementation.

### Stdin Pipe

When `-p` is specified with no positional argument and stdin is piped (not a TTY), the CLI reads the full stdin stream as the prompt:

```bash
echo "Explain this" | robota -p
cat file.ts | robota -p "Review this code"
```

If both stdin and a positional argument are provided, stdin content is prepended to the prompt.

### Exit Codes

| Code | Meaning                |
| ---- | ---------------------- |
| 0    | Success or interrupted |
| 1    | Error during execution |

### CLI Update Check

The CLI owns package-version update checks because they are distribution UX, not SDK agent behavior. This feature is exclusive to `@robota-sdk/agent-cli`. The SDK, providers, session store, and command modules must not know about npm, package manager commands, or CLI release cadence.

Update-check behavior:

- Startup checks are enabled by default only for interactive TUI startup and rate-limited by a product-level TTL constant.
- The default cache TTL is 24 hours.
- Registry lookup uses the npm package metadata endpoint for `@robota-sdk/agent-cli`.
- Registry URL, timeout, package name, and TTL are CLI-owned constants. They are not written into `settings.json` during startup.
- Registry lookup failure must never prevent interactive, print, or headless startup.
- Update notices must not be written into project session history.
- TUI notices are rendered as transient UI outside `MessageList`.
- Print/headless execution (`robota -p`, JSON output, and streaming JSON output) must not schedule automatic startup update checks and must not emit startup update notices. This keeps automation, pipes, and structured stdout/stderr contracts deterministic without requiring `--disable-update-check`.
- The CLI may show the command `npm install -g @robota-sdk/agent-cli@latest`, but it must not execute install/update commands without explicit user confirmation.

Operational cache lives in `~/.robota/update-check.json` and is not part of `.robota/sessions`. Cache fields include package name, checked timestamp, current version, latest version, and the last non-fatal error message if a registry lookup failed.

`robota --check-update` forces a registry lookup and exits after printing one of:

- update available notice with the install command;
- already-current notice;
- registry failure message.

`robota --disable-update-check` disables only the current interactive startup invocation. Persistent policy storage is not part of the first implementation.

### Session Resolution Logic

| Flag                | Behavior                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--continue` / `-c` | Finds the most recent session matching the current working directory and resumes it (reuses original session ID, continues writing to the same session file)  |
| `--resume [id]`     | If an ID or name is provided, resumes that session (reuses original session ID). If omitted, shows a session picker                                           |
| `--fork-session`    | Boolean flag, used with `--continue` or `--resume`. Creates a new session (fresh UUID) but restores context from the resumed session. Original file preserved |
| `--name <name>`     | Sets the session name. Can be combined with other flags                                                                                                       |

When `--resume` is used without a value, a `ListPicker` overlay is shown with all saved sessions. The user selects one to resume.

### Session Storage

The CLI asks `@robota-sdk/agent-sdk` for a project-local session persistence facade rooted at `.robota/sessions`, not the generic user-level default. The CLI must not import `SessionStore` or `ISessionRecord` from `@robota-sdk/agent-sessions`; it may only consume SDK-owned store and resumable-session summary types. Every resumable session record must stay beside the project logs and must include provider messages, UI history, the exact system prompt, and registered tool schemas. This makes `/continue`, `/resume`, and local debugging inspect the same project-local `.robota` tree.

## Tool Output Limits

- **Universal cap**: Tool output is capped at 30,000 characters. Outputs exceeding this limit are middle-truncated (first and last portions are kept, with a truncation marker in the middle).
- **Glob entry limit**: The Glob tool defaults to a maximum of 1,000 entries per invocation to prevent oversized responses.

## First-Run Setup

When no settings file exists (`~/.robota/settings.json`, `.robota/settings.json`, or `.robota/settings.local.json`), the CLI prompts for initial setup:

1. **Anthropic API key** (input masked with asterisks)
2. **Response language** (ko/en/ja/zh, default: en)

Creates `~/.robota/settings.json` with provider config and language setting. The language is injected into the system prompt as `"Always respond in {language}."` and persists across compaction.

Use `robota --reset` to delete the user settings file and return to the first-run state.

## Session Logging

Session logging is an SDK-internal concern. The CLI does not configure or manage log files. For logging details (JSONL format, log paths, event types), see the agent-sdk SPEC.

## Tool Execution Display

Tool execution uses a unified visual style across real-time streaming and post-execution summary.

### Icons and Colors

| State   | Icon | Color        | Strikethrough | When                        |
| ------- | ---- | ------------ | ------------- | --------------------------- |
| Running | ⟳    | yellow       | no            | Tool is executing           |
| Success | ✓    | green        | no            | Tool completed successfully |
| Error   | ✗    | red          | yes           | Tool execution failed       |
| Denied  | ⊘    | yellowBright | yes           | Permission denied           |

### Labels

- `Tools:` / `Tool:` headers use **white bold** (visible on dark terminals).
- Tool count badge: `[N tools]` in white dim.

### Argument Truncation

Long tool arguments are truncated with **middle ellipsis**, keeping the last 30 characters visible:

- Before: `Read(/Users/jungyoun/Documents/dev/robota/packages/agent-sdk/src/plugins/ver...)`
- After: `Read(/Users/jungyoun/Documents/dev/...sdk/src/plugins/very-long/file.ts)`

This ensures file names and important suffixes remain visible.

### Plugin Skill Display

Plugin skills show the plugin hint before the description:

- Format: `/skill-name (plugin-name) description`
- Example: `/audit (rulebased-harness) Audits your project's harness setup`

### Assistant Markdown Diff Rendering

Assistant responses are rendered as Markdown through `render-markdown.ts`. A fenced code block with the `diff` language identifier is the canonical way for the assistant to show proposed code changes inside normal prose:

````markdown
```diff
- const oldValue = true;
+ const newValue = true;
```
````

**Rules:**

- `render-markdown.ts` owns assistant Markdown diff rendering.
- `diff` fenced blocks receive line-level terminal colors: removed lines use high-contrast light red foreground plus dark red background, added lines use high-contrast light green foreground plus dark green background, hunk headers use cyan foreground, and diff metadata is dim.
- Added and removed `diff` rows are padded before ANSI styling so the background covers the full rendered row. The renderer uses an explicit code block width when supplied and otherwise falls back to the widest diff row.
- Color is controlled by renderer options and terminal color environment. With color disabled, the same diff text remains readable without ANSI escape codes.
- General fenced code blocks continue through `marked-terminal`; only `diff` fenced blocks take the Robota line-level path.
- Tool execution summaries use the same Markdown diff body rendering path while keeping file path, truncation, permissions, and streaming status as structured UI metadata outside the fenced block.

### Edit Diff Display

When an Edit tool summary includes diff lines, the CLI shows a compact diff below the tool line. This gives the user immediate visibility into what changed without inspecting the file.

**Source:** `old_string` and `new_string` from the Edit tool arguments.

**Ownership:** `tool-diff-summary.ts` converts structured `IDiffLine[]` data into a Markdown fenced `diff` body. `ToolDiffBlock.tsx` renders structured metadata around that body and delegates the diff body itself to `renderMarkdown()`. There must not be a second bespoke diff-coloring policy for tool summaries; edit diffs use the same foreground, background, and row-fill policy as assistant Markdown diffs.

**Display format:**

```markdown
✓ Edit(src/provider.ts)
│ src/provider.ts
`diff
    - 42 | const DEFAULT_MAX_TOKENS = 4096;
    + 42 | const maxTokens = getModelMaxOutput(modelId);
    `
```

**Rules:**

- Show the file path as a header line.
- Diff body lines use Markdown `diff` prefixes: `-` for removed, `+` for added, and a leading space for context lines.
- Line numbers are included inside the diff body text as `PREFIX NN | content` so they remain readable with colors disabled.
- File path is structured metadata outside the Markdown diff body.
- Truncation is structured metadata outside the Markdown diff body: **max display lines: 12**. If the diff exceeds 12 lines, render the first 10 lines plus `... and N more lines`.
- If `old_string` and `new_string` are identical (no-op edit), show nothing.
- Diff is shown in both the real-time streaming indicator (after tool completes) and the post-execution summary.
- Post-execution `tool-summary` entries must render from structured `data.tools` when present so persisted `diffFile` and `diffLines` are not lost. The plain `summary` string is a fallback for legacy entries only.

**Permission prompt integration (future):**

When a permission prompt is shown for an Edit tool, the diff should be displayed alongside the Allow/Deny prompt so the user can see what will change before approving.

## Keyboard Controls

### Message Display Order (fixed)

The display order is **Tool → Robota**, fixed and identical for streaming, normal completion, and ESC abort:

**During streaming (real-time):**

```
You: [user prompt]             ← MessageList (visible immediately on submit)
System: Invoking skill: audit  ← MessageList (SDK skill_activation event)
Tool: ⟳ Read(file.ts)         ← StreamingIndicator (real-time, below MessageList)
      ⟳ Edit(file.ts)
Robota: [streaming text...]    ← StreamingIndicator (real-time)
```

`You:` and SDK-owned `System:` events are visible from the start of streaming — not delayed until
completion. Messages are synced from InteractiveSession on both `thinking=true` (execution start)
and `thinking=false` (execution end). Only `Tool:` and `Robota:` are handled by StreamingIndicator
during streaming.

**After completion or abort (final state):**

```
You: [user prompt]             ← MessageList
Tool: ✓ Read(file.ts)         ← MessageList (tool summary message, inserted before Robota)
      ✓ Edit(file.ts)
Robota: [response]             ← MessageList
System: Interrupted by user.   ← MessageList (abort only)
```

**Mechanism:**

- During streaming: `StreamingIndicator` renders `activeTools` + `streamingText` in real-time (Tool → Robota order). Each tool occupies exactly one line — `onToolEnd` uses `findIndex` to update only the first matching running entry (not all entries with the same tool name).
- Individual `tool-start` and `tool-end` events are recorded as `IHistoryEntry` in the session history for persistence, but `MessageList` does **not** render them (returns empty fragment). They exist only for session resume and debugging.
- On complete/interrupt/error: `InteractiveSession.pushToolSummaryMessage()` inserts a formatted tool summary into the `messages` array BEFORE the Robota response. Then `activeTools` is cleared and `StreamingIndicator` disappears.
- Result: Tool → Robota order is preserved in both real-time and final state. Tool information transitions from `StreamingIndicator` (live) to `MessageList` (permanent).

### Ctrl+C — Graceful Shutdown

Ink render uses `exitOnCtrlC: false`. The first Ctrl+C is handled by `App.tsx`, renders `Shutting down...`, and calls `useInteractiveSession.handleShutdown('prompt_input_exit')`. That delegates to `InteractiveSession.shutdown()`, so foreground abort, managed background task cancellation, session persistence, and `SessionEnd` hooks run in the SDK-owned lifecycle before the TUI exits.

Slash-command restarts and exits (`/exit`, provider/model/language restart, reset) also call `InteractiveSession.shutdown()` before `useApp().exit()`. The CLI owns only signal/UI wiring; it must not enumerate or kill SDK-managed background work directly.

### ESC — Abort Execution

ESC aborts the current execution gracefully (unlike Ctrl+C which kills the process):

1. ESC key handler in `App.tsx` calls `handleAbort()` (from `useInteractiveSession`). The App-level ESC listener remains mounted and guards permission, plugin, and session-picker overlays inside the handler instead of toggling `useInput({ isActive })`.
2. `handleAbort` sets `isAborting: true` and calls `interactiveSession.abort()`
3. AbortSignal propagates through the entire stack (ExecutionService -> Provider -> `streamWithAbort`)
4. `executeRound` calls `commitAssistant('interrupted')` — the partial response is saved to conversation history with `state: 'interrupted'`. Text is ALWAYS preserved (no stripping).
5. `InteractiveSession` emits the `interrupted` event; the `thinking` event fires with `false`

**Rendering state on abort (`onInterrupted` handler):**

- **Tool list**: `pushToolSummaryMessage()` inserts tool summary into `messages` (before Robota). Then `activeTools` is cleared — tool info lives in `MessageList` now, not `StreamingIndicator`.
- **Streaming text**: cleared (`streamBuf = ''`, `setStreamingText('')`). The interrupted response is committed to message history.
- **isAborting**: cleared by `onThinking(false)` handler.
- **Border color**: yellow (aborting) → green (normal) after `onThinking(false)`.

6. `useInteractiveSession`'s `onThinking(false)` handler:
   - Sets `isAborting: false`
   - Re-syncs `messages` from `interactiveSession.getMessages()` — interrupted messages are already committed
   - Messages with `msg.state === 'interrupted'` show an interrupted indicator in the UI
7. After abort, conversation continues normally — history includes the interrupted assistant message and any tool results
8. History is the SSOT for all message content. Append-only, read-only — no edit, no delete.

**What appears in the UI after ESC:**

```
Tool:                           ← in MessageList (from pushToolSummaryMessage)
  ✓ Read(file.ts)
  ⟳ Edit(file.ts)

Robota:                         ← in MessageList (committed interrupted response)
  [partial response text...]

System:                         ← in MessageList
  Interrupted by user.
```

Tool → Robota order preserved. StreamingIndicator is cleared (activeTools = []).

### Prompt History Navigation

In `InputArea`, up/down arrows follow shell-style prompt history navigation:

- Up recalls the newest submitted prompt first, then moves toward older prompts.
- Down moves toward newer prompts and restores the in-progress draft after the newest history item.
- Empty prompts and consecutive duplicates are not added to prompt history.
- Restored session history contributes user chat entries to the prompt history list.
- The behavior is owned by `input-area-flow.ts`; `InputArea` applies returned value/cursor/state changes.
- `InputArea` disables `CjkTextInput` vertical arrow handling so the parent prompt-history flow owns up/down semantics.

### Up/Down Arrows — Visual Line Navigation

`CjkTextInput` can move the cursor between wrapped visual lines when `enableVerticalNavigation=true`. `InputArea` sets this to `false` because its product-level up/down semantics are prompt history navigation.

**Architecture:**

- Cursor-only manipulation — text is never modified, only flow `cursor` position changes
- External value sync with `cursorHint` — when parent sets value, cursor position is determined by `cursorHint` prop: `null` (default) moves cursor to end (tab completion, clear), a number moves cursor to that position (paste). `cursorHint` is consumed once and reset to `null` after use.
- Helpers in `cjk-text-input-flow.ts`:
  - `displayOffset(chars, charIndex, width)` → cumulative display column offset, accounting for CJK line-end gaps
  - `charIndexAtDisplayOffset(chars, targetOffset, width)` → char index closest to target offset
- Up arrow: `cursor = charIndexAtDisplayOffset(chars, offset - availableWidth, width)`
- Down arrow: `cursor = charIndexAtDisplayOffset(chars, offset + availableWidth, width)`
- Uses `string-width` for CJK character support (2 columns per CJK character)

**Available width calculation:**

- `InputArea` computes `availableWidth` from Ink 7 `useWindowSize().columns` minus layout constants
- `availableWidth = terminalColumns - BORDER_HORIZONTAL - PADDING_LEFT - PROMPT_WIDTH`
- Named constants (no magic numbers): `BORDER_HORIZONTAL = 2`, `PADDING_LEFT = 1`, `PROMPT_WIDTH = 2` ("> ")
- Layout constants are co-located with InputArea (the component that owns the layout)
- `availableWidth` is passed to `CjkTextInput` as a prop when visual navigation is enabled

**Behavior:**

- Up arrow when already on first visual line: no-op (target offset < 0)
- Down arrow when already on last visual line: no-op (target offset exceeds text)
- Column position is preserved across line moves via offset arithmetic
- Terminal resize recalculates available width via `useWindowSize()`

### Paste Handling

**Paste event lifecycle:**

- `CjkTextInput` uses Ink 7 `usePaste`, which owns bracketed paste enable/disable while the input is focused
- `render.tsx` must not globally toggle DECSET 2004; paste lifecycle belongs to the active input hook, not the app renderer
- `usePaste` delivers the complete pasted string to `cjk-text-input-flow` as a single event, separate from `useInput`
- `cjk-text-input-flow` normalizes `\r\n`/`\r` to `\n` before deciding whether to insert text or emit a paste-label effect
- Legacy bracketed paste marker handling remains in the flow as a fallback for callers that receive `[200~`/`[201~` through `useInput`
- Deterministic boundary detection — no debounce or timing heuristics

**Single-line vs multiline paste:**

- Single-line paste (no `\n`): inserted directly into the input at the current cursor position via `insertAtCursor`
- Multiline paste (contains `\n`): routed to `onPaste(text, cursorPosition)` → `InputArea.handlePaste` inserts a `[Pasted text #N +M lines]` label at the current cursor position, stores content in `pasteStore`
- On submit, `expandPasteLabels()` replaces labels with actual content from `pasteStore`
- Paste store is cleared after each submit

**Fallback for terminals without bracketed paste:**

- Multi-char input containing `\n` or `\r` is treated as a single paste (original heuristic)

## Plugin Management TUI

The `/plugin` command opens an interactive TUI for managing bundle plugins, built with `MenuSelect`, `TextPrompt`, and `ConfirmPrompt` components.

### Screen Stack Navigation

The TUI uses a screen stack pattern with 8 screens:

| Screen                      | Description                                                       |
| --------------------------- | ----------------------------------------------------------------- |
| `main`                      | Top-level menu (Marketplace / Installed / Exit)                   |
| `marketplace-list`          | List of configured marketplace sources                            |
| `marketplace-action`        | Actions for a selected source (Browse / Add / Back)               |
| `marketplace-browse`        | Browse plugins from a selected source                             |
| `marketplace-install-scope` | Choose install scope (project / user)                             |
| `marketplace-add`           | Add a new marketplace source URL                                  |
| `installed-list`            | List of installed plugins with enable/disable state               |
| `installed-action`          | Actions for a selected plugin (Enable/Disable / Uninstall / Back) |

ESC navigates back in the stack. When the stack is empty, the TUI closes and returns to the normal input area.

## Subagent Execution

Subagent execution (`/agent` command module, fork sessions, agent definition loading) is managed by `@robota-sdk/agent-sdk` internally. The CLI does not own subagent lifecycle state — `InteractiveSession` handles subagent and background task lifecycle.

The CLI owns Node runtime process adapters. It injects `createManagedShellProcessRunner()` into `InteractiveSession` as a `kind: 'process'` background task runner. SDK composition then exposes the separate `BackgroundProcess` tool; the existing foreground `Bash` tool remains unchanged.

`createManagedShellProcessRunner()` owns only Node process spawning, stdin forwarding,
termination, and process-environment wiring. Bounded output capture, source-prefixed log line
projection, and cursor-based log pagination come from runtime-owned helpers re-exported by the SDK.

The CLI also injects `createChildProcessSubagentRunnerFactory()` into `InteractiveSession` as the production subagent runner factory. The factory receives SDK-assembled subagent dependencies, but the runner starts a child Node worker and sends only serializable config/context/provider/agent-definition data over IPC. The worker reconstructs its provider inside the child process using the same concrete provider profile the CLI used for the parent session.

`child-process-subagent-runner-result.ts` owns child-worker result orchestration for the adapter: IPC message validation, timeout timer cleanup, early-exit errors, and transcript metadata projection. `child-process-subagent-runner.ts` remains the process factory and payload composer.

Agent command behavior is not owned by the TUI. The Robota binary composes `@robota-sdk/agent-command-agent` as a default command module, but reusable CLI UI code only handles generic command modules.

Child-process subagent runner responsibilities:

- fork one worker process per subagent job
- pass `ISubagentSpawnRequest`, agent definition, parent config/context, permission mode, and serialized provider profile over IPC
- expose child `pid` on the background task state
- forward worker text/tool IPC messages to `BackgroundTaskManager` progress events
- create an append-only subagent transcript at `.robota/logs/PARENT_SESSION_ID/subagents/AGENT_ID.jsonl` and make `/agent read AGENT_ID` read that transcript while the worker is still running
- forward cancellation to the worker and terminate it after a grace period
- forward follow-up prompts to workers that support input
- keep runtime-owned lifecycle state inside `BackgroundTaskManager`; the CLI owns only the Node process adapter

Subagent transcript pagination uses the same runtime-owned log page helper as process background
tasks. The CLI remains responsible for locating and reading the append-only transcript file.

When an agent request sets `isolation: 'worktree'`, the CLI composes the runtime-owned `WorktreeSubagentRunner` exposed through SDK contracts around the child-process runner and injects a CLI-owned `GitWorktreeIsolationAdapter`.

The runtime worktree runner owns worktree lifecycle orchestration:

- delegate non-worktree requests unchanged
- run isolated workers with `cwd` set to the prepared worktree path
- remove clean worktrees exactly once on success, worker failure, startup failure, or successful cancellation
- preserve dirty worktrees and return `worktreePath`, `branchName`, `worktreeStatus`, `worktreeNextAction`, `worktreeBaseRevision`, and `parentWorktreeStatus` in result metadata
- fire SDK hook notifications for `WorktreeCreate` and `WorktreeRemove` when configured

The CLI-owned Git adapter implements only local Git/filesystem I/O:

- create a temporary branch and worktree before the worker starts
- retry branch/path collisions with a new short id before failing
- remove the worktree and branch when the worktree remains clean
- support nested repository cwd resolution and detached HEAD worktree creation
- fail non-Git cwd with an actionable worktree-isolation error
- report whether the worktree has local edits and expose `git status --porcelain` output for preserved worktree handoff
- allow dirty parent checkouts while surfacing the base revision and parent `git status --porcelain` in preserved handoff metadata

When a user invokes a skill slash command with `context: fork`, the CLI still calls only `interactiveSession.executeCommand(...)`. The SDK and skills command module handle fork execution deterministically. The CLI may render a `skill-invocation` event, but it must not convert fork skills into plain prompt injection.

When a user asks in normal conversation to call or delegate to an agent, the request is handled through the model-invocable `/agent` built-in command module. The CLI only displays the resulting command/background events and final assistant response.

Background agent task lifecycle and progress are projected by the SDK execution workspace APIs.
`TuiStateManager` stores the latest SDK workspace snapshot and the currently selected entry id for
rendering. React components may render this SDK state only; they must not own task transitions,
retention, grouping, unread semantics, or cancellation logic.

The shared contract for switchable main-thread, process, agent, group, and skill-spawned work state
is [../../../.agents/specs/background-work-state.md](../../../.agents/specs/background-work-state.md).
The CLI may render existing SDK fields and selection indicators now. Any future row fields such as
elapsed time, input-needed reason, terminal result, archive, or clear controls must be introduced in
SDK/runtime projections before TUI components display them.

`BackgroundTaskPanel` renders SDK default-visible background task entries as a one-level tree headed
by `Background work`. Each child row is built by the pure `formatBackgroundTaskRow` formatter from
`IExecutionWorkspaceEntry` data and contains a compact status marker, human-readable task label,
secondary metadata such as task kind/status/attention, and a short whitespace-normalized preview.
The always-visible panel must not expose raw task IDs; task IDs remain available through
`/background list` and `/background read`. User controls are routed through
`@robota-sdk/agent-command-background`:

| Command                               | Behavior                       |
| ------------------------------------- | ------------------------------ |
| `/background` or `/background list`   | List current background tasks  |
| `/background read <task-id> [offset]` | Read stdout/stderr log lines   |
| `/background cancel <task-id>`        | Cancel one queued/running task |
| `/background close <task-id>`         | Dismiss one terminal task      |

For implementation details of subagent/background execution (`/agent`, `context: fork` skills, background task manager, agent definition scanning), see the agent-sdk and agent-runtime SPEC files.

Background job groups are SDK-owned orchestration state. The TUI may render group entries from the
SDK execution workspace snapshot, but it must not decide group completion, aggregate raw logs,
trigger continuations, or own retry/wait behavior. Group waiting and summaries are exposed through
SDK APIs and `/agent wait` command behavior.

### Execution Workspace Switcher

The execution workspace switcher is a TUI-only view over `InteractiveSession` execution workspace
APIs. `agent-sdk` owns the snapshot entries, status, attention, visibility, origin metadata, detail
pagination, and available controls. `agent-cli` owns only:

- opening/closing the switcher with Ctrl+B;
- arrow-key menu navigation while the switcher is open;
- the currently selected entry id as ephemeral terminal view state;
- rendering SDK-provided entries and detail records.

The switcher list includes the main thread plus SDK-projected background task and background group
entries. The active visible entry renders with `●`; inactive entries render with `○`. A separate
highlight marker may indicate the currently focused menu row before Enter commits a selection. Enter
changes only the selected view id; it must not cancel, close, pause, foreground, wait, or otherwise
mutate execution.

When the selected entry is not the main thread, the message pane is replaced by an execution detail
pane populated through `InteractiveSession.readExecutionWorkspaceDetail(entryId)`. Main-thread
selection renders the normal `MessageList`. Live updates come from `execution_workspace_event`
snapshots emitted by the SDK; React components must not infer lifecycle, retention, or task grouping
from raw `background_task_event` data when an SDK workspace entry exists.

Completed, failed, cancelled, and grouped task visibility follows the SDK `visibility` field. The
CLI may filter the always-visible compact panel to `visibility: default` background task entries,
but it must not invent a separate retention timeout, close/dismiss policy, unread policy, or group
completion rule. Explicit controls such as cancel, close, wait, send, or read-log remain SDK/command
APIs and are not implied by view selection.

When rendering user-facing workflow states, the CLI follows the transparent workflow vocabulary. It
may display a debug/raw runtime status only in an explicitly labeled diagnostic context.

### AI Workflow Control Surface

Future AI workflow dashboards, task intake wizards, review/evidence screens, and workflow command
menus are TUI-only surfaces. The CLI may render repository workflow state only through SDK/runtime
or harness-owner projections defined by
[../../../.agents/specs/ai-workflow-control-plane.md](../../../.agents/specs/ai-workflow-control-plane.md).

The CLI must not parse workflow manifests, choose canonical harness commands, execute workflow hooks,
write evidence artifacts, decide review gates, retain workflow runs, or infer workflow lifecycle from
raw shell output. It may provide terminal-local runner adapters and render:

- manifest readiness and setup gaps supplied by owner APIs;
- workflow run list/detail projections;
- command choices and hook decisions supplied by owner APIs;
- evidence links and review decisions recorded through owner APIs.

## Memory Management

### User-Local Memory And Preference Transparency

User-local memory is display/navigation state only. The CLI may render inspection rows, disabled
state, storage location, source, last-used time, and delete/disable actions returned by SDK or
command APIs. It must not own storage shape, write user-local memory directly, write baseline memory
inside the repository, or convert remembered values into command execution.

### Project Memory Review Surface

Project memory storage and policy primitives are SDK-owned, while `/memory` command behavior is owned by `@robota-sdk/agent-command-memory`. The CLI and TUI must not extract memory candidates, select relevant topics, decide approval policy, or write `.robota/memory` files directly. They compose the memory command module, route `/memory` commands through `session.executeCommand()`, and render returned messages/data.

Supported memory command module flows exposed through the CLI:

| Command                | CLI responsibility                                              |
| ---------------------- | --------------------------------------------------------------- |
| `/memory list`         | Render memory index/topic paths returned by the SDK             |
| `/memory show [topic]` | Render memory index or topic content returned by the SDK        |
| `/memory add ...`      | Pass arguments to the SDK command; render save/dedup result     |
| `/memory pending`      | Render pending automatic candidates returned by the SDK         |
| `/memory approve ID`   | Pass the selected candidate ID to the SDK; render save result   |
| `/memory reject ID`    | Pass the selected candidate ID to the SDK; render reject result |
| `/memory used`         | Render SDK-reported memory references used in the latest turn   |

Pending-memory notices emitted into `InteractiveSession` history are presentation data only. TUI components may style or position them, but must not infer candidate IDs or mutate memory state outside SDK commands.

## Edit Checkpointing

Edit checkpoint behavior is SDK-owned and `/rewind` command behavior is owned by `@robota-sdk/agent-command-rewind`. The CLI and TUI must not snapshot files, restore files, inspect checkpoint manifests directly, format `/rewind` command output, or decide rollback ordering. They route `/rewind` commands through `session.executeCommand()` and render returned messages/data.

Supported SDK-owned edit checkpoint commands exposed through the CLI:

| Command                         | CLI responsibility                                        |
| ------------------------------- | --------------------------------------------------------- |
| `/rewind list`                  | Render checkpoint summaries returned by the SDK           |
| `/rewind restore <checkpoint>`  | Pass the selected checkpoint ID to the SDK                |
| `/rewind code <checkpoint>`     | Alias for SDK code restore; render the restore result     |
| `/rewind rollback <checkpoint>` | Pass the selected checkpoint ID to SDK inclusive rollback |

Future Esc Esc or picker UI is terminal chrome only. The picker must call SDK APIs or commands; it must not duplicate checkpoint storage or restore algorithms.

### Message Windowing

`TuiStateManager` keeps only the most recent 100 entries (`MAX_RENDERED_MESSAGES`) in `history: IHistoryEntry[]`. Older entries are dropped from the render tree to prevent unbounded memory growth. Full conversation history is preserved in the session store on disk.

### Tool State Cleanup

Completed tool execution states are trimmed to the most recent 50 entries (`MAX_COMPLETED_TOOLS`). Running tools are always kept. This prevents `activeTools` array from growing unbounded during tool-heavy responses.

### React.memo

`MessageItem` component uses `React.memo` to skip re-renders when message props are unchanged, reducing CPU and indirect memory pressure from Ink's full-tree reconciliation.

## Message Architecture

The CLI uses `IHistoryEntry` from `@robota-sdk/agent-core` as the primary message type for the message list. `TUniversalMessage` is still used in lower-level contexts (session history access, type guards, provider calls). There is no local `IChatMessage` type.

### Type Unification

- `IHistoryEntry[]` is the primary type held by `TuiStateManager` and passed to `MessageList`
- `MessageList` renders entries via `EntryItem`, which dispatches on `entry.category`:
  - `'chat'` entries: rendered as conversation messages (user, assistant, system, tool)
  - `'event'` entries: rendered based on `entry.type` (e.g., `'tool-summary'` renders the tool call list, `'skill-invocation'` renders a system notice)
- `entry.id` (UUID) is used as the React key for message list rendering
- `TUniversalMessage` is still used where needed (type guards, provider API calls, `getMessages()` for backward compat)
- `msg.state === 'interrupted'` shows an interrupted indicator in the UI

### Message State in useInteractiveSession

- `history: IHistoryEntry[]` React state is managed by `TuiStateManager` and derived from `interactiveSession.getFullHistory()`.
- After each execution (when `thinking` transitions to `false`), the hook delegates to `TuiStateManager` to sync `history` from `interactiveSession.getFullHistory()` — the session is the SSOT for all history content.
- `addMessage` appends a local system message directly to React state (used for command output and error notices that are not part of the AI conversation). These are wrapped as `IHistoryEntry` with `category: 'event'` before insertion.
- After abort: interrupted messages are already committed to session history by `InteractiveSession`; the hook re-syncs from full history — no separate streaming text ref is needed.

### Tool Message Type Guards

Tool messages use the `isToolMessage(msg)` type guard for safe access to `msg.name`.

## Known Limitations

- **Korean IME on macOS Terminal.app**: Ink's renderer shifts the input area during IME composition, causing Terminal.app to crash (SIGSEGV). Fixed by adding a permanent blank line below the input area, which stabilizes the cursor position during IME composition. **Use [iTerm2](https://iterm2.com/) for the best experience.**
- **CjkTextInput**: Custom text input component with try-catch error handling, non-printable character filtering, `setCursorPosition` removed to minimize IME interaction surface, and optional visual-line-aware up/down arrow navigation for wrapped text.

## Dependencies

`@robota-sdk/agent-cli` requires Node.js 22+ because Ink 7 requires Node.js 22 and React 19.2+.

| Package                                 | Purpose                                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `@robota-sdk/agent-command-agent`       | Default `/agent` command module composed by the Robota binary                                                                        |
| `@robota-sdk/agent-command-compact`     | Default `/compact` command module composed by the Robota binary                                                                      |
| `@robota-sdk/agent-command-context`     | Default `/context` command module composed by the Robota binary                                                                      |
| `@robota-sdk/agent-command-exit`        | Default `/exit` command module composed by the Robota binary                                                                         |
| `@robota-sdk/agent-command-help`        | Default `/help` command module composed by the Robota binary                                                                         |
| `@robota-sdk/agent-command-language`    | Default `/language` command module composed by the Robota binary                                                                     |
| `@robota-sdk/agent-command-model`       | Default `/model` command module composed by the Robota binary                                                                        |
| `@robota-sdk/agent-command-permissions` | Default `/permissions [mode]` command module composed by the Robota binary                                                           |
| `@robota-sdk/agent-command-provider`    | Default `/provider` command module composed by the Robota binary                                                                     |
| `@robota-sdk/agent-command-rewind`      | Default `/rewind` command module composed by the Robota binary                                                                       |
| `@robota-sdk/agent-command-session`     | Default session command module composed by the Robota binary, currently owning `/clear`, `/rename`, `/resume`, and `/cost`           |
| `@robota-sdk/agent-command-statusline`  | Default `/statusline` command module composed by the Robota binary                                                                   |
| `@robota-sdk/agent-sdk`                 | `InteractiveSession`, `CommandRegistry`, command sources, command API common layer, plugin management, re-exported runtime contracts |
| `@robota-sdk/agent-core`                | Public types (`TPermissionMode`, `TToolArgs`, `TUniversalMessage`, etc.)                                                             |
| `@robota-sdk/agent-provider-anthropic`  | Default provider definition contributed by the Robota binary                                                                         |
| `@robota-sdk/agent-provider-openai`     | Default provider definition contributed by the Robota binary                                                                         |
| `@robota-sdk/agent-provider-gemma`      | Default provider definition contributed by the Robota binary                                                                         |
| `@robota-sdk/agent-transport-headless`  | Headless runner for print mode (`-p`) execution                                                                                      |
| `ink` 7, `react` 19.2+                  | TUI rendering                                                                                                                        |
| `ink-select-input`                      | Arrow-key selection (permission prompt)                                                                                              |
| `ink-spinner`                           | Loading spinner                                                                                                                      |
| `chalk`                                 | Terminal colors                                                                                                                      |
| `ink-text-input`                        | Base text input (extended by CjkTextInput)                                                                                           |
| `marked`, `marked-terminal`             | Markdown parsing and terminal rendering                                                                                              |
| `cli-highlight`                         | Syntax highlighting for code blocks                                                                                                  |
| `string-width`                          | Unicode-aware string width calculation                                                                                               |
