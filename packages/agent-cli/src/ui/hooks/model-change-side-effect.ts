import {
  createSystemMessage,
  getModelName,
  messageToHistoryEntry,
  type IHistoryEntry,
  type TSessionEndReason,
} from '@robota-sdk/agent-core';
import {
  applyActiveModelChange,
  type IActiveModelChangeOptions,
  type IActiveModelChangeResult,
} from '../../utils/provider-configuration.js';

type TApplyModelChange = (
  cwd: string,
  modelId: string,
  options?: IActiveModelChangeOptions,
) => IActiveModelChangeResult;

export interface IApplyConfirmedModelChangeDeps {
  cwd: string;
  modelId: string;
  providerOverride?: string | undefined;
  addEntry: (entry: IHistoryEntry) => void;
  requestShutdown: (reason: TSessionEndReason, message: string) => void;
  applyModelChange?: TApplyModelChange;
}

export function formatModelChangeConfirmationMessage(modelId: string): string {
  return `Change model to ${getModelName(modelId)}? This will exit the current session so the next session uses it.`;
}

export function formatModelChangeExitMessage(modelId: string): string {
  return `Model changed to ${getModelName(modelId)}. Exiting so the next session uses it.`;
}

export function applyConfirmedModelChange(deps: IApplyConfirmedModelChangeDeps): void {
  const applyModelChange = deps.applyModelChange ?? applyActiveModelChange;
  const options =
    deps.providerOverride !== undefined ? { providerOverride: deps.providerOverride } : undefined;

  try {
    applyModelChange(deps.cwd, deps.modelId, options);
    deps.addEntry(
      messageToHistoryEntry(createSystemMessage(formatModelChangeExitMessage(deps.modelId))),
    );
    deps.requestShutdown('other', 'Model change applied');
  } catch (error) {
    deps.addEntry(
      messageToHistoryEntry(
        createSystemMessage(`Failed: ${error instanceof Error ? error.message : String(error)}`),
      ),
    );
  }
}

export function addModelChangeCancelledMessage(addEntry: (entry: IHistoryEntry) => void): void {
  addEntry(messageToHistoryEntry(createSystemMessage('Model change cancelled.')));
}
