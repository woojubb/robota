import type { IRelayReply, TJson, TJsonObject } from './outcome-coding-protocol.js';

/**
 * The host-side relay for a trial. It sits between the worker (which has no network and no
 * credential) and whatever answers model requests, and decides what may pass: only requests that
 * match the trial's policy are forwarded, and each forwarded request is attempted exactly once.
 * The reply source is injected: a scripted source offline, a live gateway client elsewhere.
 */

export interface IRelayPolicy {
  /** The one URL a request may name. */
  readonly endpoint: string;
  /** The one model a request may name. */
  readonly model: string;
  /** Function tools a request may declare or call. */
  readonly allowedTools: readonly string[];
  /** Fields a forwarded request must carry; a request with a different value is refused. */
  readonly forced: TJsonObject;
  readonly maxBodyBytes: number;
  /** Epoch milliseconds after which no request is forwarded. */
  readonly deadlineAt: number;
  /** Most time one upstream attempt may take. */
  readonly upstreamTimeoutMs: number;
}

export type TRefusalCode =
  | 'malformed'
  | 'deadline'
  | 'endpoint'
  | 'model'
  | 'stream'
  | 'field'
  | 'setting'
  | 'content'
  | 'tool-type'
  | 'tool'
  | 'size'
  | 'admission'
  | 'stopped';

export type TRelayDecision =
  | { readonly ok: true; readonly body: TJsonObject; readonly encoded: string }
  | { readonly ok: false; readonly code: TRefusalCode; readonly detail: string };

/** Top-level request fields a request may carry besides the forced ones. */
const ALLOWED_FIELDS: ReadonlySet<string> = new Set([
  'model',
  'messages',
  'tools',
  'tool_choice',
  'parallel_tool_calls',
]);
const ALLOWED_MESSAGE_FIELDS: ReadonlySet<string> = new Set([
  'role',
  'content',
  'tool_calls',
  'tool_call_id',
  'name',
]);
const ROLES: ReadonlySet<string> = new Set(['system', 'user', 'assistant', 'tool']);

