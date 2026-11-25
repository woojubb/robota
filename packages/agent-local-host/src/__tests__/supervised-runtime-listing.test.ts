import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { controlSocketPath, readRegisteredProcessStartTime } from '../supervised-control-carrier.js';
import { isControlCwd, isCurrentActivity, listSupervisedRuntimes } from '../supervised-control-client.js';
import { FIXTURE_GENERATION, replyOf, startControlEndpoint, writeRegistration, type IControlEndpoint, type TControlAnswer } from './helpers/control-endpoint.js';

const GENERATION = FIXTURE_GENERATION;
const FIRST = '1bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';
const SECOND = '2bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';
const THIRD = '3bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';

let root: string;
const endpoints: IControlEndpoint[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'rt-')));
});

afterEach(async () => {
  for (const endpoint of endpoints.splice(0)) await endpoint.close();
  rmSync(root, { recursive: true, force: true });
});

async function runtime(
  id: string,
  answer: (request: Record<string, unknown>, context: { readonly id: string; readonly generation: string }) => TControlAnswer | Promise<TControlAnswer>,
): Promise<IControlEndpoint> {
  const endpoint = await startControlEndpoint({ root, id, answer });
  endpoints.push(endpoint);
  return endpoint;
}

const running = (body: Record<string, unknown> = {}) =>
  (_request: Record<string, unknown>, context: { readonly id: string; readonly generation: string }) =>
    replyOf(context.id, context.generation, { status: 'running', ...body });

describe('listing supervised runtimes', () => {
  it('lists a live runtime with the verified reply it gave to a status request', async () => {
    const endpoint = await runtime(FIRST, running({
      activity: 'idle', cwd: '/work/project', daemon: true, restricted: true, certified: true, name: 'Morning review',
    }));
    const listed = await listSupervisedRuntimes(root);
    expect(listed).toEqual([{
      id: FIRST, liveness: 'alive', generation: GENERATION, control: 'available',
      status: {
        activity: 'idle', cwd: '/work/project', daemon: true, restricted: true, certified: true,
        reply: {
          id: FIRST, status: 'running', activity: 'idle', cwd: '/work/project', daemon: true,
          restricted: true, certified: true, name: 'Morning review', generation: GENERATION,
        },
      },
    }]);
    expect(endpoint.lines).toEqual([`{"command":"status","id":"${FIRST}","generation":"${GENERATION}"}`]);
  });

  it('lists a runtime that reports nothing with the activity unknown and no optional field', async () => {
    await runtime(FIRST, running());
    const [listed] = await listSupervisedRuntimes(root);
    expect(listed?.status).toStrictEqual({
      activity: 'unknown',
      reply: { id: FIRST, status: 'running', generation: GENERATION },
    });
  });

  it('lists a registration that is not alive, invalid, or without a generation as unavailable without asking it', async () => {
    const startedAt = readRegisteredProcessStartTime(process.pid)!;
    writeRegistration(root, FIRST, { id: FIRST, pid: process.pid, startedAt: 'a start that has ended', generation: GENERATION });
    writeRegistration(root, SECOND, { id: SECOND, pid: 'not a pid', startedAt, generation: GENERATION });
    writeRegistration(root, THIRD, { id: THIRD, pid: process.pid, startedAt });
    expect(await listSupervisedRuntimes(root)).toStrictEqual([
      { id: FIRST, liveness: 'dead', control: 'unavailable' },
      { id: SECOND, liveness: 'unknown', control: 'unavailable', problem: 'invalid-registration' },
      { id: THIRD, liveness: 'alive', control: 'unavailable' },
    ]);
  });

  it('lists nothing for a directory without registrations or one that does not exist', async () => {
    expect(await listSupervisedRuntimes(root)).toEqual([]);
    expect(await listSupervisedRuntimes(join(root, 'absent'))).toEqual([]);
  });

  it.each<[string, TControlAnswer]>([
    ['refuses without echoing the generation', { id: FIRST, status: 'refused' }],
    ['answers with another status', { id: FIRST, status: 'stopping', generation: GENERATION }],
    ['echoes another generation', { id: FIRST, status: 'running', activity: 'working', generation: 'B'.repeat(22) }],
    ['echoes another id', { id: SECOND, status: 'running', activity: 'working', generation: GENERATION }],
    ['answers with something that is no object', 'null\n'],
    ['answers with something that is no JSON', 'not json\n'],
    ['hangs up without answering', undefined],
  ])('lists a live runtime whose control %s as unavailable, with nothing it said', async (_name, answer) => {
    await runtime(FIRST, () => answer);
    expect(await listSupervisedRuntimes(root)).toStrictEqual([
      { id: FIRST, liveness: 'alive', control: 'unavailable' },
    ]);
  });

  it('lists a live runtime whose socket is gone as unavailable', async () => {
    await runtime(FIRST, running());
    rmSync(controlSocketPath(root, FIRST));
    expect(await listSupervisedRuntimes(root)).toStrictEqual([
      { id: FIRST, liveness: 'alive', control: 'unavailable' },
    ]);
  });

  it('lists runtimes in id order however long each takes to answer', async () => {
    await runtime(THIRD, running({ activity: 'idle' }));
    await runtime(FIRST, async (_request, context) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 60));
      return replyOf(context.id, context.generation, { status: 'running', activity: 'working' });
    });
    writeRegistration(root, SECOND, { id: SECOND, pid: process.pid, startedAt: 'a start that has ended', generation: GENERATION });
    const listed = await listSupervisedRuntimes(root);
    expect(listed.map((entry) => [entry.id, entry.control, entry.status?.activity])).toEqual([
      [FIRST, 'available', 'working'],
      [SECOND, 'unavailable', undefined],
      [THIRD, 'available', 'idle'],
    ]);
  });
});

