# Plugin Management TUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interactive TUI to `/plugin` (no args) with arrow-key menus for managing marketplaces and plugins.

**Architecture:** Stack-based menu component (`PluginTUI`) renders screens from a `menuStack` state. Each screen is a `MenuSelect`, `TextPrompt`, or `ConfirmPrompt`. ESC pops, Enter pushes. Integration via `ISlashResult.triggerPluginTUI` and `showPluginTUI` state in App.tsx.

**Tech Stack:** Ink (React for CLI), useInput hook, existing IPluginCallbacks, PluginSettingsStore, MarketplaceClient, BundlePluginInstaller.

**Spec:** `docs/superpowers/specs/2026-03-23-plugin-management-tui-design.md`

---

## File Structure

```
packages/agent-cli/src/ui/
├─ MenuSelect.tsx          [CREATE] Reusable vertical list selector
├─ TextPrompt.tsx          [CREATE] Text input with inline validation
├─ PluginTUI.tsx           [CREATE] Main TUI orchestrator (screen stack)
├─ ConfirmPrompt.tsx       [EXISTING] Reuse for destructive confirmations
├─ PermissionPrompt.tsx    [EXISTING] Reference for UI patterns
├─ App.tsx                 [MODIFY] showPluginTUI state, useInput guard, conditional render

packages/agent-cli/src/ui/__tests__/
├─ MenuSelect.test.tsx     [CREATE] MenuSelect unit tests
├─ TextPrompt.test.tsx     [CREATE] TextPrompt unit tests
├─ PluginTUI.test.tsx      [CREATE] PluginTUI integration tests

packages/agent-cli/src/commands/
├─ slash-executor.ts       [MODIFY] ISlashResult + triggerPluginTUI, /plugin no-args path

packages/agent-cli/src/ui/hooks/
├─ usePluginCallbacks.ts   [MODIFY] fix listInstalled, add listAvailablePlugins, dual installer
```

---

### Task 1: MenuSelect Component

Reusable vertical list selector with arrow-key navigation, loading/error states.

**Files:**

- Create: `packages/agent-cli/src/ui/MenuSelect.tsx`
- Create: `packages/agent-cli/src/ui/__tests__/MenuSelect.test.tsx`

- [ ] **Step 1: Write failing tests for MenuSelect**

```typescript
// packages/agent-cli/src/ui/__tests__/MenuSelect.test.tsx
import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import MenuSelect from '../MenuSelect.js';

describe('MenuSelect', () => {
  const items = [
    { label: 'Option A', value: 'a' },
    { label: 'Option B', value: 'b', hint: 'some hint' },
    { label: 'Option C', value: 'c' },
  ];

  it('renders title and all items', () => {
    const { lastFrame } = render(
      <MenuSelect title="Test Menu" items={items} onSelect={() => {}} onBack={() => {}} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Test Menu');
    expect(frame).toContain('Option A');
    expect(frame).toContain('Option B');
    expect(frame).toContain('Option C');
  });

  it('renders hint text when provided', () => {
    const { lastFrame } = render(
      <MenuSelect title="Test" items={items} onSelect={() => {}} onBack={() => {}} />,
    );
    expect(lastFrame()!).toContain('some hint');
  });

  it('highlights first item by default with > prefix', () => {
    const { lastFrame } = render(
      <MenuSelect title="Test" items={items} onSelect={() => {}} onBack={() => {}} />,
    );
    expect(lastFrame()!).toContain('>');
  });

  it('shows loading state', () => {
    const { lastFrame } = render(
      <MenuSelect title="Test" items={[]} onSelect={() => {}} onBack={() => {}} loading />,
    );
    expect(lastFrame()!).toContain('Loading');
  });

  it('shows error state', () => {
    const { lastFrame } = render(
      <MenuSelect title="Test" items={[]} onSelect={() => {}} onBack={() => {}} error="Failed" />,
    );
    expect(lastFrame()!).toContain('Failed');
  });

  it('calls onSelect with value on Enter', () => {
    let selected = '';
    const { stdin } = render(
      <MenuSelect
        title="Test"
        items={items}
        onSelect={(v) => { selected = v; }}
        onBack={() => {}}
      />,
    );
    stdin.write('\r'); // Enter
    expect(selected).toBe('a');
  });

  it('calls onBack on Escape', () => {
    let backed = false;
    const { stdin } = render(
      <MenuSelect
        title="Test"
        items={items}
        onSelect={() => {}}
        onBack={() => { backed = true; }}
      />,
    );
    stdin.write('\x1B'); // Escape
    expect(backed).toBe(true);
  });

  it('navigates down with arrow key', () => {
    let selected = '';
    const { stdin } = render(
      <MenuSelect
        title="Test"
        items={items}
        onSelect={(v) => { selected = v; }}
        onBack={() => {}}
      />,
    );
    stdin.write('\x1B[B'); // Down arrow
    stdin.write('\r');
    expect(selected).toBe('b');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @robota-sdk/agent-cli test -- --run src/ui/__tests__/MenuSelect.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement MenuSelect**

```typescript
// packages/agent-cli/src/ui/MenuSelect.tsx
import React, { useState, useCallback, useRef } from 'react';
import { Box, Text, useInput } from 'ink';

