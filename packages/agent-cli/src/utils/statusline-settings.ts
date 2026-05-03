import type { TUniversalValue } from '@robota-sdk/agent-core';
import type {
  IStatusLineCommandSettings,
  TStatusLineCommandSettingsPatch,
} from '@robota-sdk/agent-sdk';
import { DEFAULT_STATUS_LINE_COMMAND_SETTINGS } from '@robota-sdk/agent-sdk';
import type { TSettingsData } from './settings-io.js';
import { readSettings, writeSettings } from './settings-io.js';

export type IStatusLineSettings = IStatusLineCommandSettings;
export type TStatusLineSettingsPatch = TStatusLineCommandSettingsPatch;

const DEFAULT_STATUS_LINE_SETTINGS: IStatusLineSettings = {
  ...DEFAULT_STATUS_LINE_COMMAND_SETTINGS,
};

export function readStatusLineSettings(settings: TSettingsData): IStatusLineSettings {
  const raw = settings.statusline;
  if (!isRecord(raw)) {
    return { ...DEFAULT_STATUS_LINE_SETTINGS };
  }

  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_STATUS_LINE_SETTINGS.enabled,
    gitBranch:
      typeof raw.gitBranch === 'boolean' ? raw.gitBranch : DEFAULT_STATUS_LINE_SETTINGS.gitBranch,
  };
}

export function applyStatusLineSettings(
  settingsPath: string,
  patch: TStatusLineSettingsPatch,
): IStatusLineSettings {
  const settings = readSettings(settingsPath);
  const next = {
    ...readStatusLineSettings(settings),
    ...patch,
  };
  settings.statusline = next;
  writeSettings(settingsPath, settings);
  return next;
}

function isRecord(value: TUniversalValue): value is Record<string, TUniversalValue> {
  return (
    value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
  );
}
