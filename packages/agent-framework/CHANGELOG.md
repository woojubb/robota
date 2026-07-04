# @robota-sdk/agent-framework

## 3.0.0-beta.77

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.77
  - @robota-sdk/agent-executor@3.0.0-beta.77
  - @robota-sdk/agent-interface-transport@3.0.0-beta.77
  - @robota-sdk/agent-session@3.0.0-beta.77
  - @robota-sdk/agent-tools@3.0.0-beta.77

## 3.0.0-beta.76

### Patch Changes

- c0a6287: Relocate session feature logic out of the CLI shell and the transport (DQ-AUDIT-004):

  - Extract session-log timing analysis into the new `@robota-sdk/agent-session-analytics` package (pure analysis over canonical session records — no duplicate types, no file I/O). `agent-cli`'s `session analyze` command shrinks to thin wiring and loads records via the new `createUserSessionStore()` / existing `createProjectSessionStore()` framework facades.
  - Move LLM-based session auto-naming (`generateSessionName`) from `agent-transport/tui` into `agent-framework` (session-lifecycle owner); the TUI transport now invokes it through the framework.

- 9df3a88: Split the consolidated `@robota-sdk/agent-transport` package into per-concern transport packages (DQ-AUDIT-005) so unrelated heavy dependencies (React/Ink, ws, Hono, MCP SDK) no longer share one publishable unit and are not dragged into non-TUI consumers' graphs:

  - `@robota-sdk/agent-transport` — lean core: headless adapter + `TransportRegistry` + scripted-provider testing fixtures (no external runtime deps).
  - `@robota-sdk/agent-transport-tui` — React + Ink terminal UI.
  - `@robota-sdk/agent-transport-ws` — WebSocket transport + protocol (`agent-web-ui` now depends only on this for WS types).
  - `@robota-sdk/agent-transport-http` — Hono HTTP transport.
  - `@robota-sdk/agent-transport-mcp` — MCP server transport.

  The default transport-registry wiring (pre-registering `WsTransport`) moves to the CLI composition root, removing the core→ws edge.

- 576af62: Fix `ConfigurationError: Agent must be fully initialized before changing model configuration` when running `/preset` (or any live model re-apply) on a fresh interactive session before the first message. The Robota agent initialized lazily on the first `run()`, but `setModel` requires full initialization. `Session.applyModelOptions` now awaits the new idempotent `Robota.ensureReady()` before `setModel`, and the preset live-switch path (`applyPresetToSession` → `executePresetCommand`) is async end-to-end. Adds a real cold-session regression test (no mocked Robota).
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies [576af62]
  - @robota-sdk/agent-core@3.0.0-beta.76
  - @robota-sdk/agent-session@3.0.0-beta.76
  - @robota-sdk/agent-executor@3.0.0-beta.76
  - @robota-sdk/agent-interface-transport@3.0.0-beta.76
  - @robota-sdk/agent-tools@3.0.0-beta.76

## 3.0.0-beta.75

### Patch Changes

- Agent preset system + live preset switching + context/history correctness fixes.

  - **Preset system (PRESET-001~017):** new `@robota-sdk/agent-preset` package layering framework
    assembly options into named, selectable profiles (`default`, `autonomous-builder`, `careful-reviewer`,
    `neutral-executor`) plus user-authored external presets loaded from `~/.robota/presets/*.json`.
  - **Live preset switching:** `/preset` command (list + active marker + switch) and a TUI active-preset
    display. Switching live re-applies permission posture, model/effort, persona, command-module
    selection, parallel-subagents gating, and a self-verification system-prompt section via the single
    `applyPresetToSession` engine.
  - **CTX-001:** the TUI Context display + session auto-compact now use the accurate provider-based token
    estimate (system prompt + tool schemas included) instead of a crude history-only char heuristic.
  - **HIST-001:** conversation history is now append-only — removed the silent 100-message count cap that
    could drop early context; context size is managed solely by size-based compaction.

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.75
  - @robota-sdk/agent-session@3.0.0-beta.75
  - @robota-sdk/agent-executor@3.0.0-beta.75
  - @robota-sdk/agent-interface-transport@3.0.0-beta.75
  - @robota-sdk/agent-tools@3.0.0-beta.75

## 3.0.0-beta.74

### Patch Changes

