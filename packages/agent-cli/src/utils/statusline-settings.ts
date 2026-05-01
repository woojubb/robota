import type { TUniversalValue } from '@robota-sdk/agent-core';
import type { TSettingsData } from './settings-io.js';
import { readSettings, writeSettings } from './settings-io.js';

export interface IStatusLineSettings {
  enabled: boolean;
  gitBranch: boolean;
}

export type TStatusLineSettingsPatch = Partial<IStatusLineSettings>;

const DEFAULT_STATUS_LINE_SETTINGS: IStatusLineSettings = {
  enabled: true,
  gitBranch: true,
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
