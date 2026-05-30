import type { IProviderConfig } from '@robota-sdk/agent-core';
import type { TSubagentRunnerFactory } from '@robota-sdk/agent-framework';
import {
  createChildProcessSubagentRunnerFactory,
  getDefaultSubagentWorkerPath,
} from '@robota-sdk/agent-subagent-runner';

export interface ISubagentSetupConfig {
  workerPath?: string;
  providerConfig: IProviderConfig;
  logsDir: string;
}

export interface ISubagentSetup {
  subagentRunnerFactory: TSubagentRunnerFactory;
}

export function createSubagentSetup(config: ISubagentSetupConfig): ISubagentSetup {
  return {
    subagentRunnerFactory: createChildProcessSubagentRunnerFactory({
      workerPath: config.workerPath ?? getDefaultSubagentWorkerPath(),
      providerConfig: config.providerConfig,
      logsDir: config.logsDir,
    }),
  };
}
