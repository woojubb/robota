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
│    ├─ Add Marketplace          → TextPrompt (source input, validates '/')
│    ├─ marketplace-A            → [Browse plugins / Update / Remove]
│    └─ marketplace-B            → [Browse plugins / Update / Remove]
│         ├─ Browse plugins      → plugin list
│         │    ├─ (not installed) → scope select [User / Project] → install
│         │    └─ (installed)    → [Uninstall] → ConfirmPrompt
│         ├─ Update              → execute + feedback
│         └─ Remove              → ConfirmPrompt → execute + feedback
│
└─ Installed Plugins
     ├─ plugin-x@marketplace-A   → ConfirmPrompt → uninstall
     └─ plugin-y@marketplace-B   → ConfirmPrompt → uninstall
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
| `installed-list`            | Installed plugins (name@marketplace format)    | MenuSelect | `listInstalled()` on each render    |
| `installed-action`          | [Uninstall]                                    | MenuSelect | None (static options)               |

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
  addMessage?: (msg: { role: string; content: string }) => void;
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
- Footer: `↑↓ Navigate  Enter Select  Esc Back`
- Loading: "Loading..." text (rendered inside MenuSelect, not separate Box)
- Error: red text with error message + "Press Esc to go back"

**Key prop requirement:** When multiple screens share a single MenuSelect render position, each must have a unique `key` (e.g., `key={screen}` or `key={stack.length}`) to force React remount. Without this, `resolvedRef` from the previous screen's selection persists and blocks all input.

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

Inline validation: when `validate` returns a string, show it in red below the input and block submission. marketplace-add uses `validate` to require `/` in source string.

### ConfirmPrompt

Existing component, reused for destructive actions (remove marketplace, uninstall plugin).

## Callback Changes

### IPluginCallbacks additions

```typescript
// New method: fetch plugins from a specific marketplace
// Implementation: calls MarketplaceClient.fetchManifest(marketplace) wrapped in
// try/catch (returns [] on failure), then cross-references
// Object.values(installer.getInstalledPlugins()) to derive `installed` boolean.
listAvailablePlugins(marketplace: string): Promise<Array<{
  name: string;
  description: string;
  installed: boolean;
}>>;

// Modified: add scope parameter
// Implementation: 'user' scope uses ~/.robota/plugins/ installer,
// 'project' scope uses .robota/plugins/ installer.
// usePluginCallbacks creates a project-scoped BundlePluginInstaller on demand.
install(pluginId: string, scope?: 'user' | 'project'): Promise<void>;
```

### Bug fixes applied

- `listInstalled()`: Uses `settingsStore.getEnabledPlugins()` (not the non-existent `settingsStore.read()`).
- `listInstalled()`: Returns `name@marketplace` format by extracting marketplace from `pluginDir` path (`cache/<marketplace>/<plugin>/<version>/`).
- `getInstalledPlugins()` returns `Record`, not array — use `Object.values()` before `.map()`.

## Plugin State Model (Current)

Enable/disable is **deferred** — not yet reliable. Current model:

| State         | Actions available            |
| ------------- | ---------------------------- |
| Not installed | Install (user/project scope) |
| Installed     | Uninstall                    |

Enable/disable will be added when `PluginSettingsStore` enabled state tracking is stable.

## Install Scope

| Scope         | Path                        | Git tracked |
| ------------- | --------------------------- | ----------- |
| User (global) | `~/.robota/plugins/<name>/` | No          |
| Project       | `.robota/plugins/<name>/`   | Yes         |

## Integration

### Slash Command

`/plugin` has no subcommands in autocomplete — selecting it directly submits the command. Text subcommands (`/plugin install name@mp`, `/plugin marketplace add`, etc.) still work when typed manually.

Add `triggerPluginTUI?: boolean` to `ISlashResult`. When `/plugin` is called with no arguments (or with `manage`), returns `{ handled: true, triggerPluginTUI: true }`.

### App.tsx Integration

```typescript
const [showPluginTUI, setShowPluginTUI] = useState(false);

// In useSlashCommands (added as last parameter):
if (result.triggerPluginTUI) {
  setShowPluginTUI(true);
}

// Render: PluginTUI before StatusBar, InputArea disabled when TUI active
{showPluginTUI && (
  <PluginTUI
    callbacks={pluginCallbacks}
    onClose={() => setShowPluginTUI(false)}
    addMessage={addMessage}
  />
)}
```

### useInput Conflict Resolution

When `showPluginTUI` is true:

- App-level `useInput` is disabled via `{ isActive: !permissionRequest && !showPluginTUI }`
- `InputArea` is disabled (`isDisabled` includes `showPluginTUI`)
- Only `PluginTUI`'s `useInput` handlers are active

### Feedback

After operations (install, uninstall, update, remove):

1. Display result as system message in the chat via `addMessage` prop
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
├─ builtin-source.ts   ← Modified: /plugin without subcommands
└─ slash-executor.ts   ← Modified: ISlashResult + triggerPluginTUI, IPluginCallbacks extended

packages/agent-cli/src/ui/hooks/
├─ usePluginCallbacks.ts ← Modified: listAvailablePlugins, scoped install, listInstalled fix
└─ useSlashCommands.ts   ← Modified: setShowPluginTUI parameter

packages/agent-cli/src/ui/
└─ App.tsx             ← Modified: showPluginTUI state, useInput isActive guard
```

## Out of Scope

- Enable/disable plugin toggle (deferred until state tracking is reliable)
- Tab-based top-level navigation (future enhancement)
- Local scope (user+repo-specific, gitignored)
- Plugin version management
- MCP server configuration UI
