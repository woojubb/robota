# Session Continue/Resume Design

## Goal

Enable users to resume previous conversations with full AI context and UI history restoration. Modeled after Claude Code's session management.

## Commands

### CLI Flags

| Flag               | Behavior                                                                               |
| ------------------ | -------------------------------------------------------------------------------------- |
| `--continue`, `-c` | Resume the most recent session in the current directory                                |
| `--resume`, `-r`   | No argument: show session picker. With argument: resume by name or ID                  |
| `--fork-session`   | Used with `--continue`/`--resume`. Creates a new session ID from existing session data |
| `--name`, `-n`     | Set a display name for the session                                                     |

### TUI Slash Commands

| Command          | Behavior                                                |
| ---------------- | ------------------------------------------------------- |
| `/resume`        | Open session picker to select and resume a session      |
| `/rename <name>` | Rename the current session. Name displayed in StatusBar |

## Storage

### Existing Infrastructure (no changes needed)

- **SessionStore** (`agent-sessions/session-store.ts`): Reads/writes `~/.robota/sessions/{id}.json`. Methods: `save()`, `load()`, `list()`, `delete()`.
- **Session class**: Accepts optional `SessionStore` injection. Calls `persistSession()` after each `run()`.
- **Paths**: `projectPaths(cwd).sessions` and `userPaths().sessions` already defined.

### ISessionRecord Extension

Add `history` field to existing `ISessionRecord`:

```typescript
interface ISessionRecord {
  id: string;
  name?: string; // user-assigned session name
  cwd: string;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
  history: IHistoryEntry[]; // full timeline (chat + events) — UI restoration
  messages: TUniversalMessage[]; // AI provider messages — context restoration
}
```

- `history`: Passed to TuiStateManager for UI rendering (MessageList)
- `messages`: Injected into Session/Robota to restore AI context

## Save Flow

1. InteractiveSession creates `SessionStore` instance during initialization
2. Passes it to internal `Session` constructor
3. Session auto-persists after each `run()` (existing behavior, just needs wiring)
4. InteractiveSession additionally saves `history: IHistoryEntry[]` to the record

## Restore Flow

### `--continue`

1. CLI calls `SessionStore.list()` filtered by `cwd`
2. Takes the most recent session (sorted by `updatedAt`)
3. Calls `SessionStore.load(id)`
4. Passes `messages` to Session → AI context restored
5. Passes `history` to TuiStateManager.syncHistory() → UI restored
6. New prompts append to existing history

### `--resume` (no argument)

1. CLI calls `SessionStore.list()`
2. Renders `ListPicker` with session list
3. User selects a session
4. Same restore flow as `--continue`

### `--resume <name-or-id>`

1. CLI calls `SessionStore.list()`, finds by name or ID match
2. Same restore flow as `--continue`

### `--fork-session`

1. Load session as above
2. Generate new UUID
3. Start with loaded history/messages but save under new ID
4. Original session remains unchanged

### `/resume` (TUI)

1. System command handler calls `SessionStore.list()`
2. App renders `ListPicker` overlay
3. User selects → current session is replaced with loaded session
4. AI context and UI history restored

### `/rename <name>` (TUI)

1. System command updates `ISessionRecord.name`
2. Persists immediately via `SessionStore.save()`
3. StatusBar re-renders with new name

## Components

### Modified Files

| File                               | Change                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `agent-sessions/session-store.ts`  | Add `history: IHistoryEntry[]` to `ISessionRecord`                                                   |
| `agent-sessions/session.ts`        | Include `history` in `persistSession()`                                                              |
| `agent-sdk/interactive-session.ts` | Create SessionStore, wire to Session. Add `loadSession()` for restore. Add `setName()` / `getName()` |
| `agent-sdk/system-command.ts`      | Add `resume` and `rename` system commands                                                            |
| `agent-cli/cli-args.ts`            | Add `--fork-session`, `--name` flags                                                                 |
| `agent-cli/cli.ts`                 | Handle continue/resume/fork before app render                                                        |
| `agent-cli/App.tsx`                | Pass session name to StatusBar. Handle `/resume` overlay                                             |
| `agent-cli/StatusBar.tsx`          | Display session name                                                                                 |

### New File

| File                          | Purpose                                                                                                                     |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `agent-cli/ui/ListPicker.tsx` | Generic list selection component. Arrow keys, Enter, Esc. Reusable for any list selection (sessions, models, plugins, etc.) |

```typescript
interface IListPickerProps<T> {
  items: T[];
  renderItem: (item: T, isSelected: boolean) => React.ReactElement;
  onSelect: (item: T) => void;
  onCancel: () => void;
}
```

## Session Picker Display

Each session row shows:

- Session name (or first prompt text if unnamed)
- Time since last activity (e.g., "2h ago")
- Message count

## StatusBar Session Name

When a session has a name (via `--name` or `/rename`), it is displayed in the StatusBar alongside existing info (permission mode, model, context usage).

## Out of Scope

- Session auto-cleanup (separate task)
- Git branch linking (CLI-BL-015)
- Session picker keyboard shortcuts beyond basic navigation (P for preview, / for search — future enhancement)
- `--from-pr` flag (not applicable without GitHub integration)
- `--session-id` flag (low priority)

## Testing

- SessionStore save/load round-trip with IHistoryEntry[]
- `--continue` selects most recent session by cwd
- `--resume <name>` finds session by name
- `--fork-session` creates new ID, preserves history
- `/rename` updates name and persists
- ListPicker renders items, handles selection and cancel
- AI context restoration: messages injected correctly after load
