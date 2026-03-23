/**
 * PluginTUI — Main orchestrator component for plugin management.
 * Manages a stack of screens: main, marketplace, installed plugins, etc.
 */

import React, { useState, useEffect, useCallback } from 'react';
import MenuSelect from './MenuSelect.js';
import TextPrompt from './TextPrompt.js';
import ConfirmPrompt from './ConfirmPrompt.js';
import {
  handleMainSelect,
  handleMarketplaceListSelect,
  handleMarketplaceActionSelect,
  handleMarketplaceBrowseSelect,
  handleInstallScopeSelect,
  handleInstalledListSelect,
  handleInstalledActionSelect,
} from './plugin-tui-handlers.js';
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

interface IMenuContext {
  marketplace?: string;
  pluginId?: string;
}

interface IMenuState {
  screen: TScreenId;
  context?: IMenuContext;
}

interface IConfirmState {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

interface IProps {
  callbacks: IPluginCallbacks;
  onClose: () => void;
  addMessage?: (msg: { role: string; content: string }) => void;
}

export default function PluginTUI({ callbacks, onClose, addMessage }: IProps): React.ReactElement {
  const [stack, setStack] = useState<IMenuState[]>([{ screen: 'main' }]);
  const [items, setItems] = useState<IMenuSelectItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [confirm, setConfirm] = useState<IConfirmState | undefined>();
  const [refreshCounter, setRefreshCounter] = useState(0);

  const current = stack[stack.length - 1] ?? { screen: 'main' };

  const push = useCallback((state: IMenuState) => {
    setStack((prev) => [...prev, state]);
    setItems([]);
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
    setItems([]);
    setError(undefined);
  }, [onClose]);

  const popN = useCallback(
    (n: number) => {
      setStack((prev) => {
        const next = prev.slice(0, Math.max(1, prev.length - n));
        if (next.length === 0) {
          onClose();
          return prev;
        }
        return next;
      });
      setItems([]);
      setError(undefined);
    },
    [onClose],
  );

  const notify = useCallback(
    (content: string) => {
      addMessage?.({ role: 'system', content });
    },
    [addMessage],
  );

  const refresh = useCallback(() => {
    setItems([]);
    setRefreshCounter((c) => c + 1);
  }, []);

  const nav = { push, pop, popN, notify, setConfirm, refresh };

  // Fetch data when screen or refreshCounter changes
  useEffect(() => {
    const screen = current.screen;

    if (screen === 'marketplace-list') {
      setLoading(true);
      callbacks
        .marketplaceList()
        .then((sources) => {
          const baseItems: IMenuSelectItem[] = [{ label: 'Add Marketplace', value: '__add__' }];
          const sourceItems: IMenuSelectItem[] = sources.map((s) => ({
            label: s.name,
            value: s.name,
            hint: s.type,
          }));
          setItems([...baseItems, ...sourceItems]);
          setLoading(false);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        });
    } else if (screen === 'marketplace-browse') {
      const marketplace = current.context?.marketplace ?? '';
      setLoading(true);
      callbacks
        .listAvailablePlugins(marketplace)
        .then((plugins) => {
          setItems(
            plugins.map((p) => ({
              label: p.name,
              value: p.name,
              hint: p.installed ? 'installed' : p.description,
            })),
          );
          setLoading(false);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        });
    } else if (screen === 'installed-list') {
      setLoading(true);
      callbacks
        .listInstalled()
        .then((plugins) => {
          setItems(
            plugins.map((p) => ({
              label: p.name,
              value: p.name,
              hint: p.description,
            })),
          );
          setLoading(false);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        });
    }
  }, [stack.length, current.screen, current.context?.marketplace, callbacks, refreshCounter]);

  const handleSelect = useCallback(
    (value: string) => {
      const screen = current.screen;
      const ctx = current.context;

      if (screen === 'main') handleMainSelect(value, nav);
      else if (screen === 'marketplace-list') handleMarketplaceListSelect(value, nav);
      else if (screen === 'marketplace-action')
        handleMarketplaceActionSelect(value, ctx?.marketplace ?? '', callbacks, nav);
      else if (screen === 'marketplace-browse')
        handleMarketplaceBrowseSelect(value, ctx?.marketplace ?? '', items, nav);
      else if (screen === 'marketplace-install-scope')
        handleInstallScopeSelect(value, ctx?.pluginId ?? '', callbacks, nav);
      else if (screen === 'installed-list') handleInstalledListSelect(value, callbacks, nav);
      else if (screen === 'installed-action')
        handleInstalledActionSelect(value, ctx?.pluginId ?? '', callbacks, nav);
    },
    [current, items, callbacks, push, pop, popN, notify, setConfirm, refresh],
  );

  const handleTextSubmit = useCallback(
    (value: string) => {
      if (current.screen === 'marketplace-add') {
        callbacks
          .marketplaceAdd(value)
          .then((name) => {
            notify(`Added marketplace "${name}" from ${value}.`);
            pop();
          })
          .catch((err: unknown) => {
            notify(`Error: ${err instanceof Error ? err.message : String(err)}`);
            pop();
          });
      }
    },
    [current.screen, callbacks, notify, pop],
  );

  // Confirm overlay intercepts everything
  if (confirm) {
    return (
      <ConfirmPrompt
        message={confirm.message}
        onSelect={(index) => {
          if (index === 0) confirm.onConfirm();
          else confirm.onCancel();
        }}
      />
    );
  }

  const screen = current.screen;

  if (screen === 'marketplace-add') {
    return (
      <TextPrompt
        title="Add Marketplace Source"
        placeholder="owner/repo or git URL"
        onSubmit={handleTextSubmit}
        onCancel={pop}
        validate={(v) => (!v.includes('/') ? 'Must be owner/repo or a git URL' : undefined)}
      />
    );
  }

  if (screen === 'marketplace-action') {
    return (
      <MenuSelect
        key={stack.length}
        title={`Marketplace: ${current.context?.marketplace ?? ''}`}
        items={[
          { label: 'Browse plugins', value: 'browse' },
          { label: 'Update', value: 'update' },
          { label: 'Remove', value: 'remove' },
        ]}
        onSelect={handleSelect}
        onBack={pop}
      />
    );
  }

  if (screen === 'marketplace-install-scope') {
    return (
      <MenuSelect
        key={stack.length}
        title={`Install scope for "${current.context?.pluginId ?? ''}"`}
        items={[
          { label: 'User scope', value: 'user' },
          { label: 'Project scope', value: 'project' },
        ]}
        onSelect={handleSelect}
        onBack={pop}
      />
    );
  }

  if (screen === 'installed-action') {
    return (
      <MenuSelect
        key={stack.length}
        title={`Plugin: ${current.context?.pluginId ?? ''}`}
        items={[{ label: 'Uninstall', value: 'uninstall' }]}
        onSelect={handleSelect}
        onBack={pop}
      />
    );
  }

  // Screens with async items: main, marketplace-list, marketplace-browse, installed-list
  const titleMap: Record<string, string> = {
    main: 'Plugin Management',
    'marketplace-list': 'Marketplace',
    'marketplace-browse': `Browse: ${current.context?.marketplace ?? ''}`,
    'installed-list': 'Installed Plugins',
  };

  const staticItemsMap: Record<string, IMenuSelectItem[]> = {
    main: [
      { label: 'Marketplace', value: 'marketplace' },
      { label: 'Installed Plugins', value: 'installed' },
    ],
  };

  return (
    <MenuSelect
      key={`${screen}-${stack.length}-${refreshCounter}`}
      title={titleMap[screen] ?? 'Plugin Management'}
      items={staticItemsMap[screen] ?? items}
      onSelect={handleSelect}
      onBack={pop}
      loading={loading}
      error={error}
    />
  );
}
