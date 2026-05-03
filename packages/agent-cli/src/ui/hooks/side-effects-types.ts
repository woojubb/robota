import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type {
  ICommandInteraction,
  InteractiveSession,
  TCommandEffect,
} from '@robota-sdk/agent-sdk';
import type { TInteractivePrompt } from '../../utils/interactive-prompt.js';
import type {
  IStatusLineSettings,
  TStatusLineSettingsPatch,
} from '../../utils/statusline-settings.js';

/** Side-effect flags for TUI-specific actions */
export interface ISideEffects {
  _pendingModelId?: string;
  _resetRequested?: boolean;
  _exitRequested?: boolean;
  _triggerPluginTUI?: boolean;
  _triggerResumePicker?: boolean;
  _sessionName?: string;
  _pendingCommandInteraction?: ICommandInteraction;
  _pendingCommandEffects?: readonly TCommandEffect[];
  _statusLinePatch?: TStatusLineSettingsPatch;
}

export interface IUseSideEffectsOptions {
  cwd: string;
  providerOverride?: string | undefined;
  interactiveSession: InteractiveSession;
  addEntry: (entry: IHistoryEntry) => void;
  baseHandleSubmit: (input: string) => Promise<void>;
  setSessionName: (name: string) => void;
  setStatusLineSettings: (settings: IStatusLineSettings) => void;
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
