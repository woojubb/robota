import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { controlSocketPath } from '../supervised-control-carrier.js';
import {
  lockSupervisedSession,
  openSupervisedAttachSocket,
  requestSupervisedControl,
  stopStartedSupervisedSession,
  stopSupervisedSession,
  type TControlCommand,
} from '../supervised-control-client.js';
import { FIXTURE_GENERATION, replyOf, startControlEndpoint, type IControlEndpoint, type TControlAnswer } from './helpers/control-endpoint.js';

const ID = '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';
const GENERATION = FIXTURE_GENERATION;

let root: string;
const endpoints: IControlEndpoint[] = [];
const children: ChildProcess[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'ctl-')));
});

afterEach(async () => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
  for (const endpoint of endpoints.splice(0)) await endpoint.close();
  rmSync(root, { recursive: true, force: true });
});

async function endpointAnswering(
  answer: (request: Record<string, unknown>, context: { readonly id: string; readonly generation: string }) => TControlAnswer | Promise<TControlAnswer>,
  options: { readonly pid?: number; readonly startedAt?: string } = {},
): Promise<IControlEndpoint> {
  const endpoint = await startControlEndpoint({ root, id: ID, answer, ...options });
  endpoints.push(endpoint);
  return endpoint;
}

const statusOnly = (status: string) => (_request: Record<string, unknown>, context: { readonly id: string; readonly generation: string }) =>
  replyOf(context.id, context.generation, { status });

/** A process that stays alive until the test ends it, so no timing decides when it has exited. */
function spawnLongLivedProcess(): ChildProcess {
  const child = spawn(process.execPath, ['-e', 'process.stdin.resume()'], { stdio: ['pipe', 'ignore', 'ignore'] });
  children.push(child);
  return child;
}

/**
 * Resolves when Node delivers the child's `exit` event. The wait under test counts a registered
 * zombie as exited, which can be seen a moment before Node delivers that event, so a test awaits
 * the event instead of reading a flag it sets. A long-lived child ends only when the test kills it,
 * so `child.killed` (set by the kill call itself) shows the wait did not return before that.
 */
function exitOf(child: ChildProcess): Promise<void> {
  return new Promise<void>((resolve) => child.once('exit', () => resolve()));
}

describe('control request bytes', () => {
  const head = (command: string): string => `{"command":"${command}","id":"${ID}","generation":"${GENERATION}"`;
  const cases: ReadonlyArray<[TControlCommand, Readonly<Record<string, string>> | undefined, string]> = [
    ['status', undefined, '}'],
    ['stop', undefined, '}'],
    ['lock', undefined, '}'],
    ['unlink-pr', undefined, '}'],
    ['events-list', undefined, '}'],
    ['connect', undefined, '}'],
    ['rename', { name: 'Evening review' }, ',"name":"Evening review"}'],
    ['link-pr', { url: 'https://github.com/team/repo/pull/1' }, ',"url":"https://github.com/team/repo/pull/1"}'],
    ['events-revoke', { grantId: 'grant-1' }, ',"grantId":"grant-1"}'],
  ];

  it.each(cases)('sends %s as one line with its fields after the generation', async (command, fields, tail) => {
    const endpoint = await endpointAnswering(statusOnly('ok'));
    await requestSupervisedControl(endpoint.directory, ID, GENERATION, command, undefined, fields);
    expect(endpoint.lines).toEqual([`${head(command)}${tail}`]);
  });

  it('keeps the fields in the order the caller gave them', async () => {
    const endpoint = await endpointAnswering(statusOnly('ok'));
    await requestSupervisedControl(endpoint.directory, ID, GENERATION, 'rename', undefined, { z: '1', a: '2' });
    expect(endpoint.lines).toEqual([`${head('rename')},"z":"1","a":"2"}`]);
  });

  it('sends lock and attach as the same request lines', async () => {
    const endpoint = await endpointAnswering((request, context) => replyOf(context.id, context.generation,
      request['command'] === 'lock' ? { status: 'locked' } : { status: 'attached', driverId: 'attach:1' }));
    await lockSupervisedSession(ID, root, GENERATION);
    const attached = await openSupervisedAttachSocket(ID, 'observe', root, GENERATION);
    attached.socket.destroy();
    expect(attached.driverId).toBe('attach:1');
    expect(endpoint.lines).toEqual([head('lock') + '}', `${head('attach')},"mode":"observe","protocol":1}`]);
  });
});

