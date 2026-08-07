/**
 * RUNTIME-003 P2 — an MCP `submit` must be answered by ITS OWN turn.
 *
 * `waitForCompletion` subscribes to the session-global `complete` / `interrupted` / `error` events
 * with no request correlation, so the first terminal event to fire resolves whichever call is
 * listening. A session runs one turn at a time and queues the rest, which means a second `submit`
 * arriving during a turn does not start anything — it waits, and then takes the RUNNING turn's
 * result as its own answer.
 *
 * The case drives the real request handler over the SDK's in-memory transport pair rather than
 * reaching into the server's private handler map, because the defect lives at the seam between the
 * session's events and the MCP response, and a unit that skipped that seam would not see it.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-transport';
import { describe, expect, it, vi } from 'vitest';

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-transport/testing';

import { createAgentMcpServer } from '../mcp-server.js';

/**
 * A session that behaves the way the real one does: one turn at a time, later submissions queued,
 * and every turn answered with the text it was given so a crossed answer is visible by name.
 */
function createQueueingSession() {
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const emit = (event: string, data: unknown): void => {
    for (const handler of [...(listeners.get(event) ?? [])]) handler(data);
  };

  interface IQueued {
    prompt: string;
    turnId: string;
    settle: (result: unknown) => void;
  }
  const queue: IQueued[] = [];
  let running = false;
  let minted = 0;

  const runNext = async (): Promise<void> => {
    const next = queue.shift();
    if (next === undefined) {
      running = false;
      return;
    }
    running = true;
    await new Promise((resolve) => setTimeout(resolve, 10));
    const result = { success: true, response: `answer to ${next.prompt}` };
    // Both are emitted: the session-global event (what every attached surface still sees) AND the
    // settling of this submission's own handle. Keeping the event is what lets the case tell the two
    // apart — a correlation that only worked because the event had stopped firing would prove
    // nothing about correlation.
    emit('complete', result);
    next.settle(result);
    await runNext();
  };

  // Built on the PUBLISHED conformant double rather than a cast. A cast to `IInteractiveSession` is
  // a partial re-implementation nothing checks against the real contract: it compiles whatever it
  // happens to contain, so a member the contract gains later is silently absent here.
  const session = createTestInteractiveSession({
    submit: async (input: string) => {
      const turnId = `turn-${++minted}`;
      let settle!: (result: unknown) => void;
      const completed = new Promise((resolve) => {
        settle = resolve;
      });
      queue.push({ prompt: input, turnId, settle });
      if (!running) void runNext();
      return { turnId, completed };
    },
    abort: vi.fn(),
    cancelQueue: vi.fn(),
    isExecuting: () => running,
    getPendingPrompt: () => null,
    getMessages: () => [],
    getContextState: () => ({ usedTokens: 0, maxTokens: 200000, usedPercentage: 0 }),
    executeCommand: vi.fn(),
    listCommands: () => [],
    on: (event: string, handler: (data: unknown) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)?.add(handler);
    },
    off: (event: string, handler: (data: unknown) => void) => {
      listeners.get(event)?.delete(handler);
    },
  } as never);

  return session;
}

async function connectedClient(session: IInteractiveSession): Promise<Client> {
  const server = createAgentMcpServer({ name: 'test-agent', version: '1.0.0', session });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content ?? [];
  return content.map((part) => part.text ?? '').join('');
}

describe('RUNTIME-003: an MCP submit is answered by its own turn', () => {
  it('does not hand one turn’s answer to two callers', async () => {
    const client = await connectedClient(createQueueingSession());

    const [first, second] = await Promise.all([
      client.callTool({ name: 'submit', arguments: { prompt: 'AAAA' } }),
      client.callTool({ name: 'submit', arguments: { prompt: 'BBBB' } }),
    ]);

    // The failure is not that an answer is missing — both calls return. It is that they return the
    // SAME answer, because both were listening to one session-global event.
    expect(textOf(first), 'the first caller was answered by a turn it did not ask for').toBe(
      'answer to AAAA',
    );
    expect(textOf(second), 'the second caller was handed the running turn’s answer').toBe(
      'answer to BBBB',
    );
  });
});
