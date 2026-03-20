/**
 * Types and interfaces for CodeExecutor
 */

export interface ICodeExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  logs?: string[];
  duration: number;
  agentReady: boolean;
  compiledCode?: string;
  errors?: IErrorInfo[];
  warnings?: IErrorInfo[];
}

export interface IErrorInfo {
  type: 'syntax' | 'runtime' | 'api' | 'configuration' | 'import';
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
  column?: number;
  stack?: string;
  code?: string;
  suggestions?: string[];
  documentation?: string;
}

export interface IAgentContext {
  provider: string;
  model: string;
  tools: Array<{ name: string; description: string }>;
  systemMessage?: string;
}
