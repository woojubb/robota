import type { IErrorInfo } from '../code-executor-types';

export interface IAnalyzeCodeResult {
  errors: IErrorInfo[];
  warnings: IErrorInfo[];
}

export interface IParsedToolConfig {
  name: string;
  description: string;
}

export interface IParsedAgentConfig {
  name: string;
  model: string;
  tools: IParsedToolConfig[];
  systemMessage?: string;
  plugins: string[];
}
