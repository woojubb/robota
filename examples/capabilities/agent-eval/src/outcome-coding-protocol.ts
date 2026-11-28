/**
 * The line protocol between a trial's host and the worker process it starts. Shared by both sides
 * and free of task data, so the worker image can carry it. The host writes one JSON line per
 * message to the worker's stdin; the worker writes prefixed JSON lines to stdout (any other output
 * line is a diagnostic). The worker holds no credential: every model request leaves it as a
 * `request` message and returns only through the host's `reply`.
 */

export const WIRE_PREFIX = 'BENCH:';

export type TJson =
  null | boolean | number | string | readonly TJson[] | { readonly [key: string]: TJson };

export type TJsonObject = { readonly [key: string]: TJson };

/** One role of the delegation arm, as data the worker needs: no task, solution or verifier text. */
export interface IDelegationRoleInit {
  readonly name: string;
  /** Text the role's system message carries, by which both sides recognize the role. */
  readonly marker: string;
  readonly description: string;
  /** The role's prompt body; it contains the marker. */
  readonly systemPrompt: string;
  /** Tools the role's requests may declare and call. */
  readonly tools: readonly string[];
  readonly maxTurns: number;
}

export interface IDelegationInit {
  /** The role the session itself runs as; every other role is a child job. */
  readonly parent: string;
  readonly roles: readonly IDelegationRoleInit[];
  /** Most child jobs the trial may start; one more is refused and recorded. */
  readonly maxJobs: number;
}

/** What the worker observed of the child jobs, in milliseconds since its session started. */
export interface IDelegationReport {
  readonly jobsStarted: number;
  readonly jobsRefused: number;
  /** The agent types refused because they are not a child role (each also counts in `jobsRefused`). */
  readonly refusedAgentTypes?: readonly string[];
  readonly jobs: readonly {
    readonly agent: string;
    readonly startMs: number;
    readonly endMs: number | null;
  }[];
}

/** Everything the worker needs to run one trial, supplied at runtime and never compiled in. */
export interface IWorkerInit {
  readonly kind: 'init';
  readonly prompt: string;
  readonly model: string;
  /** Full request URL the relay expects; the worker's client derives its base URL from it. */
  readonly endpoint: string;
  /** Directory the agent works in (the task tree). */
  readonly projectDir: string;
  /** Directory that holds the throwaway git repository the trust check needs. */
  readonly gitRoot: string;
  readonly homeDir: string;
  readonly stateDir: string;
  readonly systemPrompt: string;
  readonly allowedTools: readonly string[];
  readonly deniedTools: readonly string[];
  readonly maxTurns: number;
  readonly maxTokens: number;
  readonly temperature: number;
  /** The worker aborts its own run after this long. */
  readonly abortAfterMs: number;
  /** Present for the delegation arm: the roles, and the child job limit. */
  readonly delegation?: IDelegationInit;
}

export interface IWorkerRequest {
  readonly kind: 'request';
  readonly id: number;
  readonly url: string;
  readonly body: TJson;
}

export interface IRelayReply {
  readonly kind: 'reply';
  readonly id: number;
  readonly status: number;
  readonly body: TJson;
}

export interface IWorkerResult {
  readonly kind: 'result';
  /** The run reached a normal completion (no error, not interrupted). */
  readonly completed: boolean;
  readonly interrupted: boolean;
  readonly response: string;
  readonly toolCalls: number;
  readonly toolNames: readonly string[];
  readonly usage: TJson;
  readonly elapsedMs: number;
  readonly error?: string;
  readonly delegation?: IDelegationReport;
}

export function encodeHostLine(message: IWorkerInit | IRelayReply): string {
  return `${JSON.stringify(message)}\n`;
}

export function encodeWorkerLine(message: IWorkerRequest | IWorkerResult): string {
  return `${WIRE_PREFIX}${JSON.stringify(message)}\n`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Parses a worker stdout line; `undefined` for a diagnostic or a malformed message. */
export function parseWorkerLine(line: string): IWorkerRequest | IWorkerResult | undefined {
  if (!line.startsWith(WIRE_PREFIX)) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(line.slice(WIRE_PREFIX.length));
  } catch {
    return undefined;
  }
  if (!isObject(value)) return undefined;
  if (
    value.kind === 'request' &&
    typeof value.id === 'number' &&
    Number.isInteger(value.id) &&
    typeof value.url === 'string'
  ) {
    return { kind: 'request', id: value.id, url: value.url, body: value.body as TJson };
  }
  if (
    value.kind === 'result' &&
    typeof value.completed === 'boolean' &&
    typeof value.interrupted === 'boolean' &&
    typeof value.response === 'string' &&
    typeof value.toolCalls === 'number' &&
    Array.isArray(value.toolNames) &&
    typeof value.elapsedMs === 'number'
  ) {
    return {
      kind: 'result',
      completed: value.completed,
      interrupted: value.interrupted,
      response: value.response,
      toolCalls: value.toolCalls,
      toolNames: value.toolNames.filter((name): name is string => typeof name === 'string'),
      usage: (value.usage ?? null) as TJson,
      elapsedMs: value.elapsedMs,
      ...(typeof value.error === 'string' ? { error: value.error } : {}),
      ...(isObject(value.delegation)
        ? { delegation: value.delegation as unknown as IDelegationReport }
        : {}),
    };
  }
  return undefined;
}

/** Parses a host stdin line; `undefined` for anything that is not a well-formed message. */
export function parseHostLine(line: string): IWorkerInit | IRelayReply | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isObject(value)) return undefined;
  if (
    value.kind === 'reply' &&
    typeof value.id === 'number' &&
    Number.isInteger(value.id) &&
    typeof value.status === 'number'
  ) {
    return { kind: 'reply', id: value.id, status: value.status, body: value.body as TJson };
  }
  const strings = [
    'prompt',
    'model',
    'endpoint',
    'projectDir',
    'gitRoot',
    'homeDir',
    'stateDir',
    'systemPrompt',
  ] as const;
  const numbers = ['maxTurns', 'maxTokens', 'temperature', 'abortAfterMs'] as const;
  const lists = ['allowedTools', 'deniedTools'] as const;
  if (
    value.kind === 'init' &&
    strings.every((key) => typeof value[key] === 'string') &&
    numbers.every((key) => typeof value[key] === 'number') &&
    lists.every(
      (key) =>
        Array.isArray(value[key]) &&
        (value[key] as unknown[]).every((entry) => typeof entry === 'string'),
    )
  ) {
    return value as unknown as IWorkerInit;
  }
  return undefined;
}
