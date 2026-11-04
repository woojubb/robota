/**
 * The control socket of a secure runtime: a same-user program that connects gets liveness, stop, lock
 * and the owner link's front door, and nothing that reveals what the runtime is working on or admits
 * a session. The bytes after the link's request line reach the custody untouched, because the
 * handshake that follows them is binary.
 */
import { Buffer } from 'node:buffer';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRuntimeIdentity, startSpawnerExchange } from '@robota-sdk/agent-keyring';
import {
  LINK_REQUEST_LINE,
  openSpawnerLink,
  serveRuntimeLink,
} from '@robota-sdk/agent-transport-link';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { openDescriptorCount } from './descriptor-count.js';

import type {
  IRuntimeAdmission,
  IRuntimeAdmissionContext,
  IRuntimeAdmissionStatus,
  TRuntimeAdmissionFactory,
} from '../runtime-admission.js';
import {
  parseSupervisedPr,
  serveSupervisedControl,
  type ISupervisedControl,
  type ISupervisedControlOptions,
} from '../supervised-session-control.js';

const ID = '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';
const PR_URL = 'https://github.com/team/repo/pull/7';

const scratch: string[] = [];
const running: ISupervisedControl[] = [];
const sockets: Socket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const control of running.splice(0)) await control.close();
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

interface IRecordingAdmission {
  readonly factory: TRuntimeAdmissionFactory;
  readonly calls: Array<'lock' | 'take-daemon-role' | { link: Buffer }>;
  context(): IRuntimeAdmissionContext;
  status: IRuntimeAdmissionStatus;
  refuseRole: boolean;
}

function recordingAdmission(
  serveLink?: (stream: Parameters<IRuntimeAdmission['serveLink']>[0], rest: Buffer) => void,
): IRecordingAdmission {
  let context: IRuntimeAdmissionContext | undefined;
  const recorded: IRecordingAdmission = {
    calls: [],
    status: { certified: false, daemon: false, restricted: false },
    refuseRole: false,
    context: () => context!,
    factory: (given) => {
      context = given;
      return {
        serveLink: (stream, rest) => {
          recorded.calls.push({ link: Buffer.from(rest) });
          if (serveLink === undefined) stream.destroy();
          else serveLink(stream, rest);
        },
        lock: () => recorded.calls.push('lock'),
        status: () => recorded.status,
        takeDaemonRole: () => {
          recorded.calls.push('take-daemon-role');
          return !recorded.refuseRole;
        },
      };
    },
  };
  return recorded;
}

async function start(
  options: Partial<ISupervisedControlOptions>,
): Promise<{ root: string; generation: string; socketPath: string }> {
  const directory = mkdtempSync(join(tmpdir(), 'rs-secure-'));
  scratch.push(directory);
  const root = join(directory, 'supervised');
  running.push(await serveSupervisedControl({ id: ID, onStop: () => undefined, root, ...options }));
  const generation = (
    JSON.parse(readFileSync(join(root, ID, 'state.json'), 'utf8')) as { generation: string }
  ).generation;
  return { root, generation, socketPath: join(root, readdirSync(root).find((n) => n.endsWith('.sock'))!) };
}

async function connectTo(socketPath: string): Promise<Socket> {
  const socket = createConnection(socketPath);
  sockets.push(socket);
  await new Promise<void>((resolve) => socket.once('connect', resolve));
  return socket;
}

/** One request line out and the one reply line back. */
async function ask(socketPath: string, frame: unknown): Promise<Record<string, unknown>> {
  const client = await connectTo(socketPath);
  client.setEncoding('utf8');
  client.write(`${typeof frame === 'string' ? frame : JSON.stringify(frame)}\n`);
  let received = '';
  await new Promise<void>((resolve) => {
    client.on('data', (chunk: string) => {
      received += chunk;
      if (received.includes('\n')) resolve();
    });
  });
  return JSON.parse(received.slice(0, received.indexOf('\n'))) as Record<string, unknown>;
}

/**
 * A request line followed by bytes the endpoint has no use for, then the client's close: what a
 * same-user program that does not wait for its answer sends, as often as it likes.
 */
async function askAndTrail(
  socketPath: string,
  frame: unknown,
  trailing: number,
): Promise<Record<string, unknown>> {
  const client = await connectTo(socketPath);
  client.setEncoding('utf8');
  let received = '';
  client.on('data', (chunk: string) => {
    received += chunk;
  });
  const closed = new Promise<void>((resolve) => client.once('close', () => resolve()));
  client.end(`${JSON.stringify(frame)}\n${'x'.repeat(trailing)}`);
  let gaveUp: NodeJS.Timeout | undefined;
  await Promise.race([
    closed,
    new Promise<never>((_resolve, reject) => {
      gaveUp = setTimeout(() => reject(new Error('The endpoint never closed the connection.')), 2_000);
    }),
  ]).finally(() => clearTimeout(gaveUp));
  return JSON.parse(received.slice(0, received.indexOf('\n'))) as Record<string, unknown>;
}

