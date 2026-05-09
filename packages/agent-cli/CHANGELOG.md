# @robota-sdk/agent-cli

## 3.0.0-beta.62

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.62
  - @robota-sdk/agent-command-provider@3.0.0-beta.62
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.62
  - @robota-sdk/agent-provider-deepseek@3.0.0-beta.62
  - @robota-sdk/agent-provider-gemini@3.0.0-beta.62
  - @robota-sdk/agent-provider-gemma@3.0.0-beta.62
  - @robota-sdk/agent-provider-openai@3.0.0-beta.62
  - @robota-sdk/agent-provider-qwen@3.0.0-beta.62
  - @robota-sdk/agent-sdk@3.0.0-beta.62
  - @robota-sdk/agent-command-agent@3.0.0-beta.62
  - @robota-sdk/agent-command-background@3.0.0-beta.62
  - @robota-sdk/agent-command-compact@3.0.0-beta.62
  - @robota-sdk/agent-command-context@3.0.0-beta.62
  - @robota-sdk/agent-command-exit@3.0.0-beta.62
  - @robota-sdk/agent-command-help@3.0.0-beta.62
  - @robota-sdk/agent-command-language@3.0.0-beta.62
  - @robota-sdk/agent-command-memory@3.0.0-beta.62
  - @robota-sdk/agent-command-model@3.0.0-beta.62
  - @robota-sdk/agent-command-permissions@3.0.0-beta.62
  - @robota-sdk/agent-command-plugin@3.0.0-beta.62
  - @robota-sdk/agent-command-reset@3.0.0-beta.62
  - @robota-sdk/agent-command-rewind@3.0.0-beta.62
  - @robota-sdk/agent-command-session@3.0.0-beta.62
  - @robota-sdk/agent-command-skills@3.0.0-beta.62
  - @robota-sdk/agent-command-statusline@3.0.0-beta.62
  - @robota-sdk/agent-command-user-local@3.0.0-beta.62
  - @robota-sdk/agent-transport-headless@3.0.0-beta.62
  - @robota-sdk/agent-transport-ws@3.0.0-beta.62

## 3.0.0-beta.61

### Minor Changes

- b7cb169: Add first-class DeepSeek API provider support and include it in the default CLI provider definitions.

### Patch Changes

- cfb8b5a: Clean up the CLI status bar by hiding the baseline default permission mode and removing the duplicate right-side thinking indicator.
- cc0223d: Add SDK-owned provider profile name suggestions, create model-derived profile keys during interactive setup, and show the active provider profile identity in the CLI status area.
- d97bdf2: Add provider-owned model catalog metadata, route `/model` suggestions through the active provider, and make `cli:dev` resolve the CLI workspace dependency closure through source export conditions.
- Updated dependencies [e243fb0]
- Updated dependencies [b7cb169]
- Updated dependencies [1c0d44c]
- Updated dependencies [36eb7a9]
- Updated dependencies [cc0223d]
- Updated dependencies [18fcc5b]
- Updated dependencies [d97bdf2]
- Updated dependencies [3bde012]
  - @robota-sdk/agent-sdk@3.0.0-beta.61
  - @robota-sdk/agent-provider-deepseek@3.0.0-beta.61
  - @robota-sdk/agent-core@3.0.0-beta.61
  - @robota-sdk/agent-command-session@3.0.0-beta.61
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.61
  - @robota-sdk/agent-provider-gemini@3.0.0-beta.61
  - @robota-sdk/agent-provider-gemma@3.0.0-beta.61
  - @robota-sdk/agent-provider-openai@3.0.0-beta.61
  - @robota-sdk/agent-provider-qwen@3.0.0-beta.61
  - @robota-sdk/agent-command-provider@3.0.0-beta.61
  - @robota-sdk/agent-command-model@3.0.0-beta.61
  - @robota-sdk/agent-command-agent@3.0.0-beta.61
  - @robota-sdk/agent-command-background@3.0.0-beta.61
  - @robota-sdk/agent-command-compact@3.0.0-beta.61
  - @robota-sdk/agent-command-context@3.0.0-beta.61
  - @robota-sdk/agent-command-exit@3.0.0-beta.61
  - @robota-sdk/agent-command-help@3.0.0-beta.61
  - @robota-sdk/agent-command-language@3.0.0-beta.61
  - @robota-sdk/agent-command-memory@3.0.0-beta.61
  - @robota-sdk/agent-command-permissions@3.0.0-beta.61
  - @robota-sdk/agent-command-plugin@3.0.0-beta.61
  - @robota-sdk/agent-command-reset@3.0.0-beta.61
  - @robota-sdk/agent-command-rewind@3.0.0-beta.61
  - @robota-sdk/agent-command-statusline@3.0.0-beta.61
  - @robota-sdk/agent-transport-headless@3.0.0-beta.61
  - @robota-sdk/agent-command-skills@3.0.0-beta.61

