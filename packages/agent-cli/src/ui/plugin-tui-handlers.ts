/**
 * Screen-specific selection handlers for PluginTUI.
 * Extracted to keep PluginTUI.tsx under 300 lines.
 */

import type { IMenuSelectItem } from './MenuSelect.js';
import type { IPluginCallbacks } from '../commands/slash-executor.js';

interface IConfirmState {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

interface IMenuContext {
  marketplace?: string;
  pluginId?: string;
}

interface INavActions {
  push: (state: { screen: string; context?: IMenuContext }) => void;
  pop: () => void;
  popN: (n: number) => void;
  notify: (content: string) => void;
  setConfirm: (state: IConfirmState | undefined) => void;
  refresh: () => void;
}

export function handleMainSelect(value: string, nav: Pick<INavActions, 'push'>): void {
  if (value === 'marketplace') {
    nav.push({ screen: 'marketplace-list' });
  } else if (value === 'installed') {
    nav.push({ screen: 'installed-list' });
  }
}

export function handleMarketplaceListSelect(value: string, nav: Pick<INavActions, 'push'>): void {
  if (value === '__add__') {
    nav.push({ screen: 'marketplace-add' });
  } else {
    nav.push({ screen: 'marketplace-action', context: { marketplace: value } });
  }
}

export function handleMarketplaceActionSelect(
  value: string,
  marketplace: string,
  callbacks: IPluginCallbacks,
  nav: Pick<INavActions, 'push' | 'pop' | 'popN' | 'notify' | 'setConfirm'>,
): void {
  if (value === 'browse') {
    nav.push({ screen: 'marketplace-browse', context: { marketplace } });
  } else if (value === 'update') {
    callbacks
      .marketplaceUpdate(marketplace)
      .then(() => {
        nav.notify(`Updated marketplace "${marketplace}".`);
        nav.pop();
      })
      .catch((err: unknown) => {
        nav.notify(`Error: ${err instanceof Error ? err.message : String(err)}`);
      });
  } else if (value === 'remove') {
    nav.setConfirm({
      message: `Remove marketplace "${marketplace}" and all its plugins?`,
      onConfirm: () => {
        nav.setConfirm(undefined);
        callbacks
          .marketplaceRemove(marketplace)
          .then(() => {
            nav.notify(`Removed marketplace "${marketplace}".`);
            nav.popN(2);
          })
          .catch((err: unknown) => {
            nav.notify(`Error: ${err instanceof Error ? err.message : String(err)}`);
          });
      },
      onCancel: () => nav.setConfirm(undefined),
    });
  }
}

export function handleMarketplaceBrowseSelect(
  value: string,
  marketplace: string,
  items: IMenuSelectItem[],
  nav: Pick<INavActions, 'push'>,
): void {
  const fullId = `${value}@${marketplace}`;
  const item = items.find((i) => i.value === value);
  if (item?.hint === 'installed') {
    nav.push({ screen: 'installed-action', context: { pluginId: fullId } });
  } else {
    nav.push({ screen: 'marketplace-install-scope', context: { marketplace, pluginId: fullId } });
  }
}

export function handleInstallScopeSelect(
  value: string,
  pluginId: string,
  callbacks: IPluginCallbacks,
  nav: Pick<INavActions, 'popN' | 'notify'>,
): void {
  const scope = value as 'user' | 'project';
  callbacks
    .install(pluginId, scope)
    .then(() => {
      nav.notify(`Installed plugin "${pluginId}" (${scope} scope).`);
      nav.popN(2);
    })
    .catch((err: unknown) => {
      nav.notify(`Error: ${err instanceof Error ? err.message : String(err)}`);
    });
}

export function handleInstalledListSelect(
  value: string,
  callbacks: IPluginCallbacks,
  nav: Pick<INavActions, 'notify' | 'setConfirm' | 'refresh'>,
): void {
  nav.setConfirm({
    message: `Uninstall plugin "${value}"?`,
    onConfirm: () => {
      nav.setConfirm(undefined);
      callbacks
        .uninstall(value)
        .then(() => {
          nav.notify(`Uninstalled plugin "${value}".`);
          nav.refresh();
        })
        .catch((err: unknown) => {
          nav.notify(`Error: ${err instanceof Error ? err.message : String(err)}`);
        });
    },
    onCancel: () => nav.setConfirm(undefined),
  });
}

export function handleInstalledActionSelect(
  value: string,
  pluginId: string,
  callbacks: IPluginCallbacks,
  nav: Pick<INavActions, 'popN' | 'notify' | 'setConfirm'>,
): void {
  if (value === 'uninstall') {
    nav.setConfirm({
      message: `Uninstall plugin "${pluginId}"?`,
      onConfirm: () => {
        nav.setConfirm(undefined);
        callbacks
          .uninstall(pluginId)
          .then(() => {
            nav.notify(`Uninstalled plugin "${pluginId}".`);
            nav.popN(2);
          })
          .catch((err: unknown) => {
            nav.notify(`Error: ${err instanceof Error ? err.message : String(err)}`);
          });
      },
      onCancel: () => nav.setConfirm(undefined),
    });
  }
}
