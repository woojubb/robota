import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const IMAGE_DIR = resolve(here, '../../../../docker/personal-agent');
const FORWARDER = resolve(IMAGE_DIR, 'ingress-forwarder.mjs');

interface IForwarder {
  servers: net.Server[];
  close(): Promise<unknown>;
}
interface IForwarderModule {
  DEFAULT_PORTS: number[];
  startForwarder(options: {
    listenHost: string;
    targetHost?: string;
    ports?: Array<number | { listen: number; target: number }>;
  }): Promise<IForwarder>;
}

const closers: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function load(): Promise<IForwarderModule> {
  return (await import(pathToFileURL(FORWARDER).href)) as IForwarderModule;
}

function listen(server: net.Server): Promise<number> {
  closers.push(() => new Promise((done) => server.close(done)));
  return new Promise((resolvePort) =>
    server.listen(0, '127.0.0.1', () => resolvePort((server.address() as net.AddressInfo).port)),
  );
}

async function freePort(): Promise<number> {
  const probe = net.createServer();
  const port = await listen(probe);
  await new Promise((done) => probe.close(done));
  return port;
}

async function forwarderTo(target: number): Promise<number> {
  const { startForwarder } = await load();
  const entry = await freePort();
  const running = await startForwarder({
    listenHost: '127.0.0.1',
    ports: [{ listen: entry, target }],
  });
  closers.push(() => running.close());
  return entry;
}

function collect(socket: net.Socket): Promise<Buffer> {
  const chunks: Buffer[] = [];
  socket.on('data', (chunk: Buffer) => chunks.push(chunk));
  return new Promise((done) => socket.on('close', () => done(Buffer.concat(chunks))));
}

describe('ingress forwarder', () => {
  it('pipes bytes both ways without changing them', async () => {
    const echo = net.createServer((socket) => socket.pipe(socket));
    const entry = await forwarderTo(await listen(echo));
    const client = net.connect(entry, '127.0.0.1');
    const payload = Buffer.from(Array.from({ length: 2_000_000 }, (_, i) => i % 251));
    const received = collect(client);
    client.end(payload);
    expect((await received).equals(payload)).toBe(true);
  });

  it('delivers the last bytes an upstream writes before it closes', async () => {
    const reply = Buffer.alloc(3_000_000, 7);
    const upstream = net.createServer((socket) => {
      socket.once('data', () => socket.end(reply));
    });
    const entry = await forwarderTo(await listen(upstream));
    const client = net.connect(entry, '127.0.0.1');
    const received = collect(client);
    client.write('go');
    expect((await received).equals(reply)).toBe(true);
  });

  it('closes the upstream when the client goes away', async () => {
    let client: net.Socket | undefined;
    const closed = new Promise<void>((done) => {
      const upstream = net.createServer((socket) => {
        socket.on('data', () => client?.destroy());
        socket.on('close', () => done());
      });
      void listen(upstream).then(async (port) => {
        client = net.connect(await forwarderTo(port), '127.0.0.1');
        client.write('x');
      });
    });
    await closed;
  });

  it('drops the client when the agent is not listening', async () => {
    const entry = await forwarderTo(await freePort());
    const client = net.connect(entry, '127.0.0.1');
    client.on('error', () => undefined);
    await once(client, 'close');
  });

  it('serves connections one after another and side by side', async () => {
    const echo = net.createServer((socket) => socket.pipe(socket));
    const entry = await forwarderTo(await listen(echo));
    const ask = async (text: string): Promise<string> => {
      const client = net.connect(entry, '127.0.0.1');
      const received = collect(client);
      client.end(text);
      return (await received).toString();
    };
    expect(await Promise.all(['a', 'b', 'c'].map(ask))).toEqual(['a', 'b', 'c']);
    expect(await ask('later')).toBe('later');
  });

  it('listens on both of the agent ports by default and refuses to run without an address', async () => {
    const { DEFAULT_PORTS } = await load();
    expect(DEFAULT_PORTS).toEqual([7360, 7361]);
    const child = spawn(process.execPath, [FORWARDER], {
      env: { PATH: process.env.PATH ?? '' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const stderr: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    const [code] = (await once(child, 'close')) as [number];
    expect(code).toBe(2);
    expect(Buffer.concat(stderr).toString()).toContain('PERSONAL_AGENT_INGRESS_ADDR');
  });
});

describe('image entrypoint', () => {
  it('runs the forwarder only when the host sets the ingress address', async () => {
    const dockerfile = await readFile(resolve(IMAGE_DIR, 'Dockerfile'), 'utf8');
    const start = dockerfile.indexOf('personal-agent-entrypoint\n#!/bin/sh');
    const script = dockerfile.slice(start, dockerfile.indexOf('\nEOF', start));
    const branch =
      'if [ -n "${PERSONAL_AGENT_INGRESS_ADDR:-}" ]; then node /opt/personal-agent-ingress.mjs & fi';
    expect(script).toContain(branch);
    // The forwarder is the only addition: it comes before the agent starts, and the two ways the
    // agent starts are exactly as they were.
    expect(script.indexOf(branch)).toBeLessThan(
      script.indexOf('exec personal-agent start --server'),
    );
    expect(script).toContain(
      'if [ -n "${PERSONAL_AGENT_PUBLIC_URL:-}" ]; then exec personal-agent start --server; fi\nexec personal-agent start',
    );
    expect(dockerfile).toContain('/opt/personal-agent-ingress.mjs');
  });
});
