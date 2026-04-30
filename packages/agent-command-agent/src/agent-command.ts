import type {
  ICommandResult,
  InteractiveSession,
  TBackgroundTaskIsolation,
} from '@robota-sdk/agent-sdk';

type TAgentMode = 'foreground' | 'background';

interface IAgentRunRequest {
  readonly agentType: string;
  readonly label: string;
  readonly mode: TAgentMode;
  readonly prompt: string;
  readonly model?: string;
  readonly isolation?: TBackgroundTaskIsolation;
}

interface IParsedAgentOptions {
  readonly background: boolean;
  readonly model?: string;
  readonly isolation?: TBackgroundTaskIsolation;
  readonly positional: string[];
}

const USAGE =
  'Usage: agent list | agent run <agent> [--background] <prompt> | agent parallel <label>=<agent>:"<prompt>" --background | agent read <agent-id> [offset] | agent send <agent-id> <prompt> | agent stop <agent-id> [reason] | agent close <agent-id>';

function tokenizeArgs(args: string): string[] {
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
  let model: string | undefined;
  let isolation: TBackgroundTaskIsolation | undefined;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--background') {
      background = true;
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
    ...(model ? { model } : {}),
    ...(isolation ? { isolation } : {}),
  };
}

function parseAgentJobToken(
  token: string,
  options: IParsedAgentOptions,
): IAgentRunRequest | undefined {
  const equalsIndex = token.indexOf('=');
  const colonIndex = token.indexOf(':', equalsIndex + 1);
  if (equalsIndex <= 0 || colonIndex <= equalsIndex + 1 || colonIndex === token.length - 1) {
    return undefined;
  }

  return {
    label: token.slice(0, equalsIndex),
    agentType: token.slice(equalsIndex + 1, colonIndex),
    prompt: token.slice(colonIndex + 1),
    mode: options.background ? 'background' : 'foreground',
    ...(options.model ? { model: options.model } : {}),
    ...(options.isolation ? { isolation: options.isolation } : {}),
  };
}

async function executeList(session: InteractiveSession): Promise<ICommandResult> {
  const agents = session.listAgentDefinitions();
  const jobs = session.listAgentJobs();
  const lines = [
    'Available agents:',
    ...agents.map((agent) => `  ${agent.name} - ${agent.description}`),
    '',
    jobs.length === 0 ? 'No active agent jobs.' : 'Agent jobs:',
    ...jobs.map((job) => `  ${job.id} [${job.status}] ${job.label} - ${job.promptPreview}`),
  ];
  return {
    message: lines.join('\n'),
    success: true,
    data: { agents: agents.length, jobs: jobs.length },
  };
}

async function executeRun(
  session: InteractiveSession,
  tokens: readonly string[],
): Promise<ICommandResult> {
  const options = parseOptions(tokens);
  const [agentType, ...promptParts] = options.positional;
  const prompt = promptParts.join(' ').trim();
  if (!agentType || !prompt) {
    return { message: 'Usage: agent run <agent> [--background] <prompt>', success: false };
  }

  const state = await session.spawnAgentJob({
    agentType,
    label: agentType,
    mode: options.background ? 'background' : 'foreground',
    prompt,
    ...(options.model ? { model: options.model } : {}),
    ...(options.isolation ? { isolation: options.isolation } : {}),
  });

  if (options.background) {
    return {
      message: `Started agent job: ${state.id}`,
      success: true,
      data: { agentId: state.id, status: state.status },
    };
  }

  const result = await session.waitAgentJob(state.id);
  return {
    message: result.output,
    success: true,
    data: { agentId: state.id, output: result.output },
  };
}

async function executeParallel(
  session: InteractiveSession,
  tokens: readonly string[],
): Promise<ICommandResult> {
  const options = parseOptions(tokens);
  const jobs = options.positional
    .map((token) => parseAgentJobToken(token, options))
    .filter((job): job is IAgentRunRequest => job !== undefined);

  if (jobs.length === 0) {
    return {
      message: 'Usage: agent parallel <label>=<agent>:"<prompt>" [more...] --background',
      success: false,
    };
  }

  const states = await Promise.all(jobs.map((job) => session.spawnAgentJob(job)));
  if (options.background) {
    return {
      message: [
        'Started agent jobs:',
        ...states.map((state) => `${state.label}: ${state.id}`),
      ].join('\n'),
      success: true,
      data: { agentIds: states.map((state) => state.id) },
    };
  }

  const results = await Promise.all(states.map((state) => session.waitAgentJob(state.id)));
  return {
    message: results.map((result) => result.output).join('\n\n'),
    success: true,
    data: { agentIds: states.map((state) => state.id) },
  };
}

async function executeRead(
  session: InteractiveSession,
  tokens: readonly string[],
): Promise<ICommandResult> {
  const [agentId, offset] = tokens;
  if (!agentId) return { message: 'Usage: agent read <agent-id> [offset]', success: false };
  const cursor = offset ? { offset: Number.parseInt(offset, 10) } : undefined;
  const page = await session.readBackgroundTaskLog(agentId, cursor);
  const next = page.nextCursor ? `\nNext offset: ${page.nextCursor.offset}` : '';
  return {
    message: page.lines.length > 0 ? `${page.lines.join('\n')}${next}` : `No log lines: ${agentId}`,
    success: true,
    data: { agentId, nextOffset: page.nextCursor?.offset },
  };
}

async function executeSend(
  session: InteractiveSession,
  tokens: readonly string[],
): Promise<ICommandResult> {
  const [agentId, ...promptParts] = tokens;
  const prompt = promptParts.join(' ').trim();
  if (!agentId || !prompt) {
    return { message: 'Usage: agent send <agent-id> <prompt>', success: false };
  }
  await session.sendAgentJob(agentId, prompt);
  return { message: `Sent input to agent job: ${agentId}`, success: true, data: { agentId } };
}

async function executeStop(
  session: InteractiveSession,
  tokens: readonly string[],
): Promise<ICommandResult> {
  const [agentId, ...reasonParts] = tokens;
  if (!agentId) return { message: 'Usage: agent stop <agent-id> [reason]', success: false };
  await session.cancelAgentJob(agentId, reasonParts.join(' ') || undefined);
  return { message: `Agent job stopped: ${agentId}`, success: true, data: { agentId } };
}

async function executeClose(
  session: InteractiveSession,
  tokens: readonly string[],
): Promise<ICommandResult> {
  const [agentId] = tokens;
  if (!agentId) return { message: 'Usage: agent close <agent-id>', success: false };
  await session.closeAgentJob(agentId);
  return { message: `Agent job closed: ${agentId}`, success: true, data: { agentId } };
}

export async function executeAgentCommand(
  session: InteractiveSession,
  args: string,
): Promise<ICommandResult> {
  const [action = 'list', ...tokens] = tokenizeArgs(args);
  if (action === 'list') return executeList(session);
  if (action === 'run') return executeRun(session, tokens);
  if (action === 'parallel') return executeParallel(session, tokens);
  if (action === 'read' || action === 'open') return executeRead(session, tokens);
  if (action === 'send') return executeSend(session, tokens);
  if (action === 'stop' || action === 'cancel') return executeStop(session, tokens);
  if (action === 'close') return executeClose(session, tokens);
  return { message: USAGE, success: false };
}