- Architecture conformance release: doc-vs-code audit (INFRA-002), conformance skill system + GATE-CONFORMANCE blocking scan (INFRA-003), canonical-doc drift cleanup (INFRA-004~011, BEHAVIOR-004), and the interface-type SSOT extraction to `@robota-sdk/agent-interface-transport` with a mechanically-enforced interface-import rule across packages and apps (DATA-001, INFRA-012~014). Harness process lessons baked into skills (INFRA-015).
  - @robota-sdk/agent-core@3.0.0-beta.74
  - @robota-sdk/agent-executor@3.0.0-beta.74
  - @robota-sdk/agent-interface-transport@3.0.0-beta.74
  - @robota-sdk/agent-session@3.0.0-beta.74
  - @robota-sdk/agent-tools@3.0.0-beta.74

## 3.0.0-beta.73

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.73
- @robota-sdk/agent-executor@3.0.0-beta.73
- @robota-sdk/agent-interface-transport@3.0.0-beta.73
- @robota-sdk/agent-session@3.0.0-beta.73
- @robota-sdk/agent-tools@3.0.0-beta.73

## 3.0.0-beta.72

### Patch Changes

- Emit context_update event after session restore so TUI status bar reflects correct context usage immediately on /resume.
  - @robota-sdk/agent-core@3.0.0-beta.72
  - @robota-sdk/agent-executor@3.0.0-beta.72
  - @robota-sdk/agent-interface-transport@3.0.0-beta.72
  - @robota-sdk/agent-session@3.0.0-beta.72
  - @robota-sdk/agent-tools@3.0.0-beta.72

## 3.0.0-beta.71

### Patch Changes

- fix(context): unify token estimation to single SSOT — status bar and /context list now use the same serialized JSON estimate
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.71
  - @robota-sdk/agent-executor@3.0.0-beta.71
  - @robota-sdk/agent-interface-transport@3.0.0-beta.71
  - @robota-sdk/agent-session@3.0.0-beta.71
  - @robota-sdk/agent-tools@3.0.0-beta.71

## 3.0.0-beta.70

### Patch Changes

- CLI UX fixes: /context list full LLM context breakdown (CLI-B10), logo resize fix (CLI-B03), token estimates in context list (CLI-B04)
  - @robota-sdk/agent-core@3.0.0-beta.70
  - @robota-sdk/agent-executor@3.0.0-beta.70
  - @robota-sdk/agent-interface-transport@3.0.0-beta.70
  - @robota-sdk/agent-session@3.0.0-beta.70
  - @robota-sdk/agent-tools@3.0.0-beta.70

## 3.0.0-beta.69

### Patch Changes

- Fix /context list showing empty despite non-zero context percentage. System context files (AGENTS.md, CLAUDE.md) loaded at session startup now appear in the list with [system, active] label. Prompt execution no longer re-adds them as manual duplicates.
  - @robota-sdk/agent-core@3.0.0-beta.69
  - @robota-sdk/agent-executor@3.0.0-beta.69
  - @robota-sdk/agent-interface-transport@3.0.0-beta.69
  - @robota-sdk/agent-session@3.0.0-beta.69
  - @robota-sdk/agent-tools@3.0.0-beta.69

## 3.0.0-beta.68

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.68
- @robota-sdk/agent-executor@3.0.0-beta.68
- @robota-sdk/agent-interface-transport@3.0.0-beta.68
- @robota-sdk/agent-session@3.0.0-beta.68
- @robota-sdk/agent-tools@3.0.0-beta.68

## 3.0.0-beta.67

### Patch Changes

- CLIR: agent-cli layer separation, agent-framework interactive session improvements, subagent runner fix, TUI interface README
  - @robota-sdk/agent-core@3.0.0-beta.67
  - @robota-sdk/agent-executor@3.0.0-beta.67
  - @robota-sdk/agent-interface-transport@3.0.0-beta.67
  - @robota-sdk/agent-session@3.0.0-beta.67
  - @robota-sdk/agent-tools@3.0.0-beta.67

## 3.0.0-beta.66

### Patch Changes

