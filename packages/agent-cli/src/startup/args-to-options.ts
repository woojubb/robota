import type { IParsedCliArgs, TOutputFormat } from '../utils/cli-args.js';
import type { TPermissionMode } from '@robota-sdk/agent-core';

export interface IConfigPhaseOptions {
  configure: boolean;
  provider?: string;
  settingsScope?: string;
  configureProvider?: string;
  providerType?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  baseURL?: string;
  setCurrent: boolean;
  printMode: boolean;
  positional: readonly string[];
}

export interface ISessionRunOptions {
  positional: readonly string[];
  language?: string;
  permissionMode?: TPermissionMode;
  maxTurns?: number;
  sessionName?: string;
  noSessionPersistence: boolean;
  continueMode: boolean;
  resumeId?: string;
  forkSession: boolean;
  outputFormat?: TOutputFormat;
  bare: boolean;
  allowedTools?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  taskFile?: string;
  jsonSchema?: string;
  dryRun: boolean;
}

export interface IUserLocalCommandOptions {
  positional: readonly string[];
  format?: string;
  summary?: string;
  source?: string;
}

export interface IStartupUpdatePolicyOptions {
  printMode: boolean;
  disableUpdateCheck: boolean;
}

export function toConfigPhaseOptions(args: IParsedCliArgs): IConfigPhaseOptions {
  return {
    configure: args.configure,
    provider: args.provider,
    settingsScope: args.settingsScope,
    configureProvider: args.configureProvider,
    providerType: args.providerType,
    apiKey: args.apiKey,
    apiKeyEnv: args.apiKeyEnv,
    baseURL: args.baseURL,
    setCurrent: args.setCurrent,
    printMode: args.printMode || args.dryRun,
    positional: args.positional,
  };
}

export function toSessionRunOptions(args: IParsedCliArgs): ISessionRunOptions {
  return {
    positional: args.positional,
    language: args.language,
    permissionMode: args.dryRun ? 'plan' : args.permissionMode,
    maxTurns: args.maxTurns,
    sessionName: args.sessionName,
    noSessionPersistence: args.noSessionPersistence,
    continueMode: args.continueMode,
    resumeId: args.resumeId,
    forkSession: args.forkSession,
    outputFormat: args.outputFormat,
    bare: args.bare,
    allowedTools: args.allowedTools,
    systemPrompt: args.systemPrompt,
    appendSystemPrompt: args.appendSystemPrompt,
    taskFile: args.taskFile,
    jsonSchema: args.jsonSchema,
    dryRun: args.dryRun,
  };
}

export function toUserLocalCommandOptions(args: IParsedCliArgs): IUserLocalCommandOptions {
  return {
    positional: args.positional,
    format: args.format,
    summary: args.summary,
    source: args.source,
  };
}

export function toStartupUpdatePolicyOptions(args: IParsedCliArgs): IStartupUpdatePolicyOptions {
  return {
    printMode: args.printMode,
    disableUpdateCheck: args.disableUpdateCheck,
  };
}
