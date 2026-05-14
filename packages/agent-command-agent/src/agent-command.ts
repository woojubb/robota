import { summarizeBackgroundJobGroup } from '@robota-sdk/agent-sdk';
import type { ICommandResult, InteractiveSession } from '@robota-sdk/agent-sdk';
import { parseParallelRequests, parseRunRequest, tokenizeArgs } from './agent-command-parser.js';
import type { IAgentRunRequest } from './agent-command-parser.js';

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

function executeOpenSwitcher(): ICommandResult {
  return { message: '', effects: [{ type: 'agent-switcher-requested' }], success: true };
}

async function executeList(session: InteractiveSession): Promise<ICommandResult> {
  const agents = session.listAgentDefinitions();
  const jobs = session.listAgentJobs();
  const lines = [
    'Available agents:',
    ...agents.map((agent) => `  ${agent.name} - ${agent.description}`),
    '',
    jobs.length === 0 ? 'No active agent jobs.' : 'Agent jobs:',
    ...jobs.map((job) => `  ${formatAgentJobLine(job)}`),
  ];
  return {
    message: lines.join('\n'),
    success: true,
    data: { agents: agents.length, jobs: jobs.length },
  };
}

function formatAgentJobLine(job: ReturnType<InteractiveSession['listAgentJobs']>[number]): string {
  const worktree = [
    job.worktreePath ? `worktree=${job.worktreePath}` : undefined,
    job.branchName ? `branch=${job.branchName}` : undefined,
  ].filter((segment): segment is string => segment !== undefined);
  const metadata = worktree.length > 0 ? ` ${worktree.join(' ')}` : '';
  return `${job.id} [${job.status}${metadata}] ${job.label} - ${job.promptPreview}`;
}

async function executeRun(
  session: InteractiveSession,
  tokens: readonly string[],
): Promise<ICommandResult> {
  const request = parseRunRequest(tokens, getAvailableAgentNames(session));
  if (!request) {
    return {
      message: 'Usage: agent run [AGENT_NAME] [--agent AGENT_NAME] PROMPT',
      success: false,
    };
  }

  const spawned = await spawnAgentJob(session, request);
  if ('success' in spawned) return spawned;
  const { state } = spawned;

  return {
    message: `Started agent job: ${state.id}`,
    success: true,
    data: { agentId: state.id, status: state.status },
  };
}

async function executeParallel(
  session: InteractiveSession,
  tokens: readonly string[],
): Promise<ICommandResult> {
  const wait = tokens.includes('--wait') || !tokens.includes('--detach');
  const commandTokens = tokens.filter((token) => token !== '--wait' && token !== '--detach');
  const jobs = parseParallelRequests(commandTokens, getAvailableAgentNames(session));

  if (jobs.length === 0) {
    return {
      message: 'Usage: agent parallel [--wait|--detach] LABEL:"PROMPT" [LABEL=AGENT_NAME:"PROMPT"]',
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
  const group = session.createBackgroundJobGroup({
    waitPolicy: 'wait_all',
    taskIds: states.map((state) => state.id),
    label: 'agent parallel',
  });

  if (wait) {
    const completed = await session.waitBackgroundJobGroup(group.id);
    const summary = summarizeBackgroundJobGroup(completed);
    return {
      message: formatGroupSummary(summary),
      success: true,
      data: { agentIds: states.map((state) => state.id), groupId: group.id, summary },
    };
  }

  return {
    message: ['Started agent jobs:', ...states.map((state) => `${state.label}: ${state.id}`)].join(
      '\n',
    ),
    success: true,
    data: { agentIds: states.map((state) => state.id), groupId: group.id },
  };
}

async function executeWait(
  session: InteractiveSession,
  tokens: readonly string[],
): Promise<ICommandResult> {
  const [groupId] = tokens;
  if (!groupId) return { message: 'Usage: agent wait GROUP_ID', success: false };
  const completed = await session.waitBackgroundJobGroup(groupId);
  const summary = summarizeBackgroundJobGroup(completed);
  return {
    message: formatGroupSummary(summary),
    success: true,
    data: { groupId, summary },
  };
}

async function executeRead(
  session: InteractiveSession,
  tokens: readonly string[],
): Promise<ICommandResult> {
  const [agentId, offset] = tokens;
  if (!agentId) return { message: 'Usage: agent read AGENT_ID [OFFSET]', success: false };
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
    return { message: 'Usage: agent send AGENT_ID PROMPT', success: false };
  }
  await session.sendAgentJob(agentId, prompt);
  return { message: `Sent input to agent job: ${agentId}`, success: true, data: { agentId } };
}

async function executeStop(
  session: InteractiveSession,
  tokens: readonly string[],
): Promise<ICommandResult> {
  const [agentId, ...reasonParts] = tokens;
  if (!agentId) return { message: 'Usage: agent stop AGENT_ID [REASON]', success: false };
  await session.cancelAgentJob(agentId, reasonParts.join(' ') || undefined);
  return { message: `Agent job stopped: ${agentId}`, success: true, data: { agentId } };
}

async function executeClose(
  session: InteractiveSession,
  tokens: readonly string[],
): Promise<ICommandResult> {
  const [agentId] = tokens;
  if (!agentId) return { message: 'Usage: agent close AGENT_ID', success: false };
  await session.closeAgentJob(agentId);
  return { message: `Agent job closed: ${agentId}`, success: true, data: { agentId } };
}

export async function executeAgentCommand(
  session: InteractiveSession,
  args: string,
): Promise<ICommandResult> {
  try {
    if (args.trim() === '') return executeOpenSwitcher();
    const [action = 'list', ...tokens] = tokenizeArgs(args);
    if (action === 'list' && tokens.length === 0) return executeList(session);
    if (action === 'run') return executeRun(session, tokens);
    if (action === 'parallel') return executeParallel(session, tokens);
    if (action === 'wait') return executeWait(session, tokens);
    if (action === 'read' || action === 'open') return executeRead(session, tokens);
    if (action === 'send') return executeSend(session, tokens);
    if (action === 'stop' || action === 'cancel') return executeStop(session, tokens);
    if (action === 'close') return executeClose(session, tokens);
    return executeRun(session, [action, ...tokens]);
  } catch (error) {
    return { message: formatError(error), success: false };
  }
}

function formatGroupSummary(summary: ReturnType<typeof summarizeBackgroundJobGroup>): string {
  const header = `Background job group ${summary.groupId}: ${summary.status} (${summary.completed}/${summary.total} completed, ${summary.failed} failed, ${summary.cancelled} cancelled, ${summary.pending} pending)`;
  return [header, ...summary.lines].join('\n');
}
