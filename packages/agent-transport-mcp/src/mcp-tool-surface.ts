/** One canonical tool catalog and invocation path shared by stdio and HTTP MCP carriers. */
import { inputRequired, inputResponse, specTypeSchemas } from '@modelcontextprotocol/server';
import { isTurnNotRunError } from '@robota-sdk/agent-interface-session';

import { McpCallPrompts, mintCallDriverId, promptForm } from './mcp-call-prompts.js';

import type { TMcpCallPrompt } from './mcp-call-prompts.js';
import type { McpPendingCalls } from './mcp-pending-calls.js';
import type { IMcpTransportSession } from './mcp-session.js';
import type {
  CallToolResult,
  ElicitRequestFormParams,
  ElicitResult,
  InputRequiredResult,
  Tool,
} from '@modelcontextprotocol/server';
import type { TDriverId } from '@robota-sdk/agent-interface-session';

export interface IMcpSubmitToolIdentity {
  readonly name: string;
  readonly description: string;
}

const DEFAULT_SUBMIT_TOOL: IMcpSubmitToolIdentity = {
  name: 'agent_submit',
  description: 'Submit a prompt to the agent and await its turn',
};

/**
 * How the client that made a call can be asked about the prompts the call raises, when the
 * operator enabled that and the client declared form-mode elicitation. Absent: the call runs as
 * it always has, and a prompt it raises is a tool error.
 */
export type TMcpCaller =
  /** A stateful connection: a question goes to the client as an elicitation request and its answer comes back on the same connection. */
  | {
      readonly kind: 'elicit';
      readonly elicit: (form: ElicitRequestFormParams, signal: AbortSignal) => Promise<ElicitResult>;
    }
  /** A stateless exchange on the 2026-07-28 era: a question is returned as an input-required result and the client's retry carries the answer. */
  | {
      readonly kind: 'rounds';
      readonly pending: McpPendingCalls;
      /** The token a retry echoes; absent on a fresh call. */
      readonly requestState: string | undefined;
      readonly inputResponses: Record<string, unknown> | undefined;
    };

/**
 * The SDK's own validator for the wire shape of a tool: a catalog entry it rejects never ships. The
 * candidate is validated as the JSON a peer receives, so a schema member that serialization drops
 * (an `undefined` value, a function) never fails the catalog — the carriers always sent it that way.
 */
function parseTool(candidate: unknown): Tool {
  const outcome = specTypeSchemas.Tool['~standard'].validate(
    JSON.parse(JSON.stringify(candidate)) as unknown,
  );
  if (outcome.issues !== undefined) {
    const reasons = outcome.issues.map((issue) => {
      const path = issue.path
        ?.map((segment) => (typeof segment === 'object' ? segment.key : segment))
        .map(String)
        .join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    });
    throw new Error(`Invalid MCP tool: ${reasons.join('; ')}`);
  }
  return outcome.value;
}

export function resolveSubmitTool(identity: IMcpSubmitToolIdentity = DEFAULT_SUBMIT_TOOL): Tool {
  if (typeof identity.name !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(identity.name)) {
    throw new Error(
      'MCP submit tool name must contain 1–128 ASCII letters, digits, dots, hyphens, or underscores',
    );
  }
  return parseTool({
    name: identity.name,
    description: identity.description,
    inputSchema: {
      type: 'object' as const,
      properties: { prompt: { type: 'string', minLength: 1 } },
      required: ['prompt'],
      additionalProperties: false,
    },
  });
}

export async function readCatalog(
  session: IMcpTransportSession,
  submitToolName: string,
): Promise<Tool[]> {
  const names = new Set([submitToolName]);
  return (await session.listRuntimeTools()).map((schema) => {
    if (names.has(schema.name)) {
      throw new Error(`Duplicate or reserved MCP tool name: ${schema.name}`);
    }
    names.add(schema.name);
    return parseTool({
      name: schema.name,
      description: schema.description,
      inputSchema: schema.parameters,
    });
  });
}

function toolError(message: string): CallToolResult {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return typeof value === 'object' && Object.values(value).every(isJsonValue);
}

function isRuntimeParameters(
  value: Record<string, unknown>,
): value is Parameters<IMcpTransportSession['invokeRuntimeTool']>[1] {
  return Object.values(value).every(isJsonValue);
}