- refactor: CLI-001/002 — agent-cli layer separation and monorepo-wide readability lint rules
  - CLI-001: Extract startup phases into focused modules; enforce agent-cli layer separation
  - CLI-002: Apply import/order, consistent-type-imports, explicit-function-return-type, prefer-const, object-shorthand across all packages
  - Fix stale child-process-subagent-worker entry in agent-cli tsdown.config.ts (build fix)
  - @robota-sdk/agent-core@3.0.0-beta.66
  - @robota-sdk/agent-executor@3.0.0-beta.66
  - @robota-sdk/agent-interface-transport@3.0.0-beta.66
  - @robota-sdk/agent-session@3.0.0-beta.66
  - @robota-sdk/agent-tools@3.0.0-beta.66

## 3.0.0-beta.65

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.65
- @robota-sdk/agent-executor@3.0.0-beta.65
- @robota-sdk/agent-interface-transport@3.0.0-beta.65
- @robota-sdk/agent-session@3.0.0-beta.65
- @robota-sdk/agent-tools@3.0.0-beta.65

## 3.0.0-beta.64

### Minor Changes

- feat: add displayName and requiresPermission to command interfaces
  - `ICommand`, `ISystemCommand`, `ICommandListEntry`: add optional `displayName` field for user-friendly labels
  - `ISystemCommand`: add optional `requiresPermission` field for per-command permission policy declaration
  - `SystemCommandExecutor`: add `resolveRequiresPermission()` — derives from `safety` when field is undefined
  - All 24 built-in commands declare explicit `displayName` and `requiresPermission`
  - TUI autocomplete renders `displayName ?? name`; Tab completion still inserts the technical command ID
  - `/help` output shows `Display Name (/command-id)` format

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.64
- @robota-sdk/agent-executor@3.0.0-beta.64
- @robota-sdk/agent-interface-transport@3.0.0-beta.64
- @robota-sdk/agent-session@3.0.0-beta.64
- @robota-sdk/agent-tools@3.0.0-beta.64

## 3.0.0-beta.63

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.63
- @robota-sdk/agent-session@3.0.0-beta.63
- @robota-sdk/agent-tools@3.0.0-beta.63
- @robota-sdk/agent-interface-transport@3.0.0-beta.63
- @robota-sdk/agent-executor@3.0.0-beta.63

## 3.0.0-beta.62

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.62
  - @robota-sdk/agent-executor@3.0.0-beta.62
  - @robota-sdk/agent-session@3.0.0-beta.62
  - @robota-sdk/agent-tools@3.0.0-beta.62

## 3.0.0-beta.61

### Minor Changes

- e243fb0: Add provider-neutral sandbox execution ports, E2B-compatible sandbox adapter, and SDK sandbox injection for Bash and core file tools.
- 18fcc5b: Add provider-neutral sandbox snapshot hydration for interactive sessions. Snapshot-capable sandbox clients now persist `sandboxSnapshotId` on shutdown and restore it before saved message replay on non-fork resume, while the E2B structural adapter supports both `createSnapshot()`-style checkpoints and pause/resume sandbox references.
- 3bde012: Add provider-neutral sandbox workspace manifests and wire `InteractiveSession` to apply them before session creation.

### Patch Changes

- 36eb7a9: Add provider-owned native replay payload hooks, replay validation coverage, and a session log validation command.
- cc0223d: Add SDK-owned provider profile name suggestions, create model-derived profile keys during interactive setup, and show the active provider profile identity in the CLI status area.
- d97bdf2: Add provider-owned model catalog metadata, route `/model` suggestions through the active provider, and make `cli:dev` resolve the CLI workspace dependency closure through source export conditions.
- Updated dependencies [e243fb0]
- Updated dependencies [1c0d44c]
- Updated dependencies [36eb7a9]
- Updated dependencies [18fcc5b]
- Updated dependencies [d97bdf2]
- Updated dependencies [3bde012]
  - @robota-sdk/agent-tools@3.0.0-beta.61
  - @robota-sdk/agent-core@3.0.0-beta.61
  - @robota-sdk/agent-session@3.0.0-beta.61
  - @robota-sdk/agent-executor@3.0.0-beta.61

## 3.0.0-beta.60

### Minor Changes

- 7439391: Add provider-neutral native web search/fetch capability contracts, explicit unsupported handling for OpenAI-compatible/LM Studio profiles, and local WebFetch/WebSearch permission/documentation alignment.

### Patch Changes

- 41ae788: Restore the CLI thinking indicator and add structured Agent tool batch provenance/count metadata.
- Updated dependencies [7439391]
  - @robota-sdk/agent-core@3.0.0-beta.60
  - @robota-sdk/agent-session@3.0.0-beta.60
  - @robota-sdk/agent-executor@3.0.0-beta.60
  - @robota-sdk/agent-tools@3.0.0-beta.60

