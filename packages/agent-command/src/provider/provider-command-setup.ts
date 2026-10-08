import { buildProviderSetupPatch, mergeProviderPatch } from '@robota-sdk/agent-framework';

import { createProviderSetupFlow } from './provider-setup-flow.js';
import { runProviderSetupAsk } from './provider-setup-ask.js';
import {
  hasProviderConnectionMethods,
  runProviderConnectionSetup,
} from './provider-connection-setup.js';

import type { IProviderSetupFlowState } from './provider-setup-flow.js';
import type { IUserInteraction } from '@robota-sdk/agent-core';
import type {
  IProviderCommandModuleOptions,
  IProviderSetupInput,
} from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';

export { runProviderSetupAsk } from './provider-setup-ask.js';

const PROVIDER_RESTART_ACTION = {
  type: 'session-restart',
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

/** Run the `/provider add` setup wizard inline. */
export function runProviderAddSetup(
  ui: IUserInteraction,
  flow: IProviderSetupFlowState,
  options: IProviderCommandModuleOptions,
  isSetupRequired: boolean,
): Promise<ICommandResult> {
  if (hasProviderConnectionMethods(flow.type, options)) {
    return runProviderConnectionSetup(ui, flow, options, isSetupRequired);
  }
  return runProviderSetupAsk(
    ui,
    flow,
    (input) => completeProviderSetup(input, options, isSetupRequired),
    'Provider setup cancelled.',
  );
}

function completeProviderSetup(
  input: IProviderSetupInput,
  options: IProviderCommandModuleOptions,
  isSetupRequired: boolean,
): ICommandResult {
  const target = options.settings.readTargetSettings();
  const patch = buildProviderSetupPatch(input, {
    providerDefinitions: options.providerDefinitions,
    ...(options.env === undefined ? {} : { env: options.env }),
  });
  options.settings.writeTargetSettings(mergeProviderPatch(target, patch));
  // #3282 §3: the session's own live setup-mode state (never settings — an ordinary env-default
  // session also has no persisted `currentProvider`, and restarts like any other session). Only a
  // session that itself started with a placeholder provider hot-swaps the real one in; every other
  // `/provider add`, even a session's first EVER persisted profile, restarts as before.
  if (isSetupRequired) {
    return {
      message: `Provider ${input.profile} configured.`,
      success: true,
      hostActions: [{ type: 'provider-hot-swap', profileName: input.profile }],
    };
  }
  return {
    message: `Provider ${input.profile} configured. Restarting...`,
    success: true,
    hostActions: [{ ...PROVIDER_RESTART_ACTION, message: 'Provider setup restart' }],
  };
}
