/**
 * Issue #3288 §1 (review item 5): the child's own session must be built with a `permissionHandler`
 * that forwards a tool call needing approval to the parent — dropping that one line in
 * `child-process-subagent-worker.ts` (`createSubagentSession({ …, permissionHandler:
 * requestParentPermission })`) is exactly the regression that shipped the original bug (the child had
 * no approver in its own process at all). This drives the real `runSubagentWorkerMain` in-process —
 * no spawned child, no real provider — mocking only `createSubagentSession` to capture the option the
 * worker constructs it with, then exercising that captured `permissionHandler` directly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createSubagentSessionMock } = vi.hoisted(() => ({
  createSubagentSessionMock: vi.fn(),
}));

vi.mock('@robota-sdk/agent-framework', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-framework')>();
  return { ...actual, createSubagentSession: createSubagentSessionMock };
});

import { runSubagentWorkerMain } from '../child-process-subagent-worker.js';
import { sealConnectionEnvironment } from '@robota-sdk/agent-executor';

import type { ISubagentWorkerComposition } from '../worker-composition.js';

// The runtime shape of `@robota-sdk/agent-session`'s `TPermissionHandler`, spelled locally: this
// package's own SPEC forbids importing that package directly (session lifecycle is reached only
// through `agent-framework` facades), even from a test.
type TPermissionHandlerLike = (
  toolName: string,
  toolArgs: Record<string, unknown>,
  context?: { signal?: AbortSignal },
) => Promise<unknown>;

const COMPOSITION: ISubagentWorkerComposition = {
  createTools: () => [],
  providerDefinitions: [
    {
      type: 'scratch-provider',
      destinationEnvironment: [],
      createProvider: () => ({ name: 'scratch-provider', chat: () => Promise.resolve() }) as never,
    },
  ],
};

function startPayload(): Record<string, unknown> {
  return {
    taskId: 'agent_1',
    request: {
      permissionPolicy: 'inherit-allowlist',
      agentType: 'tester',
      label: 'Tester',
      parentSessionId: 'session_1',
      mode: 'background',
      depth: 1,
      cwd: process.cwd(),
      prompt: 'do work',
    },
    agentDefinition: {
      name: 'tester',
      description: 'Test subagent',
      systemPrompt: 'Run test tasks.',
    },
    parentConfig: {},
    parentContext: { agentsMd: '', projectNotesMd: '' },
    providerProfile: { type: 'scratch-provider', model: 'scratch-model' },
    connectionCheck: sealConnectionEnvironment([], {}),
  };
}

type TProcessSend = NonNullable<typeof process.send>;
/** `process.send` is typed optional, which `vi.spyOn`'s `keyof` constraint rejects directly. */
const sendableProcess = process as unknown as { send: TProcessSend };

describe('child-process-subagent-worker: the child session gets a permissionHandler (#3288 §1)', () => {
  let sendMock: ReturnType<typeof vi.fn>;
  // A spy, not a global reassignment, and never `process.emit(...)`: this test runner is ITSELF a
  // Node worker process using `process.send`/`'message'` for its own IPC with the parent vitest
  // process (tinypool) — emitting a synthetic `'message'` event, or leaving `process.send` replaced,
  // would collide with that real channel. `mockRestore()` in `afterEach` undoes the spy immediately.
  let sendSpy: { mockImplementation: (impl: TProcessSend) => unknown; mockRestore: () => void };

  beforeEach(() => {
    sendMock = vi.fn();
    sendSpy = vi.spyOn(sendableProcess, 'send');
    sendSpy.mockImplementation(sendMock as unknown as TProcessSend);
    createSubagentSessionMock.mockReset();
    // `run()` never settles — this test only needs the constructor call, not a finished turn.
    createSubagentSessionMock.mockReturnValue({
      run: () => new Promise<never>(() => {}),
      getFullHistory: () => [],
    });
  });

  afterEach(() => {
    sendSpy.mockRestore();
  });

  /**
   * The registered `'message'` handler, called DIRECTLY rather than via `process.emit('message', …)`
   * — emitting on the real, shared `process` EventEmitter would also reach whatever this test runner's
   * own worker-pool machinery has listening for the exact same event, for an unrelated protocol.
   * `runSubagentWorkerMain` registers exactly one `'message'` listener; the most recently added one is
   * always the current call's, so a stray listener some other test forgot to remove cannot be reached.
   */
  function realMessageHandler(): (message: unknown) => void {
    const listeners = process.listeners('message') as ((message: unknown) => void)[];
    const handler = listeners.at(-1);
    if (handler === undefined) throw new Error('runSubagentWorkerMain registered no message listener');
    return handler;
  }

  it('wires a permissionHandler that sends a permission_request to the parent over IPC', async () => {
    runSubagentWorkerMain(COMPOSITION);
    const handler = realMessageHandler();
    try {
      handler({ type: 'start', payload: startPayload() });

      await vi.waitFor(() => expect(createSubagentSessionMock).toHaveBeenCalledTimes(1));

      const options = createSubagentSessionMock.mock.calls[0]?.[0] as {
        permissionHandler?: TPermissionHandlerLike;
      };
      expect(options.permissionHandler).toBeTypeOf('function');

      // Invoke it exactly as the enforcer would for a call needing approval, and observe the send.
      sendMock.mockClear();
      void options.permissionHandler?.('Glob', { pattern: '**/*' });
      await vi.waitFor(() => expect(sendMock).toHaveBeenCalled());

      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'permission_request',
          requestId: expect.any(String),
          toolName: 'Glob',
          toolArgs: { pattern: '**/*' },
        }),
      );
    } finally {
      // This test's own handler must not linger on the shared `process` past this test.
      process.removeListener('message', handler);
    }
  });
});
