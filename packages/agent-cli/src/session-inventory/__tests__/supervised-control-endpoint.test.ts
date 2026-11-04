/**
 * What a plain control socket answers to every command it knows and to everything it does not: the
 * table's plain column in action, one request at a time over a real socket. The endpoint's whole
 * command chain lives in one handler that the owner link's `control` request shares, so these
 * answers are what that handler must keep giving.
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

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

afterEach(async () => {
  for (const control of running.splice(0)) await control.close();
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function start(
  options: Partial<ISupervisedControlOptions> = {},
): Promise<{ root: string; generation: string }> {
  const directory = mkdtempSync(join(tmpdir(), 'rs-endpoint-'));
  scratch.push(directory);
  const root = join(directory, 'supervised');
  running.push(await serveSupervisedControl({ id: ID, onStop: () => undefined, root, ...options }));
  const generation = (
    JSON.parse((await import('node:fs')).readFileSync(join(root, ID, 'state.json'), 'utf8')) as {
      generation: string;
    }
  ).generation;
  return { root, generation };
}

/** One request line out and the one reply line back, as a same-user program would send it. */
async function ask(root: string, frame: unknown): Promise<Record<string, unknown>> {
  const socketName = readdirSync(root).find((name) => name.endsWith('.sock'))!;
  const client = createConnection(join(root, socketName));
  try {
    await new Promise<void>((resolve) => client.once('connect', resolve));
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
  } finally {
    client.destroy();
  }
}

describe.skipIf(process.platform === 'win32')('the plain control socket', () => {
  it('answers status with everything its runtime observes', async () => {
    const pr = parseSupervisedPr(PR_URL)!;
    const { root, generation } = await start({
      observe: {
        activity: () => 'working',
        cwd: () => '/work/project',
        nextLoopAt: () => undefined,
        name: () => 'Morning review',
      },
      pr: { get: () => pr, set: () => undefined },
      daemon: { url: () => 'ws://127.0.0.1:9?token=t', restricted: true },
    });

    expect(await ask(root, { command: 'status', id: ID, generation })).toEqual({
      id: ID,
      generation,
      status: 'running',
      activity: 'working',
      cwd: '/work/project',
      name: 'Morning review',
      pr,
      daemon: true,
      restricted: true,
    });
  });

  it('hands a daemon its connection, and refuses a runtime that is not one', async () => {
    const daemon = await start({ daemon: { url: () => 'ws://127.0.0.1:9?token=t' } });
    expect(await ask(daemon.root, { command: 'connect', id: ID, generation: daemon.generation })).toEqual({
      id: ID,
      generation: daemon.generation,
      status: 'connected',
      url: 'ws://127.0.0.1:9?token=t',
    });
    const plain = await start();
    expect(await ask(plain.root, { command: 'connect', id: ID, generation: plain.generation })).toEqual({
      id: ID,
      generation: plain.generation,
      status: 'refused',
    });
  });

  it('confirms stop and stops once the reply has been sent', async () => {
    const onStop = vi.fn();
    const { root, generation } = await start({ onStop });

    expect(await ask(root, { command: 'stop', id: ID, generation })).toEqual({
      id: ID,
      generation,
      status: 'stopping',
    });
    await vi.waitFor(() => expect(onStop).toHaveBeenCalledTimes(1));
  });

  it('renames, links and unlinks through the handlers it was given, and refuses what they refuse', async () => {
    const rename = vi.fn();
    const set = vi.fn();
    const { root, generation } = await start({ rename, pr: { get: () => undefined, set } });
    const send = (frame: Record<string, unknown>) => ask(root, { id: ID, generation, ...frame });

    expect(await send({ command: 'rename', name: 'Evening review' })).toMatchObject({ status: 'renamed' });
    expect(rename).toHaveBeenCalledExactlyOnceWith('Evening review');
    expect(await send({ command: 'rename', name: ' padded ' })).toMatchObject({ status: 'refused' });
    expect(await send({ command: 'rename' })).toMatchObject({ status: 'refused' });
    expect(await send({ command: 'link-pr', url: PR_URL })).toMatchObject({ status: 'linked' });
    expect(set).toHaveBeenLastCalledWith(parseSupervisedPr(PR_URL));
    expect(await send({ command: 'link-pr', url: 'http://example.test/not-a-pr' })).toMatchObject({
      status: 'refused',
    });
    expect(await send({ command: 'unlink-pr' })).toMatchObject({ status: 'unlinked' });
    expect(set).toHaveBeenLastCalledWith(undefined);
  });

  it('refuses rename, link-pr and unlink-pr when the runtime gave no handler for them', async () => {
    const { root, generation } = await start();
    for (const frame of [
      { command: 'rename', name: 'Name' },
      { command: 'link-pr', url: PR_URL },
      { command: 'unlink-pr' },
    ]) {
      expect(await ask(root, { id: ID, generation, ...frame })).toMatchObject({ status: 'refused' });
    }
  });

  it('lists and revokes external event grants through the runtime, and names an unknown one', async () => {
    const grant = {
      grantId: 'ci',
      principal: 'client',
      state: 'open',
      counters: { accepted: 1, refused: {}, settled: {} },
    } as const;
    const revoke = vi.fn((grantId: string) => (grantId === 'ci' ? ('revoked' as const) : ('unknown-grant' as const)));
    const { root, generation } = await start({ externalEvents: { list: () => [grant], revoke } });
    const send = (frame: Record<string, unknown>) => ask(root, { id: ID, generation, ...frame });

    expect(await send({ command: 'events-list' })).toMatchObject({ status: 'events', grants: [grant] });
    expect(await send({ command: 'events-revoke', grantId: 'ci' })).toMatchObject({ status: 'revoked' });
    expect(await send({ command: 'events-revoke', grantId: 'nope' })).toMatchObject({
      status: 'refused',
      reason: 'unknown-grant',
    });
    expect(await send({ command: 'events-revoke', grantId: 'not a label!' })).toMatchObject({
      status: 'refused',
    });
  });

  it('answers a command it does not offer, or does not know, as refused', async () => {
    const { root, generation } = await start();

    // `lock`, `link` and the daemon role exist only in secure mode; the rest is not a command at all.
    for (const command of ['lock', 'link', 'take-daemon-role', 'toString', '__proto__', 'nope', 7, null]) {
      expect(await ask(root, { command, id: ID, generation })).toEqual({
        id: ID,
        generation,
        status: 'refused',
      });
    }
  });

  it('refuses an attach when the runtime has nothing to attach to', async () => {
    const { root, generation } = await start();

    expect(
      await ask(root, { command: 'attach', id: ID, generation, mode: 'drive', protocol: 1 }),
    ).toEqual({ id: ID, generation, status: 'refused', reason: 'attach-unavailable' });
  });

  it('tells a caller that does not hold the generation nothing but that it was refused', async () => {
    const { root, generation } = await start();

    expect(await ask(root, { command: 'status', id: ID, generation: 'A'.repeat(22) })).toEqual({
      id: ID,
      status: 'refused',
      reason: 'stale-generation',
    });
    expect(await ask(root, { command: 'status', id: ID })).toEqual({
      id: ID,
      status: 'refused',
      reason: 'stale-generation',
    });
    expect(await ask(root, { command: 'status', id: 'another', generation })).toEqual({
      id: ID,
      status: 'refused',
    });
    expect(await ask(root, 'not json')).toEqual({ id: ID, status: 'refused' });
  });
});