const observed: Partial<ISupervisedControlOptions> = {
  observe: {
    activity: () => 'working',
    cwd: () => '/work/project',
    name: () => 'Morning review',
  },
};

describe.skipIf(process.platform === 'win32')('a secure control socket', () => {
  it('hands the custody the binding of this start', async () => {
    const admission = recordingAdmission();
    const { generation } = await start({ admission: admission.factory });

    expect(admission.context().binding).toEqual({ runtimeId: ID, generation });
  });

  it('answers status with liveness and the custody state, and without what names the work', async () => {
    const admission = recordingAdmission();
    const pr = parseSupervisedPr(PR_URL)!;
    const { socketPath, generation } = await start({
      ...observed,
      pr: { get: () => pr, set: () => undefined },
      externalEvents: { list: () => [], revoke: () => 'unknown-grant' },
      daemon: { url: () => 'ws://127.0.0.1:9?token=t' },
      admission: admission.factory,
    });

    expect(await ask(socketPath, { command: 'status', id: ID, generation })).toEqual({
      id: ID,
      generation,
      status: 'running',
      activity: 'working',
      cwd: '/work/project',
      certified: false,
    });

    admission.status = { certified: true, daemon: true, restricted: true };
    expect(await ask(socketPath, { command: 'status', id: ID, generation })).toMatchObject({
      certified: true,
      daemon: true,
      restricted: true,
    });
  });

  it.each(['connect', 'attach', 'rename', 'link-pr', 'unlink-pr', 'events-list', 'events-revoke', 'take-daemon-role', 'link'])(
    'refuses %s on the socket, whatever it carries',
    async (command) => {
      const rename = vi.fn();
      const set = vi.fn();
      const admission = recordingAdmission();
      const { socketPath, generation } = await start({
        rename,
        pr: { get: () => undefined, set },
        daemon: { url: () => 'ws://127.0.0.1:9?token=t' },
        attachTarget: { session: {} as never },
        admission: admission.factory,
      });

      const answer = await ask(socketPath, {
        command,
        id: ID,
        generation,
        name: 'Taken',
        url: PR_URL,
        grantId: 'ci',
        mode: 'drive',
        protocol: 1,
      });

      expect(answer).toEqual({ id: ID, generation, status: 'refused' });
      expect(rename).not.toHaveBeenCalled();
      expect(set).not.toHaveBeenCalled();
      expect(admission.calls).toEqual([]);
    },
  );

  it('stops on request and locks without a proof', async () => {
    const onStop = vi.fn();
    const admission = recordingAdmission();
    const { socketPath, generation } = await start({ onStop, admission: admission.factory });

    expect(await ask(socketPath, { command: 'lock', id: ID, generation })).toEqual({
      id: ID,
      generation,
      status: 'locked',
    });
    expect(admission.calls).toEqual(['lock']);
    expect(await ask(socketPath, { command: 'stop', id: ID, generation })).toMatchObject({
      status: 'stopping',
    });
    await vi.waitFor(() => expect(onStop).toHaveBeenCalledTimes(1));
  });

  it('answers a request that carries more bytes than its line, and lets go of the connection', async () => {
    const admission = recordingAdmission();
    const { socketPath, generation } = await start({ ...observed, admission: admission.factory });
    // The commands any program of this user may send, and the refusals it can draw.
    const requests = [
      { command: 'status', id: ID, generation },
      { command: 'stop', id: ID, generation },
      { command: 'lock', id: ID, generation },
      { command: 'connect', id: ID, generation },
      { command: 'rename', id: ID, generation, name: 'Taken' },
      { command: 'status', id: ID, generation: 'A'.repeat(22) },
      { command: 'status', id: 'another', generation },
    ];
    for (const request of requests) await askAndTrail(socketPath, request, 200 * 1024);
    const baseline = openDescriptorCount();

    for (let round = 0; round < 5; round += 1) {
      for (const request of requests) {
        expect(await askAndTrail(socketPath, request, 200 * 1024)).toHaveProperty('status');
      }
    }

    // A program that sends junk and leaves must not be able to use up the runtime's descriptors.
    await vi.waitFor(() => expect(openDescriptorCount()).toBeLessThanOrEqual(baseline), { timeout: 2_000 });
  });

  it('still refuses a caller that does not hold the generation', async () => {
    const admission = recordingAdmission();
    const { socketPath } = await start({ admission: admission.factory });

    expect(await ask(socketPath, { command: 'lock', id: ID, generation: 'A'.repeat(22) })).toEqual({
      id: ID,
      status: 'refused',
      reason: 'stale-generation',
    });
    expect(admission.calls).toEqual([]);
  });
});

