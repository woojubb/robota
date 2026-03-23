# Plugin Management TUI Design

## Goal

Provide an interactive terminal UI for managing marketplaces and plugins via `/plugin` (no args), using arrow-key navigation with a stacked menu model.

## Architecture

Stack-based menu component (`PluginTUI`) manages screen navigation. Each screen renders a `MenuSelect`, `TextPrompt`, or `ConfirmPrompt`. ESC pops the stack; Enter pushes a new screen. The TUI reuses existing `IPluginCallbacks` from `usePluginCallbacks` — no new backend API needed beyond minor extensions.

## Tech Stack

- Ink (React for CLI), `useInput` hook for keyboard
- Existing: `IPluginCallbacks`, `PluginSettingsStore`, `MarketplaceClient`, `BundlePluginInstaller`

---

## Screen Flow

```
/plugin (no args)
│
├─ Marketplace
│    ├─ Add Marketplace          → TextPrompt (source input)
│    ├─ marketplace-A            → [Browse plugins / Update / Remove]
│    └─ marketplace-B            → [Browse plugins / Update / Remove]
│         ├─ Browse plugins      → plugin list → [Install] → scope select
│         ├─ Update              → execute + feedback
│         └─ Remove              → ConfirmPrompt → execute + feedback
│
└─ Installed Plugins
     ├─ plugin-x (enabled)       → [Disable / Uninstall]
     └─ plugin-y (disabled)      → [Enable / Uninstall]
```

## Screens

| Screen ID                   | Purpose                                        | Input      | Data fetch                          |
| --------------------------- | ---------------------------------------------- | ---------- | ----------------------------------- |
| `main`                      | Top-level: [Marketplace / Installed Plugins]   | MenuSelect | None (static)                       |
| `marketplace-list`          | [Add Marketplace / ...registered marketplaces] | MenuSelect | `marketplaceList()` on each render  |
| `marketplace-action`        | [Browse plugins / Update / Remove]             | MenuSelect | None (static options)               |
| `marketplace-browse`        | Plugin list from marketplace manifest          | MenuSelect | `listAvailablePlugins(marketplace)` |
| `marketplace-install-scope` | [User scope / Project scope]                   | MenuSelect | None (static)                       |
| `marketplace-add`           | Source URL input                               | TextPrompt | None                                |
| `installed-list`            | Installed plugins with enabled/disabled status | MenuSelect | `listInstalled()` on each render    |
| `installed-action`          | [Enable or Disable / Uninstall]                | MenuSelect | None (static options)               |

All list screens re-fetch data on each render (not cached in stack state) so that changes (add/remove/install) are immediately reflected when returning via ESC.

## State Model

```typescript
interface IMenuState {
  screen: TScreenId;
  context?: {
    marketplace?: string; // marketplace name for marketplace-action/browse
    pluginId?: string; // "name@marketplace" for install-scope/installed-action
  };
}

// Stack: IMenuState[]
// Push on selection, pop on ESC, clear on completion or top-level ESC
```

## Components

### PluginTUI

Main orchestrator. Manages menu stack, renders current screen, handles callbacks.

```typescript
interface IPluginTUIProps {
  callbacks: IPluginCallbacks;
  onClose: () => void;
}
```

### MenuSelect

Reusable vertical list selector with arrow-key navigation.

```typescript
interface IMenuSelectProps {
  title: string;
  items: Array<{ label: string; value: string; hint?: string }>;
  onSelect: (value: string) => void;
  onBack: () => void; // ESC handler
  loading?: boolean; // show spinner while fetching
  error?: string; // show error message instead of items
}
```

Visual:

- Border: round, yellow (matches PermissionPrompt)
- Selected: cyan + bold + `>` prefix
- Footer: `Up/Down Navigate  Enter Select  Esc Back`
- Loading: spinner with "Loading..." text
- Error: red text with error message + "Press Esc to go back"

### TextPrompt

Text input for marketplace source entry.

