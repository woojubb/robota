# @robota-sdk/agent-transport-acp

## 3.0.0-beta.97
### Minor Changes

- e5a4254: **An editor that offers its file system carries the file tools' reads and writes.**

  `Read`, `Write` and `Edit` take an optional `editorFiles` port (`IEditorFileAccess`), asked at each
  call. On the host, after the tool's containment check (the permission gate has already decided),
  `Read` returns the editor's text, unsaved changes included, and `Write` hands the content to the
  editor; `Edit` reads where `Read` reads and writes where `Write` writes. The editor's text keeps
  `Read`'s byte budget, binary refusal, formatting and cancellation, and an editor failure becomes the
  tool's error result. `Glob` and `Grep` still search the disk and end their result with a note saying
  so while an editor is attached. A sandbox with its own filesystem still carries every file tool, and
  commands never use the editor. `createDefaultTools` and `createCodingPack` pass `editorFiles` through
  to those tools only.

  The ACP agent transport records the editor's `clientCapabilities.fs` and, once `session/new` binds the
  session, hands the host an access through the new `onEditorFileAccess` option that sends
  `fs/read_text_file` and `fs/write_text_file` for that session, for what the editor offered; stopping
  the transport withdraws it. `robota acp` connects the two, so Read, Write and Edit go through the
  editor in an editor that offers `fs`; `terminal/*` is not used.
- 0d43f37: **An editor can reopen an earlier conversation over ACP and offer the agent's slash commands.**

  `@robota-sdk/agent-transport-acp` sends `available_commands_update` once the editor holds the session
  id — the runtime's commands and the user-invocable skills, each with its argument hint — and again
  after a prompt that changed the list (a plugin reload, a preset). A host can supply `loadSession`;
  the agent then offers `session/load`, checks it exactly like `session/new` (the served directory, no
  editor MCP servers or extra roots, workspace trust), refuses it while a prompt runs, and replays the
  loaded conversation — what was typed, what the agent answered, and each finished tool call, a reused
  call id getting a row of its own — before it answers. The port makes the stored session current in
  the object the transport was attached to, so a host attaches a forwarder such as a session slot.
  The published narrow `IAcpTransportSession` contract remains supported: command listing and history
  display reads are optional capabilities. Loading is offered only with both the host port and the
  history read, so a session cannot be replaced without replaying its conversation.

  `robota acp` supplies the load: the editor may load a stored session of the folder it serves that
  this version can read, and the agent replaces its session with it and shuts the old one down. A load
  is refused while the current session has work in progress, and for a stored session with an active
  goal, a live loop or a schedule that restore would re-arm to fire, which would otherwise run unseen
  by the editor. With `--no-session-persistence` nothing is stored, so loading is not offered.

### Patch Changes

- Updated dependencies [c207a31]
- Updated dependencies [9b4f63b]
- Updated dependencies [7911a7d]
- Updated dependencies [23a30cd]
  - @robota-sdk/agent-core@3.0.0-beta.97
  - @robota-sdk/agent-transport@3.0.0-beta.97
  - @robota-sdk/agent-interface-session@3.0.0-beta.97
  - @robota-sdk/agent-interface-transport@3.0.0-beta.97

## 3.0.0-beta.96
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.96
  - @robota-sdk/agent-interface-session@3.0.0-beta.96
  - @robota-sdk/agent-interface-transport@3.0.0-beta.96
  - @robota-sdk/agent-transport@3.0.0-beta.96

## 3.0.0-beta.95
### Minor Changes

- c967c57: `robota acp` runs the agent as an Agent Client Protocol (v1) agent over stdio, so an editor that launches it (Zed, JetBrains and other ACP clients) can create a session, send prompts, see streamed replies and tool calls, approve or reject permission requests, and cancel a turn. Workspace trust, permission rules and the sandbox behave as in the terminal: the editor answers prompts and widens nothing. A folder that is not trusted yet is refused at `session/new` with the `trust` command to run, a working directory other than the one the agent was started in and any editor-supplied MCP servers or extra roots are refused, and a prompt that starts with `/` runs that command.

  New package `@robota-sdk/agent-transport-acp` provides `createAcpTransport`, the ACP `ITransportAdapter` the command uses.

  `@robota-sdk/agent-transport/node` gains `attachStdioCarrier`, the process-input bridge and close observation a stdio protocol carrier shares. `agent-transport-mcp` now uses it for its stdio carrier; its behavior is unchanged.
