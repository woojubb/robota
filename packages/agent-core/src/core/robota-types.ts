import type { IModuleResultData } from '../abstracts/abstract-module';
import type { TModelEffort } from '../interfaces/provider';

/**
 * Shared model configuration shape used in setModel / getModel. The system prompt is intentionally
 * absent: it is an agent-level concern (top-level `config.systemMessage`), updated live via
 * `Robota.updateSystemPrompt`, not part of model config.
 */
export interface IModelConfig {
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  /** Reasoning effort tier read per-call by the execution round (PRESET-013 live re-application channel). */
  effort?: TModelEffort;
}

/** Return shape of getConfiguration(). */
export interface IConfigurationSnapshot {
  version: number;
  tools: Array<{ name: string; parameters?: string[] }>;
  updatedAt: number;
}

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
