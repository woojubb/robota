# agent-cli — session ownership in TuiInteractionChannel

> Whitebox design for `@robota-sdk/agent-cli`. The blackbox contract lives in
> [`../SPEC.md`](../SPEC.md); nothing here is a promise to a consumer. Placement follows the
> consumer-impact test in
> [`design-doc-authoring`](../../../../.agents/skills/design-doc-authoring/SKILL.md).

## Context & Goal

Which object holds the live `InteractiveSession`, and how the TUI reaches it. A user cannot observe
this; changing it changes no command, key binding, or output.

## Constraints

- The CLI owns no session lifecycle logic — `InteractiveSession` in `@robota-sdk/agent-framework`
  does. The channel is a holder, not a manager.
- React components must not reach the session except through the channel.

## Internal Structure

`TuiInteractionChannel` (owned by `@robota-sdk/agent-transport-tui`) is the single owner of the SDK session lifecycle in TUI mode. It:

1. Creates `InteractiveSession({ cwd, provider, commandModules, commandHostAdapters })` and `CommandRegistry` once (in the constructor — never recreated). The provider instance is passed in from the caller; `InteractiveSession` handles config/context loading internally. Host adapters are thin CLI-owned services such as settings read/write, not command implementations.
2. Creates a `TuiStateManager` instance that holds `history: IHistoryEntry[]` as the primary state for the message list and the latest SDK execution workspace snapshot for background/workspace rendering. On each execution update (when `thinking` transitions to `false`, or on `complete`/`interrupted`), delegates to `TuiStateManager` to sync state from `interactiveSession.getFullHistory()` and `interactiveSession.getExecutionWorkspaceSnapshot()`.
3. Subscribes to `InteractiveSession` events (`text_delta`, `tool_start`, `tool_end`, `thinking`, `complete`, `interrupted`, `error`, `execution_workspace_event`) and converts them to channel state.
4. Exposes `handleSubmit`, `handleAbort`, `handleCancelQueue`, and `handleShutdown` as stable callbacks to the TUI via `useTuiChannel`.
5. Routes slash commands via `session.executeCommand(name, args)` — no `SystemCommandExecutor` is instantiated directly by the CLI. Commands that need input ask inline via the CMD-004 seam (rendered by the channel's `askUser` → `PendingActionPrompt`); command-specific host actions are typed `TCommandHostAction` values the SESSION executes via `ICommandHostAdapters` (CMD-004; the legacy `TCommandEffect` union is deleted).
6. Manages the permission queue (serialises concurrent permission requests).

`useTuiChannel` is the React hook that subscribes to `TuiInteractionChannel.onChange` and exposes its state/callbacks to `App.tsx`. No component interacts with `InteractiveSession` directly.

### Plugin Hook Merging

Plugin hook merging (resolving `${CLAUDE_PLUGIN_ROOT}` and merging hook groups) is handled internally by `@robota-sdk/agent-framework`. The CLI does not perform hook merging.

### App.tsx

`App.tsx` is owned by `@robota-sdk/agent-transport-tui` (`packages/agent-transport-tui/src/App.tsx`). It is a thin JSX shell that:

- Calls `useTuiChannel` and `usePluginCallbacks`.
- Renders host-shell state via `ITuiCliAdapter` (injected by `startCli()`; read-only toward settings since CMD-004 — host actions are session-executed).
- Contains no queue logic, no abort logic, no session business logic.

### Tool List Visibility

The `StreamingIndicator` (showing active tools) is rendered when `isThinking || activeTools.length > 0`. Streaming state (`streamBuf`, `activeTools`) is cleared at the **start** of a new execution (when `thinking: true`), not at the end. This means the tool list stays visible after execution completes or is aborted, until the next execution begins.

### Streaming Text Debounce

`TuiStateManager.onTextDelta` debounces `notify()` calls to reduce React re-render and markdown rendering frequency. Text deltas are accumulated in `streamBuf` immediately (no data loss), but `notify()` fires at most once per `STREAMING_DEBOUNCE_MS` (default 300ms). This limits `renderMarkdown()` invocations to ~3/second instead of per-token (hundreds/second). A `createDebouncedNotify` utility manages the timer lifecycle; `flush()` is called on completion/interruption/error to clean up.

## Key Flows

A turn enters through the channel, is forwarded to the session, and its events are converted to React
state. The user-visible result — display order, abort semantics — is contract and lives in
[`../SPEC.md`](../SPEC.md) under `User-Facing Contract`.

## Test Approach

Channel-level unit tests in `packages/agent-cli/src/**/__tests__`; the user-visible ordering guarantee
is asserted separately against the SPEC.
