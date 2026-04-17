/**
 * PluginTUI — Main orchestrator component for plugin management.
 * Manages a stack of screens: main, marketplace, installed plugins, etc.
 */

import React, { useState, useCallback } from 'react';
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
import { usePluginScreenData } from './hooks/usePluginScreenData.js';

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
  const [confirm, setConfirm] = useState<IConfirmState | undefined>();
  const [refreshCounter, setRefreshCounter] = useState(0);

  const current = stack[stack.length - 1] ?? { screen: 'main' };

  const push = useCallback((state: IMenuState) => {
    setStack((prev) => [...prev, state]);
  }, []);

  const pop = useCallback(() => {
    setStack((prev) => {
      if (prev.length <= 1) {
        onClose();
        return prev;
      }
      return prev.slice(0, -1);
    });
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
    setRefreshCounter((c) => c + 1);
  }, []);

  const setConfirmNav = useCallback(
    (state: IConfirmState | undefined) => setConfirm(state),
    [setConfirm],
  );
  // nav.push accepts a loose { screen: string } shape to satisfy plugin-tui-handlers types;
  // we cast screen to TScreenId which is safe because handlers only push valid screen names.
  const pushNav = useCallback(
    (state: { screen: string; context?: IMenuContext }) =>
      push({ screen: state.screen as TScreenId, context: state.context }),
    [push],
  );
  const nav = { push: pushNav, pop, popN, notify, setConfirm: setConfirmNav, refresh };

  const { items, loading, error } = usePluginScreenData(
    current.screen,
    current.context?.marketplace,
    callbacks,
    refreshCounter,
    stack.length,
  );

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
