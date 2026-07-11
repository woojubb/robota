import type { ICommandPluginAdapter } from './plugin/plugin-command-api.js';
import type { TPermissionMode, TSessionEndReason, TUniversalValue } from '@robota-sdk/agent-core';

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

/**
 * REMOTE-008: read-only view of `/remote-control` state, so the command can report status without
 * touching the transport. The enable/disable actions go through `TCommandEffect` (host-wired to the
 * composition root); only the status query is exposed here (mirrors the `permissionMode` query adapter).
 */
export type TRemoteControlStatus =
  | { readonly state: 'off' }
  | { readonly state: 'no-relay' }
  | { readonly state: 'awaiting-pairing'; readonly pairingUrl: string }
  | { readonly state: 'paired' };

/** A trusted device summary for `/remote-control devices` (public data only; REMOTE-012 E3). */
export interface IRemoteTrustedDeviceSummary {
  readonly deviceId: string;
  readonly label: string;
  readonly lastSeenAt: string;
}

export interface ICommandRemoteControlAdapter {
  getStatus(): TRemoteControlStatus;
  /** REMOTE-012 E3: enrolled trusted devices (for `/remote-control devices`). Absent → TOFU not available. */
  listDevices?(): IRemoteTrustedDeviceSummary[];
  /** REMOTE-012 E3: revoke a trusted device by id (for `/remote-control revoke <id>`); returns true if removed. */
  revokeDevice?(deviceId: string): boolean;
}

export interface ICommandHostAdapters {
  settings?: ICommandSettingsAdapter;
  process?: ICommandProcessAdapter;
  permissionMode?: ICommandPermissionModeAdapter;
  plugin?: ICommandPluginAdapter;
  remoteControl?: ICommandRemoteControlAdapter;
}
