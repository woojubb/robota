/**
 * Runs one coding trial on the current runtime API, inside the worker container (or any process the
 * host starts). It reads one `init` line from stdin, then drives a headless session whose model client
 * relays every request over stdio to the host, with no retries and no credential. The runtime sees an
 * ordinary chat-completions client; the host decides what actually leaves the machine.
 *
 * This file and the protocol file are the only parts of the example the worker image carries: it
 * imports no task, solution or verifier data.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import {
  buildRuntimeSession,
  createAgentRuntime,
  createInProcessSubagentRunner,
  runEval,
} from '@robota-sdk/agent-framework';
import {
  createNodeFrameworkHost,
  createNodeWorkspaceTrustService,
} from '@robota-sdk/agent-framework/node';
import { createAgentCommandModule } from '@robota-sdk/agent-product/command';
import { OpenAIProvider } from '@robota-sdk/agent-provider/openai';
import { createDefaultTools } from '@robota-sdk/agent-tools/defaults';
import OpenAI from 'openai';

import { childAgentDefinitions, createJobLimiter } from './outcome-delegation-limits.js';
import { roleByMarker } from './outcome-delegation-roles.js';
import {
  encodeWorkerLine,
  parseHostLine,
  type IDelegationInit,
  type IRelayReply,
  type IWorkerInit,
  type IWorkerRequest,
  type IWorkerResult,
  type TJson,
} from './outcome-coding-protocol.js';

const CHAT_PATH = '/chat/completions';

function emit(message: IWorkerRequest | IWorkerResult): void {
  process.stdout.write(encodeWorkerLine(message));
}

/** Reads stdin lines: resolves the init message and routes replies to their waiting request. */
function listen(): { init: Promise<IWorkerInit>; reply: (id: number) => Promise<IRelayReply> } {
  const pending = new Map<number, (reply: IRelayReply) => void>();
  let initialize: (init: IWorkerInit) => void = () => undefined;
  const init = new Promise<IWorkerInit>((resolve) => {
    initialize = resolve;
  });
  const lines = createInterface({ input: process.stdin });
  lines.on('line', (line) => {
    const message = parseHostLine(line);
    if (message?.kind === 'init') initialize(message);
    else if (message?.kind === 'reply') {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });
  // The host closing stdin ends the trial: nothing can be answered any more.
  lines.on('close', () => process.exit(3));
  return {
    init,
    reply: (id) =>
      new Promise<IRelayReply>((resolve) => {
        pending.set(id, resolve);
      }),
  };
}

/**
 * The runtime declares session-control tools (goal status, loop decision) that no session option
 * turns off. The model-visible tool set is the baseline's, so the declaration is cut down to the
 * allow-list before the request leaves; the host's relay still refuses anything that remains.
 */
function visibleToolsOnly(
  body: TJson,
  fallback: readonly string[],
  delegation: IDelegationInit | undefined,
): TJson {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return body;
  // In the delegation arm each role sees only its own tools; a request of no known role gets the
  // session's set and is refused by the host's attribution.
  const allowed =
    delegation === undefined ? fallback : (roleByMarker(delegation.roles, body)?.tools ?? fallback);
  const { tools, ...rest } = body as { readonly [key: string]: TJson };
  if (!Array.isArray(tools)) return body;
  const kept = tools.filter((tool) => {
    const declared = (tool as { readonly function?: { readonly name?: TJson } }).function?.name;
    return typeof declared === 'string' && allowed.includes(declared);
  });
  return kept.length > 0 ? { ...rest, tools: kept } : rest;
}

function baseUrlFor(endpoint: string): string {
  if (!endpoint.endsWith(CHAT_PATH)) {
    throw new Error(`The endpoint must end with ${CHAT_PATH}`);
  }
  return endpoint.slice(0, -CHAT_PATH.length);
}

/** A git repository outside the task tree: the trust check needs one, and the tree must stay clean. */
function prepareWorkspace(init: IWorkerInit): void {
  mkdirSync(init.homeDir, { recursive: true });
  mkdirSync(init.stateDir, { recursive: true });
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(environment)) if (key.startsWith('GIT_')) delete environment[key];
  if (!existsSync(join(init.gitRoot, '.git'))) {
    execFileSync('git', ['init', '--quiet', init.gitRoot], { env: environment });
  }
}