describe('control request replies', () => {
  it.each<[string, TControlAnswer]>([
    ['no generation', { id: ID, status: 'ok' }],
    ['another generation', { id: ID, status: 'ok', generation: 'B'.repeat(22) }],
    ['another id', { id: '9bf9bc27-d773-4e88-b88f-f7a43e9eb1f4', status: 'ok', generation: GENERATION }],
    ['no object', 'null\n'],
    ['text', '"text"\n'],
  ])('returns no reply that carries %s', async (_name, answer) => {
    const endpoint = await endpointAnswering(() => answer);
    await expect(requestSupervisedControl(endpoint.directory, ID, GENERATION, 'status'))
      .rejects.toThrow(/changed since it was verified/i);
  });

  it('bounds a reply line, and lets only the status reply be longer', async () => {
    const long = `{"id":"${ID}","generation":"${GENERATION}","pad":"${'x'.repeat(4_200)}"}\n`;
    const endpoint = await endpointAnswering(() => long);
    await expect(requestSupervisedControl(endpoint.directory, ID, GENERATION, 'stop')).rejects.toThrow(/too large/i);
    await expect(requestSupervisedControl(endpoint.directory, ID, GENERATION, 'status')).resolves.toMatchObject({ id: ID });
  });

  it('reports a control that closes without replying, and one whose socket is gone', async () => {
    const endpoint = await endpointAnswering(() => undefined);
    await expect(requestSupervisedControl(endpoint.directory, ID, GENERATION, 'status'))
      .rejects.toThrow(/closed before replying/i);
    rmSync(controlSocketPath(root, ID), { force: true });
    await expect(requestSupervisedControl(endpoint.directory, ID, GENERATION, 'status')).rejects.toThrow();
  });

  it('destroys its connection when the caller aborts an unanswered request', async () => {
    const endpoint = await endpointAnswering(() => new Promise<never>(() => undefined));
    const abort = new AbortController();
    const pending = requestSupervisedControl(endpoint.directory, ID, GENERATION, 'status', abort.signal);
    await vi.waitFor(() => expect(endpoint.lines).toHaveLength(1));
    const closed = new Promise<void>((resolve) => endpoint.connections[0]!.once('close', () => resolve()));
    abort.abort();
    await expect(pending).rejects.toThrow();
    await closed;
  });
});

describe('lock', () => {
  it('asks the live owner to lock it', async () => {
    const endpoint = await endpointAnswering(statusOnly('locked'));
    await lockSupervisedSession(ID, root, GENERATION);
    expect(endpoint.lines).toEqual([`{"command":"lock","id":"${ID}","generation":"${GENERATION}"}`]);
  });

  it('reports an endpoint that cannot confirm it, and a registration that changed since it was listed', async () => {
    const endpoint = await endpointAnswering(statusOnly('refused'));
    await expect(lockSupervisedSession(ID, root, GENERATION)).rejects.toThrow(/confirm locking/i);
    await expect(lockSupervisedSession(ID, root, 'B'.repeat(22))).rejects.toThrow(/changed/i);
    expect(endpoint.lines).toHaveLength(1);
  });
});

describe('stop', () => {
  /** A runtime that, once asked to stop, leaves in two steps: its registration first, its process after. */
  async function stoppingRuntime(
    answer: TControlAnswer,
  ): Promise<{ endpoint: IControlEndpoint; child: ChildProcess; exited: Promise<void> }> {
    const child = spawnLongLivedProcess();
    const exited = exitOf(child);
    const endpoint = await endpointAnswering(() => {
      setTimeout(() => {
        rmSync(join(root, ID), { recursive: true, force: true });
        setTimeout(() => child.kill('SIGKILL'), 150);
      }, 20);
      return answer;
    }, { pid: child.pid! });
    return { endpoint, child, exited };
  }

  it('returns only once the registration is gone and the registered process has exited', async () => {
    const { endpoint, child, exited } = await stoppingRuntime({ id: ID, status: 'stopping', generation: GENERATION });
    await stopSupervisedSession(ID, root, GENERATION);
    expect(child.killed).toBe(true);
    await exited;
    expect(existsSync(join(root, ID))).toBe(false);
    expect(endpoint.lines).toEqual([`{"command":"stop","id":"${ID}","generation":"${GENERATION}"}`]);
  });

  it('refuses an endpoint that does not confirm the shutdown', async () => {
    const endpoint = await endpointAnswering(statusOnly('refused'));
    await expect(stopSupervisedSession(ID, root, GENERATION)).rejects.toThrow(/confirm shutdown/i);
    expect(endpoint.lines).toHaveLength(1);
  });

  it('refuses an id outside the registry and a registration that changed since it was listed, asking nothing', async () => {
    const endpoint = await endpointAnswering(statusOnly('stopping'));
    await expect(stopSupervisedSession('../escape', root)).rejects.toThrow(/invalid/i);
    await expect(stopSupervisedSession(ID, root, 'B'.repeat(22))).rejects.toThrow(/changed/i);
    expect(endpoint.lines).toEqual([]);
  });

  it('refuses a registration whose process start no longer matches, asking nothing', async () => {
    const endpoint = await endpointAnswering(statusOnly('stopping'), { startedAt: 'a process that has since ended' });
    await expect(stopSupervisedSession(ID, root)).rejects.toThrow(/not proven alive/i);
    expect(endpoint.lines).toEqual([]);
  });
});