```typescript
interface ITextPromptProps {
  title: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void; // ESC handler
  validate?: (value: string) => string | undefined; // return error message or undefined
}
```

Inline validation: when `validate` returns a string, show it in red below the input and block submission.

### ConfirmPrompt

Existing component, reused for destructive actions (remove marketplace, uninstall plugin).

## Callback Changes

### IPluginCallbacks additions

```typescript
// New method: fetch plugins from a specific marketplace
// Implementation: calls MarketplaceClient.fetchManifest(marketplace) to get
// marketplace plugin entries, then cross-references BundlePluginInstaller.getInstalledPlugins()
// to derive the `installed` boolean for each plugin.
listAvailablePlugins(marketplace: string): Promise<Array<{
  name: string;
  description: string;
  installed: boolean;
}>>;

// Modified: add scope parameter
// Implementation: 'user' scope uses ~/.robota/plugins/ installer,
// 'project' scope uses .robota/plugins/ installer.
// usePluginCallbacks creates two BundlePluginInstaller instances (one per scope)
// and dispatches based on the scope argument. Default: 'user'.
install(pluginId: string, scope?: 'user' | 'project'): Promise<void>;
```

### Bug fixes

- `listInstalled()`: Return actual enabled state from `PluginSettingsStore` instead of hardcoded `true`.

## Install Scope

| Scope         | Path                        | Git tracked |
| ------------- | --------------------------- | ----------- |
| User (global) | `~/.robota/plugins/<name>/` | No          |
| Project       | `.robota/plugins/<name>/`   | Yes         |

`usePluginCallbacks` creates two `BundlePluginInstaller` instances — one for each scope directory. The `install(id, scope)` callback dispatches to the appropriate installer based on the `scope` argument.

## Integration

### Slash Command Return Type

Add `triggerPluginTUI?: boolean` to `ISlashResult`:

```typescript
interface ISlashResult {
  handled: boolean;
  exitRequested?: boolean;
  pendingModelId?: string;
  pendingLanguage?: string;
  triggerPluginTUI?: boolean; // NEW: trigger interactive TUI
}
```

When `/plugin` is called with no arguments, `executeSlashCommand` returns `{ handled: true, triggerPluginTUI: true }`.

### App.tsx Integration

```typescript
const [showPluginTUI, setShowPluginTUI] = useState(false);

// In slash command handler:
if (result.triggerPluginTUI) {
  setShowPluginTUI(true);
}

// Render:
{showPluginTUI
  ? <PluginTUI callbacks={pluginCallbacks} onClose={() => setShowPluginTUI(false)} />
  : <InputArea ... />}
```

### useInput Conflict Resolution

When `showPluginTUI` is true:

- App-level `useInput` is disabled via `{ isActive: !showPluginTUI }`
- `InputArea` is unmounted (conditional render above)
- Only `PluginTUI`'s `useInput` handlers are active

### Feedback

After operations (install, uninstall, update, remove):

1. Display result as system message in the chat
2. Pop stack back to the parent list screen
3. Parent list screen re-fetches data to reflect changes

## File Structure

```
packages/agent-cli/src/ui/
├─ PluginTUI.tsx       ← Main TUI (screen stack management)
├─ MenuSelect.tsx      ← Reusable vertical list selector
├─ TextPrompt.tsx      ← Text input component
└─ ConfirmPrompt.tsx   ← Existing (reuse)

packages/agent-cli/src/commands/
├─ slash-executor.ts   ← Modified: /plugin no-args → triggerPluginTUI
└─ types.ts            ← Modified: ISlashResult + triggerPluginTUI

packages/agent-cli/src/ui/hooks/
└─ usePluginCallbacks.ts ← Modified: add listAvailablePlugins, dual installer, fix listInstalled

packages/agent-cli/src/ui/
└─ App.tsx             ← Modified: showPluginTUI state, useInput isActive guard
```

## Out of Scope

- Tab-based top-level navigation (future enhancement)
- Local scope (user+repo-specific, gitignored)
- Plugin version management
- MCP server configuration UI
