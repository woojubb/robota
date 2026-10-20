/** Shared fixtures: a scriptable session and an SDK editor client wired to the transport over in-memory streams. */

import { PassThrough, Readable, Writable } from 'node:stream';

import { client, ndJsonStream } from '@agentclientprotocol/sdk';
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { vi } from 'vitest';

import type { Mock } from 'vitest';

import { createAcpTransport } from '../acp-transport.js';

import type { IAcpTransport, IAcpTransportOptions, IAcpTransportSession } from '../acp-types.js';
import type {
  ClientConnection,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionUpdate,
} from '@agentclientprotocol/sdk';
import type {
  IExecutionResult,
  IInteractiveSession,
  IInteractiveSessionEvents,
  ITurnHandle,
  TInteractiveEventName,
} from '@robota-sdk/agent-interface-session';

export const SESSION_ID = 'robota-session-1';
export const WORKSPACE = '/workspace';

export function executionResult(response = '', interrupted?: true): IExecutionResult {
  return {
    response,
    ...(interrupted ? { interrupted } : {}),
    history: [],
    toolSummaries: [],
    contextState: { usedTokens: 0, maxTokens: 1, usedPercentage: 0, remainingPercentage: 100 },
  };
}

/** A turn that has already ended with `result`. */
export function endedTurn(result: IExecutionResult = executionResult()): ITurnHandle {
  return { turnId: 'turn-1', completed: Promise.resolve(result) };
}

type TListener = (...args: never[]) => void;

export interface IFakeSession {
  readonly session: IInteractiveSession;
  readonly submit: Mock<IInteractiveSession['submit']>;
  readonly abort: Mock<IInteractiveSession['abort']>;
  readonly resolvePermission: Mock<IInteractiveSession['resolvePermission']>;
  emit<E extends TInteractiveEventName>(
    event: E,
    ...args: Parameters<IInteractiveSessionEvents[E]>
  ): void;
  listenerCount(event: TInteractiveEventName): number;
  /** Every event name `on` was ever called with. */
  readonly everSubscribed: Set<string>;
}

/**
 * A session whose events the test emits. `submit` is supplied per test; by default it ends the turn
 * at once with an empty reply.
 */
export function createFakeSession(
  submit: IInteractiveSession['submit'] = () => Promise.resolve(endedTurn()),
): IFakeSession {
  const listeners = new Map<string, Set<TListener>>();
  const everSubscribed = new Set<string>();
  const submitMock = vi.fn(submit);
  const abort = vi.fn<IInteractiveSession['abort']>();
  const resolvePermission = vi.fn<IInteractiveSession['resolvePermission']>();
  const base = createTestInteractiveSession({
    getStatusSnapshot: () => ({
      sessionId: SESSION_ID,
      model: 'test-model',
      permissionMode: 'default',
      effort: 'auto',
      context: { usedTokens: 0, maxTokens: 1, usedPercentage: 0, remainingPercentage: 100 },
      goal: null,
    }),
    submit: submitMock,
    abort,
    resolvePermission,
    on: ((event: string, handler: TListener) => {
      everSubscribed.add(event);
      const set = listeners.get(event) ?? new Set();
      set.add(handler);
      listeners.set(event, set);
    }) as IInteractiveSession['on'],
    off: ((event: string, handler: TListener) => {
      listeners.get(event)?.delete(handler);
    }) as IInteractiveSession['off'],
  });
  return {
    session: base,
    submit: submitMock,
    abort,
    resolvePermission,
    emit: (event, ...args) => {
      for (const handler of [...(listeners.get(event) ?? [])]) {
        (handler as (...a: unknown[]) => void)(...args);
      }
    },
    listenerCount: (event) => listeners.get(event)?.size ?? 0,
    everSubscribed,
  };
}

export interface IEditor {
  readonly connection: ClientConnection;
  readonly updates: SessionUpdate[];
  readonly permissionRequests: RequestPermissionRequest[];
  /** What the editor answers when asked for permission. */
  answerPermission(
    answer: (
      request: RequestPermissionRequest,
    ) => RequestPermissionResponse | Promise<RequestPermissionResponse>,
  ): void;
  readonly input: PassThrough;
  readonly output: PassThrough;
}

export interface ITransportFixture {
  readonly transport: IAcpTransport;
  readonly editor: IEditor;
  readonly deliveryErrors: { error: Error; context: string }[];
  readonly options: IAcpTransportOptions;
}

export function createTransportOptions(
  input: PassThrough,
  output: PassThrough,
  overrides: Partial<IAcpTransportOptions> = {},
): IAcpTransportOptions {
  return {
    input,
    output,
    agentInfo: { name: 'robota', version: '1.2.3' },
    cwd: WORKSPACE,
    admitWorkspace: () => ({ admitted: true }),
    ...overrides,
  };
}

/** Attach `session` to a transport and connect an SDK editor client to it. */
export async function startTransport(
  session: IAcpTransportSession,
  overrides: Partial<IAcpTransportOptions> = {},
): Promise<ITransportFixture & { stop(): Promise<void> }> {
  const input = new PassThrough();
  const output = new PassThrough();
  const deliveryErrors: { error: Error; context: string }[] = [];
  const options = createTransportOptions(input, output, {
    onDeliveryError: (error, context) => deliveryErrors.push({ error, context }),
    ...overrides,
  });
  const transport = createAcpTransport(options);
  transport.attach(session);
  await transport.start();

  const updates: SessionUpdate[] = [];
  const permissionRequests: RequestPermissionRequest[] = [];
  let answer: Parameters<IEditor['answerPermission']>[0] = () => ({
    outcome: { outcome: 'cancelled' },
  });
  const app = client({ name: 'test-editor' })
    .onNotification('session/update', ({ params }) => {
      updates.push(params.update);
    })
    .onRequest('session/request_permission', async ({ params }) => {
      permissionRequests.push(params);
      return answer(params);
    });
  const connection = app.connect(
    ndJsonStream(
      Writable.toWeb(input) as WritableStream<Uint8Array>,
      Readable.toWeb(output) as ReadableStream<Uint8Array>,
    ),
  );
  const editor: IEditor = {
    connection,
    updates,
    permissionRequests,
    answerPermission: (next) => {
      answer = next;
    },
    input,
    output,
  };
  return {
    transport,
    editor,
    deliveryErrors,
    options,
    stop: async () => {
      connection.close();
      await transport.stop();
    },
  };
}

/** Initialize and create the session, as every editor does first. */
export async function openSession(editor: IEditor): Promise<string> {
  await editor.connection.agent.request('initialize', { protocolVersion: 1 });
  const created = await editor.connection.agent.request('session/new', {
    cwd: WORKSPACE,
    mcpServers: [],
  });
  return created.sessionId;
}

export function textPrompt(text: string): { type: 'text'; text: string }[] {
  return [{ type: 'text', text }];
}

export async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}
