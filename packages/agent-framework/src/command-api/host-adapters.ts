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
  /**
   * CMD-004 Phase 2: delete the settings document (the host-executed `settings-reset` action).
   * Returns `true` when a document existed and was removed. Optional — a composition that does not
   * wire it makes the reset action fail EXPLICITLY in the command result (no-fallback), never a
   * silent skip.
   */
  delete?(): boolean;
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
 * REMOTE-008: view of `/remote-control` state, so the command can report status without touching the
 * transport. CMD-004 Phase 2 supersedes the original status-only design: the enable/stop ACTIONS are
 * now host-executed through this adapter (wired at the composition root) instead of surface-rendered
 * `TCommandEffect`s, so they work on every surface (remote/headless included).
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
  /**
   * CMD-004 Phase 2: enable remote control (host-executed `remote-control-enable` action). Resolves
   * to the user-facing message (pairing QR/link, or a fail-closed notice) which the host folds into
   * the command result. Absent ⇒ the action fails explicitly in the result (no-fallback).
   */
  enable?(): string | Promise<string>;
  /** CMD-004 Phase 2: stop remote control; resolves to the user-facing message (see {@link enable}). */
  stop?(): string | Promise<string>;
}

export interface ICommandHostAdapters {
  settings?: ICommandSettingsAdapter;
  process?: ICommandProcessAdapter;
  permissionMode?: ICommandPermissionModeAdapter;
  plugin?: ICommandPluginAdapter;
  remoteControl?: ICommandRemoteControlAdapter;
}