function isObject(value: unknown): value is { readonly [key: string]: TJson } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameJson(a: TJson | undefined, b: TJson | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function refuse(code: TRefusalCode, detail: string): TRelayDecision {
  return { ok: false, code, detail };
}

function checkContent(content: TJson | undefined): string | undefined {
  if (content === undefined || content === null || typeof content === 'string') return undefined;
  if (!Array.isArray(content)) return 'content is neither text nor a list of parts';
  for (const part of content) {
    if (!isObject(part) || part.type !== 'text') return 'only text content is authorized';
  }
  return undefined;
}

function checkToolCalls(
  calls: TJson | undefined,
  allowed: ReadonlySet<string>,
): TRelayDecision | undefined {
  if (calls === undefined) return undefined;
  if (!Array.isArray(calls)) return refuse('malformed', 'tool_calls is not a list');
  for (const call of calls) {
    if (!isObject(call) || call.type !== 'function' || !isObject(call.function)) {
      return refuse('tool-type', 'only function tool calls are authorized');
    }
    if (typeof call.function.name !== 'string' || !allowed.has(call.function.name)) {
      return refuse(
        'tool',
        `a tool call names a tool outside the allow-list: ${String(call.function.name)}`,
      );
    }
  }
  return undefined;
}

function checkMessages(
  messages: TJson | undefined,
  allowed: ReadonlySet<string>,
): TRelayDecision | undefined {
  if (!Array.isArray(messages) || messages.length === 0) {
    return refuse('malformed', 'messages must be a non-empty list');
  }
  for (const message of messages) {
    if (!isObject(message) || typeof message.role !== 'string' || !ROLES.has(message.role)) {
      return refuse('malformed', 'a message has no valid role');
    }
    for (const key of Object.keys(message)) {
      if (!ALLOWED_MESSAGE_FIELDS.has(key))
        return refuse('field', `message field ${key} is not authorized`);
    }
    const problem = checkContent(message.content);
    if (problem !== undefined) return refuse('content', problem);
    const calls = checkToolCalls(message.tool_calls, allowed);
    if (calls !== undefined) return calls;
  }
  return undefined;
}

function checkTools(
  tools: TJson | undefined,
  allowed: ReadonlySet<string>,
): TRelayDecision | undefined {
  if (tools === undefined) return undefined;
  if (!Array.isArray(tools)) return refuse('malformed', 'tools is not a list');
  for (const tool of tools) {
    if (!isObject(tool) || tool.type !== 'function' || !isObject(tool.function)) {
      return refuse('tool-type', 'only function tools are authorized');
    }
    if (typeof tool.function.name !== 'string' || !allowed.has(tool.function.name)) {
      return refuse(
        'tool',
        `a declared tool is outside the allow-list: ${String(tool.function.name)}`,
      );
    }
  }
  return undefined;
}

/**
 * Decides whether one worker request may be forwarded. Pure: the clock is a parameter. An accepted
 * request comes back with the forced fields applied; a request that carries a forced field with a
 * different value, a field outside the authorized set, or anything else outside the policy is refused.
 */
export function validateRelayRequest(
  policy: IRelayPolicy,
  request: { readonly url: string; readonly body: TJson },
  now: number,
): TRelayDecision {
  if (now >= policy.deadlineAt) return refuse('deadline', 'the trial deadline has passed');
  if (request.url !== policy.endpoint)
    return refuse('endpoint', 'the request names another endpoint');
  const body = request.body;
  if (!isObject(body)) return refuse('malformed', 'the request body is not an object');
  if (body.model !== policy.model) return refuse('model', 'the request names another model');
  if (body.stream !== undefined && body.stream !== false) {
    return refuse('stream', 'only non-streaming requests are authorized');
  }
  for (const key of Object.keys(body)) {
    if (!ALLOWED_FIELDS.has(key) && !(key in policy.forced)) {
      return refuse('field', `request field ${key} is not authorized`);
    }
  }
  const allowed = new Set(policy.allowedTools);
  const problem = checkMessages(body.messages, allowed) ?? checkTools(body.tools, allowed);
  if (problem !== undefined) return problem;
  const forwarded: Record<string, TJson> = { ...body };
  for (const [key, value] of Object.entries(policy.forced)) {
    if (key in body && !sameJson(body[key], value)) {
      return refuse('setting', `request field ${key} differs from the forced value`);
    }
    forwarded[key] = value;
  }
  const encoded = JSON.stringify(forwarded);
  if (Buffer.byteLength(encoded) > policy.maxBodyBytes) {
    return refuse('size', 'the request exceeds the size bound');
  }
  return { ok: true, body: forwarded, encoded };
}

/** One attempt at getting a reply. Implementations must not retry; the relay never calls twice. */
export type TUpstream = (call: {
  readonly url: string;
  readonly body: string;
  readonly signal: AbortSignal;
}) => Promise<{ readonly status: number; readonly body: TJson }>;

/**
 * Admission control in front of the reply source, for a paid upstream. It sees each request that
 * passed validation, once, before anything leaves: a refusal means nothing is sent. An accepted
 * request comes back with a ticket that is settled exactly once with whatever the single upstream
 * attempt produced (`undefined` when the attempt threw or timed out). A settlement may stop the
 * run: the reply is then a failure, and every later request is refused without an upstream attempt.
 */
export interface IRelayGate {
  admit(request: {
    readonly id: number;
    readonly encoded: string;
    readonly bytes: number;
    readonly body: TJsonObject;
  }): IGateAdmission;
}

export type IGateAdmission =
  | { readonly ok: true; readonly settle: (answer: IUpstreamAnswer | undefined) => IGateVerdict }
  | { readonly ok: false; readonly detail: string };

export interface IGateVerdict {
  /** When set, the run stops for this reason. */
  readonly stop?: string;
}

export interface IUpstreamAnswer {
  readonly status: number;
  readonly body: TJson;
}

export interface IRelayLogEntry {
  readonly id: number;
  readonly outcome: 'refused' | 'forwarded' | 'upstream-failed' | 'stopped';
  readonly code?: TRefusalCode;
  readonly status: number;
  readonly requestBytes: number;
  /** Zero for a refused request, one otherwise. */
  readonly upstreamAttempts: 0 | 1;
}

export interface ICodingRelay {
  handle(request: {
    readonly id: number;
    readonly url: string;
    readonly body: TJson;
  }): Promise<IRelayReply>;
  readonly log: readonly IRelayLogEntry[];
  /** Total upstream attempts made; equals the number of requests that were not refused. */
  readonly upstreamAttempts: () => number;
  /** Why the run stopped, once a gate has stopped it. */
  readonly stopReason: () => string | undefined;
}

function reply(id: number, status: number, body: TJson): IRelayReply {
  return { kind: 'reply', id, status, body };
}

function failureBody(type: string, message: string, code?: string): TJson {
  return { error: { type, message, ...(code === undefined ? {} : { code }) } };
}

export function createCodingRelay(
  policy: IRelayPolicy,
  upstream: TUpstream,
  now: () => number = Date.now,
  gate?: IRelayGate,
): ICodingRelay {
  const log: IRelayLogEntry[] = [];
  let attempts = 0;
  let stopped: string | undefined;
  const refused = (id: number, code: TRefusalCode, detail: string): IRelayReply => {
    log.push({ id, outcome: 'refused', code, status: 403, requestBytes: 0, upstreamAttempts: 0 });
    return reply(id, 403, failureBody('relay_refusal', detail, code));
  };
  return {
    log,
    upstreamAttempts: () => attempts,
    stopReason: () => stopped,
    async handle(request) {
      if (stopped !== undefined)
        return refused(request.id, 'stopped', `the run is stopped: ${stopped}`);
      const decision = validateRelayRequest(policy, request, now());
      if (!decision.ok) return refused(request.id, decision.code, decision.detail);
      const requestBytes = Buffer.byteLength(decision.encoded);
      const admission = gate?.admit({
        id: request.id,
        encoded: decision.encoded,
        bytes: requestBytes,
        body: decision.body,
      });
      if (admission !== undefined && !admission.ok) {
        return refused(request.id, 'admission', admission.detail);
      }
      attempts += 1;
      const remaining = Math.max(1, policy.deadlineAt - now());
      const timeoutMs = Math.min(policy.upstreamTimeoutMs, remaining);
      const controller = new AbortController();
      let timer: NodeJS.Timeout | undefined;
      let answer: IUpstreamAnswer | undefined;
      try {
        // The one and only attempt: a failure or a timeout is reported, never repeated.
        answer = await Promise.race([
          upstream({ url: policy.endpoint, body: decision.encoded, signal: controller.signal }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new Error('upstream attempt timed out'));
            }, timeoutMs);
          }),
        ]);
      } catch {
        answer = undefined;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
      let verdict: IGateVerdict | undefined;
      if (admission !== undefined && admission.ok) {
        try {
          verdict = admission.settle(answer);
        } catch (error) {
          verdict = {
            stop: `the gate could not settle the call: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }
      if (verdict?.stop !== undefined) {
        stopped = verdict.stop;
        log.push({
          id: request.id,
          outcome: 'stopped',
          status: 502,
          requestBytes,
          upstreamAttempts: 1,
        });
        return reply(
          request.id,
          502,
          failureBody('run_stopped', 'the run was stopped by the spend gate'),
        );
      }
      if (answer === undefined) {
        log.push({
          id: request.id,
          outcome: 'upstream-failed',
          status: 502,
          requestBytes,
          upstreamAttempts: 1,
        });
        return reply(
          request.id,
          502,
          failureBody('upstream_failure', 'the single upstream attempt failed'),
        );
      }
      log.push({
        id: request.id,
        outcome: 'forwarded',
        status: answer.status,
        requestBytes,
        upstreamAttempts: 1,
      });
      return reply(request.id, answer.status, answer.body);
    },
  };
}

export interface IScriptedStep {
  /** Tool calls the scripted model makes in this step. */
  readonly toolCalls?: readonly { readonly name: string; readonly args: TJsonObject }[];
  readonly text?: string;
}

/**
 * A reply source with no network and no cost: each request gets the next scripted step as a
 * chat-completion reply. A request past the end of the script gets a server error, so a worker that
 * asks for more than the script allows ends visibly instead of hanging.
 */
export function createScriptedUpstream(
  steps: readonly IScriptedStep[],
): TUpstream & { readonly calls: () => number } {
  let calls = 0;
  const upstream: TUpstream = async ({ body }) => {
    const index = calls++;
    const step = steps[index];
    if (step === undefined) {
      return { status: 500, body: failureBody('script_exhausted', 'no scripted step remains') };
    }
    const requested = JSON.parse(body) as { readonly model?: string };
    const toolCalls = (step.toolCalls ?? []).map((call, position) => ({
      id: `call_${index}_${position}`,
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.args) },
    }));
    const message: TJson =
      toolCalls.length > 0
        ? { role: 'assistant', content: null, tool_calls: toolCalls }
        : { role: 'assistant', content: step.text ?? '' };
    return {
      status: 200,
      body: {
        id: `scripted-${index + 1}`,
        object: 'chat.completion',
        created: 1,
        model: requested.model ?? 'scripted',
        choices: [
          { index: 0, message, finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop' },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
    };
  };
  return Object.assign(upstream, { calls: () => calls });
}
