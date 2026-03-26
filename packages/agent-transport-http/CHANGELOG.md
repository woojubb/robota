# @robota-sdk/agent-transport-http

## 3.0.0-beta.45

### Patch Changes

- refactor: transports consume InteractiveSession only — commandExecutor param removed
  - Add InteractiveSession.listCommands() for transport tool discovery
  - All transports use session.executeCommand() instead of separate commandExecutor
  - Simplified factory signatures: only InteractiveSession required

- Updated dependencies
  - @robota-sdk/agent-sdk@3.0.0-beta.45

## 3.0.0-beta.44

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-sdk@3.0.0-beta.44
