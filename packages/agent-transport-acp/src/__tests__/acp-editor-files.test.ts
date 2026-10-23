/**
 * Issue #3550 item 4 — the editor's `clientCapabilities.fs` reaches the host as a file access bound to
 * the session, only when the editor offers it, and goes away when the transport stops.
 */
import { PassThrough, Readable, Writable } from 'node:stream';

import { client, ndJsonStream, RequestError } from '@agentclientprotocol/sdk';
import { afterEach, describe, expect, it } from 'vitest';

import { createAcpTransport } from '../acp-transport.js';
import {
  createFakeSession,
  createTransportOptions,
  SESSION_ID,
  WORKSPACE,
} from './acp-test-harness.js';

import type {
  IAcpEditorFileAccess,
  IAcpTransportOptions,
  IAcpTransportSession,
} from '../acp-types.js';
import type {
  ClientCapabilities,
  ReadTextFileRequest,
  WriteTextFileRequest,
} from '@agentclientprotocol/sdk';

const open: { stop(): Promise<void> }[] = [];
afterEach(async () => {
  while (open.length) await open.pop()!.stop();
});

interface IEditorFs {
  read?: (params: ReadTextFileRequest, signal: AbortSignal) => Promise<string>;
  write?: (params: WriteTextFileRequest) => Promise<void>;
}

/** A transport with an SDK editor that answers `fs/*` the way `fs` says, recording what it was asked. */
async function start(
  fs: IEditorFs = {},
  overrides: Partial<IAcpTransportOptions> = {},
  session: IAcpTransportSession = createFakeSession().session,
) {
  const input = new PassThrough();
  const output = new PassThrough();
  const offered: (IAcpEditorFileAccess | undefined)[] = [];
  const transport = createAcpTransport(
    createTransportOptions(input, output, {
      ...overrides,
      onEditorFileAccess: (access) => offered.push(access),
    }),
  );
  transport.attach(session);
  await transport.start();
  const reads: ReadTextFileRequest[] = [];
  const writes: WriteTextFileRequest[] = [];
  const connection = client({ name: 'test-editor' })
    .onRequest('fs/read_text_file', async ({ params, signal }) => {
      reads.push(params);
      return { content: await (fs.read ?? (async () => 'BUFFER'))(params, signal) };
    })
    .onRequest('fs/write_text_file', async ({ params }) => {
      writes.push(params);
      await fs.write?.(params);
      return {};
    })
    .connect(
      ndJsonStream(
        Writable.toWeb(input) as WritableStream<Uint8Array>,
        Readable.toWeb(output) as ReadableStream<Uint8Array>,
      ),
    );
  const fixture = {
    transport,
    agent: connection.agent,
    offered,
    reads,
    writes,
    stop: async () => {
      connection.close();
      await transport.stop();
    },
  };
  open.push(fixture);
  return fixture;
}

async function openSession(
  agent: Awaited<ReturnType<typeof start>>['agent'],
  clientCapabilities?: ClientCapabilities,
): Promise<void> {
  await agent.request('initialize', {
    protocolVersion: 1,
    ...(clientCapabilities ? { clientCapabilities } : {}),
  });
  await agent.request('session/new', { cwd: WORKSPACE, mcpServers: [] });
}

const BOTH: ClientCapabilities = { fs: { readTextFile: true, writeTextFile: true } };

