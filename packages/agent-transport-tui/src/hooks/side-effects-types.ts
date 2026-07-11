import type { ICommandEffectQueue } from './command-effect-queue.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { InteractiveSession } from '@robota-sdk/agent-framework';
import type { IStatusLineCommandSettings as TStatusLineSettings } from '@robota-sdk/agent-interface-transport';

export type { TStatusLineSettings };

export interface IUseSideEffectsOptions {
  cwd: string;
  providerOverride?: string | undefined;
  interactiveSession: InteractiveSession;
  commandEffectQueue: ICommandEffectQueue;
  addEntry: (entry: IHistoryEntry) => void;
  baseHandleSubmit: (input: string) => Promise<void>;
  setSessionName: (name: string) => void;
  setStatusLineSettings: (settings: TStatusLineSettings) => void;
  showSessionPickerOnStart?: boolean;
  openAgentSwitcher?: () => void;
  /** REMOTE-008: composition-root enable/stop of remote control; each returns a message to render. */
  enableRemoteControl?: () => string | Promise<string>;
  stopRemoteControl?: () => string | Promise<string>;
}

export interface IUseSideEffectsResult {
  handleSubmit: (input: string) => Promise<void>;
  showPluginTUI: boolean;
  showSessionPicker: boolean;
  showTransportTUI: boolean;
  setShowPluginTUI: (show: boolean) => void;
  setShowSessionPicker: (show: boolean) => void;
  setShowTransportTUI: (show: boolean) => void;
}
