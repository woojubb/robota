/**
 * Hook: returns a no-op ICommandPluginAdapter for when no plugin adapter is provided.
 *
 * In normal usage, App receives commandHostAdapters.plugin from the CLI (agent-cli), which
 * constructs the real adapter. This fallback exists only for test environments where no adapter
 * is injected.
 */

import { useMemo } from 'react';
import type { ICommandPluginAdapter } from '@robota-sdk/agent-sdk';

function createNoOpPluginAdapter(): ICommandPluginAdapter {
  return {
    listInstalled: async () => [],
    listAvailablePlugins: async () => [],
    install: async () => undefined,
    uninstall: async () => undefined,
    enable: async () => undefined,
    disable: async () => undefined,
    marketplaceAdd: async () => '',
    marketplaceRemove: async () => undefined,
    marketplaceUpdate: async () => undefined,
    marketplaceList: async () => [],
    reloadPlugins: async () => ({ loadedPluginCount: 0 }),
  };
}

export function usePluginCallbacks(_cwd: string): ICommandPluginAdapter {
  return useMemo(() => createNoOpPluginAdapter(), []);
}
