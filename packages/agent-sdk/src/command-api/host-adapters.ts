import type { TPermissionMode, TSessionEndReason, TUniversalValue } from '@robota-sdk/agent-core';
import type { ICommandPluginAdapter } from './plugin/plugin-command-api.js';

export interface ICommandSettingsDocument {
  [key: string]: TUniversalValue;
}

export interface ICommandSettingsAdapter<
  TSettings extends ICommandSettingsDocument = ICommandSettingsDocument,
> {
  read(): TSettings;
  write(settings: TSettings): void;
}

export interface ICommandProcessAdapter {
  requestExit(reason?: TSessionEndReason): void;
  requestRestart(reason: TSessionEndReason, message: string): void;
}

export interface ICommandPickerAdapter<TItem extends ICommandSettingsDocument> {
  pick(items: readonly TItem[]): Promise<TItem | undefined> | TItem | undefined;
}

export interface ICommandPermissionModeAdapter {
  getPermissionMode(): TPermissionMode;
  setPermissionMode(mode: TPermissionMode): void;
  listSessionAllowedTools(): readonly string[];
}

export interface ICommandHostAdapters {
  settings?: ICommandSettingsAdapter;
  process?: ICommandProcessAdapter;
  permissionMode?: ICommandPermissionModeAdapter;
  plugin?: ICommandPluginAdapter;
}
