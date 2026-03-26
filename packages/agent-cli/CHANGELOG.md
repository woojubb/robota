# @robota-sdk/agent-cli

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
