import { readFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { adminPaths } from '../admin/paths.js';
import { type ICliIo } from '../cli/io.js';
import { main } from '../main.js';
import { FakeRuntime } from '../runtime/fake.js';
import { type IRunningHost, startServe } from '../serve.js';
import { BASE_DOMAIN, tempDir } from './harness.js';

export function hostEnv(dir: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PERSONAL_AGENT_HOST_BASE_DOMAIN: BASE_DOMAIN,
    PERSONAL_AGENT_HOST_TLS: 'internal',
    PERSONAL_AGENT_HOST_UNIT_IMAGE: 'personal-agent:test',
    PERSONAL_AGENT_HOST_ALLOW_CONTAINER: 'true',
    PERSONAL_AGENT_HOST_STATE_DIR: dir,
    ...extra,
  };
}

const running: IRunningHost[] = [];

export async function stopHosts(): Promise<void> {
  await Promise.all(running.splice(0).map((host) => host.stop()));
}

export interface ITestHost {
  dir: string;
  env: NodeJS.ProcessEnv;
  runtime: FakeRuntime;
  host: IRunningHost;
  socket: string;
  /** Appends to everything a client or the socket ever showed, for key-absence checks. */
  seen: string[];
  cli(args: string[], stdin?: string | Readable): Promise<ICliResult>;
  audit(): Promise<string>;
}

export interface ICliResult {
  code: number;
  out: string;
  err: string;
}

export function ttyStdin(): Readable & { isTTY: boolean; setRawMode(mode: boolean): void } {
  const stream = new Readable({ read() {} }) as Readable & {
    isTTY: boolean;
    setRawMode(mode: boolean): void;
  };
  stream.isTTY = true;
  stream.setRawMode = () => undefined;
  return stream;
}

export async function runCli(
  env: NodeJS.ProcessEnv,
  args: string[],
  stdin: string | Readable = '',
  signals?: ICliIo['signals'],
): Promise<ICliResult> {
  let out = '';
  let err = '';
  const input = typeof stdin === 'string' ? Readable.from(stdin === '' ? [] : [stdin]) : stdin;
  const io: ICliIo = {
    stdin: input,
    stdout: { write: (text) => (out += text) },
    stderr: { write: (text) => (err += text) },
    ...(signals ? { signals } : {}),
  };
  const code = await main(args, env, io);
  return { code, out, err };
}

export async function startHost(
  options: {
    dir?: string;
    extra?: Record<string, string>;
    runtime?: FakeRuntime;
    reconcileMs?: number;
  } = {},
): Promise<ITestHost> {
  const dir = options.dir ?? (await tempDir());
  const env = hostEnv(dir, options.extra);
  const runtime = options.runtime ?? new FakeRuntime();
  const host = await startServe(env, {
    log: () => undefined,
    runtime,
    reconcileMs: options.reconcileMs ?? 3_600_000,
  });
  running.push(host);
  const seen: string[] = [];
  return {
    dir,
    env,
    runtime,
    host,
    socket: host.socket,
    seen,
    async cli(args, stdin) {
      const result = await runCli(env, args, stdin);
      seen.push(result.out, result.err);
      return result;
    },
    async audit() {
      return readFile(join(dir, 'audit.log'), 'utf8').catch(() => '');
    },
  };
}

export interface IRawResponse {
  status: number;
  body: string;
}

/** A request written by hand, so tests can send what the CLI never would. */
export function rawRequest(
  env: NodeJS.ProcessEnv,
  method: string,
  path: string,
  body?: string | Buffer,
  headers: Record<string, string> = {},
): Promise<IRawResponse> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: adminPaths(env).socket, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
      );
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

export const JSON_HEADERS = { 'content-type': 'application/json' };
