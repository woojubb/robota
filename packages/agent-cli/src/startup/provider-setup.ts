import type { IAIProvider, IProviderConfig } from '@robota-sdk/agent-core';
import type { TSubagentRunnerFactory } from '@robota-sdk/agent-framework';
import {
  projectPaths,
  readMergedProviderSettings,
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
  activeProfileName: string | undefined;
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
  const modelId = providerSettings.model;
  const provider = createProviderFromSettings(cwd, undefined, providerOptions);
  const activeProfileName = opts.provider ?? readMergedProviderSettings(cwd).currentProvider;

  const { subagentRunnerFactory } = createSubagentSetup({
    providerConfig: { ...providerSettings, model: modelId },
    logsDir: projectPaths(cwd).logs,
  });

  return { provider, providerSettings, modelId, activeProfileName, subagentRunnerFactory };
}
