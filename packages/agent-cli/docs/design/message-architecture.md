# agent-cli — message type unification

> Whitebox design for `@robota-sdk/agent-cli`. The blackbox contract lives in
> [`../SPEC.md`](../SPEC.md); nothing here is a promise to a consumer. Placement follows the
> consumer-impact test in
> [`design-doc-authoring`](../../../../.agents/skills/design-doc-authoring/SKILL.md).

## Context & Goal

Which internal type the message list holds (`IHistoryEntry` vs `TUniversalMessage`) and how tool
messages are narrowed. The user sees rendered output; the type behind it is not contract.

## Constraints

- `IHistoryEntry` is owned by `@robota-sdk/agent-core`; the CLI must not redefine it.
- Type guards must be total — an unhandled message kind must not render as blank.

## Internal Structure

The CLI uses `IHistoryEntry` from `@robota-sdk/agent-core` as the primary message type for the message list. `TUniversalMessage` is still used in lower-level contexts (session history access, type guards, provider calls). There is no local `IChatMessage` type.

### Type Unification

- `IHistoryEntry[]` is the primary type held by `TuiStateManager` and passed to `MessageList`
- `MessageList` renders entries via `EntryItem`, which dispatches on `entry.category`:
  - `'chat'` entries: rendered as conversation messages (user, assistant, system, tool)
  - `'event'` entries: rendered based on `entry.type` (e.g., `'tool-summary'` renders the tool call list, `'skill-invocation'` renders a system notice)
- `entry.id` (UUID) is used as the React key for message list rendering
- `TUniversalMessage` is still used where needed (type guards, provider API calls, `getMessages()` for backward compat)
- `msg.state === 'interrupted'` shows an interrupted indicator in the UI

### Message State in TuiInteractionChannel

- `history: IHistoryEntry[]` state is managed by `TuiStateManager` inside `TuiInteractionChannel`, derived from `interactiveSession.getFullHistory()`.
- After each execution (when `thinking` transitions to `false`), delegates to `TuiStateManager` to sync `history` from `interactiveSession.getFullHistory()` — the session is the SSOT for all history content.
- `addMessage` appends a local system message directly to channel state (used for command output and error notices that are not part of the AI conversation). These are wrapped as `IHistoryEntry` with `category: 'event'` before insertion.
- After abort: interrupted messages are already committed to session history by `InteractiveSession`; the channel re-syncs from full history — no separate streaming text ref is needed.

### Tool Message Type Guards

Tool messages use the `isToolMessage(msg)` type guard for safe access to `msg.name`.

### Render windowing and memoization

How many entries the render tree holds, and which component skips a re-render, is invisible to the
user — the transcript on disk is the contract, and it is stated in [`../SPEC.md`](../SPEC.md).

### Message Windowing

`TuiStateManager` keeps only the most recent 100 entries (`MAX_RENDERED_MESSAGES`) in `history: IHistoryEntry[]`. Older entries are dropped from the render tree to prevent unbounded memory growth. Full conversation history is preserved in the session store on disk.

### Tool State Cleanup

Completed tool execution states are trimmed to the most recent 50 entries (`MAX_COMPLETED_TOOLS`). Running tools are always kept. This prevents `activeTools` array from growing unbounded during tool-heavy responses.

### React.memo

`MessageItem` component uses `React.memo` to skip re-renders when message props are unchanged, reducing CPU and indirect memory pressure from Ink's full-tree reconciliation.

## Key Flows

SDK event → history entry → type guard narrows to a tool/assistant/user variant → the matching
renderer runs. What each variant looks like on screen is contract and lives in
[`../SPEC.md`](../SPEC.md) under `User-Facing Contract`.

## Test Approach

Type-guard unit tests plus render snapshots for each message variant.
