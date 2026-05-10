import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { InteractiveSession } from '@robota-sdk/agent-sdk';
import type { TInteractivePrompt } from '../../utils/interactive-prompt.js';
import type { IStatusLineSettings } from '../../utils/statusline-settings.js';
import type { ICommandEffectQueue } from './command-effect-queue.js';

export interface IUseSideEffectsOptions {
  cwd: string;
  providerOverride?: string | undefined;
  interactiveSession: InteractiveSession;
  commandEffectQueue: ICommandEffectQueue;
  addEntry: (entry: IHistoryEntry) => void;
  baseHandleSubmit: (input: string) => Promise<void>;
  setSessionName: (name: string) => void;
  setStatusLineSettings: (settings: IStatusLineSettings) => void;
  showSessionPickerOnStart?: boolean;
}

export interface IUseSideEffectsResult {
  handleSubmit: (input: string) => Promise<void>;
  pendingModelId: string | null;
  pendingInteractionPrompt: TInteractivePrompt | null;
  showPluginTUI: boolean;
  showSessionPicker: boolean;
  setPendingModelId: (id: string | null) => void;
  setShowPluginTUI: (show: boolean) => void;
  setShowSessionPicker: (show: boolean) => void;
  handleModelConfirm: (index: number) => void;
  handleInteractionSubmit: (value: string) => Promise<void>;
  handleInteractionCancel: () => void;
}
