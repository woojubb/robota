# @robota-sdk/agent-transport-ws

## 3.0.0-beta.51

### Patch Changes

- @robota-sdk/agent-sdk@3.0.0-beta.51

## 3.0.0-beta.50

### Patch Changes

- fix: reinsert repository/homepage/bugs in correct field order
- Updated dependencies
  - @robota-sdk/agent-sdk@3.0.0-beta.50

## 3.0.0-beta.49

### Patch Changes

- fix: add repository, homepage, bugs metadata to all publishable packages
- Updated dependencies
  - @robota-sdk/agent-sdk@3.0.0-beta.49

## 3.0.0-beta.48

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-sdk@3.0.0-beta.48

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

## 3.0.0-beta.46

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-sdk@3.0.0-beta.46

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
