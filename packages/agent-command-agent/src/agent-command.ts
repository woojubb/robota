import type { ICommandResult, InteractiveSession } from '@robota-sdk/agent-sdk';
import { parseParallelRequests, parseRunRequest, tokenizeArgs } from './agent-command-parser.js';
import type { IAgentRunRequest } from './agent-command-parser.js';

const USAGE =
  'Usage: agent list | agent run [<agent>] [--agent <agent>] [--background] <prompt> | agent parallel <label>:"<prompt>" [<label>=<agent>:"<prompt>"] --background | agent read <agent-id> [offset] | agent send <agent-id> <prompt> | agent stop <agent-id> [reason] | agent close <agent-id>';

function formatError<TError>(error: TError): string {
  return error instanceof Error ? error.message : String(error);
}

function getAvailableAgentNames(session: InteractiveSession): ReadonlySet<string> {
  return new Set(session.listAgentDefinitions().map((agent) => agent.name));
}

function validateAgentType(
  session: InteractiveSession,
  agentType: string,
): ICommandResult | undefined {
  const agents = session.listAgentDefinitions();
  if (agents.some((agent) => agent.name === agentType)) return undefined;
  return {
    message: `Unknown agent type: ${agentType}\nAvailable agents: ${agents.map((agent) => agent.name).join(', ')}`,
    success: false,
  };
}

async function spawnAgentJob(
  session: InteractiveSession,
  request: IAgentRunRequest,
): Promise<ICommandResult | { state: Awaited<ReturnType<InteractiveSession['spawnAgentJob']>> }> {
  const invalid = validateAgentType(session, request.agentType);
  if (invalid) return invalid;
  try {
    return { state: await session.spawnAgentJob(request) };
  } catch (error) {
    return { message: formatError(error), success: false };
  }
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
  const request = parseRunRequest(tokens, getAvailableAgentNames(session));
  if (!request) {
    return {
      message: 'Usage: agent run [<agent>] [--agent <agent>] [--background] <prompt>',
      success: false,
    };
  }

  const spawned = await spawnAgentJob(session, request);
  if ('success' in spawned) return spawned;
  const { state } = spawned;

  if (request.mode === 'background') {
    return {
      message: `Started agent job: ${state.id}`,
      success: true,
      data: { agentId: state.id, status: state.status },
    };
  }

  try {
    const result = await session.waitAgentJob(state.id);
    return {
      message: result.output,
      success: true,
      data: { agentId: state.id, output: result.output },
    };
  } catch (error) {
    return { message: formatError(error), success: false, data: { agentId: state.id } };
  }
}

async function executeParallel(
  session: InteractiveSession,
  tokens: readonly string[],
): Promise<ICommandResult> {
  const jobs = parseParallelRequests(tokens, getAvailableAgentNames(session));

  if (jobs.length === 0) {
    return {
      message: 'Usage: agent parallel <label>:"<prompt>" [<label>=<agent>:"<prompt>"] --background',
      success: false,
    };
  }

  const invalid = jobs
    .map((job) => validateAgentType(session, job.agentType))
    .find((result): result is ICommandResult => result !== undefined);
  if (invalid) return invalid;

  let states: Array<Awaited<ReturnType<InteractiveSession['spawnAgentJob']>>>;
  try {
    states = await Promise.all(jobs.map((job) => session.spawnAgentJob(job)));
  } catch (error) {
    return { message: formatError(error), success: false };
  }

  if (jobs.every((job) => job.mode === 'background')) {
    return {
      message: [
        'Started agent jobs:',
        ...states.map((state) => `${state.label}: ${state.id}`),
      ].join('\n'),
      success: true,
      data: { agentIds: states.map((state) => state.id) },
    };
  }

  try {
    const results = await Promise.all(states.map((state) => session.waitAgentJob(state.id)));
    return {
      message: results.map((result) => result.output).join('\n\n'),
      success: true,
      data: { agentIds: states.map((state) => state.id) },
    };
  } catch (error) {
    return { message: formatError(error), success: false };
  }
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
  try {
    const [action = 'list', ...tokens] = tokenizeArgs(args);
    if (action === 'list') return executeList(session);
    if (action === 'run') return executeRun(session, tokens);
    if (action === 'parallel') return executeParallel(session, tokens);
    if (action === 'read' || action === 'open') return executeRead(session, tokens);
    if (action === 'send') return executeSend(session, tokens);
    if (action === 'stop' || action === 'cancel') return executeStop(session, tokens);
    if (action === 'close') return executeClose(session, tokens);
    return { message: USAGE, success: false };
  } catch (error) {
    return { message: formatError(error), success: false };
  }
}