- 04719a9: **A permission request names the tool call it is about.**

  `IPermissionRequestEvent` gains an optional `executionId`: the same id the call's `tool_start` and
  `tool_end` carry, so a surface can hold one row from the request to the call's end. The session's
  permission path carries the call's id from the tool wrapper to the prompt (`IPermissionAskContext.executionId`)
  and the framework's prompt registry stamps it on the event, so it reaches every client that receives
  the event, the WebSocket and HTTP `permission_request` frames included. It is present whenever the
  session reports that call (its own, or an in-process background agent's) and absent for a
  child-process agent's forwarded request.

  The ACP agent transport keys its permission rows by that id: the request's `toolCallId` is the
  call's execution id, its start and end address the same row, a denial the session decides on its
  own while the editor's dialog is open closes that one row, and two same-named calls each follow
  their own row whatever order the editor answers in. A request that names no call gets a row that
  closes with the answer, and is closed at the end of the turn if no answer came. The name-ordered
  matching is gone.
- 04a6de4: **Reasoning text a provider streams now reaches the editor as an ACP `agent_thought_chunk`, through a new `thinking_delta` session event.**

  `IChatOptions.onThinkingDelta`, `IRunOptions.onThinkingDelta` and `IResumeExecutionOptions.onThinkingDelta`
  (typed `TThinkingDeltaCallback`) carry reasoning text from a provider through the run, and the session
  options (`ISessionOptions.onThinkingDelta`, `ICreateSessionOptions.onThinkingDelta`) hand it to the
  session's owner. `InteractiveSession` emits it as `thinking_delta(delta)`, beside `text_delta`. The
  text is never part of the reply: it is not appended to the conversation, not streamed through
  `onTextDelta`, and the core adds no record of its own for it (no text-delta log entry, no
  `provider_stream_raw_delta`); a provider's own native payload capture and response metadata keep
  what the provider sent, as before. A reasoning delta counts as provider activity for the idle
  timeout whether or not anyone listens to it, so a model that is only thinking is not cut off. The
  existing `thinking(isThinking)` event is unchanged and remains the busy indicator. Where a provider
  sends no reasoning text, nothing is emitted and nothing new is switched on.

  `@robota-sdk/agent-interface-session` is a major change because a new session event name makes an
  exhaustive map over the event names stop compiling until it classifies the event.

  `@robota-sdk/agent-transport-acp` sends each non-empty `thinking_delta` to the editor as an
  `agent_thought_chunk`, in order with the message chunks, so `robota acp` shows the model's reasoning
  in the editor. A turn that streamed only thoughts still shows its result text, because only reply
  text marks a turn as streamed. The WebSocket wire, the HTTP stream, headless stream-json, `query()`
  and the terminal UI do not carry the new event in this change (`@robota-sdk/agent-transport` and
  `@robota-sdk/agent-ui-terminal` classify it as non-surface). A forked skill and an in-process subagent
  pass their reply text up but not their reasoning.

  Two providers already receive reasoning text and now report it. `@robota-sdk/agent-provider-openai`
  passes `response.reasoning_summary_text.delta` events of a streamed Responses call to
  `onThinkingDelta`; the API sends them only when the provider profile asks for a reasoning summary, and
  no request option changed; a summary streamed in several parts, and the summary of a later reasoning
  item, each start on a new paragraph (`\n\n`) so the parts do not run together.
  `@robota-sdk/agent-provider-openai-compatible` reports the text of Gemma's thought channel, which the
  provider already removed from the reply, as it streams across chunk boundaries, with each later
  channel of one reply on a new paragraph; the reply text is unchanged. No other provider reports
  reasoning, and Anthropic thinking is not enabled. A model fallback chain still moves to the next model when only reasoning had streamed.

  The scripted test provider (`@robota-sdk/agent-core/testing`) accepts an optional `thinking` string on
  a turn and delivers it through `onThinkingDelta` before the turn's text; the scripted session harness
  collects `thinking_delta` and now keeps a scripted tool-call turn's `usage`, which it used to drop.

### Patch Changes

- 0f7d214: Name a built-in file tool's path in the permission request an editor is asked about. The title of a Read request now reads `Read: <path>` instead of the tool name alone, because the adapter takes the call's identifying argument from the shared `permissionSummaryArgument` that the MCP transport also uses, which includes `filePath`.
- Updated dependencies [c967c57]
- Updated dependencies [60f3965]
- Updated dependencies [115e104]
- Updated dependencies [04719a9]
- Updated dependencies [04a6de4]
- Updated dependencies [0ba247b]
- Updated dependencies [02053ec]
  - @robota-sdk/agent-transport@3.0.0-beta.95
  - @robota-sdk/agent-interface-session@3.0.0-beta.95
  - @robota-sdk/agent-core@3.0.0-beta.95
  - @robota-sdk/agent-interface-transport@3.0.0-beta.95