## 3.0.0-beta.59

### Patch Changes

- Updated dependencies [95721ff]
  - @robota-sdk/agent-tools@3.0.0-beta.59
  - @robota-sdk/agent-core@3.0.0-beta.59
  - @robota-sdk/agent-session@3.0.0-beta.59
  - @robota-sdk/agent-executor@3.0.0-beta.59

## 3.0.0-beta.58

### Patch Changes

- Refresh package docs and robota.io content for the beta 57 feature set.
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.58
  - @robota-sdk/agent-executor@3.0.0-beta.58
  - @robota-sdk/agent-session@3.0.0-beta.58
  - @robota-sdk/agent-tools@3.0.0-beta.58

## 3.0.0-beta.57

### Minor Changes

- b80e51e: Add SDK-owned automatic project memory capture, approval review, bounded retrieval, and session-log provenance.
- 1cfdce9: Add SDK-owned edit checkpointing for Write/Edit tool mutations with `/rewind` list and code restore commands.
- f61e2cb: Add Qwen provider-owned Responses API support for built-in web search/fetch tools and pass provider-owned profile options through generic CLI/runtime configuration.
- 822a78b: Add self-hosting verification planning and atomic UTF-8 writes for built-in file mutation tools.
- 9817f99: Add active task context loading, formatting, and status update helpers for `.agents/tasks/*.md`.

### Patch Changes

- 16c3b6f: Persist and render provider-neutral per-turn usage summaries with pre-send context updates in CLI sessions.
- 4eca470: Render command tool output as bounded transcript previews and persist tool result metadata in SDK tool summaries.
- 90a2802: Render Edit tool summaries as context-aware diff hunks with structured truncation metadata.
- 26a1718: Preserve and render Edit tool diff metadata in persisted CLI tool summaries.
- e504d30: Route project memory through the model-visible `/memory` command descriptor instead of hidden automatic prompt injection.
- 0e0e533: Remove obsolete automatic memory policy configuration and top-level automatic memory orchestration exports from the SDK public surface.
- Updated dependencies [16c3b6f]
- Updated dependencies [b80e51e]
- Updated dependencies [26a1718]
- Updated dependencies [f61e2cb]
- Updated dependencies [822a78b]
  - @robota-sdk/agent-core@3.0.0-beta.57
  - @robota-sdk/agent-session@3.0.0-beta.57
  - @robota-sdk/agent-executor@3.0.0-beta.57
  - @robota-sdk/agent-tools@3.0.0-beta.57

## 3.0.0-beta.56

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.56
  - @robota-sdk/agent-executor@3.0.0-beta.56
  - @robota-sdk/agent-session@3.0.0-beta.56
  - @robota-sdk/agent-tools@3.0.0-beta.56

## 3.0.0-beta.55

### Patch Changes

- 38a72bf: fix: resolve ESLint tsconfig parsing errors and improve pnpm CI reliability
  - Add tsconfig.eslint.json to all packages for per-package ESLint runs
  - Migrate typecheck from pnpm -r exec tsc to per-package typecheck scripts
  - Add --if-present to all recursive pnpm run scripts
  - Fix React type imports, dynamic imports in tests, Express.Multer types

- Updated dependencies [38a72bf]
  - @robota-sdk/agent-core@3.0.0-beta.55
  - @robota-sdk/agent-session@3.0.0-beta.55
  - @robota-sdk/agent-tools@3.0.0-beta.55

## 3.0.0-beta.54

### Patch Changes

- fix: resolve all typecheck errors across packages
- Updated dependencies
  - @robota-sdk/agent-session@3.0.0-beta.54
  - @robota-sdk/agent-core@3.0.0-beta.54
  - @robota-sdk/agent-tools@3.0.0-beta.54

## 3.0.0-beta.53

### Patch Changes

- refactor: monolith decomposition — all agent-\* files under 300 lines
- fix: PR #69 code review — session resume tool messages, type SSOT, fork isolation, settings crash, Notification removal, chat validation
- Updated dependencies
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.53
  - @robota-sdk/agent-session@3.0.0-beta.53
  - @robota-sdk/agent-tools@3.0.0-beta.53

