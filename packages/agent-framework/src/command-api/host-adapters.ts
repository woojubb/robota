import type { ICommandPluginAdapter } from './plugin/plugin-command-api.js';
import type { IPresetApplicationOptions } from './preset/preset-application.js';
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
 * legacy command effects, so they work on every surface (remote/headless included).
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

/**
 * PEER-004 (#1863): a live session this one can address, as the operator sees it.
 *
 * Display data only. `sessionId` names the peer for a later `send`; `liveness` is carried rather
 * than filtered so the operator can tell "I could not determine" from "not running" — a host with no
 * way to read process start times answers `unknown`, and collapsing that into either verdict would
 * be the guess the registry refuses to make.
 */
export interface ILocalPeerSummary {
  readonly sessionId: string;
  readonly name?: string;
  readonly liveness: 'alive' | 'dead' | 'unknown';
}

/**
 * PEER-004: what `/peers` reads. The registry, the guarded directory and the liveness rule all live
 * in the composition root — a command never touches the filesystem, for the same reason it never
 * constructs a transport.
 */
export interface ICommandLocalPeersAdapter {
  /** Every announced session, this one included. Ordering is the adapter's. */
  list(): readonly ILocalPeerSummary[];
  /** This session's own id, so the command can mark which row is the reader. */
  ownSessionId(): string;
  /**
   * PEER-006: hand `text` to another announced session, and report what came back.
   *
   * Returns a delivery state rather than throwing, because "the peer refused it" and "the carrier
   * broke" are both answers the operator needs, and an exception would flatten them into one.
   * Absent on a host that can discover peers but cannot address them.
   */
  send?(targetSessionId: string, text: string): Promise<ILocalPeerSendResult>;
}

/**
 * PEER-006: what the sender learns, in the vocabulary the operator reads.
 *
 * Deliberately not the transport's ack type: the command layer must not import the wire contract to
 * print a sentence, and `pending` — the honest answer while a message waits behind a running turn —
 * is a state the operator has to be able to see named.
 */
export interface ILocalPeerSendResult {
  readonly state: 'pending' | 'delivered' | 'acknowledged' | 'duplicate' | 'refused' | 'failed';
  readonly reason?: string;
}

/**
 * ARCH-009 — the discovery half of a preset registry, named HERE rather than imported.
 *
 * `agent-preset` depends on `agent-framework`, not the other way round, so importing its
 * `IPresetRegistry` would invert the layering to describe a value this package only hands to a
 * command. Structural typing means the registry `agent-preset` builds satisfies this without either
 * package naming the other.
 *
 * Only the three members `/preset` actually calls are named. A port that mirrors a whole contract it
 * does not use is a second copy of that contract waiting to drift.
 *
 * It is an ADAPTER and not a host-role member, because that is what it is: a capability the
 * composition root supplies, reached the way `/permission-mode` and `/plugin` already reach theirs.
 * Absent ⇒ the host loaded no external presets, and `/preset` lists the built-ins.
 */
export interface ICommandPresetRegistryAdapter {
  /**
   * `title` and `description` are REQUIRED, because `/preset list` renders both. Optional members
   * here would let a conforming host typecheck and then print `id — undefined: undefined`; review of
   * ARCH-009 reported exactly that. A port requires what its consumer needs, and variation belongs in
   * the VALUE, not in whether the member exists.
   */
  listPresets(): readonly { id: string; title: string; description: string }[];
  /** PRESENCE only — `/preset` asks whether the id is known, never what it holds. */
  getPreset(id: string): unknown;
  /**
   * The re-appliable option subset. `IPresetApplicationOptions` is framework-owned and
   * `agent-preset`'s `IResolvedPresetOptions` satisfies it structurally, so naming it here crosses no
   * layer and leaves nothing for a consumer to assert about a value it did not check.
   */
  resolvePreset(id: string, context?: unknown): IPresetApplicationOptions;
}

/**
 * HANDOFF-001 (issue #1864): what a hand-off looks like to the operator, in the operator's words.
 *
 * Deliberately not the wire package's `THandoffPhase`. The command layer must not import the wire
 * contract to print a sentence, and the two vocabularies answer different questions — `staged` is a
 * protocol state, while "the other machine has it and is not running it yet" is what the person
 * standing at the keyboard needs to be told.
 */
export interface IHandoffProgress {
  readonly state: 'offered' | 'sending' | 'awaiting-confirmation' | 'done' | 'stopped';
  /** Present when the transfer stopped without completing. Named so the operator can act on it. */
  readonly reason?: string;
  /** Is THIS machine still in charge of the session? The single question the whole design answers. */
  readonly stillMine: boolean;
}

/** What stays behind, surfaced BEFORE the operator confirms, because it is their choice to lose it. */
export interface IHandoffStaysBehind {
  readonly uncommittedChanges: boolean;
  readonly subprocesses: number;
}

/**
 * What `/handoff` reads. The carrier, the wire composition and the device identity all live in the
 * composition root — a command never constructs a transport.
 */
export interface ICommandHandoffAdapter {
  /** The machines this session could be moved to. Empty is an answer, not an error. */
  destinations(): Promise<readonly { readonly deviceId: string; readonly name?: string }[]>;
  /**
   * What will not travel, so the operator is asked with the facts in front of them.
   *
   * Read before the confirmation prompt rather than after: uncommitted work and running
   * subprocesses stay on this machine by design, and a consent that did not mention them is not
   * consent to lose them.
   */
  staysBehind(): Promise<IHandoffStaysBehind>;
  /**
   * Move this session to `deviceId`, reporting progress as it goes.
   *
   * Returns the final progress rather than throwing: "the destination cannot run it" and "the link
   * broke" are both answers the operator needs, and an exception would flatten them into one. In
   * every non-`done` outcome `stillMine` is true — that is the invariant the command prints.
   */
  transfer(
    deviceId: string,
    onProgress?: (progress: IHandoffProgress) => void,
  ): Promise<IHandoffProgress>;
  /** Is this machine still authoritative? Asked without starting anything. */
  status(): IHandoffProgress;
}

export interface ICommandHostAdapters {
  settings?: ICommandSettingsAdapter;
  process?: ICommandProcessAdapter;
  permissionMode?: ICommandPermissionModeAdapter;
  plugin?: ICommandPluginAdapter;
  remoteControl?: ICommandRemoteControlAdapter;
  localPeers?: ICommandLocalPeersAdapter;
  /**
   * ARCH-009 — the instance registry the host resolved with, so in-session `/preset` discovers THIS
   * product's presets. Its absence is why `agent-preset` had to keep a module-global registry: a
   * command runs with an `ICommandHostContext` and nothing else, so this bag is the path from the
   * shell to the command.
   */
  presetRegistry?: ICommandPresetRegistryAdapter;
  /**
   * HANDOFF-001 (issue #1864). Absent on a host with no carrier — `/handoff` then says so rather
   * than offering a transfer it cannot perform.
   */
  handoff?: ICommandHandoffAdapter;
}
