# @robota-sdk/agent-roundtable-robota

## 3.0.0-beta.89
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.89
  - @robota-sdk/agent-roundtable@3.0.0-beta.89
  - @robota-sdk/agent-session@3.0.0-beta.89

## 3.0.0-beta.88

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.88
- @robota-sdk/agent-roundtable@3.0.0-beta.88
- @robota-sdk/agent-session@3.0.0-beta.88

## 3.0.0-beta.87

### Patch Changes

- Release the migrated Robota product with its public SDK namespace, robota command, compatible SDK exports, internal product configuration, and verified CLI startup and delivery corrections.
- Updated dependencies
- Updated dependencies [66af868]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
  - @robota-sdk/agent-core@3.0.0-beta.87
  - @robota-sdk/agent-roundtable@3.0.0-beta.87
  - @robota-sdk/agent-session@3.0.0-beta.87

## 3.0.0-beta.86

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.86
- @robota-sdk/agent-roundtable@3.0.0-beta.86
- @robota-sdk/agent-session@3.0.0-beta.86

## 3.0.0-beta.85

### Minor Changes

- 190f78f: `@robota-sdk/agent-roundtable` and `@robota-sdk/agent-roundtable-robota` are published, alongside the
  rest of the fixed group (issue #3273).

  `@robota-sdk/agent-roundtable` coordinates independently constructed agents and people in one shared
  conversation: it selects who speaks next, runs a turn or a parallel group of turns, and publishes
  their messages to a shared transcript in a stable order, while each participant keeps its own runtime
  and private state. It runs no model and imports no provider — a participant can wrap a __PRODUCT_DISPLAY_NAME__
  session, another agent runtime, or plain code — and ships as a platform-neutral build with zero
  runtime dependencies, so it also runs in a browser.

  `@robota-sdk/agent-roundtable-robota` is the __PRODUCT_DISPLAY_NAME__ adapter: `sessionParticipant` runs a permission-
  gated `Session` (tools, hooks, approval waits) as a participant, `runtimeParticipant` runs a plain
  `ConversationAgent` agent, and `runtimeSelector` asks a __PRODUCT_DISPLAY_NAME__ agent to pick the next speaker through one control
  tool call. Every provider call either wrapper makes is metered and reported through the conversation's
  own usage ledger.

  Both packages were previously developed as private workspace packages under the same version; this
  changeset makes no API change on its own.

### Patch Changes

- Updated dependencies [190f78f]
- Updated dependencies [41cca13]
- Updated dependencies [ada3841]
- Updated dependencies [5093a30]
- Updated dependencies [94b2c87]
- Updated dependencies [10597b2]
- Updated dependencies [3ab2eca]
  - @robota-sdk/agent-roundtable@3.0.0-beta.85
  - @robota-sdk/agent-core@3.0.0-beta.85
  - @robota-sdk/agent-session@3.0.0-beta.85

## 3.0.0-beta.84

### Patch Changes

- Updated dependencies [9f46375]
- Updated dependencies [9f46375]
- Updated dependencies [9c6a8db]
  - @robota-sdk/agent-core@3.0.0-beta.84
  - @robota-sdk/agent-session@3.0.0-beta.84
