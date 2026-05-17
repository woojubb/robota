import type { IProviderConfig } from '@robota-sdk/agent-core';
import type { TSubagentRunnerFactory } from '@robota-sdk/agent-framework';
import { createChildProcessSubagentRunnerFactory } from '@robota-sdk/agent-subagent-runner';

export interface ISubagentSetupConfig {
  providerConfig: IProviderConfig;
  logsDir: string;
}

export interface ISubagentSetup {
  subagentRunnerFactory: TSubagentRunnerFactory;
}

export function createSubagentSetup(config: ISubagentSetupConfig): ISubagentSetup {
  return {
    subagentRunnerFactory: createChildProcessSubagentRunnerFactory({
      providerConfig: config.providerConfig,
      logsDir: config.logsDir,
    }),
  };
}
