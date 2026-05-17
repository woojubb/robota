import type { IAIProvider, IProviderConfig } from '@robota-sdk/agent-core';
import type { TSubagentRunnerFactory } from '@robota-sdk/agent-framework';
import {
  projectPaths,
  readProviderSettings,
  createProviderFromSettings,
} from '@robota-sdk/agent-framework';
import type { IConfigPhaseOptions } from './args-to-options.js';
import type { ICommandSetup } from './command-setup.js';
import { createSubagentSetup } from './subagent-setup.js';

export interface IProviderSetup {
  provider: IAIProvider;
  providerSettings: IProviderConfig;
  modelId: string;
  subagentRunnerFactory: TSubagentRunnerFactory;
}

export function createProviderSetup(
  cwd: string,
  opts: IConfigPhaseOptions,
  commandSetup: ICommandSetup,
): IProviderSetup {
  const providerOptions = opts.provider
    ? { providerOverride: opts.provider, providerDefinitions: commandSetup.providerDefinitions }
    : { providerDefinitions: commandSetup.providerDefinitions };

  const providerSettings = readProviderSettings(cwd, providerOptions);
  const modelId = opts.model ?? providerSettings.model;
  const provider = createProviderFromSettings(cwd, opts.model, providerOptions);

  const { subagentRunnerFactory } = createSubagentSetup({
    providerConfig: { ...providerSettings, model: modelId },
    logsDir: projectPaths(cwd).logs,
  });

  return { provider, providerSettings, modelId, subagentRunnerFactory };
}