## 3.0.0-beta.60

### Minor Changes

- 7439391: Add provider-neutral native web search/fetch capability contracts, explicit unsupported handling for OpenAI-compatible/LM Studio profiles, and local WebFetch/WebSearch permission/documentation alignment.

### Patch Changes

- 0c77089: Validate the merged active provider profile during CLI startup so higher-priority provider selections with missing API keys are not masked by unrelated valid settings files.
- 41ae788: Restore the CLI thinking indicator and add structured Agent tool batch provenance/count metadata.
- Updated dependencies [41ae788]
- Updated dependencies [3d6bdf6]
- Updated dependencies [7439391]
  - @robota-sdk/agent-sdk@3.0.0-beta.60
  - @robota-sdk/agent-provider-gemini@3.0.0-beta.60
  - @robota-sdk/agent-core@3.0.0-beta.60
  - @robota-sdk/agent-sessions@3.0.0-beta.60
  - @robota-sdk/agent-provider-openai@3.0.0-beta.60
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.60
  - @robota-sdk/agent-provider-gemma@3.0.0-beta.60
  - @robota-sdk/agent-provider-qwen@3.0.0-beta.60
  - @robota-sdk/agent-command-agent@3.0.0-beta.60
  - @robota-sdk/agent-command-background@3.0.0-beta.60
  - @robota-sdk/agent-command-compact@3.0.0-beta.60
  - @robota-sdk/agent-command-context@3.0.0-beta.60
  - @robota-sdk/agent-command-exit@3.0.0-beta.60
  - @robota-sdk/agent-command-help@3.0.0-beta.60
  - @robota-sdk/agent-command-language@3.0.0-beta.60
  - @robota-sdk/agent-command-memory@3.0.0-beta.60
  - @robota-sdk/agent-command-mode@3.0.0-beta.60
  - @robota-sdk/agent-command-model@3.0.0-beta.60
  - @robota-sdk/agent-command-permissions@3.0.0-beta.60
  - @robota-sdk/agent-command-plugin@3.0.0-beta.60
  - @robota-sdk/agent-command-provider@3.0.0-beta.60
  - @robota-sdk/agent-command-reset@3.0.0-beta.60
  - @robota-sdk/agent-command-rewind@3.0.0-beta.60
  - @robota-sdk/agent-command-session@3.0.0-beta.60
  - @robota-sdk/agent-command-statusline@3.0.0-beta.60
  - @robota-sdk/agent-transport-headless@3.0.0-beta.60

## 3.0.0-beta.59

### Patch Changes

- @robota-sdk/agent-sdk@3.0.0-beta.59
- @robota-sdk/agent-command-agent@3.0.0-beta.59
- @robota-sdk/agent-transport-headless@3.0.0-beta.59
- @robota-sdk/agent-core@3.0.0-beta.59
- @robota-sdk/agent-sessions@3.0.0-beta.59
- @robota-sdk/agent-provider-anthropic@3.0.0-beta.59
- @robota-sdk/agent-provider-openai@3.0.0-beta.59
- @robota-sdk/agent-provider-gemma@3.0.0-beta.59
- @robota-sdk/agent-provider-gemini@3.0.0-beta.59
- @robota-sdk/agent-provider-qwen@3.0.0-beta.59

## 3.0.0-beta.58

### Patch Changes

