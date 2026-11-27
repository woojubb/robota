/**
 * An in-memory ACP agent for tests, built with the SDK's agent side over `PassThrough` pairs. It
 * records every JSON-RPC message the client side writes, as parsed from the wire, so a test can pin
 * exact payloads rather than what the SDK chose to hand a handler.
 */
import { PassThrough, Readable, Writable } from 'node:stream';

import { agent, ndJsonStream } from '@agentclientprotocol/sdk';
import type {
  AgentContext,
  PromptRequest,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionUpdate,
} from '@agentclientprotocol/sdk';

import type { AcpConnection, AcpLauncher } from './launcher';

export interface WireMessage {
  jsonrpc: string;
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

export interface FakePromptCall {
  readonly params: PromptRequest;
  readonly sessionId: string;
  /** The connection back to the client, for requests the agent makes of it. */
  readonly peer: AgentContext;
  /** Resolves when the client sends `session/cancel` for this prompt's session. */
  readonly cancelled: Promise<void>;
  update(update: SessionUpdate): Promise<void>;
  chunk(text: string): Promise<void>;
  requestPermission(
    request: Pick<RequestPermissionRequest, 'options' | 'toolCall'> & { sessionId?: string },
  ): Promise<RequestPermissionResponse>;
}

export interface FakeAgentBehavior {
  protocolVersion?: number;
  sessionId?: string;
  /** `hang` never answers; `fail` answers with a JSON-RPC error. */
  initialize?: 'hang' | 'fail';
  newSession?: 'hang' | 'fail';
  prompt?: (call: FakePromptCall) => PromptResponse | Promise<PromptResponse>;
  /** Called with the connection to the client as soon as the agent has one. */
  onConnect?: (peer: AgentContext) => void;
}

export interface FakeAgent {
  readonly launcher: AcpLauncher;
  /** Everything the client side wrote, in order, across every launch. */
  readonly wire: WireMessage[];
  /** Everything the agent side wrote, in order, across every launch. */
  readonly agentWire: WireMessage[];
  /** Resolves once the agent has written a message the predicate accepts. */
  whenAgentWrote(match: (message: WireMessage) => boolean): Promise<void>;
  /** The `session/prompt` requests among them. */
  prompts(): { sessionId: string; prompt: unknown }[];
  /** Notifications the agent received, by method. */
  readonly notifications: { method: string; params: unknown }[];
  /** Resolves once the agent has received `count` notifications of `method` in total. */
  whenNotified(method: string, count?: number): Promise<void>;
  readonly launches: { conversationId: string; participantId: string }[];
  closes(): number;
  /** Resolves once the connection has been closed `count` times in total. */
  whenClosed(count?: number): Promise<void>;
  /** The agent's own side of the connection of the latest launch. */
  peer(): AgentContext | undefined;
  /** End the agent's side of the latest launch, as a crashed agent process would. */
  crash(): void;
}

function tapLines(onLine: (line: string) => void): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  let buffered = '';
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffered += decoder.decode(chunk, { stream: true });
      let newline = buffered.indexOf('\n');
      while (newline >= 0) {
        onLine(buffered.slice(0, newline));
        buffered = buffered.slice(newline + 1);
        newline = buffered.indexOf('\n');
      }
      controller.enqueue(chunk);
    },
  });
}

const never = (): Promise<never> => new Promise<never>(() => {});

