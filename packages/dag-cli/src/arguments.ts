import type { IDagCliFailure } from './types.js';
import { DEFAULT_DAG_SERVER_URL } from './types.js';
import { createCliFailure } from './json.js';

const OPTION_PREFIX = '--';
const NEXT_ARGUMENT_OFFSET = 1;

export interface IParsedOption {
  readonly args: readonly string[];
  readonly value?: string;
  readonly failure?: IDagCliFailure;
}

export interface IGlobalCliConfig {
  readonly args: readonly string[];
  readonly serverUrl: string;
  readonly failure?: IDagCliFailure;
}

export function parseGlobalConfig(
  args: readonly string[],
  envServerUrl?: string,
): IGlobalCliConfig {
  const parsed = takeStringOption(args, '--server-url');
  if (parsed.failure) {
    return {
      args: parsed.args,
      serverUrl: DEFAULT_DAG_SERVER_URL,
      failure: parsed.failure,
    };
  }
  return {
    args: parsed.args,
    serverUrl: parsed.value ?? envServerUrl ?? DEFAULT_DAG_SERVER_URL,
  };
}

export function takeStringOption(args: readonly string[], optionName: string): IParsedOption {
  const remaining: string[] = [];
  let value: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current !== optionName) {
      remaining.push(current);
      continue;
    }

    const optionValue = args[index + NEXT_ARGUMENT_OFFSET];
    if (typeof optionValue !== 'string' || optionValue.startsWith(OPTION_PREFIX)) {
      return usageOptionResult(remaining, optionName);
    }
    if (typeof value === 'string') {
      return duplicateOptionResult(remaining, optionName);
    }
    value = optionValue;
    index += NEXT_ARGUMENT_OFFSET;
  }

  return { args: remaining, value };
}

export function takeNumberOption(args: readonly string[], optionName: string): IParsedOption {
  const parsed = takeStringOption(args, optionName);
  if (parsed.failure || typeof parsed.value !== 'string') {
    return parsed;
  }
  if (!/^[1-9]\d*$/.test(parsed.value)) {
    return {
      args: parsed.args,
      failure: createCliFailure('DAG_CLI_USAGE_ERROR', `${optionName} must be a positive integer.`),
    };
  }
  return parsed;
}

export function rejectUnexpectedArgs(
  args: readonly string[],
  commandName: string,
): IDagCliFailure | undefined {
  if (args.length === 0) {
    return undefined;
  }
  return createCliFailure(
    'DAG_CLI_USAGE_ERROR',
    `${commandName} received unexpected arguments: ${args.join(' ')}.`,
  );
}

function usageOptionResult(args: readonly string[], optionName: string): IParsedOption {
  return {
    args,
    failure: createCliFailure('DAG_CLI_USAGE_ERROR', `${optionName} requires a value.`),
  };
}

function duplicateOptionResult(args: readonly string[], optionName: string): IParsedOption {
  return {
    args,
    failure: createCliFailure('DAG_CLI_USAGE_ERROR', `${optionName} can only be provided once.`),
  };
}
