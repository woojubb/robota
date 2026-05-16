import type { TUniversalValue } from '@robota-sdk/agent-core';
import type { ICommand } from '../types.js';

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
