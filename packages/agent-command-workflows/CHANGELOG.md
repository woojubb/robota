# @robota-sdk/agent-command-workflows

## 3.0.0-beta.6

### Patch Changes

- Updated dependencies [c7f9203]
  - @robota-sdk/agent-core@3.0.0-beta.82
  - @robota-sdk/agent-framework@3.0.0-beta.82
  - @robota-sdk/agent-interface-command@3.0.0-beta.82
  - @robota-sdk/dag-framework@1.0.0-beta.6
  - @robota-sdk/dag-nodes-default@0.1.0-beta.3
  - @robota-sdk/dag-node-instant-node@3.0.0-beta.66

## 3.0.0-beta.5

### Patch Changes

- 18b52cc: Built-in commands are offered to the model deliberately, each described for the model, and never
  with a trust, credential or permission-widening action.

  - `agent-interface-command` — `ICommand` gains `modelDescription?` (what the model is told, beside the
    short `/help` line), and `modelInvocable` on a subcommand entry now narrows what the model may run.
  - `agent-framework` — `ISystemCommand` gains `modelDescription?` and `modelRequiresPermission?`.
    Once any subcommand of a model-invocable command declares `modelInvocable`, the model may run only
    the bare command and the subcommands declared `true`; everything else, including an alias or an
    undeclared subcommand, is refused before the command runs. The model-facing descriptor lists only
    that subset. A model-requested monitor's command is now decided by the shell tool's gate (its
    Bash/Shell rules, the mode and the prompt) and a refusal rejects with the new
    `MonitorCommandRefusedError`. The `scriptedSession` test harness accepts `permissions` patterns.
  - `agent-session` — `Session.checkToolPermission(toolName, toolArgs)` decides an action that has a
    tool's effect by another route: that tool's PreToolUse hooks, then the gate's rules, mode,
    remembered consent and prompt — never the command sandbox's auto-approval, since the action does
    not run inside the sandbox.
  - `agent-framework` also: `ICommandMCPActivationAdapter.userActionSurface?` tells `/mcp` whether the
    user can type a session command, so the model's status names the terminal sign-in otherwise.
  - `agent-command` — `/context` (bare and `list`), `/cost` (the report, not `budget`) and `/mcp`
    (`status` only, without a prompt) are now model-invocable; `/memory approve` and `/memory reject`
    are now user-only; the model's `/monitor` is decided by the shell gate rather than by consent to
    the command's name. Every model-invocable command carries a model-facing description. The model's
    `/mcp status` shows only safe names, states and the command to suggest, and a caller that does not
    identify itself gets that view. `/context list` accounts only for turns still in context. New
    `mcpUserActionNotice`, `mcpUserActionCommand` and `mcpUnavailableServersNotice` build the fixed
    notices.
  - `agent-command-workflows` — `/workflows` carries a model-facing description.
  - `agent-mcp` — `createDiscoveredTool` accepts `authFailureNotice`: a call the server refuses for
    authentication returns that host text instead of the generic failure.
  - `agent-cli` — an MCP server that did not start because the user must approve it, trust the
    workspace or sign in is named to the model at the start of an interactive session with the
    command to suggest, and a
    signed-in OAuth server that refuses a call tells the model to suggest `/mcp login <server>` — or, in print and serve runs, the terminal
    `robota mcp login <server>`.

  A command whose bare form is a complete action declares `runsBare`, so choosing `/cost` or `/mcp`
  from the autocomplete menu still runs it even though they now declare subcommands.

- Updated dependencies [3038eb7]
- Updated dependencies [02b7452]
- Updated dependencies [ec5e477]
- Updated dependencies [007fd90]
- Updated dependencies [18b52cc]
- Updated dependencies [9843fe6]
  - @robota-sdk/agent-core@3.0.0-beta.81
  - @robota-sdk/agent-framework@3.0.0-beta.81
  - @robota-sdk/agent-interface-command@3.0.0-beta.81
  - @robota-sdk/dag-framework@1.0.0-beta.5
  - @robota-sdk/dag-nodes-default@0.1.0-beta.2
  - @robota-sdk/dag-node-instant-node@3.0.0-beta.65

## 3.0.0-beta.4

### Minor Changes