describe('listing supervised runtimes and cancelling', () => {
  it('rejects at once when it is already cancelled, asking nobody', async () => {
    const endpoint = await runtime(FIRST, running());
    const abort = new AbortController();
    abort.abort();
    await expect(listSupervisedRuntimes(root, abort.signal)).rejects.toThrow(/abort/i);
    expect(endpoint.lines).toEqual([]);
  });

  it('rejects when cancelled while a status request is unanswered, and closes that connection', async () => {
    const endpoint = await runtime(FIRST, () => new Promise<never>(() => undefined));
    const abort = new AbortController();
    const listing = listSupervisedRuntimes(root, abort.signal);
    await vi.waitFor(() => expect(endpoint.lines).toHaveLength(1));
    const closed = new Promise<void>((resolve) => endpoint.connections[0]!.once('close', () => resolve()));
    abort.abort();
    await expect(listing).rejects.toThrow(/abort/i);
    await closed;
  });
});

describe('the fields every control endpoint reports', () => {
  async function statusOf(body: Record<string, unknown>) {
    const endpoint = await runtime(FIRST, running(body));
    const [listed] = await listSupervisedRuntimes(root);
    await endpoint.close();
    endpoints.pop();
    const { reply, ...fields } = listed!.status!;
    expect(reply).toEqual({ id: FIRST, status: 'running', ...body, generation: GENERATION });
    return fields;
  }

  it.each<[unknown, string]>([
    ['working', 'working'], ['needs-input', 'needs-input'], ['idle', 'idle'],
    ['unknown', 'unknown'], ['sleeping', 'unknown'], [3, 'unknown'], [null, 'unknown'], [undefined, 'unknown'],
  ])('takes the activity %j as %s', async (reported, activity) => {
    expect(await statusOf({ activity: reported })).toStrictEqual({ activity });
  });

  it.each<[string, unknown, boolean]>([
    ['an absolute path', '/work/project', true],
    ['a path of 4096 characters', `/${'x'.repeat(4_095)}`, true],
    ['a path of 4097 characters', `/${'x'.repeat(4_096)}`, false],
    ['a relative path', 'work/project', false],
    ['an empty string', '', false],
    ['a number', 7, false],
  ])('takes %s as the working directory only when it is absolute and bounded', async (_name, cwd, accepted) => {
    expect(await statusOf({ cwd })).toStrictEqual(accepted ? { activity: 'unknown', cwd } : { activity: 'unknown' });
  });

  it.each<[string, Record<string, unknown>, Record<string, unknown>]>([
    ['a daemon', { daemon: true }, { daemon: true }],
    ['a restricted daemon', { daemon: true, restricted: true }, { daemon: true, restricted: true }],
    ['a daemon whose restriction is not true', { daemon: true, restricted: 'yes' }, { daemon: true }],
    ['a restriction without a daemon', { restricted: true }, {}],
    ['a daemon flag that is not true', { daemon: 'true', restricted: true }, {}],
    ['a daemon flag that is false', { daemon: false }, {}],
  ])('reports %s only when daemon is exactly true, and restricted only with it', async (_name, reported, expected) => {
    expect(await statusOf(reported)).toStrictEqual({ activity: 'unknown', ...expected });
  });

  it.each<[unknown, Record<string, unknown>]>([
    [true, { certified: true }], [false, { certified: false }], ['yes', {}], [1, {}], [null, {}],
  ])('takes certified %j only when it is a boolean', async (certified, expected) => {
    expect(await statusOf({ certified })).toStrictEqual({ activity: 'unknown', ...expected });
  });
});

describe('the predicates the endpoints and clients share', () => {
  it('accepts exactly the current activities and bounded absolute directories', () => {
    expect(['working', 'needs-input', 'idle'].every(isCurrentActivity)).toBe(true);
    expect([isCurrentActivity('unknown'), isCurrentActivity(undefined)]).toEqual([false, false]);
    expect([isControlCwd('/a'), isControlCwd('a'), isControlCwd(`/${'x'.repeat(4_096)}`), isControlCwd(undefined)])
      .toEqual([true, false, false, false]);
  });
});
