/**
 * Hook: uses the host plugin adapter, or an explicit unsupported adapter when none is provided.
 *
 * A missing host capability must fail visibly. Returning successful no-ops would make the plugin
 * screen claim mutations succeeded while changing nothing.
 */

import { useMemo } from 'react';

import type { ICommandPluginAdapter } from '@robota-sdk/agent-interface-command';

function unsupported(): Promise<never> {
  return Promise.reject(new Error('Plugin management is unavailable in this host.'));
}

function createUnsupportedPluginAdapter(): ICommandPluginAdapter {
  return {
    listInstalled: unsupported,
    listAvailablePlugins: unsupported,
    install: unsupported,
    uninstall: unsupported,
    enable: unsupported,
    disable: unsupported,
    marketplaceAdd: unsupported,
    marketplaceRemove: unsupported,
    marketplaceUpdate: unsupported,
    marketplaceList: unsupported,
    reloadPlugins: unsupported,
  };
}

export function resolvePluginCallbacks(adapter?: ICommandPluginAdapter): ICommandPluginAdapter {
  return adapter ?? createUnsupportedPluginAdapter();
}

export function usePluginCallbacks(adapter?: ICommandPluginAdapter): ICommandPluginAdapter {
  return useMemo(() => resolvePluginCallbacks(adapter), [adapter]);
}