- 8291d7b: Add the `/workflows build` subcommand (WORKFLOW-004): LLM-assisted authoring WITHOUT execution.
  `build "<description>" [--input k=v] [--name <name>]` authors a workflow from natural language via
  the active provider (the same FLOW-007 authoring pipeline, deps seam, and arg grammar as `create`),
  validates + assembles it, saves the artifact (plus any prompt-backed nodes) — and never runs it. The
  explicit next steps are the existing `validate` / `run` subcommands. `build` is model-invocable and
  strictly less privileged than `create`.

### Patch Changes

- fec722f: Carry a trusted canonical absolute execution root from DAG product composition through worker task
  input and node lifecycle context. Filesystem-capable DAG nodes now use that injected authority instead
  of ambient `process.cwd()`, and authored `cwd` values may only narrow it.

  BREAKING: `ITaskExecutionInput`, `INodeExecutionContext`, worker composition dependencies,
  `LocalDagRuntimeProvider`, and the CLI-local runner now require an execution root at their non-convenience
  boundaries. `createDagFramework()` preserves no-argument construction by validating and capturing its
  current directory at the factory boundary. The filesystem-backed skill node is explicitly Node-only and
  no longer advertises a browser export condition.

- 3a8876b: ARCH-029: decompose the command host into role ports

  `ICommandHostContext`, `ICommandSessionRuntime` and `IAgentJobHostContext` are now empty `extends`
  aggregates over 26 named role ports, so a command declares only the capability it uses. A role port
  is a supertype of the aggregate, so narrowing a declared parameter still satisfies
  `ISystemCommand.execute` by contravariance.

  All 79 members are preserved (46 + 18 + 15) with the declaration kind unchanged, so implementors and
  callers stay source-compatible.

  **Breaking:** every role-port member is now required except the adapter bag, whose contents are
  genuinely variational. 38 members went from optional to required. A host that previously omitted a
  member must now provide one — including `validateCurrentSessionReplayLog`, which was an override
  with a framework-computed default and no implementor. `createTestCommandHost`,
  `createTestAgentJobHost` and `createTestSessionRuntime` are published from
  `@robota-sdk/agent-framework/testing` as conformant, cast-free doubles for exactly this.

  Also removed: the `clearConversationHistory` fallback that reached past the host into
  `getSession().clearHistory()`. Those were never the same operation — the host path also broadcasts
  `history_cleared` to every attached surface, so a fallback clear left other surfaces still showing
  the transcript.

- 9eb7607: Provider DIP Stage C (ARCH-PROVIDER-004): extract the default DAG node catalog into a new
  entry-point-only `@robota-sdk/dag-nodes-default` aggregator. `@robota-sdk/dag-framework` no
  longer carries a hard dependency on any concrete node package — it loads the default catalog
  lazily (typed diagnostic on failure) or via injected `options.nodes` / `nodeRegistry`. The
  `createDefaultNodeRegistry` / `createDefaultNodeRegistrySync` functions moved out of
  `dag-framework` (no longer re-exported); import them from `@robota-sdk/dag-nodes-default`.
