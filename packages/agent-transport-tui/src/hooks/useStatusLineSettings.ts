import { DEFAULT_STATUS_LINE_COMMAND_SETTINGS } from '@robota-sdk/agent-framework';
import { useCallback, useState } from 'react';

import { useTuiCliAdapter } from '../tui-cli-adapter-context.js';

import type { ITuiCliAdapter } from '../tui-cli-adapter.js';
import type { TUniversalValue } from '@robota-sdk/agent-core';
import type { IStatusLineCommandSettings } from '@robota-sdk/agent-interface-transport';

function readStatusLineSettings(
  settings: Record<string, TUniversalValue>,
): IStatusLineCommandSettings {
  const defaults = { ...DEFAULT_STATUS_LINE_COMMAND_SETTINGS };
  const raw = settings.statusline;
  if (!isRecord(raw)) {
    return defaults;
  }
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : defaults.enabled,
    gitBranch: typeof raw.gitBranch === 'boolean' ? raw.gitBranch : defaults.gitBranch,
  };
}

function isRecord(value: TUniversalValue): value is Record<string, TUniversalValue> {
  return (
    value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
  );
}

function readFromAdapter(cliAdapter: ITuiCliAdapter): IStatusLineCommandSettings {
  return readStatusLineSettings(cliAdapter.readSettings(cliAdapter.getUserSettingsPath()));
}

/**
 * Statusline settings as persisted on disk, plus a from-disk `refresh()`.
 *
 * CMD-004 Phase 2 Stage C: the HOST applies `statusline-settings-patch` via the settings adapter
 * (the TUI no longer writes settings), so the renderer refreshes by RE-READING the persisted
 * document when a command result arrives (refresh-on-result).
 */
export function useStatusLineSettings(): [IStatusLineCommandSettings, () => void] {
  const cliAdapter = useTuiCliAdapter();
  const [settings, setSettings] = useState<IStatusLineCommandSettings>(() =>
    readFromAdapter(cliAdapter),
  );
  const refresh = useCallback((): void => {
    setSettings(readFromAdapter(cliAdapter));
  }, [cliAdapter]);
  return [settings, refresh];
}