- Refresh package docs and robota.io content for the beta 57 feature set.
- Updated dependencies
  - @robota-sdk/agent-command-agent@3.0.0-beta.58
  - @robota-sdk/agent-core@3.0.0-beta.58
  - @robota-sdk/agent-provider-gemini@3.0.0-beta.58
  - @robota-sdk/agent-provider-gemma@3.0.0-beta.58
  - @robota-sdk/agent-provider-qwen@3.0.0-beta.58
  - @robota-sdk/agent-sdk@3.0.0-beta.58
  - @robota-sdk/agent-sessions@3.0.0-beta.58
  - @robota-sdk/agent-transport-headless@3.0.0-beta.58
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.58
  - @robota-sdk/agent-provider-openai@3.0.0-beta.58

## 3.0.0-beta.57

### Minor Changes

- b80e51e: Add SDK-owned automatic project memory capture, approval review, bounded retrieval, and session-log provenance.
- f61e2cb: Add Qwen provider-owned Responses API support for built-in web search/fetch tools and pass provider-owned profile options through generic CLI/runtime configuration.

### Patch Changes

- 16c3b6f: Persist and render provider-neutral per-turn usage summaries with pre-send context updates in CLI sessions.
- d3bcc0e: Move the active status indicator into the primary status-bar scan path with deterministic tool, thinking, background, queued, and idle priority.
- 4eca470: Render command tool output as bounded transcript previews and persist tool result metadata in SDK tool summaries.
- 1cfdce9: Add SDK-owned edit checkpointing for Write/Edit tool mutations with `/rewind` list and code restore commands.
- 90a2802: Render Edit tool summaries as context-aware diff hunks with structured truncation metadata.
- 26a1718: Preserve and render Edit tool diff metadata in persisted CLI tool summaries.
- 3509f1d: Add canonical Gemini provider package and keep the Google provider package as a compatibility wrapper.
- 8e056b1: Adopt Ink 7 paste and window-size hooks for CJK-aware input handling.
- 7e9e81c: Render background work as compact one-level tree rows with shared formatting and bounded previews.
- Updated dependencies [16c3b6f]
- Updated dependencies [b80e51e]
- Updated dependencies [4eca470]
- Updated dependencies [1cfdce9]
- Updated dependencies [90a2802]
- Updated dependencies [26a1718]
- Updated dependencies [3509f1d]
- Updated dependencies [e504d30]
- Updated dependencies [f61e2cb]
- Updated dependencies [0e0e533]
- Updated dependencies [822a78b]
- Updated dependencies [9817f99]
  - @robota-sdk/agent-core@3.0.0-beta.57
  - @robota-sdk/agent-sessions@3.0.0-beta.57
  - @robota-sdk/agent-sdk@3.0.0-beta.57
  - @robota-sdk/agent-provider-gemini@3.0.0-beta.57
  - @robota-sdk/agent-provider-qwen@3.0.0-beta.57
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.57
  - @robota-sdk/agent-provider-gemma@3.0.0-beta.57
  - @robota-sdk/agent-provider-openai@3.0.0-beta.57
  - @robota-sdk/agent-command-agent@3.0.0-beta.57
  - @robota-sdk/agent-transport-headless@3.0.0-beta.57

## 3.0.0-beta.56

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.56
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.56
  - @robota-sdk/agent-provider-gemma@3.0.0-beta.56
  - @robota-sdk/agent-provider-openai@3.0.0-beta.56
  - @robota-sdk/agent-sdk@3.0.0-beta.56
  - @robota-sdk/agent-sessions@3.0.0-beta.56
  - @robota-sdk/agent-command-agent@3.0.0-beta.56
  - @robota-sdk/agent-transport-headless@3.0.0-beta.56

## 3.0.0-beta.55

### Patch Changes

- 38a72bf: fix: resolve ESLint tsconfig parsing errors and improve pnpm CI reliability
  - Add tsconfig.eslint.json to all packages for per-package ESLint runs
  - Migrate typecheck from pnpm -r exec tsc to per-package typecheck scripts
  - Add --if-present to all recursive pnpm run scripts
  - Fix React type imports, dynamic imports in tests, Express.Multer types