- 5a46402: Share root credit reservations across nested local DAG runs so concurrent children cannot each spend the same remaining limit.
- Updated dependencies [9c19c50]
- Updated dependencies [7b6234c]
- Updated dependencies [5307f8a]
- Updated dependencies [b462ee7]
- Updated dependencies [08a9bd6]
- Updated dependencies [818f0c8]
- Updated dependencies [4eea54b]
- Updated dependencies [eb71c83]
- Updated dependencies [0214ff8]
- Updated dependencies [792b726]
- Updated dependencies [a58fc4b]
- Updated dependencies [1698be4]
- Updated dependencies [9368d00]
- Updated dependencies [d4189b9]
- Updated dependencies [9edae52]
- Updated dependencies [4078a72]
- Updated dependencies [4c73a0b]
- Updated dependencies [af2f2ad]
- Updated dependencies [267af5f]
- Updated dependencies [196a900]
- Updated dependencies [f336838]
- Updated dependencies [34e50f0]
- Updated dependencies [722e88a]
- Updated dependencies [a5cc36e]
- Updated dependencies [d23c848]
- Updated dependencies [b70fa3d]
- Updated dependencies [2711ec6]
- Updated dependencies [4dd45cc]
- Updated dependencies [4c5148e]
- Updated dependencies [37af5dc]
- Updated dependencies [807d161]
- Updated dependencies [fec722f]
- Updated dependencies [e82215f]
- Updated dependencies [52b7346]
- Updated dependencies [2ebff01]
- Updated dependencies [2ebff01]
- Updated dependencies [2d3b2c0]
- Updated dependencies [b078afa]
- Updated dependencies [2d3b2c0]
- Updated dependencies [baa6863]
- Updated dependencies [2d3b2c0]
- Updated dependencies [3a8876b]
- Updated dependencies [4772067]
- Updated dependencies [7b85767]
- Updated dependencies [0f98419]
- Updated dependencies [64ba748]
- Updated dependencies [9fbab1b]
- Updated dependencies [82736ee]
- Updated dependencies [9eb7607]
- Updated dependencies [d312755]
- Updated dependencies [a009f5b]
- Updated dependencies [1e3f91a]
- Updated dependencies [4f3c075]
- Updated dependencies [475e085]
- Updated dependencies [e477440]
- Updated dependencies [9dcb5da]
- Updated dependencies [a95ca85]
- Updated dependencies [b6d14ce]
- Updated dependencies [0382a51]
- Updated dependencies [93d061d]
- Updated dependencies [39554a1]
- Updated dependencies [d28430a]
- Updated dependencies [caabd3c]
- Updated dependencies [bed26ea]
- Updated dependencies [6238e38]
- Updated dependencies [fe48835]
- Updated dependencies [1e40b5b]
- Updated dependencies [cd848eb]
- Updated dependencies [74bf844]
- Updated dependencies [4b76cfa]
- Updated dependencies [d9bd9ec]
- Updated dependencies [a0eac8f]
- Updated dependencies [8865acf]
- Updated dependencies [90e7a10]
- Updated dependencies [fcb0da3]
- Updated dependencies [07b627f]
- Updated dependencies [d0de5b2]
- Updated dependencies [9665c6e]
- Updated dependencies [44393be]
- Updated dependencies [c7fa299]
- Updated dependencies [5134b3b]
- Updated dependencies [34768aa]
- Updated dependencies [dd444c1]
- Updated dependencies [1f57e7f]
- Updated dependencies [833afe1]
- Updated dependencies [d6b9404]
- Updated dependencies [7863b16]
- Updated dependencies [fde558e]
- Updated dependencies [db5c439]
- Updated dependencies [5a46402]
- Updated dependencies [78dcc65]
- Updated dependencies [4a01a87]
- Updated dependencies [cbee54e]
- Updated dependencies [9814afc]
- Updated dependencies [242a644]
  - @robota-sdk/agent-interface-command@3.0.0-beta.80
  - @robota-sdk/agent-framework@3.0.0-beta.80
  - @robota-sdk/agent-core@3.0.0-beta.80
  - @robota-sdk/dag-core@3.0.0-beta.61
  - @robota-sdk/dag-framework@1.0.0-beta.4
  - @robota-sdk/dag-builder@0.1.0-beta.1
  - @robota-sdk/dag-nodes-default@0.1.0-beta.1
  - @robota-sdk/dag-node-instant-node@3.0.0-beta.64
  - @robota-sdk/dag-node@3.0.0-beta.61

## 3.0.0-beta.3

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.79
- @robota-sdk/agent-framework@3.0.0-beta.79
- @robota-sdk/agent-interface-transport@3.0.0-beta.79
- @robota-sdk/dag-node-instant-node@3.0.0-beta.63
- @robota-sdk/dag-framework@0.1.0-beta.3

## 3.0.0-beta.2

### Patch Changes

- @robota-sdk/agent-framework@3.0.0-beta.78
- @robota-sdk/agent-interface-transport@3.0.0-beta.78
- @robota-sdk/dag-framework@0.1.0-beta.2

## 3.0.0-beta.1

### Patch Changes

- @robota-sdk/agent-framework@3.0.0-beta.77
- @robota-sdk/agent-interface-transport@3.0.0-beta.77
- @robota-sdk/dag-framework@0.1.0-beta.1