export interface IMenuSelectItem {
  label: string;
  value: string;
  hint?: string;
}

interface IProps {
  title: string;
  items: IMenuSelectItem[];
  onSelect: (value: string) => void;
  onBack: () => void;
  loading?: boolean;
  error?: string;
}

export default function MenuSelect({
  title,
  items,
  onSelect,
  onBack,
  loading,
  error,
}: IProps): React.ReactElement {
  const [selected, setSelected] = useState(0);
  const resolvedRef = useRef(false);

  const doSelect = useCallback(
    (index: number) => {
      if (resolvedRef.current || items.length === 0) return;
      resolvedRef.current = true;
      onSelect(items[index].value);
    },
    [items, onSelect],
  );

  useInput((input, key) => {
    if (resolvedRef.current) return;
    if (key.escape) {
      resolvedRef.current = true;
      onBack();
      return;
    }
    if (loading || error || items.length === 0) return;
    if (key.upArrow) {
      setSelected((prev) => (prev > 0 ? prev - 1 : prev));
    } else if (key.downArrow) {
      setSelected((prev) => (prev < items.length - 1 ? prev + 1 : prev));
    } else if (key.return) {
      doSelect(selected);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow" bold>
        {title}
      </Text>
      {loading && (
        <Box marginTop={1}>
          <Text dimColor>Loading...</Text>
        </Box>
      )}
      {error && (
        <Box marginTop={1} flexDirection="column">
          <Text color="red">{error}</Text>
          <Text dimColor>Press Esc to go back</Text>
        </Box>
      )}
      {!loading && !error && (
        <Box flexDirection="column" marginTop={1}>
          {items.map((item, i) => (
            <Box key={item.value}>
              <Text color={i === selected ? 'cyan' : undefined} bold={i === selected}>
                {i === selected ? '> ' : '  '}
                {item.label}
              </Text>
              {item.hint && (
                <Text dimColor> {item.hint}</Text>
              )}
            </Box>
          ))}
        </Box>
      )}
      <Text dimColor>
        {loading || error ? '' : ' ↑↓ Navigate  Enter Select  Esc Back'}
      </Text>
    </Box>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @robota-sdk/agent-cli test -- --run src/ui/__tests__/MenuSelect.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent-cli/src/ui/MenuSelect.tsx packages/agent-cli/src/ui/__tests__/MenuSelect.test.tsx
git commit -m "feat(agent-cli): add MenuSelect component for plugin TUI"
```

---

### Task 2: TextPrompt Component

Text input with inline validation for marketplace source entry.

**Files:**

- Create: `packages/agent-cli/src/ui/TextPrompt.tsx`
- Create: `packages/agent-cli/src/ui/__tests__/TextPrompt.test.tsx`

- [ ] **Step 1: Write failing tests for TextPrompt**

```typescript
// packages/agent-cli/src/ui/__tests__/TextPrompt.test.tsx
import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import TextPrompt from '../TextPrompt.js';

describe('TextPrompt', () => {
  it('renders title', () => {
    const { lastFrame } = render(
      <TextPrompt title="Enter URL" onSubmit={() => {}} onCancel={() => {}} />,
    );
    expect(lastFrame()!).toContain('Enter URL');
  });

  it('renders placeholder when provided', () => {
    const { lastFrame } = render(
      <TextPrompt
        title="Enter"
        placeholder="owner/repo"
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(lastFrame()!).toContain('owner/repo');
  });

  it('calls onCancel on Escape', () => {
    let cancelled = false;
    const { stdin } = render(
      <TextPrompt title="Enter" onSubmit={() => {}} onCancel={() => { cancelled = true; }} />,
    );
    stdin.write('\x1B'); // Escape
    expect(cancelled).toBe(true);
  });

  it('calls onSubmit with value on Enter', () => {
    let submitted = '';
    const { stdin } = render(
      <TextPrompt title="Enter" onSubmit={(v) => { submitted = v; }} onCancel={() => {}} />,
    );
    stdin.write('hello');
    stdin.write('\r');
    expect(submitted).toBe('hello');
  });

  it('shows validation error and blocks submit', () => {
    let submitted = false;
    const validate = (v: string) => (v.length < 3 ? 'Too short' : undefined);
    const { stdin, lastFrame } = render(
      <TextPrompt
        title="Enter"
        onSubmit={() => { submitted = true; }}
        onCancel={() => {}}
        validate={validate}
      />,
    );
    stdin.write('ab');
    stdin.write('\r');
    expect(submitted).toBe(false);
    expect(lastFrame()!).toContain('Too short');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @robota-sdk/agent-cli test -- --run src/ui/__tests__/TextPrompt.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement TextPrompt**

```typescript
// packages/agent-cli/src/ui/TextPrompt.tsx
import React, { useState, useRef, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

interface IProps {
  title: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  validate?: (value: string) => string | undefined;
}

export default function TextPrompt({
  title,
  placeholder,
  onSubmit,
  onCancel,
  validate,
}: IProps): React.ReactElement {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>();
  const resolvedRef = useRef(false);

  const handleSubmit = useCallback(() => {
    if (resolvedRef.current) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    if (validate) {
      const err = validate(trimmed);
      if (err) {
        setError(err);
        return;
      }
    }
    resolvedRef.current = true;
    onSubmit(trimmed);
  }, [value, validate, onSubmit]);

  useInput((input, key) => {
    if (resolvedRef.current) return;
    if (key.escape) {
      resolvedRef.current = true;
      onCancel();
      return;
    }
    if (key.return) {
      handleSubmit();
      return;
    }
    if (key.backspace || key.delete) {
      setValue((prev) => prev.slice(0, -1));
      setError(undefined);
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setValue((prev) => prev + input);
      setError(undefined);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow" bold>
        {title}
      </Text>
      <Box marginTop={1}>
        <Text color="cyan">&gt; </Text>
        <Text>{value || (placeholder ? <Text dimColor>{placeholder}</Text> : '')}</Text>
        <Text color="cyan">█</Text>
      </Box>
      {error && (
        <Text color="red">{error}</Text>
      )}
      <Text dimColor> Enter Submit  Esc Cancel</Text>
    </Box>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @robota-sdk/agent-cli test -- --run src/ui/__tests__/TextPrompt.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent-cli/src/ui/TextPrompt.tsx packages/agent-cli/src/ui/__tests__/TextPrompt.test.tsx
git commit -m "feat(agent-cli): add TextPrompt component for plugin TUI"
```

---

### Task 3: ISlashResult + IPluginCallbacks Changes

Extend ISlashResult with `triggerPluginTUI`, extend IPluginCallbacks with `listAvailablePlugins` and scoped `install`, fix `listInstalled` enabled bug.

**Files:**

- Modify: `packages/agent-cli/src/commands/slash-executor.ts`
- Modify: `packages/agent-cli/src/ui/hooks/usePluginCallbacks.ts`
- Modify: `packages/agent-cli/src/commands/__tests__/plugin-commands.test.ts`

- [ ] **Step 1: Write failing tests for new behavior**

Add these tests to the existing test file:

```typescript
// In packages/agent-cli/src/commands/__tests__/plugin-commands.test.ts

// Test: /plugin with no args returns triggerPluginTUI
it('/plugin with no args returns triggerPluginTUI: true', async () => {
  const result = await handlePluginCommand('', addMessage, callbacks);
  expect(result.triggerPluginTUI).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @robota-sdk/agent-cli test -- --run src/commands/__tests__/plugin-commands.test.ts`
Expected: FAIL — triggerPluginTUI is undefined

- [ ] **Step 3: Modify ISlashResult and handlePluginCommand**

In `packages/agent-cli/src/commands/slash-executor.ts`:

1. Add `triggerPluginTUI?: boolean` to `ISlashResult` (search for `interface ISlashResult`):

```typescript
export interface ISlashResult {
  handled: boolean;
  exitRequested?: boolean;
  pendingModelId?: string;
  pendingLanguage?: string;
  triggerPluginTUI?: boolean;
}
```

2. Change the `case '': case undefined:` block in `handlePluginCommand` (search for `case '':`):

```typescript
case '':
case undefined: {
  return { handled: true, triggerPluginTUI: true };
}
```

- [ ] **Step 4: Extend IPluginCallbacks**

In `packages/agent-cli/src/commands/slash-executor.ts`, replace `IPluginCallbacks` (search for `interface IPluginCallbacks`):

```typescript
export interface IPluginCallbacks {
  listInstalled: () => Promise<Array<{ name: string; description: string; enabled: boolean }>>;
  listAvailablePlugins: (marketplace: string) => Promise<
    Array<{
      name: string;
      description: string;
      installed: boolean;
    }>
  >;
  install: (pluginId: string, scope?: 'user' | 'project') => Promise<void>;
  uninstall: (pluginId: string) => Promise<void>;
  enable: (pluginId: string) => Promise<void>;
  disable: (pluginId: string) => Promise<void>;
  marketplaceAdd: (source: string) => Promise<string>;
  marketplaceRemove: (name: string) => Promise<void>;
  marketplaceUpdate: (name: string) => Promise<void>;
  marketplaceList: () => Promise<Array<{ name: string; type: string }>>;
  reloadPlugins: () => Promise<void>;
}
```

- [ ] **Step 5: Update usePluginCallbacks**

In `packages/agent-cli/src/ui/hooks/usePluginCallbacks.ts`:

1. Fix `listInstalled` to return actual enabled state:

```typescript
listInstalled: async () => {
  const plugins = await loader.loadAll();
  const settings = settingsStore.read();
  return plugins.map((p) => ({
    name: p.manifest.name,
    description: p.manifest.description,
    enabled: settings.enabledPlugins[p.manifest.name] !== false,
  }));
},
```

2. Add `listAvailablePlugins` (inside `useMemo` closure, alongside other callbacks):

```typescript
listAvailablePlugins: async (marketplaceName: string) => {
  let manifest;
  try {
    manifest = marketplace.fetchManifest(marketplaceName);
  } catch {
    return []; // marketplace not cloned or manifest missing
  }
  const installed = installer.getInstalledPlugins();
  const installedNames = new Set(
    Object.values(installed).map((r) => r.pluginName),
  );
  return manifest.plugins.map((p) => ({
    name: p.name,
    description: p.description,
    installed: installedNames.has(p.name),
  }));
},
```

3. Add scope support to `install` (inside the existing `useMemo` closure where `cwd` is the hook parameter):

```typescript
install: async (pluginId: string, scope?: 'user' | 'project') => {
  const [name, marketplaceName] = pluginId.split('@');
  if (!name || !marketplaceName) {
    throw new Error('Plugin ID must be in format: name@marketplace');
  }
  if (scope === 'project') {
    const projectPluginsDir = join(cwd, '.robota', 'plugins');
    const projectInstaller = new BundlePluginInstaller({
      pluginsDir: projectPluginsDir,
      settingsStore,
      marketplaceClient: marketplace,
    });
    await projectInstaller.install(name, marketplaceName);
  } else {
    await installer.install(name, marketplaceName);
  }
},
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @robota-sdk/agent-cli test -- --run src/commands/__tests__/plugin-commands.test.ts`
Expected: PASS

- [ ] **Step 7: Build to verify compilation**

Run: `pnpm build`
Expected: All packages build successfully

- [ ] **Step 8: Commit**

```bash
git add packages/agent-cli/src/commands/slash-executor.ts packages/agent-cli/src/ui/hooks/usePluginCallbacks.ts packages/agent-cli/src/commands/__tests__/plugin-commands.test.ts
git commit -m "feat(agent-cli): extend ISlashResult and IPluginCallbacks for TUI"
```

---

### Task 4: PluginTUI Component

Main orchestrator: screen stack, renders current screen, dispatches callbacks.

**Files:**

- Create: `packages/agent-cli/src/ui/PluginTUI.tsx`
- Create: `packages/agent-cli/src/ui/__tests__/PluginTUI.test.tsx`

- [ ] **Step 1: Write failing tests for PluginTUI**

```typescript
// packages/agent-cli/src/ui/__tests__/PluginTUI.test.tsx
import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import PluginTUI from '../PluginTUI.js';
import type { IPluginCallbacks } from '../../commands/slash-executor.js';

function mockCallbacks(): IPluginCallbacks {
  return {
    listInstalled: vi.fn().mockResolvedValue([]),
    listAvailablePlugins: vi.fn().mockResolvedValue([]),
    install: vi.fn().mockResolvedValue(undefined),
    uninstall: vi.fn().mockResolvedValue(undefined),
    enable: vi.fn().mockResolvedValue(undefined),
    disable: vi.fn().mockResolvedValue(undefined),
    marketplaceAdd: vi.fn().mockResolvedValue('test-marketplace'),
    marketplaceRemove: vi.fn().mockResolvedValue(undefined),
    marketplaceUpdate: vi.fn().mockResolvedValue(undefined),
    marketplaceList: vi.fn().mockResolvedValue([]),
    reloadPlugins: vi.fn().mockResolvedValue(undefined),
  };
}

describe('PluginTUI', () => {
  it('renders main menu with Marketplace and Installed Plugins', () => {
    const { lastFrame } = render(
      <PluginTUI callbacks={mockCallbacks()} onClose={() => {}} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Marketplace');
    expect(frame).toContain('Installed Plugins');
  });

  it('calls onClose when Escape on main menu', () => {
    let closed = false;
    const { stdin } = render(
      <PluginTUI callbacks={mockCallbacks()} onClose={() => { closed = true; }} />,
    );
    stdin.write('\x1B');
    expect(closed).toBe(true);
  });

  it('navigates to installed plugins and shows actions', async () => {
    const cbs = mockCallbacks();
    cbs.listInstalled = vi.fn().mockResolvedValue([
      { name: 'my-plugin', description: 'A plugin', enabled: true },
    ]);
    const { stdin, lastFrame } = render(
      <PluginTUI callbacks={cbs} onClose={() => {}} />,
    );
    stdin.write('\x1B[B'); // Down to "Installed Plugins"
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()!).toContain('my-plugin');
    // Select plugin → should show Disable (since enabled)
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()!).toContain('Disable');
    expect(lastFrame()!).toContain('Uninstall');
  });

  it('navigates to marketplace list on Enter', async () => {
    const cbs = mockCallbacks();
    cbs.marketplaceList = vi.fn().mockResolvedValue([
      { name: 'test-mp', type: 'github' },
    ]);
    const { stdin, lastFrame } = render(
      <PluginTUI callbacks={cbs} onClose={() => {}} />,
    );
    stdin.write('\r'); // Enter on "Marketplace"
    // Wait for async marketplace list
    await new Promise((r) => setTimeout(r, 50));
    const frame = lastFrame()!;
    expect(frame).toContain('Add Marketplace');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @robota-sdk/agent-cli test -- --run src/ui/__tests__/PluginTUI.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement PluginTUI**

```typescript
// packages/agent-cli/src/ui/PluginTUI.tsx
/**
 * PluginTUI — interactive menu for managing marketplaces and plugins.
 * Stack-based screen navigation: ESC pops, Enter pushes.
 */

import React, { useState, useCallback, useEffect } from 'react';
import MenuSelect from './MenuSelect.js';
import TextPrompt from './TextPrompt.js';
import ConfirmPrompt from './ConfirmPrompt.js';
import type { IMenuSelectItem } from './MenuSelect.js';
import type { IPluginCallbacks } from '../commands/slash-executor.js';

type TScreenId =
  | 'main'
  | 'marketplace-list'
  | 'marketplace-action'
  | 'marketplace-browse'
  | 'marketplace-install-scope'
  | 'marketplace-add'
  | 'installed-list'
  | 'installed-action';

interface IMenuState {
  screen: TScreenId;
  context?: {
    marketplace?: string;
    pluginId?: string;
    isEnabled?: boolean;
  };
}

interface IProps {
  callbacks: IPluginCallbacks;
  onClose: () => void;
  addMessage?: (msg: { role: string; content: string }) => void;
}

export default function PluginTUI({ callbacks, onClose, addMessage }: IProps): React.ReactElement {
  const [stack, setStack] = useState<IMenuState[]>([{ screen: 'main' }]);
  const [asyncItems, setAsyncItems] = useState<IMenuSelectItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [confirm, setConfirm] = useState<{
    message: string;
    onConfirm: () => Promise<void>;
  } | null>(null);

  const current = stack[stack.length - 1];

  const push = useCallback((state: IMenuState) => {
    setStack((prev) => [...prev, state]);
    setAsyncItems([]);
    setError(undefined);
  }, []);

  const pop = useCallback(() => {
    setStack((prev) => {
      if (prev.length <= 1) {
        onClose();
        return prev;
      }
      return prev.slice(0, -1);
    });
    setAsyncItems([]);
    setError(undefined);
  }, [onClose]);

  const notify = useCallback(
    (content: string) => {
      addMessage?.({ role: 'system', content });
    },
    [addMessage],
  );

  // Fetch data for list screens
  useEffect(() => {
    const screen = current.screen;
    if (screen === 'marketplace-list') {
      setLoading(true);
      callbacks
        .marketplaceList()
        .then((sources) => {
          const items: IMenuSelectItem[] = [
            { label: 'Add Marketplace', value: '__add__' },
            ...sources.map((s) => ({ label: s.name, value: s.name, hint: `(${s.type})` })),
          ];
          setAsyncItems(items);
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setLoading(false));
    } else if (screen === 'marketplace-browse') {
      setLoading(true);
      callbacks
        .listAvailablePlugins(current.context?.marketplace ?? '')
        .then((plugins) => {
          setAsyncItems(
            plugins.map((p) => ({
              label: p.name,
              value: p.name,
              hint: p.installed ? '(installed)' : p.description,
            })),
          );
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setLoading(false));
    } else if (screen === 'installed-list') {
      setLoading(true);
      callbacks
        .listInstalled()
        .then((plugins) => {
          setAsyncItems(
            plugins.map((p) => ({
              label: p.name,
              value: p.name,
              hint: p.enabled ? '(enabled)' : '(disabled)',
            })),
          );
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setLoading(false));
    }
  }, [current.screen, current.context?.marketplace, callbacks]);

  // Confirm prompt overlay
  if (confirm) {
    return (
      <ConfirmPrompt
        message={confirm.message}
        onSelect={async (index) => {
          if (index === 0) {
            try {
              await confirm.onConfirm();
            } catch (e) {
              notify(`Error: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
          setConfirm(null);
          pop();
        }}
      />
    );
  }

  switch (current.screen) {
    case 'main':
      return (
        <MenuSelect
          title="Plugin Manager"
          items={[
            { label: 'Marketplace', value: 'marketplace' },
            { label: 'Installed Plugins', value: 'installed' },
          ]}
          onSelect={(v) => {
            if (v === 'marketplace') push({ screen: 'marketplace-list' });
            else push({ screen: 'installed-list' });
          }}
          onBack={onClose}
        />
      );

    case 'marketplace-list':
      return (
        <MenuSelect
          title="Marketplace"
          items={asyncItems}
          loading={loading}
          error={error}
          onSelect={(v) => {
            if (v === '__add__') push({ screen: 'marketplace-add' });
            else push({ screen: 'marketplace-action', context: { marketplace: v } });
          }}
          onBack={pop}
        />
      );

    case 'marketplace-action':
      return (
        <MenuSelect
          title={`${current.context?.marketplace ?? 'Marketplace'}`}
          items={[
            { label: 'Browse plugins', value: 'browse' },
            { label: 'Update', value: 'update' },
            { label: 'Remove', value: 'remove' },
          ]}
          onSelect={async (v) => {
            const mp = current.context?.marketplace ?? '';
            if (v === 'browse') {
              push({ screen: 'marketplace-browse', context: { marketplace: mp } });
            } else if (v === 'update') {
              try {
                await callbacks.marketplaceUpdate(mp);
                notify(`Updated marketplace "${mp}".`);
              } catch (e) {
                notify(`Error: ${e instanceof Error ? e.message : String(e)}`);
              }
              pop();
            } else if (v === 'remove') {
              setConfirm({
                message: `Remove marketplace "${mp}" and uninstall all its plugins?`,
                onConfirm: async () => {
                  await callbacks.marketplaceRemove(mp);
                  notify(`Removed marketplace "${mp}".`);
                },
              });
            }
          }}
          onBack={pop}
        />
      );

    case 'marketplace-browse':
      return (
        <MenuSelect
          title={`Plugins — ${current.context?.marketplace ?? ''}`}
          items={asyncItems}
          loading={loading}
          error={error}
          onSelect={(pluginName) => {
            const mp = current.context?.marketplace ?? '';
            push({
              screen: 'marketplace-install-scope',
              context: { marketplace: mp, pluginId: `${pluginName}@${mp}` },
            });
          }}
          onBack={pop}
        />
      );

    case 'marketplace-install-scope':
      return (
        <MenuSelect
          title={`Install ${current.context?.pluginId ?? ''}`}
          items={[
            { label: 'User scope', value: 'user', hint: '~/.robota/plugins/' },
            { label: 'Project scope', value: 'project', hint: '.robota/plugins/' },
          ]}
          onSelect={async (scope) => {
            const pluginId = current.context?.pluginId ?? '';
            try {
              await callbacks.install(pluginId, scope as 'user' | 'project');
              notify(`Installed ${pluginId} (${scope} scope).`);
            } catch (e) {
              notify(`Error: ${e instanceof Error ? e.message : String(e)}`);
            }
            // Pop back to browse list
            setStack((prev) => prev.slice(0, -2));
          }}
          onBack={pop}
        />
      );

    case 'marketplace-add':
      return (
        <TextPrompt
          title="Add Marketplace"
          placeholder="owner/repo or git URL"
          validate={(v) => {
            if (!v.includes('/')) return 'Must be owner/repo or a git URL';
            return undefined;
          }}
          onSubmit={async (source) => {
            try {
              const name = await callbacks.marketplaceAdd(source);
              notify(`Added marketplace: "${name}"`);
            } catch (e) {
              notify(`Error: ${e instanceof Error ? e.message : String(e)}`);
            }
            pop();
          }}
          onCancel={pop}
        />
      );

    case 'installed-list':
      return (
        <MenuSelect
          title="Installed Plugins"
          items={asyncItems}
          loading={loading}
          error={error}
          onSelect={(pluginName) => {
            const plugin = asyncItems.find((i) => i.value === pluginName);
            const isEnabled = plugin?.hint === '(enabled)';
            push({ screen: 'installed-action', context: { pluginId: pluginName, isEnabled } });
          }}
          onBack={pop}
        />
      );

    case 'installed-action': {
      const pluginId = current.context?.pluginId ?? '';
      const isEnabled = current.context?.isEnabled ?? false;
      return (
        <MenuSelect
          title={pluginId}
          items={[
            {
              label: isEnabled ? 'Disable' : 'Enable',
              value: isEnabled ? 'disable' : 'enable',
            },
            { label: 'Uninstall', value: 'uninstall' },
          ]}
          onSelect={async (action) => {
            try {
              if (action === 'enable') {
                await callbacks.enable(pluginId);
                notify(`Enabled ${pluginId}.`);
              } else if (action === 'disable') {
                await callbacks.disable(pluginId);
                notify(`Disabled ${pluginId}.`);
              } else if (action === 'uninstall') {
                setConfirm({
                  message: `Uninstall plugin "${pluginId}"?`,
                  onConfirm: async () => {
                    await callbacks.uninstall(pluginId);
                    notify(`Uninstalled ${pluginId}.`);
                  },
                });
                return;
              }
            } catch (e) {
              notify(`Error: ${e instanceof Error ? e.message : String(e)}`);
            }
            pop();
          }}
          onBack={pop}
        />
      );
    }

    default:
      return <MenuSelect title="Error" items={[]} onSelect={() => {}} onBack={pop} error="Unknown screen" />;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @robota-sdk/agent-cli test -- --run src/ui/__tests__/PluginTUI.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent-cli/src/ui/PluginTUI.tsx packages/agent-cli/src/ui/__tests__/PluginTUI.test.tsx
git commit -m "feat(agent-cli): add PluginTUI component with screen stack navigation"
```

---

### Task 5: App.tsx Integration

Wire PluginTUI into App.tsx with showPluginTUI state, useInput guard, and conditional rendering.

**Files:**

- Modify: `packages/agent-cli/src/ui/App.tsx`
- Modify: `packages/agent-cli/src/ui/hooks/useSlashCommands.ts`

- [ ] **Step 1: Read useSlashCommands.ts to understand current slash command handling**

Read: `packages/agent-cli/src/ui/hooks/useSlashCommands.ts`

- [ ] **Step 2: Add showPluginTUI state and TUI rendering to App.tsx**

In `packages/agent-cli/src/ui/App.tsx`:

1. Add import:

```typescript
import PluginTUI from './PluginTUI.js';
```

2. Add state after `pendingModelId`:

```typescript
const [showPluginTUI, setShowPluginTUI] = useState(false);
```

3. Update `useInput` isActive guard (line 111-117):

```typescript
useInput(
  (_input: string, key: { ctrl: boolean; escape: boolean }) => {
    if (key.ctrl && _input === 'c') exit();
    if (key.escape && isThinking) session.abort();
  },
  { isActive: !permissionRequest && !showPluginTUI },
);
```

4. Add PluginTUI rendering before InputArea (line ~167):

```typescript
{showPluginTUI && (
  <PluginTUI
    callbacks={pluginCallbacks}
    onClose={() => setShowPluginTUI(false)}
    addMessage={addMessage}
  />
)}
```

5. Disable InputArea when TUI is open:

```typescript
<InputArea
  onSubmit={handleSubmit}
  isDisabled={isThinking || !!permissionRequest || showPluginTUI}
  registry={registry}
/>
```

- [ ] **Step 3: Wire triggerPluginTUI in useSlashCommands**

In `packages/agent-cli/src/ui/hooks/useSlashCommands.ts`:

1. Add `setShowPluginTUI` parameter to the function signature:

```typescript
export function useSlashCommands(
  session: Session,
  addMessage: (msg: Omit<IChatMessage, 'id' | 'timestamp'>) => void,
  setMessages: React.Dispatch<React.SetStateAction<IChatMessage[]>>,
  exit: () => void,
  registry: CommandRegistry,
  pendingModelChangeRef: React.MutableRefObject<string | null>,
  setPendingModelId: React.Dispatch<React.SetStateAction<string | null>>,
  pluginCallbacks?: IPluginCallbacks,
  setShowPluginTUI?: React.Dispatch<React.SetStateAction<boolean>>,
): (input: string) => Promise<boolean> {
```

2. After `if (result.pendingModelId)` block, add:

```typescript
if (result.triggerPluginTUI) {
  setShowPluginTUI?.(true);
}
```

3. Add `setShowPluginTUI` to the `useCallback` deps array.

4. In `App.tsx`, update the `useSlashCommands` call to pass `setShowPluginTUI`:

```typescript
const handleSlashCommand = useSlashCommands(
  session,
  addMessage,
  setMessages,
  exit,
  registry,
  pendingModelChangeRef,
  setPendingModelId,
  pluginCallbacks,
  setShowPluginTUI,
);
```

- [ ] **Step 4: Build to verify compilation**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm --filter @robota-sdk/agent-cli test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/agent-cli/src/ui/App.tsx packages/agent-cli/src/ui/hooks/useSlashCommands.ts
git commit -m "feat(agent-cli): integrate PluginTUI into App with showPluginTUI state"
```

---

### Task 6: End-to-End Verification and Build

Final build, full test suite, manual verification.

**Files:**

- No new files

- [ ] **Step 1: Build all packages**

Run: `pnpm build`
Expected: All packages build successfully

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: No type errors

- [ ] **Step 4: Manual verification checklist**

Test locally with `npx @robota-sdk/agent-cli`:

1. `/plugin` opens TUI with Marketplace / Installed Plugins
2. ESC on main menu closes TUI
3. Marketplace → shows Add Marketplace + registered marketplaces
4. Add Marketplace → text input → validates → adds
5. Select marketplace → Browse plugins / Update / Remove
6. Browse → plugin list → Install → scope select → installs
7. Update → updates marketplace → returns
8. Remove → confirm → removes
9. Installed Plugins → lists with enabled/disabled → Enable/Disable/Uninstall
10. `/plugin install name@mp` still works (text subcommand preserved)

- [ ] **Step 5: Commit if any fixes needed**

Stage only the specific files that were fixed, then commit:

```bash
git commit -m "fix(agent-cli): plugin TUI fixes from manual testing"
```

## 검증

- 구현 완료 후 관련 패키지 빌드 성공 확인
- 연관 유닛 테스트 통과 확인
- typecheck 및 lint 에러 없음 확인
