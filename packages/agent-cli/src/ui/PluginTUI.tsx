/**
 * PluginTUI — Main orchestrator component for plugin management.
 * Manages a stack of screens: main, marketplace, installed plugins, etc.
 */

import React, { useState, useEffect, useCallback } from 'react';
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

interface IMenuContext {
  marketplace?: string;
  pluginId?: string;
  isEnabled?: boolean;
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

  // Fetch data when screen changes
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
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          setLoading(false);
        });
    } else if (screen === 'marketplace-browse') {
      const marketplace = current.context?.marketplace ?? '';
      setLoading(true);
      callbacks
        .listAvailablePlugins(marketplace)
        .then((plugins) => {
          if (plugins.length === 0) {
            setItems([]);
            setLoading(false);
            return;
          }
          const pluginItems: IMenuSelectItem[] = plugins.map((p) => ({
            label: p.name,
            value: p.name,
            hint: p.installed ? 'installed' : p.description,
          }));
          setItems(pluginItems);
          setLoading(false);
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          setLoading(false);
        });
    } else if (screen === 'installed-list') {
      setLoading(true);
      callbacks
        .listInstalled()
        .then((plugins) => {
          if (plugins.length === 0) {
            setItems([]);
            setLoading(false);
            return;
          }
          const pluginItems: IMenuSelectItem[] = plugins.map((p) => ({
            label: p.name,
            value: p.name,
            hint: p.enabled ? 'enabled' : 'disabled',
          }));
          setItems(pluginItems);
          setLoading(false);
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          setLoading(false);
        });
    }
  }, [stack.length, current.screen, current.context?.marketplace, callbacks]);

  const handleSelect = useCallback(
    (value: string) => {
      const screen = current.screen;

      if (screen === 'main') {
        if (value === 'marketplace') {
          push({ screen: 'marketplace-list' });
        } else if (value === 'installed') {
          push({ screen: 'installed-list' });
        }
        return;
      }

      if (screen === 'marketplace-list') {
        if (value === '__add__') {
          push({ screen: 'marketplace-add' });
        } else {
          // Navigate to marketplace action with this marketplace
          push({ screen: 'marketplace-action', context: { marketplace: value } });
        }
        return;
      }

      if (screen === 'marketplace-action') {
        const marketplace = current.context?.marketplace ?? '';
        if (value === 'browse') {
          push({ screen: 'marketplace-browse', context: { marketplace } });
        } else if (value === 'update') {
          callbacks
            .marketplaceUpdate(marketplace)
            .then(() => {
              notify(`Updated marketplace "${marketplace}".`);
              pop();
            })
            .catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              notify(`Error updating marketplace: ${msg}`);
            });
        } else if (value === 'remove') {
          setConfirm({
            message: `Remove marketplace "${marketplace}" and all its plugins?`,
            onConfirm: () => {
              setConfirm(undefined);
              callbacks
                .marketplaceRemove(marketplace)
                .then(() => {
                  notify(`Removed marketplace "${marketplace}".`);
                  popN(2); // back to marketplace-list
                })
                .catch((err: unknown) => {
                  const msg = err instanceof Error ? err.message : String(err);
                  notify(`Error removing marketplace: ${msg}`);
                });
            },
            onCancel: () => setConfirm(undefined),
          });
        }
        return;
      }

      if (screen === 'marketplace-browse') {
        const marketplace = current.context?.marketplace ?? '';
        push({ screen: 'marketplace-install-scope', context: { marketplace, pluginId: value } });
        return;
      }

      if (screen === 'marketplace-install-scope') {
        const pluginId = current.context?.pluginId ?? '';
        const scope = value as 'user' | 'project';
        callbacks
          .install(pluginId, scope)
          .then(() => {
            notify(`Installed plugin "${pluginId}" (${scope} scope).`);
            popN(2); // skip browse, return to marketplace-action
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            notify(`Error installing plugin: ${msg}`);
          });
        return;
      }

      if (screen === 'installed-list') {
        // Find isEnabled from items hint
        const item = items.find((i) => i.value === value);
        const isEnabled = item?.hint === 'enabled';
        push({ screen: 'installed-action', context: { pluginId: value, isEnabled } });
        return;
      }

      if (screen === 'installed-action') {
        const pluginId = current.context?.pluginId ?? '';
        const isEnabled = current.context?.isEnabled ?? false;

        if (value === 'toggle') {
          const action = isEnabled ? callbacks.disable : callbacks.enable;
          action(pluginId)
            .then(() => {
              notify(`${isEnabled ? 'Disabled' : 'Enabled'} plugin "${pluginId}".`);
              pop();
            })
            .catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              notify(`Error toggling plugin: ${msg}`);
            });
        } else if (value === 'uninstall') {
          setConfirm({
            message: `Uninstall plugin "${pluginId}"?`,
            onConfirm: () => {
              setConfirm(undefined);
              callbacks
                .uninstall(pluginId)
                .then(() => {
                  notify(`Uninstalled plugin "${pluginId}".`);
                  popN(2); // back to installed-list
                })
                .catch((err: unknown) => {
                  const msg = err instanceof Error ? err.message : String(err);
                  notify(`Error uninstalling plugin: ${msg}`);
                });
            },
            onCancel: () => setConfirm(undefined),
          });
        }
        return;
      }
    },
    [current, items, callbacks, push, pop, popN, notify],
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
            const msg = err instanceof Error ? err.message : String(err);
            notify(`Error adding marketplace: ${msg}`);
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
          if (index === 0) {
            confirm.onConfirm();
          } else {
            confirm.onCancel();
          }
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
    const marketplace = current.context?.marketplace ?? '';
    return (
      <MenuSelect
        title={`Marketplace: ${marketplace}`}
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
    const pluginId = current.context?.pluginId ?? '';
    return (
      <MenuSelect
        title={`Install scope for "${pluginId}"`}
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
    const pluginId = current.context?.pluginId ?? '';
    const isEnabled = current.context?.isEnabled ?? false;
    return (
      <MenuSelect
        title={`Plugin: ${pluginId}`}
        items={[
          { label: isEnabled ? 'Disable' : 'Enable', value: 'toggle' },
          { label: 'Uninstall', value: 'uninstall' },
        ]}
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

  const displayItems = staticItemsMap[screen] ?? items;
  const title = titleMap[screen] ?? 'Plugin Management';

  return (
    <MenuSelect
      key={screen}
      title={title}
      items={displayItems}
      onSelect={handleSelect}
      onBack={pop}
      loading={loading}
      error={error}
    />
  );
}
