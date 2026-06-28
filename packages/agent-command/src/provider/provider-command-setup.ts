import { textAction } from '@robota-sdk/agent-core';
import { buildProviderSetupPatch, mergeProviderPatch } from '@robota-sdk/agent-framework';

import {
  createProviderSetupFlow,
  formatProviderSetupHelpLinks,
  getProviderSetupStep,
  submitProviderSetupValue,
} from './provider-setup-flow.js';

import type { IProviderSetupFlowState } from './provider-setup-flow.js';
import type { IActionRequest, IUserInteraction } from '@robota-sdk/agent-core';
import type {
  IProviderCommandModuleOptions,
  IProviderSetupInput,
} from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';

const PROVIDER_RESTART_EFFECT = {
  type: 'session-restart-requested',
  reason: 'other',
} as const;

export function createSetupFlow(
  type: string,
  options: IProviderCommandModuleOptions,
): IProviderSetupFlowState {
  return createProviderSetupFlow(type, options.providerDefinitions, {
    existingProfileNames: Object.keys(options.settings.readMergedSettings().providers ?? {}),
  });
}

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
    allowEmpty: step.defaultValue !== undefined,
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
  complete: (input: IProviderSetupInput) => ICommandResult,
  cancelMessage: string,
): Promise<ICommandResult> {
  let state = flow;
  let errorMessage: string | undefined;
  for (;;) {
    const response = await ui.ask(toProviderSetupStepRequest(state, errorMessage));
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

/** Run the `/provider add` setup wizard inline. */
export function runProviderAddSetup(
  ui: IUserInteraction,
  flow: IProviderSetupFlowState,
  options: IProviderCommandModuleOptions,
): Promise<ICommandResult> {
  return runProviderSetupAsk(
    ui,
    flow,
    (input) => completeProviderSetup(input, options),
    'Provider setup cancelled.',
  );
}

function completeProviderSetup(
  input: IProviderSetupInput,
  options: IProviderCommandModuleOptions,
): ICommandResult {
  const target = options.settings.readTargetSettings();
  const patch = buildProviderSetupPatch(input, {
    providerDefinitions: options.providerDefinitions,
  });
  options.settings.writeTargetSettings(mergeProviderPatch(target, patch));
  return {
    message: `Provider ${input.profile} configured. Restarting...`,
    success: true,
    effects: [{ ...PROVIDER_RESTART_EFFECT, message: 'Provider setup restart' }],
  };
}
