import type { TBackgroundTaskIsolation } from '@robota-sdk/agent-sdk';

export const DEFAULT_AGENT_TYPE = 'general-purpose';

export type TAgentMode = 'foreground' | 'background';

export interface IAgentRunRequest {
  readonly agentType: string;
  readonly label: string;
  readonly mode: TAgentMode;
  readonly prompt: string;
  readonly model?: string;
  readonly isolation?: TBackgroundTaskIsolation;
}

interface IParsedAgentOptions {
  readonly background: boolean;
  readonly agentType?: string;
  readonly model?: string;
  readonly isolation?: TBackgroundTaskIsolation;
  readonly positional: string[];
}

export function tokenizeArgs(args: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let escaped = false;

  for (const char of args) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (quote && char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (current.length > 0) tokens.push(current);
  return tokens;
}

function parseOptions(tokens: readonly string[]): IParsedAgentOptions {
  const positional: string[] = [];
  let background = false;
  let agentType: string | undefined;
  let model: string | undefined;
  let isolation: TBackgroundTaskIsolation | undefined;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--background') {
      background = true;
      continue;
    }
    if (token === '--agent' || token === '--type' || token === '-a') {
      agentType = tokens[index + 1];
      index += 1;
      continue;
    }
    if (token === '--model') {
      model = tokens[index + 1];
      index += 1;
      continue;
    }
    if (token === '--isolation') {
      const value = tokens[index + 1];
      if (value === 'none' || value === 'worktree') isolation = value;
      index += 1;
      continue;
    }
    if (token !== undefined) positional.push(token);
  }

  return {
    background,
    positional,
    ...(agentType ? { agentType } : {}),
    ...(model ? { model } : {}),
    ...(isolation ? { isolation } : {}),
  };
}

function createRequest(
  options: IParsedAgentOptions,
  agentType: string,
  label: string,
  prompt: string,
): IAgentRunRequest {
  return {
    agentType,
    label,
    mode: options.background ? 'background' : 'foreground',
    prompt,
    ...(options.model ? { model: options.model } : {}),
    ...(options.isolation ? { isolation: options.isolation } : {}),
  };
}

export function parseRunRequest(
  tokens: readonly string[],
  availableAgentNames: ReadonlySet<string>,
): IAgentRunRequest | undefined {
  const options = parseOptions(tokens);
  const [first, ...rest] = options.positional;
  let agentType = options.agentType ?? DEFAULT_AGENT_TYPE;
  let promptParts = options.positional;

  if (!options.agentType && first && availableAgentNames.has(first)) {
    agentType = first;
    promptParts = rest;
  }

  const prompt = promptParts.join(' ').trim();
  if (!prompt) return undefined;
  return createRequest(options, agentType, agentType, prompt);
}

export function parseParallelRequests(
  tokens: readonly string[],
  availableAgentNames: ReadonlySet<string>,
): IAgentRunRequest[] {
  const options = parseOptions(tokens);
  return options.positional
    .map((token) => parseAgentJobToken(token, options, availableAgentNames))
    .filter((job): job is IAgentRunRequest => job !== undefined);
}

function parseAgentJobToken(
  token: string,
  options: IParsedAgentOptions,
  availableAgentNames: ReadonlySet<string>,
): IAgentRunRequest | undefined {
  const equalsIndex = token.indexOf('=');
  if (equalsIndex > 0) {
    const label = token.slice(0, equalsIndex);
    const spec = token.slice(equalsIndex + 1);
    return parseAgentPromptSpec(label, spec, options, availableAgentNames);
  }

  const colonIndex = token.indexOf(':');
  if (colonIndex <= 0 || colonIndex === token.length - 1) return undefined;
  const head = token.slice(0, colonIndex);
  const prompt = token.slice(colonIndex + 1);
  const agentType =
    options.agentType ?? (availableAgentNames.has(head) ? head : DEFAULT_AGENT_TYPE);
  return createRequest(options, agentType, head, prompt);
}

function parseAgentPromptSpec(
  label: string,
  spec: string,
  options: IParsedAgentOptions,
  availableAgentNames: ReadonlySet<string>,
): IAgentRunRequest | undefined {
  const colonIndex = spec.indexOf(':');
  if (colonIndex === -1) {
    const agentType =
      options.agentType ?? (availableAgentNames.has(label) ? label : DEFAULT_AGENT_TYPE);
    return createRequest(options, agentType, label, spec);
  }
  if (colonIndex === 0 || colonIndex === spec.length - 1) return undefined;
  return createRequest(options, spec.slice(0, colonIndex), label, spec.slice(colonIndex + 1));
}
