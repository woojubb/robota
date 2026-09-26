import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRemoteControlCommandModule } from '@robota-sdk/agent-command';
import { InteractiveSession } from '@robota-sdk/agent-framework';
import { MAX_INBOUND_FRAME_BYTES } from '@robota-sdk/agent-transport';
import { describe, expect, it, vi } from 'vitest';

import { once } from 'node:events';
import { PassThrough } from 'node:stream';

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';

import {
  createHandshakeApprover,
  createSupervisedAttachCarrier,
  MAX_ATTACHED_SURFACES,
} from '../supervised-attach.js';
import {
  listSupervisedExternalEvents,
  revokeSupervisedExternalEventGrant,
  startSupervisedControl,
  type ISupervisedControl,
  type ISupervisedExternalEvents,
} from '../supervised-session-control.js';

import type { TServerMessage } from '@robota-sdk/agent-transport';

const ID = '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';

interface IPromptRegistry {
  requestPermission(name: string, args: never): Promise<boolean>;
}

function runtime(run: () => Promise<string>): Record<string, unknown> {
  return {
    run: vi.fn(run),
    abort: vi.fn(),
    clearHistory: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    injectMessage: vi.fn(),
    getContextState: () => ({ maxTokens: 100, usedTokens: 0, usedPercentage: 0, remainingPercentage: 100 }),
    getSessionId: () => 'session_attach',
    getModelId: () => 'test-model',
    getMessageCount: () => 0,
    getSystemMessage: vi.fn().mockReturnValue('system'),
    getToolSchemas: vi.fn().mockReturnValue([]),
    getEventService: () => ({ subscribe: () => {}, unsubscribe: () => {} }),
  };
}

interface IClient {
  readonly socket: Socket;
  readonly frames: TServerMessage[];
  readonly closed: Promise<void>;
  send(frame: unknown): void;
  waitFor<T extends TServerMessage['type']>(type: T): Promise<Extract<TServerMessage, { type: T }>>;
}

async function handshake(
  root: string,
  frame: Record<string, unknown>,
  pipelined = '',
): Promise<{ reply: Record<string, unknown>; client: IClient }> {
  const socketName = readdirSync(root).find((name) => name.endsWith('.sock'))!;
  const socket = createConnection(join(root, socketName));
  socket.on('error', () => undefined);
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
  await new Promise<void>((resolve) => socket.once('connect', resolve));
  socket.setEncoding('utf8');
  const frames: TServerMessage[] = [];
  let buffered = '';
  let reply: Record<string, unknown> | undefined;
  let replied: () => void = () => undefined;
  const replyReady = new Promise<void>((resolve) => { replied = resolve; });
  socket.on('data', (chunk: string) => {
    buffered += chunk;
    let end = buffered.indexOf('\n');
    while (end !== -1) {
      const line = buffered.slice(0, end);
      buffered = buffered.slice(end + 1);
      if (reply === undefined) {
        reply = JSON.parse(line) as Record<string, unknown>;
        replied();
      } else {
        frames.push(JSON.parse(line) as TServerMessage);
      }
      end = buffered.indexOf('\n');
    }
  });
  void closed.then(() => replied());
  socket.write(`${JSON.stringify(frame)}\n${pipelined}`);
  await replyReady;
  const client: IClient = {
    socket,
    frames,
    closed,
    send: (message) => { socket.write(`${JSON.stringify(message)}\n`); },
    waitFor: async (type) => {
      await vi.waitFor(() => {
        if (!frames.some((message) => message.type === type)) throw new Error(`no ${type} yet`);
      });
      return frames.find((message) => message.type === type) as never;
    },
  };
  return { reply: reply ?? {}, client };
}

function generationOf(root: string): string {
  return String((JSON.parse(readFileSync(join(root, ID, 'state.json'), 'utf8')) as { generation?: unknown }).generation);
}

