import { useState } from 'react';
import type { IStatusLineCommandSettings } from '@robota-sdk/agent-sdk';
import { DEFAULT_STATUS_LINE_COMMAND_SETTINGS } from '@robota-sdk/agent-sdk';
import { useTuiCliAdapter } from '../tui-cli-adapter-context.js';
import type { TUniversalValue } from '@robota-sdk/agent-core';

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

export function useStatusLineSettings(): [
  IStatusLineCommandSettings,
  (settings: IStatusLineCommandSettings) => void,
] {
  const cliAdapter = useTuiCliAdapter();
  return useState<IStatusLineCommandSettings>(() =>
    readStatusLineSettings(cliAdapter.readSettings(cliAdapter.getUserSettingsPath())),
  );
}
