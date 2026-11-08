# @robota-sdk/agent-roundtable-robota

## 3.2.2
### Patch Changes

- 8d05c9b: Allow compatible SDK dependencies to update independently.

## 3.2.1
### Patch Changes

  - @robota-sdk/agent-roundtable@3.2.1

## 3.2.0
### Patch Changes

  - @robota-sdk/agent-roundtable@3.2.0

## 3.1.2
### Patch Changes

  - @robota-sdk/agent-roundtable@3.1.2

## 3.1.1
### Patch Changes

  - @robota-sdk/agent-roundtable@3.1.1

## 3.1.0
### Minor Changes

- d8cb04f: Make the session package platform-neutral.

  - `@robota-sdk/agent-core` exports `isAbsolutePath`, `resolvePath` and `joinPath` — lexical path helpers that read the platform from the path text (a drive letter or `\\` is a Windows path, anything else POSIX) and never touch the process directory — and `utf8ByteLength`.
  - `@robota-sdk/agent-session`: `NodeSessionStore`, `NodeSessionLogSink`, `NodeSessionLogSource`, `NodeExternalPayloadSource`, `NodeToolResultSpillStore` (with `ToolResultSpillError`, `sweepStaleToolResultSpillDirectories` and its option and code types) and `NodePromptHistoryFile` (with `DEFAULT_PROMPT_HISTORY_BLOCK_BYTES` and `parsePromptHistoryLine`) moved to the new `@robota-sdk/agent-session/node`, which also exports `createNodeWorkspacePathResolver` and `registerProcessExitFlush`. The main entry no longer reaches a Node built-in, a Node global or `@robota-sdk/agent-file-authority`; the sealed-store and migration exports (`StoredSessionRecords`, `StoredLines`, `StoredPayloads`, `sessionSealingOf`, `assertSessionSealing`, the `seal*` converters, `migrateNodeSessionStore`, `migrateSessionLogDirectory`, `compactPromptHistoryFile` and their companions) are on `./node` too. `ISessionLogSink`, `ISessionLogSource`, the external-payload ports, `createSessionLogExternalPayloadReference`, `loadSessionForUpdate` and the sealed-session and claim refusals stay on the main entry.
  - `@robota-sdk/agent-session`: `hookTypeExecutors` is a required option of `Session`, `PermissionEnforcer` and `CompactionOrchestrator`; a missing list throws at construction instead of defaulting to the command and HTTP executors (pass `[new CommandExecutor(), new HttpExecutor()]` from `@robota-sdk/agent-core/node`, or `[]` to run no hook handler).
  - `@robota-sdk/agent-session`: three host pieces became options with no Node default. `homeDirectory` is no longer read from the operating system — absent, the home directory is unknown, so `~` and any home-relative target not provably inside it (`~/..`) are refused, and a path inside it is not expanded. `resolveInWorkspace` replaces the built-in symlink-following resolver — absent, a shell command with a path operand is not judged read-only. `canonicalizePath` replaces `realpathSync` in snapshot, journal and approval checks — absent, directories are compared as written. `FileSessionLogger` takes `registerExitFlush` instead of listening on `process`; it registers once per distinct function.
  - `@robota-sdk/agent-session`: the execution root accepts a Windows drive or UNC root on any host and rejects a drive-less rooted path (`\work`) on a Windows host, where it was accepted before; a payload reference's `relativePath` is always written with `/` (readers accept either separator).
  - `@robota-sdk/agent-roundtable-robota`: `SessionHostOptions` requires `hookTypeExecutors`, as it extends the session options.
  - `@robota-sdk/agent-framework` passes the Node home directory, workspace resolver, `realpathSync` and exit registrar, and the command and HTTP executors, wherever it builds a session, so the CLI behaves as before.

### Patch Changes

