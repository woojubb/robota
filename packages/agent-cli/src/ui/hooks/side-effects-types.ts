import type { IProviderDefinition, IHistoryEntry } from '@robota-sdk/agent-core';
import type { InteractiveSession } from '@robota-sdk/agent-sdk';
import type { TInteractivePrompt } from '../../utils/interactive-prompt.js';

/** Side-effect flags for TUI-specific actions */
export interface ISideEffects {
  _pendingModelId?: string;
  _pendingLanguage?: string;
  _resetRequested?: boolean;
  _exitRequested?: boolean;
  _triggerPluginTUI?: boolean;
  _triggerResumePicker?: boolean;
  _sessionName?: string;
  _pendingProviderProfile?: string;
  _pendingProviderSetup?: {
    type?: string;
  };
}

export interface IUseSideEffectsOptions {
  cwd: string;
  interactiveSession: InteractiveSession;
  addEntry: (entry: IHistoryEntry) => void;
  baseHandleSubmit: (input: string) => Promise<void>;
  setSessionName: (name: string) => void;
  providerDefinitions: readonly IProviderDefinition[];
}

export interface IUseSideEffectsResult {
  handleSubmit: (input: string) => Promise<void>;
  pendingModelId: string | null;
  pendingProviderProfile: string | null;
  pendingInteractionPrompt: TInteractivePrompt | null;
  showPluginTUI: boolean;
  showSessionPicker: boolean;
  setPendingModelId: (id: string | null) => void;
  setShowPluginTUI: (show: boolean) => void;
  setShowSessionPicker: (show: boolean) => void;
  handleModelConfirm: (index: number) => void;
  handleProviderConfirm: (index: number) => void;
  handleInteractionSubmit: (value: string) => void;
  handleInteractionCancel: () => void;
}