export function createFakeAgent(
  behavior: FakeAgentBehavior = {},
  options: { launchGate?: Promise<void> } = {},
): FakeAgent {
  const wire: WireMessage[] = [];
  const agentWire: WireMessage[] = [];
  const agentWaiters: { match: (message: WireMessage) => boolean; resolve: () => void }[] = [];
  const notifications: { method: string; params: unknown }[] = [];
  const launches: { conversationId: string; participantId: string }[] = [];
  let closeCount = 0;
  const closeWaiters: { count: number; resolve: () => void }[] = [];
  const notificationWaiters: { method: string; count: number; resolve: () => void }[] = [];
  const cancelWaiters: { sessionId: string; resolve: () => void }[] = [];
  const cancelledSessions = new Set<string>();
  let latestPeer: AgentContext | undefined;
  let latestCrash: (() => void) | undefined;

  const launcher: AcpLauncher = {
    async launch(context) {
      launches.push({ ...context });
      if (options.launchGate) await options.launchGate;
      const clientToAgent = new PassThrough();
      const agentToClient = new PassThrough();
      const toAgentInput = (
        Readable.toWeb(clientToAgent) as unknown as ReadableStream<Uint8Array>
      ).pipeThrough(
        tapLines((line) => {
          if (line.trim() !== '') wire.push(JSON.parse(line) as WireMessage);
        }),
      );

      const app = agent({ name: 'fake-agent' })
        .onRequest('initialize', async () => {
          if (behavior.initialize === 'hang') return never();
          if (behavior.initialize === 'fail') throw new Error('initialize refused');
          return { protocolVersion: behavior.protocolVersion ?? 1, agentCapabilities: {} };
        })
        .onRequest('session/new', async () => {
          if (behavior.newSession === 'hang') return never();
          if (behavior.newSession === 'fail') throw new Error('session/new refused');
          return { sessionId: behavior.sessionId ?? 'fake-session-1' };
        })
        .onRequest('session/prompt', async ({ params, client: peer }) => {
          const call: FakePromptCall = {
            params,
            sessionId: params.sessionId,
            peer,
            cancelled: cancelledSessions.has(params.sessionId)
              ? Promise.resolve()
              : new Promise<void>((resolve) =>
                  cancelWaiters.push({ sessionId: params.sessionId, resolve }),
                ),
            update: (update) =>
              peer.notify('session/update', { sessionId: params.sessionId, update }),
            chunk: (text) =>
              peer.notify('session/update', {
                sessionId: params.sessionId,
                update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
              }),
            requestPermission: (request) =>
              peer.request('session/request_permission', {
                sessionId: params.sessionId,
                ...request,
              }),
          };
          return behavior.prompt ? behavior.prompt(call) : { stopReason: 'end_turn' };
        })
        .onNotification('session/cancel', ({ params }) => {
          notifications.push({ method: 'session/cancel', params });
          cancelledSessions.add(params.sessionId);
          for (const waiter of cancelWaiters.filter((w) => w.sessionId === params.sessionId)) {
            waiter.resolve();
          }
          for (const waiter of [...notificationWaiters]) {
            if (notifications.filter((n) => n.method === waiter.method).length >= waiter.count) {
              notificationWaiters.splice(notificationWaiters.indexOf(waiter), 1);
              waiter.resolve();
            }
          }
        });
      const agentOutput = tapLines((line) => {
        if (line.trim() === '') return;
        const written = JSON.parse(line) as WireMessage;
        agentWire.push(written);
        for (const waiter of [...agentWaiters]) {
          if (waiter.match(written)) {
            agentWaiters.splice(agentWaiters.indexOf(waiter), 1);
            waiter.resolve();
          }
        }
      });
      agentOutput.readable
        .pipeTo(Writable.toWeb(agentToClient) as unknown as WritableStream<Uint8Array>)
        .catch(() => {
          // The connection was closed under it; there is nothing left to deliver.
        });
      const connection = app.connect(ndJsonStream(agentOutput.writable, toAgentInput));
      latestPeer = connection.client;
      behavior.onConnect?.(connection.client);

      let closed = false;
      const shutdown = (): void => {
        if (closed) return;
        closed = true;
        connection.close();
        clientToAgent.destroy();
        agentToClient.destroy();
      };
      latestCrash = shutdown;
      const acpConnection: AcpConnection = {
        toAgent: Writable.toWeb(clientToAgent) as unknown as WritableStream<Uint8Array>,
        fromAgent: Readable.toWeb(agentToClient) as unknown as ReadableStream<Uint8Array>,
        async close() {
          closeCount += 1;
          shutdown();
          for (const waiter of closeWaiters) if (closeCount >= waiter.count) waiter.resolve();
        },
      };
      return acpConnection;
    },
  };

  return {
    launcher,
    wire,
    agentWire,
    whenAgentWrote: (match) =>
      agentWire.some(match)
        ? Promise.resolve()
        : new Promise<void>((resolve) => agentWaiters.push({ match, resolve })),
    prompts: () =>
      wire
        .filter((message) => message.method === 'session/prompt')
        .map((message) => message.params as { sessionId: string; prompt: unknown }),
    notifications,
    whenNotified: (method, count = 1) =>
      notifications.filter((n) => n.method === method).length >= count
        ? Promise.resolve()
        : new Promise<void>((resolve) => notificationWaiters.push({ method, count, resolve })),
    launches,
    closes: () => closeCount,
    whenClosed: (count = 1) =>
      closeCount >= count
        ? Promise.resolve()
        : new Promise<void>((resolve) => closeWaiters.push({ count, resolve })),
    peer: () => latestPeer,
    crash: () => latestCrash?.(),
  };
}

export function deferred<T = void>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