- Updated dependencies [38a72bf]
  - @robota-sdk/agent-core@3.0.0-beta.55
  - @robota-sdk/agent-sdk@3.0.0-beta.55
  - @robota-sdk/agent-sessions@3.0.0-beta.55
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.55
  - @robota-sdk/agent-transport-headless@3.0.0-beta.55

## 3.0.0-beta.54

### Patch Changes

- fix: resolve all typecheck errors across packages
- Updated dependencies
  - @robota-sdk/agent-sessions@3.0.0-beta.54
  - @robota-sdk/agent-sdk@3.0.0-beta.54
  - @robota-sdk/agent-core@3.0.0-beta.54
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.54
  - @robota-sdk/agent-transport-headless@3.0.0-beta.54

## 3.0.0-beta.53

### Patch Changes

- refactor: monolith decomposition — all agent-\* files under 300 lines
- fix: PR #69 code review — session resume tool messages, type SSOT, fork isolation, settings crash, Notification removal, chat validation
- Updated dependencies
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.53
  - @robota-sdk/agent-sdk@3.0.0-beta.53
  - @robota-sdk/agent-sessions@3.0.0-beta.53
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.53
  - @robota-sdk/agent-transport-headless@3.0.0-beta.53

## 3.0.0-beta.52

### Patch Changes

- fix: paste at cursor position + cursor moves to end of pasted label + cursorHint prop
  - @robota-sdk/agent-core@3.0.0-beta.52
  - @robota-sdk/agent-sessions@3.0.0-beta.52
  - @robota-sdk/agent-sdk@3.0.0-beta.52
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.52
  - @robota-sdk/agent-transport-headless@3.0.0-beta.52

## 3.0.0-beta.51

### Patch Changes

- feat: debounce streaming text rendering (300ms) to reduce CPU load
  - @robota-sdk/agent-core@3.0.0-beta.51
  - @robota-sdk/agent-sessions@3.0.0-beta.51
  - @robota-sdk/agent-sdk@3.0.0-beta.51
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.51
  - @robota-sdk/agent-transport-headless@3.0.0-beta.51

## 3.0.0-beta.50

### Patch Changes

- fix: reinsert repository/homepage/bugs in correct field order
- Updated dependencies
  - @robota-sdk/agent-sdk@3.0.0-beta.50
  - @robota-sdk/agent-transport-headless@3.0.0-beta.50
  - @robota-sdk/agent-core@3.0.0-beta.50
  - @robota-sdk/agent-sessions@3.0.0-beta.50
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.50

## 3.0.0-beta.49

### Patch Changes

- fix: add repository, homepage, bugs metadata to all publishable packages
- Updated dependencies
  - @robota-sdk/agent-sdk@3.0.0-beta.49
  - @robota-sdk/agent-transport-headless@3.0.0-beta.49
  - @robota-sdk/agent-core@3.0.0-beta.49
  - @robota-sdk/agent-sessions@3.0.0-beta.49
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.49

## 3.0.0-beta.48

### Patch Changes

- fix: record individual tool-start/tool-end in history + fix streaming tool display
  - Individual tool-start/tool-end events recorded as IHistoryEntry for persistence
  - TuiStateManager.onToolEnd uses findIndex (first match only, not all with same name)
  - MessageList hides tool-start/tool-end entries (not rendered as System:)

- Updated dependencies
  - @robota-sdk/agent-sdk@3.0.0-beta.48
  - @robota-sdk/agent-transport-headless@3.0.0-beta.48
  - @robota-sdk/agent-core@3.0.0-beta.48
  - @robota-sdk/agent-sessions@3.0.0-beta.48
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.48

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

- Updated dependencies
  - @robota-sdk/agent-sdk@3.0.0-beta.47
  - @robota-sdk/agent-transport-headless@3.0.0-beta.47
  - @robota-sdk/agent-core@3.0.0-beta.47
  - @robota-sdk/agent-sessions@3.0.0-beta.47
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.47

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
  - @robota-sdk/agent-sdk@3.0.0-beta.46
  - @robota-sdk/agent-core@3.0.0-beta.46
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.46

## 3.0.0-beta.45

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-sdk@3.0.0-beta.45
  - @robota-sdk/agent-core@3.0.0-beta.45
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.45

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
  - @robota-sdk/agent-sdk@3.0.0-beta.44
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.44
