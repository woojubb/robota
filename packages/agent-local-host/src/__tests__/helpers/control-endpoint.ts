import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

import { controlSocketPath, readRegisteredProcessStartTime, sessionDirectory } from '../../supervised-control-carrier.js';
import { WindowsControlPipeServer, type IControlChannel } from '../../windows-control-pipe.js';

export const FIXTURE_GENERATION = 'AAAAAAAAAAAAAAAAAAAAAA';

/**
 * What a fixture endpoint answers one request line with: an object is sent as one JSON line, a
 * string is sent as the exact bytes it holds, and `undefined` ends the connection without a reply.
 * A promise that never settles leaves the request unanswered.
 */
export type TControlAnswer = Record<string, unknown> | string | undefined;

export interface IControlEndpointOptions {
  /** The private supervised directory the registration and the socket live in. */
  readonly root: string;
  readonly id: string;
  readonly generation?: string;
  /** The registered process; the test process unless a test needs one it can end. */
  readonly pid?: number;
  /** What the registration records as that process's start; its real start unless a test forges one. */
  readonly startedAt?: string;
  readonly answer: (
    request: Record<string, unknown>,
    context: { readonly id: string; readonly generation: string },
  ) => TControlAnswer | Promise<TControlAnswer>;
}

export interface IControlEndpoint {
  readonly id: string;
  readonly generation: string;
  readonly directory: string;
  /** Every request line received, exactly as it arrived and without its newline. */
  readonly lines: string[];
  readonly connections: IControlChannel[];
  close(): Promise<void>;
}

/** The reply a runtime's own endpoint gives: `id` first, the body, then `generation`. */
export function replyOf(
  id: string,
  generation: string,
  body: Record<string, unknown>,
): Record<string, unknown> {
  return { id, ...body, generation };
}

/** The registration a runtime publishes: one private directory holding its record. */
export function writeRegistration(root: string, id: string, record: Record<string, unknown>): string {
  const directory = sessionDirectory(root, id);
  mkdirSync(directory, { mode: 0o700 });
  writeFileSync(join(directory, 'state.json'), JSON.stringify(record), { flag: 'wx', mode: 0o600 });
  return directory;
}

/**
 * A registration and a control socket that answer as a test says, so the client side of the
 * control protocol is tested without any runtime behind it.
 */
export async function startControlEndpoint(options: IControlEndpointOptions): Promise<IControlEndpoint> {
  const { root, id } = options;
  const generation = options.generation ?? FIXTURE_GENERATION;
  const pid = options.pid ?? process.pid;
  const startedAt = options.startedAt ?? readRegisteredProcessStartTime(pid);
  if (startedAt === undefined) throw new Error('Cannot establish the fixture process identity.');
  const directory = sessionDirectory(root, id);
  const lines: string[] = [];
  const connections: IControlChannel[] = [];
  const onConnection = (socket: IControlChannel): void => {
    connections.push(socket);
    socket.on('error', () => socket.destroy());
    let received = '';
    socket.setEncoding('utf8');
    const onData = (chunk: string): void => {
      received += chunk;
      const end = received.indexOf('\n');
      if (end === -1) return;
      socket.off('data', onData);
      const line = received.slice(0, end);
      lines.push(line);
      void Promise.resolve(options.answer(JSON.parse(line) as Record<string, unknown>, { id, generation }))
        .then((answer) => {
          if (answer === undefined) socket.end();
          else socket.end(typeof answer === 'string' ? answer : `${JSON.stringify(answer)}\n`);
        })
        .catch(() => socket.destroy());
    };
    socket.on('data', onData);
  };
  const server = process.platform === 'win32' ? new WindowsControlPipeServer(onConnection) : createServer(onConnection);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(controlSocketPath(root, id), resolve);
  });
  writeRegistration(root, id, { id, pid, startedAt, generation });
  return {
    id, generation, directory, lines, connections,
    close: async () => {
      for (const socket of connections) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (process.platform !== 'win32') rmSync(controlSocketPath(root, id), { force: true });
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