async function withTarget(
  prefix: string,
  run: (context: {
    root: string;
    session: InteractiveSession;
    registry: IPromptRegistry;
    attach: (mode: 'drive' | 'observe', extra?: Record<string, unknown>, pipelined?: string) =>
      Promise<{ reply: Record<string, unknown>; client: IClient }>;
    closeControl: () => Promise<void>;
  }) => Promise<void>,
  options: {
    run?: () => Promise<string>;
    withRemoteControl?: boolean;
    attachable?: boolean;
    externalEvents?: ISupervisedExternalEvents;
  } = {},
): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), prefix));
  const root = join(scratch, 'supervised');
  const session = new InteractiveSession({
    session: runtime(options.run ?? (async () => 'answer')) as never,
    cwd: '/tmp',
    ...(options.withRemoteControl
      ? {
        commandModules: [createRemoteControlCommandModule()],
        commandHostAdapters: { remoteControl: { getStatus: () => ({ state: 'off' as const }) } },
      }
      : {}),
  });
  const registry = (session as unknown as { promptRegistry: IPromptRegistry }).promptRegistry;
  let control: ISupervisedControl | undefined;
  try {
    control = await startSupervisedControl(
      ID, () => undefined, root, () => session.getLocalActivityStatus(), undefined, undefined,
      undefined, undefined, undefined, options.externalEvents,
      options.attachable === false ? undefined : session,
    );
    const attach = (mode: 'drive' | 'observe', extra: Record<string, unknown> = {}, pipelined = '') =>
      handshake(
        root, { command: 'attach', id: ID, generation: generationOf(root), mode, protocol: 1, ...extra },
        pipelined,
      );
    await run({ root, session, registry, attach, closeControl: () => control!.close() });
  } finally {
    await control?.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}

