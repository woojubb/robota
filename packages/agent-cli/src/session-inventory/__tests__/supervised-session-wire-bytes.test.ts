import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import {
  connectSupervisedDaemon,
  getVerifiedSupervisedPr,
  linkSupervisedPr,
  listSupervisedExternalEvents,
  listSupervisedSessions,
  renameSupervisedSession,
  revokeSupervisedExternalEventGrant,
  startSupervisedControl,
  unlinkSupervisedPr,
} from '../supervised-session-control.js';

const ID = '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';
const PR = 'https://github.com/team/repo/pull/123';

const REPLIES: Readonly<Record<string, Record<string, unknown>>> = {
  rename: { status: 'renamed' },
  'link-pr': { status: 'linked' },
  'unlink-pr': { status: 'unlinked' },
  status: { status: 'running' },
  connect: { status: 'connected', url: 'ws://127.0.0.1:43127' },
  'events-list': { status: 'events', grants: [] },
  'events-revoke': { status: 'revoked' },
};

/**
 * The product's clients write the request lines a running endpoint reads, byte for byte, so an
 * endpoint of an earlier build keeps understanding them. A recording socket stands in for the
 * endpoint, and the lines are what each client wrote.
 */
it('writes exactly one request line per command, with its product field after the generation', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'rs-wire-'));
  const root = join(scratch, 'supervised');
  const control = await startSupervisedControl({ id: ID, onStop: () => undefined, root });
  const generation = (JSON.parse(readFileSync(join(root, ID, 'state.json'), 'utf8')) as { generation: string }).generation;
  const socketPath = join(root, readdirSync(root).find((name) => name.endsWith('.sock'))!);
  rmSync(socketPath);
  const lines: string[] = [];
  const sockets = new Set<Socket>();
  const recorder: Server = createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding('utf8');
    socket.once('data', (chunk: string) => {
      const line = chunk.slice(0, chunk.indexOf('\n'));
      lines.push(line);
      const { command } = JSON.parse(line) as { command: string };
      socket.end(`${JSON.stringify({ id: ID, ...REPLIES[command], generation })}\n`);
    });
  });
  await new Promise<void>((resolve) => recorder.listen(socketPath, resolve));
  const line = (command: string, field = ''): string =>
    `{"command":"${command}","id":"${ID}","generation":"${generation}"${field}}`;
  try {
    await renameSupervisedSession(ID, 'Evening review', root);
    await linkSupervisedPr(ID, PR, root);
    await unlinkSupervisedPr(ID, root);
    await getVerifiedSupervisedPr(ID, root);
    await connectSupervisedDaemon(ID, root);
    await listSupervisedExternalEvents(ID, root);
    await revokeSupervisedExternalEventGrant(ID, 'grant-1', root);
    await listSupervisedSessions(root);
    expect(lines).toEqual([
      line('rename', ',"name":"Evening review"'),
      line('link-pr', `,"url":"${PR}"`),
      line('unlink-pr'),
      line('status'),
      line('connect'),
      line('events-list'),
      line('events-revoke', ',"grantId":"grant-1"'),
      line('status'),
    ]);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => recorder.close(() => resolve()));
    await control.close();
    rmSync(scratch, { recursive: true, force: true });
  }
});