describe('the editor file system', () => {
  it('is handed to the host once the session is bound, and carries reads and writes for it', async () => {
    const fixture = await start();
    await fixture.agent.request('initialize', { protocolVersion: 1, clientCapabilities: BOTH });
    expect(fixture.offered).toEqual([]);
    await fixture.agent.request('session/new', { cwd: WORKSPACE, mcpServers: [] });
    expect(fixture.offered).toHaveLength(1);
    const access = fixture.offered[0]!;

    await expect(access.readTextFile!(`${WORKSPACE}/a.txt`)).resolves.toBe('BUFFER');
    await access.writeTextFile!(`${WORKSPACE}/b.txt`, 'new text');
    expect(fixture.reads).toEqual([{ sessionId: SESSION_ID, path: `${WORKSPACE}/a.txt` }]);
    expect(fixture.writes).toEqual([
      { sessionId: SESSION_ID, path: `${WORKSPACE}/b.txt`, content: 'new text' },
    ]);
  });

  it.each(['load-first', 'new-then-load'])(
    'offers file access after a %s binding and addresses the loaded session',
    async (order) => {
      const fake = createFakeSession();
      const snapshot = fake.session.getStatusSnapshot();
      let currentId = SESSION_ID;
      fake.session.getStatusSnapshot = () => ({ ...snapshot, sessionId: currentId });
      const fixture = await start(
        {},
        {
          loadSession: async (id) => {
            currentId = id;
            return { loaded: true };
          },
        },
        fake.session,
      );
      await fixture.agent.request('initialize', { protocolVersion: 1, clientCapabilities: BOTH });
      if (order === 'new-then-load') {
        await fixture.agent.request('session/new', { cwd: WORKSPACE, mcpServers: [] });
      }
      const previousAccess = fixture.offered.at(-1);
      await fixture.agent.request('session/load', {
        sessionId: 'loaded-session',
        cwd: WORKSPACE,
        mcpServers: [],
      });
      expect(fixture.offered).toHaveLength(order === 'load-first' ? 1 : 2);
      const access = fixture.offered.at(-1);
      await expect(access?.readTextFile?.(`${WORKSPACE}/loaded.txt`)).resolves.toBe('BUFFER');
      await access?.writeTextFile?.(`${WORKSPACE}/loaded.txt`, 'LOADED');
      expect(fixture.reads).toEqual([
        { sessionId: 'loaded-session', path: `${WORKSPACE}/loaded.txt` },
      ]);
      expect(fixture.writes).toEqual([
        { sessionId: 'loaded-session', path: `${WORKSPACE}/loaded.txt`, content: 'LOADED' },
      ]);
      if (previousAccess !== undefined) {
        await previousAccess.readTextFile?.(`${WORKSPACE}/previous-access.txt`);
        expect(fixture.reads.at(-1)?.sessionId).toBe('loaded-session');
      }
      await fixture.stop();
      expect(fixture.offered.at(-1)).toBeUndefined();
    },
  );

  it('carries only what the editor offered', async () => {
    const fixture = await start();
    await openSession(fixture.agent, { fs: { readTextFile: true, writeTextFile: false } });
    expect(Object.keys(fixture.offered[0]!)).toEqual(['readTextFile']);
  });

  it.each([
    ['no client capabilities', undefined],
    ['an fs that offers nothing', { fs: { readTextFile: false, writeTextFile: false } }],
    ['terminals only', { terminal: true }],
  ])('is never handed over for an editor with %s', async (_label, capabilities) => {
    const fixture = await start();
    await openSession(fixture.agent, capabilities);
    await fixture.stop();
    expect(fixture.offered).toEqual([]);
  });

  it('is withdrawn when the transport stops', async () => {
    const fixture = await start();
    await openSession(fixture.agent, BOTH);
    await fixture.stop();
    expect(fixture.offered).toHaveLength(2);
    expect(fixture.offered[1]).toBeUndefined();
  });

  it("rejects with the editor's reason", async () => {
    const fixture = await start({
      read: async (params) => {
        throw RequestError.resourceNotFound(params.path);
      },
      write: async () => {
        throw new Error('the buffer is read-only');
      },
    });
    await openSession(fixture.agent, BOTH);
    const access = fixture.offered[0]!;
    await expect(access.readTextFile!(`${WORKSPACE}/gone.txt`)).rejects.toThrow(
      `Resource not found: ${WORKSPACE}/gone.txt`,
    );
    await expect(access.writeTextFile!(`${WORKSPACE}/a.txt`, 'x')).rejects.toThrow(
      'Internal error: the buffer is read-only',
    );
  });

  it('sends no request for a relative path', async () => {
    const fixture = await start();
    await openSession(fixture.agent, BOTH);
    const access = fixture.offered[0]!;
    await expect(access.readTextFile!('a.txt')).rejects.toThrow('absolute paths only');
    await expect(access.writeTextFile!('a.txt', 'x')).rejects.toThrow('absolute paths only');
    expect(fixture.reads).toEqual([]);
    expect(fixture.writes).toEqual([]);
  });

  it("cancels the editor's request when the tool's signal aborts", async () => {
    let editorSignal: AbortSignal | undefined;
    const fixture = await start({
      read: (_params, signal) =>
        new Promise((_resolve, reject) => {
          editorSignal = signal;
          signal.addEventListener('abort', () => reject(RequestError.requestCancelled()));
        }),
    });
    await openSession(fixture.agent, BOTH);
    const controller = new AbortController();
    const reading = fixture.offered[0]!.readTextFile!(`${WORKSPACE}/a.txt`, controller.signal);
    await expect.poll(() => editorSignal).toBeDefined();
    controller.abort();
    await expect(reading).rejects.toThrow('Request cancelled');
    expect(editorSignal?.aborted).toBe(true);
  });
});