describe.skipIf(process.platform === 'win32')('the front door of the owner link', () => {
  const hello = Buffer.from(Array.from({ length: 70 }, (_, index) => 0x80 + (index % 0x7f)));
  const frame = Buffer.concat([Buffer.from([0, 0, 0, hello.length]), hello]);

  it('gives the custody the bytes after the request line exactly as they arrived', async () => {
    const admission = recordingAdmission();
    const { socketPath } = await start({ admission: admission.factory });
    const client = await connectTo(socketPath);

    client.write(Buffer.concat([Buffer.from(LINK_REQUEST_LINE), frame]));
    await vi.waitFor(() => expect(admission.calls).toHaveLength(1));

    expect(admission.calls[0]).toEqual({ link: frame });
  });

  it('gives the custody the bytes that follow in a later chunk to the stream, not to the endpoint', async () => {
    const received: Buffer[] = [];
    const admission = recordingAdmission((stream, rest) => {
      received.push(Buffer.from(rest));
      stream.on('data', (chunk: Buffer) => received.push(chunk));
      stream.resume();
    });
    const { socketPath } = await start({ admission: admission.factory });
    const client = await connectTo(socketPath);

    client.write(Buffer.from(LINK_REQUEST_LINE));
    await vi.waitFor(() => expect(admission.calls).toHaveLength(1));
    client.write(frame);
    await vi.waitFor(() => expect(Buffer.concat(received).equals(frame)).toBe(true));
  });

  it('is not a link request unless it is exactly one, and then it is an ordinary command', async () => {
    const admission = recordingAdmission();
    const { socketPath, generation } = await start({ admission: admission.factory });

    for (const request of [
      { command: 'link', protocol: 2 },
      { command: 'link', protocol: 1, extra: true },
      { command: 'link', protocol: 1, id: ID, generation },
    ]) {
      const answer = await ask(socketPath, request);
      expect(answer['status']).toBe('refused');
    }
    expect(admission.calls).toEqual([]);
  });

  it('is refused by a plain runtime, as any request without an id is', async () => {
    const { socketPath } = await start({});

    expect(await ask(socketPath, LINK_REQUEST_LINE.trimEnd())).toEqual({ id: ID, status: 'refused' });
  });

  it('carries a real owner-link handshake: the key proof passes through the endpoint intact', async () => {
    const identity = createRuntimeIdentity();
    const exchange = startSpawnerExchange();
    const { spawnerKey, instancePublicKey } = exchange.complete(
      identity.answerSpawnerExchange(exchange.message),
    );
    const controlled: Array<readonly [string, Readonly<Record<string, string>>]> = [];
    const admission = recordingAdmission((stream, rest) => {
      serveRuntimeLink(stream, {
        identity,
        binding: admission.context().binding,
        rest,
        admit: () => ({
          desk: {
            custody: () => ({ unlocked: false, certified: false }),
            installTrustRoot: () => undefined,
            unlock: () => 'verified',
            lock: () => undefined,
            control: (request) => {
              controlled.push([request.command, request.fields]);
              return admission.context().control(request.command, request.fields) as never;
            },
            closed: () => undefined,
          },
          sessions: {
            question: () => ({ kind: 'open' }),
            openAccepted: () => undefined,
          },
          session: { receive: () => undefined },
        }),
      });
    });
    const rename = vi.fn();
    const { socketPath, generation } = await start({
      ...observed,
      rename,
      admission: admission.factory,
    });

    const client = await openSpawnerLink(await connectTo(socketPath), spawnerKey, instancePublicKey);
    expect(client.binding).toEqual({ runtimeId: ID, generation });

    // The owner's control request runs the handler the plain socket uses, with the whole status.
    expect(await client.control({ command: 'status', fields: {} })).toMatchObject({
      status: 'running',
      activity: 'working',
      name: 'Morning review',
    });
    expect(await client.control({ command: 'rename', fields: { name: 'Evening review' } })).toEqual({
      status: 'renamed',
    });
    expect(rename).toHaveBeenCalledExactlyOnceWith('Evening review');
    for (const command of ['stop', 'lock', 'connect', 'attach', 'link', 'nope']) {
      expect(await client.control({ command, fields: {} })).toEqual({ status: 'refused' });
    }
    // A name no client could send, which is no command for the handler either.
    for (const command of ['toString', '__proto__', 'constructor']) {
      expect(admission.context().control(command, {})).toEqual({ status: 'refused' });
    }
    expect(await client.control({ command: 'take-daemon-role', fields: {} })).toEqual({
      status: 'daemon',
    });
    client.close();
    spawnerKey.wipe();
  });

  it('refuses a daemon role the custody refuses', async () => {
    const admission = recordingAdmission();
    admission.refuseRole = true;
    await start({ admission: admission.factory });

    expect(admission.context().control('take-daemon-role', {})).toEqual({ status: 'refused' });
    expect(admission.calls).toEqual(['take-daemon-role']);
  });

  it('ends a connection whose request line is over its bound', async () => {
    const { socketPath } = await start({ admission: recordingAdmission().factory });
    const client = await connectTo(socketPath);
    const closed = new Promise<void>((resolve) => client.once('close', () => resolve()));

    client.write(Buffer.alloc(8_192, 0x61));

    await closed;
  });
});
