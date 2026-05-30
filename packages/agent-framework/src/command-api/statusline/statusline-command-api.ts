import { readSettings, writeSettings } from '../../config/settings-io.js';

import type { TSettingsData } from '../../config/settings-io.js';
import type { ICommand } from '../types.js';
import type { TUniversalValue } from '@robota-sdk/agent-core';

export const STATUSLINE_COMMAND_DESCRIPTION =
  'Configure TUI status-line visibility and fields such as model, context, tokens, session, and git branch.';
export const STATUSLINE_COMMAND_ARGUMENT_HINT = 'on | off | reset | git on | git off';

export interface IStatusLineCommandSettings {
  enabled: boolean;
  gitBranch: boolean;
}

export type TStatusLineCommandSettingsPatch = Partial<IStatusLineCommandSettings> &
  Record<string, TUniversalValue>;

export const DEFAULT_STATUS_LINE_COMMAND_SETTINGS: Readonly<IStatusLineCommandSettings> = {
  enabled: true,
  gitBranch: true,
};

export function buildStatusLineCommandSubcommands(source = 'statusline'): ICommand[] {
  return [
    { name: 'on', description: 'Show the status line', source },
    { name: 'off', description: 'Hide the status line', source },
    { name: 'reset', description: 'Restore default status-line fields', source },
    { name: 'git', description: 'Show or hide git branch field', source },
  ];
}

export function isStatusLineCommandSettingsPatch(
  value: Record<string, TUniversalValue>,
): value is TStatusLineCommandSettingsPatch {
  return (
    (value.enabled === undefined || typeof value.enabled === 'boolean') &&
    (value.gitBranch === undefined || typeof value.gitBranch === 'boolean')
  );
}

export function readStatusLineSettings(settings: TSettingsData): IStatusLineCommandSettings {
  const raw = settings.statusline;
  if (!isRecord(raw)) {
    return { ...DEFAULT_STATUS_LINE_COMMAND_SETTINGS };
  }
  return {
    enabled:
      typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_STATUS_LINE_COMMAND_SETTINGS.enabled,
    gitBranch:
      typeof raw.gitBranch === 'boolean'
        ? raw.gitBranch
        : DEFAULT_STATUS_LINE_COMMAND_SETTINGS.gitBranch,
  };
}

export function applyStatusLineSettings(
  settingsPath: string,
  patch: TStatusLineCommandSettingsPatch,
): IStatusLineCommandSettings {
  const settings = readSettings(settingsPath);
  const next = {
    ...readStatusLineSettings(settings),
    ...patch,
  };
  settings.statusline = next as TSettingsData;
  writeSettings(settingsPath, settings);
  return next;
}

function isRecord(value: TUniversalValue): value is Record<string, TUniversalValue> {
  return (
    value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
  );
}