describe('supervised attach carrier', () => {
  it('refuses a handshake with another generation, mode, protocol or id without revealing the generation', async () => {
    await withTarget('rs-a1-', async ({ root, attach }) => {
      const generation = generationOf(root);
      const stale = await handshake(root, { command: 'attach', id: ID, generation: 'A'.repeat(22), mode: 'drive', protocol: 1 });
      expect(stale.reply).toEqual({ id: ID, status: 'refused', reason: 'stale-generation' });
      await stale.client.closed;
      const missing = await handshake(root, { command: 'attach', id: ID, mode: 'drive', protocol: 1 });
      expect(missing.reply).toEqual({ id: ID, status: 'refused', reason: 'stale-generation' });
      const otherId = await handshake(root, {
        command: 'attach', id: 'fe2c7f72-ecb3-4a05-9bb1-2563ec80e615', generation, mode: 'drive', protocol: 1,
      });
      expect(otherId.reply).toEqual({ id: ID, status: 'refused' });
      for (const extra of [{ mode: 'delegate' }, { mode: 'handoff' }, { protocol: 2 }]) {
        const refused = await attach('drive', extra);
        expect(refused.reply).toMatchObject({ id: ID, status: 'refused', reason: 'unsupported-attach' });
        await refused.client.closed;
      }
    });
  });

  it('refuses attach on a session that offers none', async () => {
    await withTarget('rs-a2-', async ({ attach }) => {
      const refused = await attach('drive');
      expect(refused.reply).toMatchObject({ status: 'refused', reason: 'attach-unavailable' });
    }, { attachable: false });
  });

  it('caps attached connections and frees a slot on detach', async () => {
    await withTarget('rs-a3-', async ({ attach }) => {
      const attached = [];
      for (let index = 0; index < MAX_ATTACHED_SURFACES; index++) {
        const result = await attach(index % 2 === 0 ? 'drive' : 'observe');
        expect(result.reply).toMatchObject({ status: 'attached', driverId: `attach:${index + 1}` });
        attached.push(result.client);
      }
      const over = await attach('observe');
      expect(over.reply).toMatchObject({ status: 'refused', reason: 'attach-limit' });
      attached[0]!.socket.destroy();
      await attached[0]!.closed;
      await vi.waitFor(async () => {
        const again = await attach('observe');
        expect(again.reply).toMatchObject({ status: 'attached', driverId: `attach:${MAX_ATTACHED_SURFACES + 1}` });
      });
      for (const client of attached) client.socket.destroy();
    });
  });

  it('attributes a submitted turn to the server-assigned driver, never a client-sent one', async () => {
    await withTarget('rs-a4-', async ({ root, session, attach }) => {
      const { reply, client } = await attach('drive', { driverId: 'owner' });
      expect(reply).toEqual({ id: ID, status: 'attached', driverId: 'attach:1', generation: generationOf(root) });
      client.send({ type: 'submit', prompt: 'hello', driverId: 'owner' });
      const complete = await client.waitFor('complete');
      expect(complete.driverId).toBe('attach:1');
      const observation = session.getFullHistory().find((entry) => entry.type === 'usage-observation');
      expect(observation?.data).toMatchObject({ surface: 'attach' });
      expect(client.frames.some((frame) => 'driverId' in frame && frame.driverId === 'owner')).toBe(false);
      client.socket.destroy();
    });
  });

  it('keeps frames sent in the same write as the handshake, beyond the handshake line limit', async () => {
    await withTarget('rs-b4-', async ({ attach }) => {
      const padding = `${' '.repeat(8 * 1024)}\n`;
      const { reply, client } = await attach(
        'observe', {}, `${padding}${JSON.stringify({ type: 'get-executing' })}\n`,
      );
      expect(reply).toMatchObject({ status: 'attached' });
      expect(await client.waitFor('executing')).toEqual({ type: 'executing', executing: false });
      client.socket.destroy();
    });
  });

  it('lets a turn finish when the attacher detaches mid-turn', async () => {
    let finish: (value: string) => void = () => undefined;
    const run = () => new Promise<string>((resolve) => { finish = resolve; });
    await withTarget('rs-a5-', async ({ session, attach }) => {
      const { client } = await attach('drive');
      client.send({ type: 'submit', prompt: 'long task' });
      await vi.waitFor(() => expect(session.isExecuting()).toBe(true));
      client.socket.destroy();
      await client.closed;
      finish('done');
      await vi.waitFor(() => expect(session.isExecuting()).toBe(false));
      expect(session.getMessages().some((message) => message.content === 'done')).toBe(true);
    }, { run });
  });

  it('denies a parked prompt when the attacher is killed, and returns to the unattached posture', async () => {
    await withTarget('rs-a6-', async ({ session, registry, attach }) => {
      const { client } = await attach('drive');
      const parked = registry.requestPermission('Bash', {} as never);
      const request = await client.waitFor('permission_request');
      expect(request.event.toolName).toBe('Bash');
      expect(session.getLocalActivityStatus()).toBe('needs-input');
      client.socket.destroy();
      await expect(parked).resolves.toBe(false);
      expect(session.getLocalActivityStatus()).toBe('idle');
      await expect(registry.requestPermission('Bash', {} as never)).resolves.toBe(false);
    });
  });

  it('lets a drive attacher answer a prompt', async () => {
    await withTarget('rs-a7-', async ({ registry, attach }) => {
      const { client } = await attach('drive');
      const parked = registry.requestPermission('Bash', {} as never);
      const request = await client.waitFor('permission_request');
      client.send({ type: 'permission-response', id: request.event.id, result: true });
      await expect(parked).resolves.toBe(true);
      client.socket.destroy();
    });
  });

  it('keeps an observer read-only and out of the prompt path', async () => {
    await withTarget('rs-a8-', async ({ session, registry, attach }) => {
      const { reply, client } = await attach('observe');
      expect(reply).toMatchObject({ status: 'attached' });
      client.send({ type: 'submit', prompt: 'hello' });
      expect((await client.waitFor('protocol_error')).message).toMatch(/observer/);
      await expect(registry.requestPermission('Bash', {} as never)).resolves.toBe(false);
      client.send({ type: 'get-executing' });
      expect(await client.waitFor('executing')).toEqual({ type: 'executing', executing: false });
      expect(session.isExecuting()).toBe(false);
      client.socket.destroy();
    });
  });

  it('disconnects a reader that stops reading while another attacher keeps streaming', { timeout: 30_000 }, async () => {
    await withTarget('rs-a9-', async ({ session, attach }) => {
      const slow = await attach('observe');
      slow.client.socket.pause();
      const fast = await attach('observe');
      const emit = (session as unknown as { emit: (event: string, ...args: unknown[]) => void }).emit
        .bind(session);
      const delta = 'x'.repeat(64 * 1024);
      const deltas = (): number => fast.client.frames.filter((frame) => frame.type === 'text_delta').length;
      // The fast reader keeps up with every frame; the paused one falls behind by the whole stream.
      for (let index = 0; index < 64; index++) {
        expect(() => emit('text_delta', delta)).not.toThrow();
        await vi.waitFor(() => expect(deltas()).toBe(index + 1), { timeout: 5_000 });
      }
      // Reading again only drains what reached the kernel before the session cut the reader off.
      slow.client.socket.resume();
      await slow.client.closed;
      expect(slow.client.frames.length).toBeLessThan(64);
      fast.client.socket.destroy();
    });
  });

  it('closes only the connection that sends an oversize frame', async () => {
    await withTarget('rs-b1-', async ({ attach }) => {
      const big = await attach('observe');
      const other = await attach('observe');
      big.client.socket.write('x'.repeat(MAX_INBOUND_FRAME_BYTES + 1));
      await big.client.closed;
      other.client.send({ type: 'get-executing' });
      expect(await other.client.waitFor('executing')).toEqual({ type: 'executing', executing: false });
      other.client.socket.destroy();
    });
  });

  it('refuses enabling remote control from an attached terminal', async () => {
    await withTarget('rs-b2-', async ({ attach }) => {
      const { client } = await attach('drive');
      client.send({ type: 'command', name: 'remote-control', args: 'enable' });
      const result = await client.waitFor('command_result');
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/operator at this terminal/);
      client.socket.destroy();
    }, { withRemoteControl: true });
  });

  it('serves the external-event commands on the same socket while a terminal is attached', async () => {
    const revoked: string[] = [];
    const externalEvents: ISupervisedExternalEvents = {
      list: () => [{
        grantId: 'ci', principal: 'client', state: revoked.includes('ci') ? 'revoked' : 'open',
        counters: { accepted: 0, refused: {}, settled: {} },
      }],
      revoke: (grantId) => {
        if (grantId !== 'ci') return 'unknown-grant';
        revoked.push(grantId);
        return 'revoked';
      },
    };
    await withTarget('rs-b5-', async ({ root, attach }) => {
      const { client } = await attach('drive');
      expect((await listSupervisedExternalEvents(ID, root)).map((grant) => grant.state)).toEqual(['open']);
      await expect(revokeSupervisedExternalEventGrant(ID, 'ci', root, 'A'.repeat(22))).rejects.toThrow(/changed/i);
      expect(revoked).toEqual([]);
      await revokeSupervisedExternalEventGrant(ID, 'ci', root, generationOf(root));
      expect(revoked).toEqual(['ci']);
      client.send({ type: 'get-executing' });
      expect(await client.waitFor('executing')).toEqual({ type: 'executing', executing: false });
      client.socket.destroy();
    }, { externalEvents });
  });

  it('ends attached connections when the session closes its control', async () => {
    await withTarget('rs-b3-', async ({ session, registry, attach, closeControl }) => {
      const { client } = await attach('drive');
      const second = await attach('observe');
      const parked = registry.requestPermission('Bash', {} as never);
      await client.waitFor('permission_request');
      await closeControl();
      await client.closed;
      await second.client.closed;
      await expect(parked).resolves.toBe(false);
      expect(session.getLocalActivityStatus()).toBe('idle');
    });
  });
});