async function main(): Promise<void> {
  const { init: initialMessage, reply } = listen();
  const init = await initialMessage;
  // Disposable per trial: both live in memory-backed storage the host discards with the container.
  process.env.HOME = init.homeDir;
  process.env.PRODUCT_USER_STATE_DIR = init.stateDir;
  // The task tree is a mount inside the scratch repository's directory: git must look across it.
  process.env.GIT_DISCOVERY_ACROSS_FILESYSTEM = '1';
  prepareWorkspace(init);

  let sequence = 0;
  const client = new OpenAI({
    apiKey: 'relay-holds-the-credential',
    baseURL: baseUrlFor(init.endpoint),
    maxRetries: 0,
    fetch: async (url, options) => {
      const id = ++sequence;
      const waiting = reply(id);
      emit({
        kind: 'request',
        id,
        url: String(url),
        body: visibleToolsOnly(
          JSON.parse(String(options?.body ?? 'null')) as TJson,
          init.allowedTools,
          init.delegation,
        ),
      });
      const answer = await waiting;
      return new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const provider = new OpenAIProvider({
    client,
    baseURL: baseUrlFor(init.endpoint),
    defaultModel: init.model,
    apiSurface: 'chat-completions',
  });
  // Completed headless turns only: keep the native non-streaming adapter and the pinned settings.
  const chat = provider.chat.bind(provider);
  provider.chat = (messages, options) => {
    provider.onTextDelta = undefined;
    return chat(messages, {
      ...options,
      onTextDelta: undefined,
      maxTokens: init.maxTokens,
      temperature: init.temperature,
    });
  };
  provider.chatStream = async function* (messages, options) {
    yield await provider.chat(messages, options);
  };

  const trust = createNodeWorkspaceTrustService(join(init.homeDir, 'trust.json'), {
    sessions: '.bench-state/sessions',
    'session-logs': '.bench-state/logs',
    memory: '.bench-state/memory',
    checkpoints: '.bench-state/checkpoints',
  });
  // The embedding host authorizes this one disposable project, never a user's checkout.
  const projectAccess = await trust.grant(init.projectDir);
  // The parent has no write tool: its session never registers one. The children are lent theirs
  // through the wrapped runner factory instead.
  const parentRegistersNoWrites = init.delegation !== undefined;
  const WRITE_TOOLS = ['Write', 'Edit'];
  const childOnlyTools = createDefaultTools({ cwd: init.projectDir }).filter((tool) =>
    WRITE_TOOLS.includes(tool.getName()),
  );
  const limiter =
    init.delegation === undefined
      ? undefined
      : createJobLimiter({
          inner: createInProcessSubagentRunner,
          maxJobs: init.delegation.maxJobs,
          childAgents: init.delegation.roles
            .filter((role) => role.name !== init.delegation?.parent)
            .map((role) => role.name),
          childOnlyTools,
        });
  const runtime = createAgentRuntime({
    host: createNodeFrameworkHost({
      createDefaultTools: (options) =>
        createDefaultTools(options).filter(
          (tool) => !(parentRegistersNoWrites && WRITE_TOOLS.includes(tool.getName())),
        ),
    }),
    cwd: init.projectDir,
    provider,
    projectAccess,
    userSettingsSources: [],
    backgroundTaskRunners: [],
    sessionStore: undefined,
    ...(limiter === undefined
      ? {}
      : { commandModules: [createAgentCommandModule()], subagentRunnerFactory: limiter.factory }),
  });
  const sessionOptions: Parameters<typeof runtime.createSession>[0] = {
    bare: true,
    model: init.model,
    maxTurns: init.maxTurns,
    sessionStore: undefined,
    permissionMode: 'acceptEdits',
    allowedTools: [...init.allowedTools],
    deniedTools: [...init.deniedTools],
    systemPrompt: init.systemPrompt,
  };
  const session =
    init.delegation === undefined
      ? runtime.createSession(sessionOptions)
      : buildRuntimeSession({
          ...runtime.sessionRecipe(sessionOptions),
          agentDefinitions: childAgentDefinitions(
            init.delegation.roles,
            init.delegation.parent,
            init.model,
          ),
        });

  const started = performance.now();
  const timer = setTimeout(() => session.abort(), init.abortAfterMs);
  let result: IWorkerResult;
  try {
    const handle = await session.submit(init.prompt);
    const run = await handle.completed;
    const completion = await runEval(
      {
        cases: [{ input: init.prompt }],
        metrics: [{ name: 'completed', required: true, score: (r) => !r.interrupted }],
      },
      async () => run,
    );
    result = {
      kind: 'result',
      completed: completion.passed,
      interrupted: Boolean(run.interrupted),
      response: run.response,
      toolCalls: run.toolSummaries.length,
      toolNames: run.toolSummaries.map((summary) => summary.name),
      usage: (run.usage ?? null) as unknown as TJson,
      elapsedMs: performance.now() - started,
      ...(limiter === undefined ? {} : { delegation: limiter.report() }),
    };
  } catch (error) {
    result = {
      kind: 'result',
      completed: false,
      interrupted: false,
      response: '',
      toolCalls: 0,
      toolNames: [],
      usage: null,
      elapsedMs: performance.now() - started,
      error: error instanceof Error ? error.message : String(error),
      ...(limiter === undefined ? {} : { delegation: limiter.report() }),
    };
  } finally {
    clearTimeout(timer);
  }
  emit(result);
  await session.shutdown().catch(() => undefined);
  process.exit(0);
}

await main();
