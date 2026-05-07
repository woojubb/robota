# @robota-sdk/agent-sdk

## 3.0.0-beta.60

### Minor Changes

- 7439391: Add provider-neutral native web search/fetch capability contracts, explicit unsupported handling for OpenAI-compatible/LM Studio profiles, and local WebFetch/WebSearch permission/documentation alignment.

### Patch Changes

- 41ae788: Restore the CLI thinking indicator and add structured Agent tool batch provenance/count metadata.
- Updated dependencies [7439391]
  - @robota-sdk/agent-core@3.0.0-beta.60
  - @robota-sdk/agent-sessions@3.0.0-beta.60
  - @robota-sdk/agent-runtime@3.0.0-beta.60
  - @robota-sdk/agent-tools@3.0.0-beta.60

## 3.0.0-beta.59

### Patch Changes

- Updated dependencies [95721ff]
  - @robota-sdk/agent-tools@3.0.0-beta.59
  - @robota-sdk/agent-core@3.0.0-beta.59
  - @robota-sdk/agent-sessions@3.0.0-beta.59
  - @robota-sdk/agent-runtime@3.0.0-beta.59

## 3.0.0-beta.58

### Patch Changes

- Refresh package docs and robota.io content for the beta 57 feature set.
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.58
  - @robota-sdk/agent-runtime@3.0.0-beta.58
  - @robota-sdk/agent-sessions@3.0.0-beta.58
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
  - @robota-sdk/agent-sessions@3.0.0-beta.57
  - @robota-sdk/agent-runtime@3.0.0-beta.57
  - @robota-sdk/agent-tools@3.0.0-beta.57

## 3.0.0-beta.56

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.56
  - @robota-sdk/agent-runtime@3.0.0-beta.56
  - @robota-sdk/agent-sessions@3.0.0-beta.56
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
  - @robota-sdk/agent-sessions@3.0.0-beta.55
  - @robota-sdk/agent-tools@3.0.0-beta.55

## 3.0.0-beta.54

### Patch Changes

- fix: resolve all typecheck errors across packages
- Updated dependencies
  - @robota-sdk/agent-sessions@3.0.0-beta.54
  - @robota-sdk/agent-core@3.0.0-beta.54
  - @robota-sdk/agent-tools@3.0.0-beta.54

## 3.0.0-beta.53

### Patch Changes

- refactor: monolith decomposition — all agent-\* files under 300 lines
- fix: PR #69 code review — session resume tool messages, type SSOT, fork isolation, settings crash, Notification removal, chat validation
- Updated dependencies
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.53
  - @robota-sdk/agent-sessions@3.0.0-beta.53
  - @robota-sdk/agent-tools@3.0.0-beta.53

## 3.0.0-beta.52

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.52
- @robota-sdk/agent-sessions@3.0.0-beta.52
- @robota-sdk/agent-tools@3.0.0-beta.52

## 3.0.0-beta.51

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.51
- @robota-sdk/agent-sessions@3.0.0-beta.51
- @robota-sdk/agent-tools@3.0.0-beta.51

## 3.0.0-beta.50

### Patch Changes

- fix: reinsert repository/homepage/bugs in correct field order
- Updated dependencies
  - @robota-sdk/agent-tools@3.0.0-beta.50
  - @robota-sdk/agent-core@3.0.0-beta.50
  - @robota-sdk/agent-sessions@3.0.0-beta.50

## 3.0.0-beta.49

### Patch Changes

- fix: add repository, homepage, bugs metadata to all publishable packages
- Updated dependencies
  - @robota-sdk/agent-tools@3.0.0-beta.49
  - @robota-sdk/agent-core@3.0.0-beta.49
  - @robota-sdk/agent-sessions@3.0.0-beta.49

## 3.0.0-beta.48

### Patch Changes

- fix: record individual tool-start/tool-end in history + fix streaming tool display
  - Individual tool-start/tool-end events recorded as IHistoryEntry for persistence
  - TuiStateManager.onToolEnd uses findIndex (first match only, not all with same name)
  - MessageList hides tool-start/tool-end entries (not rendered as System:)
  - @robota-sdk/agent-core@3.0.0-beta.48
  - @robota-sdk/agent-sessions@3.0.0-beta.48
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
- @robota-sdk/agent-sessions@3.0.0-beta.47
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
  - @robota-sdk/agent-sessions@3.0.0-beta.46
  - @robota-sdk/agent-core@3.0.0-beta.46
  - @robota-sdk/agent-tools@3.0.0-beta.46

## 3.0.0-beta.45

### Patch Changes

- refactor: transports consume InteractiveSession only — commandExecutor param removed
  - Add InteractiveSession.listCommands() for transport tool discovery
  - All transports use session.executeCommand() instead of separate commandExecutor
  - Simplified factory signatures: only InteractiveSession required
  - @robota-sdk/agent-core@3.0.0-beta.45
  - @robota-sdk/agent-sessions@3.0.0-beta.45
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
  - @robota-sdk/agent-sessions@3.0.0-beta.44
  - @robota-sdk/agent-tools@3.0.0-beta.44