describe('attach handshake approval', () => {
  it('answers yes once, for the requested role on this connection, and never for anything else', async () => {
    const approver = createHandshakeApprover('observe');
    expect(await approver.approve({ capability: 'drive', scope: 'connection', locality: 'same-host' })).toBe(false);
    expect(await approver.approve({ capability: 'delegate', scope: 'request', locality: 'same-host' })).toBe(false);
    expect(await approver.approve({ capability: 'observe', scope: 'request', locality: 'same-host' })).toBe(false);
    expect(await approver.approve({ capability: 'observe', scope: 'connection', locality: 'same-host' })).toBe(true);
    expect(await approver.approve({ capability: 'observe', scope: 'connection', locality: 'same-host' })).toBe(false);
  });
});

describe('attach slot reservation', () => {
  it('never holds a slot for a connection that closed before its handshake was admitted', async () => {
    const carrier = createSupervisedAttachCarrier(createTestInteractiveSession());
    const request = { mode: 'observe', protocol: 1 };
    for (let index = 0; index < MAX_ATTACHED_SURFACES; index++) {
      const gone = new PassThrough();
      gone.destroy();
      await once(gone, 'close');
      await carrier.admit(gone as never, request, '', { refuse: vi.fn(), accept: vi.fn() });
    }
    const accept = vi.fn();
    const refuse = vi.fn();
    const live = Array.from({ length: MAX_ATTACHED_SURFACES }, () => new PassThrough());
    for (const socket of live) await carrier.admit(socket as never, request, '', { refuse, accept });
    expect(refuse).not.toHaveBeenCalled();
    expect(accept).toHaveBeenCalledTimes(MAX_ATTACHED_SURFACES);
    for (const socket of live) socket.destroy();
  });
});
