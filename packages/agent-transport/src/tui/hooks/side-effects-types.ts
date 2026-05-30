import type { ICommandEffectQueue } from './command-effect-queue.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { InteractiveSession } from '@robota-sdk/agent-framework';
import type {
  TCommandInteractionPrompt as TInteractivePrompt,
  IStatusLineCommandSettings as TStatusLineSettings,
} from '@robota-sdk/agent-framework';

export type { TInteractivePrompt, TStatusLineSettings };

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
}

export interface IUseSideEffectsResult {
  handleSubmit: (input: string) => Promise<void>;
  pendingInteractionPrompt: TInteractivePrompt | null;
  showPluginTUI: boolean;
  showSessionPicker: boolean;
  showTransportTUI: boolean;
  setShowPluginTUI: (show: boolean) => void;
  setShowSessionPicker: (show: boolean) => void;
  setShowTransportTUI: (show: boolean) => void;
  handleInteractionSubmit: (value: string) => Promise<void>;
  handleInteractionCancel: () => void;
}