## 3.0.0-beta.52

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.52
- @robota-sdk/agent-session@3.0.0-beta.52
- @robota-sdk/agent-tools@3.0.0-beta.52

## 3.0.0-beta.51

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.51
- @robota-sdk/agent-session@3.0.0-beta.51
- @robota-sdk/agent-tools@3.0.0-beta.51

## 3.0.0-beta.50

### Patch Changes

- fix: reinsert repository/homepage/bugs in correct field order
- Updated dependencies
  - @robota-sdk/agent-tools@3.0.0-beta.50
  - @robota-sdk/agent-core@3.0.0-beta.50
  - @robota-sdk/agent-session@3.0.0-beta.50

## 3.0.0-beta.49

### Patch Changes

- fix: add repository, homepage, bugs metadata to all publishable packages
- Updated dependencies
  - @robota-sdk/agent-tools@3.0.0-beta.49
  - @robota-sdk/agent-core@3.0.0-beta.49
  - @robota-sdk/agent-session@3.0.0-beta.49

## 3.0.0-beta.48

### Patch Changes

- fix: record individual tool-start/tool-end in history + fix streaming tool display
  - Individual tool-start/tool-end events recorded as IHistoryEntry for persistence
  - TuiStateManager.onToolEnd uses findIndex (first match only, not all with same name)
  - MessageList hides tool-start/tool-end entries (not rendered as System:)
  - @robota-sdk/agent-core@3.0.0-beta.48
  - @robota-sdk/agent-session@3.0.0-beta.48
  - @robota-sdk/agent-tools@3.0.0-beta.48

## 3.0.0-beta.47

### Minor Changes

- feat: ITransportAdapter unified interface + headless transport + CLI adapter pattern
  - ITransportAdapter interface in agent-sdk (name, attach, start, stop)
  - InteractiveSession.attachTransport(transport) method
  - createHttpTransport, createWsTransport, createMcpTransport, createHeadlessTransport factories
  - CLI print mode uses adapter pattern: session.attachTransport(transport)
  - agent-transport-headless: text/json/stream-json output, stdin pipe, exit codes
  - --output-format, --system-prompt, --append-system-prompt CLI flags

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.47
- @robota-sdk/agent-session@3.0.0-beta.47
- @robota-sdk/agent-tools@3.0.0-beta.47

## 3.0.0-beta.46

### Minor Changes

- feat: session continue/resume — persist, restore, and switch sessions
  - ISessionRecord.history field (required) for UI timeline restoration
  - Session.injectMessage() for AI context restoration on resume
  - InteractiveSession: sessionStore, resumeSessionId, forkSession, getName/setName
  - CLI: --continue, --resume, --fork-session, --name flags
  - TUI: /resume (session picker), /rename (session naming)
  - ListPicker generic component with viewport scrolling
  - Session name display: input border title, terminal title, StatusBar
  - Session picker: cwd filtering, date+time, response preview
  - React key remount for instant session switching

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-session@3.0.0-beta.46
  - @robota-sdk/agent-core@3.0.0-beta.46
  - @robota-sdk/agent-tools@3.0.0-beta.46

## 3.0.0-beta.45

### Patch Changes

- refactor: transports consume InteractiveSession only — commandExecutor param removed
  - Add InteractiveSession.listCommands() for transport tool discovery
  - All transports use session.executeCommand() instead of separate commandExecutor
  - Simplified factory signatures: only InteractiveSession required
  - @robota-sdk/agent-core@3.0.0-beta.45
  - @robota-sdk/agent-session@3.0.0-beta.45
  - @robota-sdk/agent-tools@3.0.0-beta.45

## 3.0.0-beta.44

### Patch Changes

- feat: IHistoryEntry universal history architecture + test quality cleanup
  - IHistoryEntry as universal history type across all 4 packages (core → sessions → sdk → cli)
  - Tool summary stored as event entry in history (category: 'event', type: 'tool-summary')
  - TuiStateManager pure TypeScript class for CLI rendering state
  - MessageList renders IHistoryEntry[] with Tool:/System:/You:/Robota: labels
  - Display order fixed: Tool → Robota (both streaming and abort)
  - Remove 25 tautological, duplicate, and hardcoded tests

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.44
  - @robota-sdk/agent-session@3.0.0-beta.44
  - @robota-sdk/agent-tools@3.0.0-beta.44