- 45c11a2: The peer dependencies on `@robota-sdk/agent-core` and `@robota-sdk/agent-session` accept the release line (`^`) instead of one exact version, so a minor release of the SDK stays a minor instead of becoming a major.
  - @robota-sdk/agent-roundtable@3.1.0

## 3.0.7
### Patch Changes

  - @robota-sdk/agent-core@3.0.7
  - @robota-sdk/agent-roundtable@3.0.7
  - @robota-sdk/agent-session@3.0.7

## 3.0.6
### Patch Changes

- Updated dependencies
- Updated dependencies
  - @robota-sdk/agent-session@3.0.6
  - @robota-sdk/agent-core@3.0.6
  - @robota-sdk/agent-roundtable@3.0.6

## 3.0.5
### Patch Changes

  - @robota-sdk/agent-core@3.0.5
  - @robota-sdk/agent-roundtable@3.0.5
  - @robota-sdk/agent-session@3.0.5

## 3.0.4
### Patch Changes

  - @robota-sdk/agent-core@3.0.4
  - @robota-sdk/agent-roundtable@3.0.4
  - @robota-sdk/agent-session@3.0.4

## 3.0.3
### Patch Changes

  - @robota-sdk/agent-core@3.0.3
  - @robota-sdk/agent-roundtable@3.0.3
  - @robota-sdk/agent-session@3.0.3

## 3.0.2
### Patch Changes

  - @robota-sdk/agent-core@3.0.2
  - @robota-sdk/agent-roundtable@3.0.2
  - @robota-sdk/agent-session@3.0.2

## 3.0.1
### Patch Changes

  - @robota-sdk/agent-core@3.0.1
  - @robota-sdk/agent-roundtable@3.0.1
  - @robota-sdk/agent-session@3.0.1

## 3.0.0
### Minor Changes

