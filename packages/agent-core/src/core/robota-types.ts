import type { IModuleResultData } from '../abstracts/abstract-module';

/** Shared model configuration shape used in setModel / getModel. */
export type TModelConfig = {
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  systemMessage?: string;
};

/** Return shape of getConfiguration(). */
export type TConfigurationSnapshot = {
  version: number;
  tools: Array<{ name: string; parameters?: string[] }>;
  updatedAt: number;
};

/** Return shape of getModuleStats(). */
export type TModuleStats =
  | {
      totalExecutions: number;
      successfulExecutions: number;
      failedExecutions: number;
      averageExecutionTime: number;
      lastExecutionTime?: Date;
    }
  | undefined;

export type { IModuleResultData };

export type TRegisterModuleOptions = {
  autoInitialize?: boolean;
  validateDependencies?: boolean;
};

export type TExecuteModuleContext = {
  executionId?: string;
  sessionId?: string;
  userId?: string;
  metadata?: Record<string, string | number | boolean | Date>;
};

export type TExecuteModuleResult = {
  success: boolean;
  data?: IModuleResultData;
  error?: Error;
  duration?: number;
};
