import { textAction } from '@robota-sdk/agent-core';

import {
  formatProviderSetupHelpLinks,
  getProviderSetupStep,
  submitProviderSetupValue,
} from './provider-setup-flow.js';

import type { IActionRequest, IUserInteraction } from '@robota-sdk/agent-core';
import type { IProviderSetupInput } from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';
import type { IProviderSetupFlowState } from './provider-setup-flow.js';

/** Build the per-step `IActionRequest` for the current setup step (CMD-004 inline ask). */
function toProviderSetupStepRequest(
  flow: IProviderSetupFlowState,
  errorMessage?: string,
): IActionRequest {
  const step = getProviderSetupStep(flow);
  const placeholder =
    step.masked === true && step.defaultValue !== undefined ? '(unchanged)' : step.defaultValue;
  const helpLinks = formatProviderSetupHelpLinks(flow.setupHelpLinks);
  const description =
    [errorMessage, helpLinks.length > 0 ? helpLinks : undefined]
      .filter((part): part is string => part !== undefined && part.length > 0)
      .join('\n') || undefined;
  return textAction(`provider-setup-${step.key}`, step.title, {
    description,
    placeholder,
    allowEmpty:
      step.defaultValue !== undefined || (step.editOnly === true && step.required !== true),
    masked: step.masked,
  });
}

/**
 * Drive the setup-step engine through inline `ui.ask` calls (CMD-004), re-asking the same step when a
 * step fails validation (the error is surfaced in the request description). The `complete` sink differs
 * between the add and edit paths.
 */
export async function runProviderSetupAsk(
  ui: IUserInteraction,
  flow: IProviderSetupFlowState,
  complete: (input: IProviderSetupInput) => ICommandResult | Promise<ICommandResult>,
  cancelMessage: string,
  signal?: AbortSignal,
): Promise<ICommandResult> {
  let state = flow;
  let errorMessage: string | undefined;
  for (;;) {
    if (signal?.aborted) return { message: cancelMessage, success: true };
    const response = await ui.ask(toProviderSetupStepRequest(state, errorMessage), { signal });
    if (response.type === 'cancelled') {
      return { message: cancelMessage, success: true };
    }
    const result = submitProviderSetupValue(state, response.text ?? '');
    if (result.status === 'error') {
      errorMessage = result.message;
      continue;
    }
    if (result.status === 'complete') {
      return complete(result.input);
    }
    state = result.state;
    errorMessage = undefined;
  }
}
