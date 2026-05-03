/**
 * Hook: create ICommandPluginAdapter wired to real SDK instances.
 * All plugin components share a single PluginSettingsStore.
 */

import { useMemo } from 'react';
import type { ICommandPluginAdapter } from '@robota-sdk/agent-sdk';
import { createCliPluginCommandAdapter } from '../../plugins/plugin-command-adapter.js';

export function usePluginCallbacks(cwd: string): ICommandPluginAdapter {
  return useMemo(() => createCliPluginCommandAdapter(cwd), [cwd]);
}