/** The invocation a call stands for, run under a signal and, when prompts are routed, the call's driver id. */
type TCallWork = (signal: AbortSignal, driverId: TDriverId | undefined) => Promise<CallToolResult>;

async function prepareCall(
  session: IMcpTransportSession,
  toolName: string,
  parameters: Record<string, unknown>,
  signal: AbortSignal,
  submitToolName: string,
): Promise<CallToolResult | TCallWork> {
  let catalog: Tool[];
  try {
    signal.throwIfAborted();
    catalog = await readCatalog(session, submitToolName);
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error));
  }
  if (toolName === submitToolName) {
    const prompt = parameters.prompt;
    if (
      typeof prompt !== 'string' ||
      prompt.length === 0 ||
      Object.keys(parameters).some((key) => key !== 'prompt')
    ) {
      return toolError(
        `${submitToolName} requires a non-empty string prompt and no other arguments`,
      );
    }
    return async (callSignal, driverId) => {
      try {
        const handle = await session.submit(prompt, undefined, undefined, {
          signal: callSignal,
          ...(driverId !== undefined ? { driverId } : {}),
        });
        const result = await handle.completed;
        return { content: [{ type: 'text', text: result.response }] };
      } catch (error) {
        if (!isTurnNotRunError(error) && !callSignal.aborted) throw error;
        return toolError(error instanceof Error ? error.message : String(error));
      }
    };
  }
  if (!catalog.some((tool) => tool.name === toolName))
    return toolError(`Unknown tool: ${toolName}`);
  if (!isRuntimeParameters(parameters)) return toolError('Tool arguments must contain JSON values');
  const runtimeParameters = parameters;
  return async (callSignal, driverId) => {
    try {
      const result = await session.invokeRuntimeTool(toolName, runtimeParameters, {
        signal: callSignal,
        ...(driverId !== undefined ? { driverId } : {}),
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        isError: !result.success,
      };
    } catch (error) {
      return toolError(error instanceof Error ? error.message : String(error));
    }
  };
}

export async function invokeMcpTool(
  session: IMcpTransportSession,
  toolName: string,
  parameters: Record<string, unknown>,
  signal: AbortSignal,
  submitToolName: string,
  caller?: TMcpCaller,
): Promise<CallToolResult | InputRequiredResult> {
  if (caller?.kind === 'rounds' && caller.requestState !== undefined) {
    return resumeRound(caller.pending, caller.requestState, caller.inputResponses, signal);
  }
  const prepared = await prepareCall(session, toolName, parameters, signal, submitToolName);
  if (typeof prepared !== 'function') return prepared;
  if (caller === undefined) return prepared(signal, undefined);
  if (caller.kind === 'elicit') return runWithElicitation(session, prepared, signal, caller.elicit);
  return runRounds(session, prepared, signal, caller.pending);
}

/** Puts one prompt to the client and settles it with the answer; withdrawn if the session settles it first. */
async function askClient(
  prompts: McpCallPrompts,
  prompt: TMcpCallPrompt,
  elicit: Extract<TMcpCaller, { kind: 'elicit' }>['elicit'],
  callSignal: AbortSignal,
): Promise<void> {
  const form = promptForm(prompt);
  if (form === undefined) {
    prompts.settle(prompt, undefined);
    return;
  }
  const withdraw = new AbortController();
  const unhook = prompts.whenSettled(prompt.event.id, () => withdraw.abort());
  const onCallAbort = (): void => withdraw.abort();
  callSignal.addEventListener('abort', onCallAbort, { once: true });
  let result: ElicitResult | undefined;
  try {
    result = await elicit(form, withdraw.signal);
  } catch {
    // allow-fallback: a client that refuses the question, disconnects or times out has allowed nothing; the prompt settles closed.
    result = undefined;
  } finally {
    unhook();
    callSignal.removeEventListener('abort', onCallAbort);
  }
  prompts.settle(prompt, result);
}