describe('stop of a runtime this process started', () => {
  it.each<[string, TControlAnswer]>([
    ['hangs up without answering', undefined],
    ['refuses the stop', { id: ID, status: 'refused' }],
    ['confirms the stop', { id: ID, status: 'stopping', generation: GENERATION }],
  ])('goes on to wait for the exit when the runtime %s', async (_name, answer) => {
    const child = spawnLongLivedProcess();
    const exited = exitOf(child);
    const endpoint = await endpointAnswering(() => {
      setTimeout(() => {
        rmSync(join(root, ID), { recursive: true, force: true });
        setTimeout(() => child.kill('SIGKILL'), 150);
      }, 20);
      return answer;
    }, { pid: child.pid! });
    await stopStartedSupervisedSession(ID, root, GENERATION);
    expect(child.killed).toBe(true);
    await exited;
    expect(endpoint.lines).toEqual([`{"command":"stop","id":"${ID}","generation":"${GENERATION}"}`]);
  });

  it('still refuses a registration that changed since it was started', async () => {
    const endpoint = await endpointAnswering(statusOnly('stopping'));
    await expect(stopStartedSupervisedSession(ID, root, 'B'.repeat(22))).rejects.toThrow(/changed/i);
    expect(endpoint.lines).toEqual([]);
  });
});

describe('attach', () => {
  it.each<[string, string]>([
    ['attach-limit', 'Too many terminals are already attached to this supervised session.'],
    ['stale-generation', 'Supervised session changed since it was listed.'],
    ['declined', 'This supervised session declined the attach.'],
    ['anything else', 'Supervised session refused the attach.'],
  ])('reports a refusal for %s in the words a person reads', async (reason, message) => {
    await endpointAnswering(() => ({ id: ID, status: 'refused', reason }));
    await expect(openSupervisedAttachSocket(ID, 'drive', root, GENERATION)).rejects.toThrow(message);
  });

  it('hands over the bytes that arrived with the reply, with the socket paused', async () => {
    await endpointAnswering(() => `{"id":"${ID}","status":"attached","driverId":"attach:7","generation":"${GENERATION}"}\nprotocol bytes`);
    const attached = await openSupervisedAttachSocket(ID, 'drive', root, GENERATION);
    try {
      expect(attached.driverId).toBe('attach:7');
      expect(attached.rest).toBe('protocol bytes');
      expect(attached.socket.isPaused()).toBe(true);
    } finally {
      attached.socket.destroy();
    }
  });

  it.each<[string, TControlAnswer]>([
    ['another generation', { id: ID, status: 'attached', driverId: 'attach:1', generation: 'B'.repeat(22) }],
    ['a driver id that is not one', { id: ID, status: 'attached', driverId: 'attach:0', generation: GENERATION }],
    ['another id', { id: '9bf9bc27-d773-4e88-b88f-f7a43e9eb1f4', status: 'attached', driverId: 'attach:1', generation: GENERATION }],
  ])('does not take a reply with %s as an attach', async (_name, answer) => {
    await endpointAnswering(() => answer);
    await expect(openSupervisedAttachSocket(ID, 'drive', root, GENERATION)).rejects.toThrow(/did not confirm the attach/i);
  });
});