- 190f78f: `@robota-sdk/agent-roundtable` and `@robota-sdk/agent-roundtable-robota` are published, alongside the
  rest of the fixed group (issue #3273).

  `@robota-sdk/agent-roundtable` coordinates independently constructed agents and people in one shared
  conversation: it selects who speaks next, runs a turn or a parallel group of turns, and publishes
  their messages to a shared transcript in a stable order, while each participant keeps its own runtime
  and private state. It runs no model and imports no provider — a participant can wrap a ConversationAgent
  session, another agent runtime, or plain code — and ships as a platform-neutral build with zero
  runtime dependencies, so it also runs in a browser.

  `@robota-sdk/agent-roundtable-robota` is the ConversationAgent adapter: `sessionParticipant` runs a permission-
  gated `Session` (tools, hooks, approval waits) as a participant, `runtimeParticipant` runs a plain
  `the agent runtime` agent, and `runtimeSelector` asks a ConversationAgent to pick the next speaker through one control
  tool call. Every provider call either wrapper makes is metered and reported through the conversation's
  own usage ledger.

  Both packages were previously developed as private workspace packages under the same version; this
  changeset makes no API change on its own.

### Patch Changes

- 2c612ba: Release the migrated Robota product with its public SDK namespace, robota command, compatible SDK exports, internal product configuration, and verified CLI startup and delivery corrections.
- 9b4f63b: Allow explicitly borrowed providers to outlive agent destruction and Session shutdown while keeping
  owned providers as the default. Track replaced and removed provider cleanup, expose current provider
  registrations after swapping, and hold Roundtable resource leases until runtime teardown finishes.
  Borrowing does not permit concurrent provider use across leases.
  Serialize manager lifecycle transitions so reinitialization cannot admit providers during pending teardown.
- Updated dependencies [7b6234c]
- Updated dependencies [5307f8a]
- Updated dependencies [b462ee7]
- Updated dependencies [4eea54b]
- Updated dependencies [30e5e50]
- Updated dependencies [1698be4]
- Updated dependencies [9368d00]
- Updated dependencies [d4189b9]
- Updated dependencies [9edae52]
- Updated dependencies [4078a72]
- Updated dependencies [4c73a0b]
- Updated dependencies [196a900]
- Updated dependencies [f336838]
- Updated dependencies [34e50f0]
- Updated dependencies [722e88a]
- Updated dependencies [a5cc36e]
- Updated dependencies [d23c848]
- Updated dependencies [3038eb7]
- Updated dependencies [02b7452]
- Updated dependencies [e689c8e]
- Updated dependencies [ec5e477]
- Updated dependencies [c7f9203]
- Updated dependencies [18b52cc]
- Updated dependencies [9843fe6]
- Updated dependencies [be0e53c]
- Updated dependencies [8bd5fac]
- Updated dependencies [57280bf]
- Updated dependencies [5033dd9]
- Updated dependencies [18c0d5c]
- Updated dependencies [dbd888d]
- Updated dependencies [1887e54]
- Updated dependencies [190f78f]
- Updated dependencies [9f46375]
- Updated dependencies [9f46375]
- Updated dependencies [41cca13]
- Updated dependencies [ada3841]
- Updated dependencies [5093a30]
- Updated dependencies [94b2c87]
- Updated dependencies [10597b2]
- Updated dependencies [3ab2eca]
- Updated dependencies [2c612ba]
- Updated dependencies [66af868]
- Updated dependencies [e706b43]
- Updated dependencies [60f3965]
- Updated dependencies [04719a9]
- Updated dependencies [04a6de4]
- Updated dependencies [0ba247b]
- Updated dependencies [6f41c53]
- Updated dependencies [807d161]
- Updated dependencies [fec722f]
- Updated dependencies [b078afa]
- Updated dependencies [b078afa]
- Updated dependencies [2ebff01]
- Updated dependencies [2d3b2c0]
- Updated dependencies [4772067]
- Updated dependencies [64ba748]
- Updated dependencies [9fbab1b]
- Updated dependencies [a009f5b]
- Updated dependencies [c207a31]
- Updated dependencies [9b4f63b]
- Updated dependencies [4f3c075]
- Updated dependencies [475e085]
- Updated dependencies [6085cad]
- Updated dependencies [e477440]
- Updated dependencies [9dcb5da]
- Updated dependencies [a95ca85]
- Updated dependencies [b6d14ce]
- Updated dependencies [0382a51]
- Updated dependencies [93d061d]
- Updated dependencies [39554a1]
- Updated dependencies [d28430a]
- Updated dependencies [bed26ea]
- Updated dependencies [7d9cc66]
- Updated dependencies [bad976f]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [df02568]
- Updated dependencies [4b76cfa]
- Updated dependencies [fcb0da3]
- Updated dependencies [07b627f]
- Updated dependencies [d0de5b2]
- Updated dependencies [9c6a8db]
- Updated dependencies [dfb9b15]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [c59acd3]
- Updated dependencies [7911a7d]
- Updated dependencies [ebd40a0]
- Updated dependencies [d6b9404]
- Updated dependencies [62663ae]
- Updated dependencies [23a30cd]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [9814afc]
- Updated dependencies [7d9cc66]
- Updated dependencies [02053ec]
- Updated dependencies [242a644]
  - @robota-sdk/agent-core@3.0.0
  - @robota-sdk/agent-session@3.0.0
  - @robota-sdk/agent-roundtable@3.0.0

## 3.0.0-beta.106
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.106
  - @robota-sdk/agent-roundtable@3.0.0-beta.106
  - @robota-sdk/agent-session@3.0.0-beta.106

## 3.0.0-beta.105
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.105
  - @robota-sdk/agent-roundtable@3.0.0-beta.105
  - @robota-sdk/agent-session@3.0.0-beta.105

## 3.0.0-beta.104
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.104
  - @robota-sdk/agent-roundtable@3.0.0-beta.104
  - @robota-sdk/agent-session@3.0.0-beta.104

## 3.0.0-beta.103
### Patch Changes

- Updated dependencies [6f41c53]
  - @robota-sdk/agent-core@3.0.0-beta.103
  - @robota-sdk/agent-session@3.0.0-beta.103
  - @robota-sdk/agent-roundtable@3.0.0-beta.103

## 3.0.0-beta.102
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.102
  - @robota-sdk/agent-roundtable@3.0.0-beta.102
  - @robota-sdk/agent-session@3.0.0-beta.102

## 3.0.0-beta.101
### Patch Changes

- Updated dependencies [62663ae]
  - @robota-sdk/agent-core@3.0.0-beta.101
  - @robota-sdk/agent-session@3.0.0-beta.101
  - @robota-sdk/agent-roundtable@3.0.0-beta.101

## 3.0.0-beta.100
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.100
  - @robota-sdk/agent-roundtable@3.0.0-beta.100
  - @robota-sdk/agent-session@3.0.0-beta.100

## 3.0.0-beta.99
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.99
  - @robota-sdk/agent-roundtable@3.0.0-beta.99
  - @robota-sdk/agent-session@3.0.0-beta.99

## 3.0.0-beta.98
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.98
  - @robota-sdk/agent-roundtable@3.0.0-beta.98
  - @robota-sdk/agent-session@3.0.0-beta.98

## 3.0.0-beta.97
### Patch Changes

- 9b4f63b: Allow explicitly borrowed providers to outlive agent destruction and Session shutdown while keeping
  owned providers as the default. Track replaced and removed provider cleanup, expose current provider
  registrations after swapping, and hold Roundtable resource leases until runtime teardown finishes.
  Borrowing does not permit concurrent provider use across leases.
  Serialize manager lifecycle transitions so reinitialization cannot admit providers during pending teardown.
- Updated dependencies [c207a31]
- Updated dependencies [9b4f63b]
- Updated dependencies [c59acd3]
- Updated dependencies [7911a7d]
- Updated dependencies [23a30cd]
  - @robota-sdk/agent-core@3.0.0-beta.97
  - @robota-sdk/agent-session@3.0.0-beta.97
  - @robota-sdk/agent-roundtable@3.0.0-beta.97

## 3.0.0-beta.96
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.96
  - @robota-sdk/agent-roundtable@3.0.0-beta.96
  - @robota-sdk/agent-session@3.0.0-beta.96

## 3.0.0-beta.95
### Patch Changes

- Updated dependencies [60f3965]
- Updated dependencies [04719a9]
- Updated dependencies [04a6de4]
- Updated dependencies [0ba247b]
- Updated dependencies [02053ec]
  - @robota-sdk/agent-session@3.0.0-beta.95
  - @robota-sdk/agent-core@3.0.0-beta.95
  - @robota-sdk/agent-roundtable@3.0.0-beta.95

## 3.0.0-beta.94
### Patch Changes

- Updated dependencies [e706b43]
  - @robota-sdk/agent-session@3.0.0-beta.94
  - @robota-sdk/agent-core@3.0.0-beta.94
  - @robota-sdk/agent-roundtable@3.0.0-beta.94

## 3.0.0-beta.93
### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.93
  - @robota-sdk/agent-session@3.0.0-beta.93
  - @robota-sdk/agent-roundtable@3.0.0-beta.93

## 3.0.0-beta.92
### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.92
  - @robota-sdk/agent-session@3.0.0-beta.92
  - @robota-sdk/agent-roundtable@3.0.0-beta.92

## 3.0.0-beta.91
### Patch Changes

- Updated dependencies [bad976f]
  - @robota-sdk/agent-session@3.0.0-beta.91
  - @robota-sdk/agent-core@3.0.0-beta.91
  - @robota-sdk/agent-roundtable@3.0.0-beta.91

## 3.0.0-beta.90
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.90
  - @robota-sdk/agent-roundtable@3.0.0-beta.90
  - @robota-sdk/agent-session@3.0.0-beta.90

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