/** A stateful connection: every prompt the call raises is put to the client while the call runs. */
async function runWithElicitation(
  session: IMcpTransportSession,
  work: TCallWork,
  signal: AbortSignal,
  elicit: Extract<TMcpCaller, { kind: 'elicit' }>['elicit'],
): Promise<CallToolResult> {
  const prompts = new McpCallPrompts(session, mintCallDriverId());
  const stop = new AbortController();
  const answering = new Set<Promise<void>>();
  const pump = (async () => {
    for (;;) {
      const prompt = await prompts.next(stop.signal);
      const answer = askClient(prompts, prompt, elicit, signal).finally(() => {
        answering.delete(answer);
      });
      answering.add(answer);
    }
  })().catch(() => undefined);
  try {
    return await work(signal, prompts.driverId);
  } finally {
    stop.abort();
    await pump;
    prompts.close();
    await Promise.all(answering);
  }
}

interface IRoundCall {
  readonly prompts: McpCallPrompts;
  readonly outcome: Promise<CallToolResult>;
  readonly abort: AbortController;
}

/** A stateless exchange: the call starts here and may be parked for the client's answer. */
function runRounds(
  session: IMcpTransportSession,
  work: TCallWork,
  exchangeSignal: AbortSignal,
  pending: McpPendingCalls,
): Promise<CallToolResult | InputRequiredResult> {
  const abort = new AbortController();
  const prompts = new McpCallPrompts(session, mintCallDriverId());
  const outcome = work(abort.signal, prompts.driverId).finally(() => prompts.close());
  return nextRound({ prompts, outcome, abort }, exchangeSignal, pending);
}

/** The retry exchange: the answer settles the parked prompt and the call carries on from where it waited. */
function resumeRound(
  pending: McpPendingCalls,
  requestState: string,
  inputResponses: Record<string, unknown> | undefined,
  exchangeSignal: AbortSignal,
): Promise<CallToolResult | InputRequiredResult> {
  const parked = pending.take(requestState);
  if (parked === undefined) return Promise.resolve(toolError('Unknown or expired request state'));
  const view = inputResponse(inputResponses, parked.prompt.event.id);
  parked.prompts.settle(parked.prompt, view.kind === 'elicit' ? answerContent(view) : undefined);
  return nextRound(parked, exchangeSignal, pending);
}

/**
 * A retry's answer as an elicitation result. The SDK does not validate what the client sent back;
 * only form values (a string, number, boolean or list of strings) are kept, so the prompt mapping
 * reads the same shapes a connection delivers.
 */
function answerContent(view: Extract<ReturnType<typeof inputResponse>, { kind: 'elicit' }>): ElicitResult {
  const content: NonNullable<ElicitResult['content']> = {};
  for (const [key, value] of Object.entries(view.content ?? {})) {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      (Array.isArray(value) && value.every((item) => typeof item === 'string'))
    ) {
      content[key] = value as string | number | boolean | string[];
    }
  }
  return { action: view.action, ...(view.content !== undefined ? { content } : {}) };
}

/**
 * Waits for the call's result or its next prompt. A result ends the exchange as usual; a prompt
 * parks the call and ends the exchange with the question. The invocation is bound to the exchange
 * only while the exchange waits on it: a client that leaves mid-wait cancels the call, a client
 * that is being asked has not left.
 */
async function nextRound(
  call: IRoundCall,
  exchangeSignal: AbortSignal,
  pending: McpPendingCalls,
): Promise<CallToolResult | InputRequiredResult> {
  const onExchangeAbort = (): void => call.abort.abort();
  exchangeSignal.addEventListener('abort', onExchangeAbort, { once: true });
  const waiting = new AbortController();
  try {
    for (;;) {
      const next = await Promise.race([
        call.outcome.then((result) => ({ result })),
        call.prompts.next(waiting.signal).then((prompt) => ({ prompt })),
      ]);
      if ('result' in next) return next.result;
      const form = promptForm(next.prompt);
      if (form === undefined) {
        call.prompts.settle(next.prompt, undefined);
        continue;
      }
      exchangeSignal.removeEventListener('abort', onExchangeAbort);
      const requestState = pending.park({ ...call, prompt: next.prompt });
      return inputRequired({
        inputRequests: { [next.prompt.event.id]: inputRequired.elicit(form) },
        requestState,
      });
    }
  } finally {
    waiting.abort();
    exchangeSignal.removeEventListener('abort', onExchangeAbort);
  }
}
