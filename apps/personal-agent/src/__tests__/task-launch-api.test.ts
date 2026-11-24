/**
 * Starting a task from the web UI's API: who may ask, what a request may hold, what each refusal
 * answers, and that a retry, a double click and a restart all get the one launch. The agent runs
 * against a scripted model, so the goal a start makes runs for real and ends with a report.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { BUILT_IN_DEFINITIONS } from '../task-catalog/built-in.js';
import { digestOf } from '../task-catalog/launch/digest.js';
import { createFileLaunchStore } from '../task-catalog/launch/file-store.js';
import { createFixtureWebRoot, loginClient, startHarness } from './harness.js';
import { PAGE, QUESTION, keyOf, launchIntent } from './launch-world.js';

import type { IHarness } from './harness.js';

interface IReply {
  readonly status: number;
  readonly body: any;
}

/** The login client, with each answer's body readable by field name. */
async function client(target: IHarness) {
  const api = await loginClient(target);
  return {
    send: (...args: Parameters<typeof api.send>) => api.send(...args) as Promise<IReply>,
  };
}

let harness: IHarness | undefined;
const directories: string[] = [];
afterEach(async () => {
  await harness?.close();
  harness = undefined;
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const START = 'tasks/definitions/check-fact-on-page/start';
const body = (change: Record<string, unknown> = {}): Record<string, unknown> => ({
  idempotencyKey: keyOf(1),
  inputs: { page: PAGE, question: QUESTION },
  ...change,
});

async function started(options: { browser?: boolean; stateDir?: string } = {}) {
  harness = await startHarness({
    gui: true,
    webRoot: createFixtureWebRoot(),
    browserAvailable: () => options.browser !== false,
    ...(options.stateDir !== undefined && { stateDir: options.stateDir }),
  });
  harness.model.script({ text: 'The page says shipping is free.' });
  return { harness, api: await client(harness) };
}

const settled = async (target: IHarness): Promise<void> => {
  await target.capabilities.runner()!.settled();
};

describe('starting a task over the API', () => {
  it('answers 201 with the launch and its goal, then 200 with the same body on a retry', async () => {
    const { harness: target, api } = await started();
    const first = await api.send('POST', START, body());
    expect(first.status).toBe(201);
    expect(Object.keys(first.body).sort()).toEqual(['goalId', 'launch']);
    expect(first.body.launch).toMatchObject({
      definitionId: 'check-fact-on-page',
      definitionRevision: 1,
      status: 'launched',
      goalId: first.body.goalId,
      origin: { kind: 'manual' },
      inputs: { page: PAGE, question: QUESTION },
    });
    const again = await api.send('POST', START, body());
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    await settled(target);

    // The goal carries the launch as typed data and ran under the launch's limits.
    const goal = await api.send('GET', `goals/${first.body.goalId}`);
    expect(goal.body.goal).toMatchObject({
      id: first.body.goalId,
      title: 'Check a fact on a page',
      readOnly: true,
      status: 'done',
      launch: { id: first.body.launch.id },
    });
    expect((await api.send('GET', 'goals')).body.goals).toHaveLength(1);
    const feed = (await api.send('GET', 'feed')).body.items as any[];
    expect(feed).toEqual([
      expect.objectContaining({
        kind: 'report',
        goalId: first.body.goalId,
        body: 'The page says shipping is free.',
      }),
    ]);

    expect((await api.send('GET', `tasks/launches/${first.body.launch.id}`)).body).toEqual({
      launch: first.body.launch,
    });
    expect((await api.send('GET', 'tasks/launches')).body).toEqual({
      launches: [first.body.launch],
    });
  });

  it('makes one goal for a double click, ten requests at once with one key', async () => {
    const { harness: target, api } = await started();
    const answers = await Promise.all(
      Array.from({ length: 10 }, () => api.send('POST', START, body())),
    );
    expect(answers.map((answer) => answer.status).sort()).toEqual([
      200, 200, 200, 200, 200, 200, 200, 200, 200, 201,
    ]);
    expect(new Set(answers.map((answer) => JSON.stringify(answer.body))).size).toBe(1);
    await settled(target);
    expect((await api.send('GET', 'goals')).body.goals).toHaveLength(1);
    expect((await api.send('GET', 'tasks/launches')).body.launches).toHaveLength(1);
  });

  it('answers a second tab’s own key for the same work with the launch already under way', async () => {
    const { harness: target, api } = await started();
    harness!.model.script(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { text: 'Done.' };
    });
    const first = await api.send('POST', START, body({ idempotencyKey: keyOf(1) }));
    const second = await api.send('POST', START, body({ idempotencyKey: keyOf(2) }));
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    await settled(target);
    expect((await api.send('GET', 'goals')).body.goals).toHaveLength(1);
  });

  it('answers the same key with the same body after the agent restarted, and makes no second goal', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'task-launch-api-'));
    directories.push(stateDir);
    const one = await started({ stateDir });
    const first = await one.api.send('POST', START, body());
    await settled(one.harness);
    await one.harness.close();
    harness = undefined;

    const two = await started({ stateDir });
    const again = await two.api.send('POST', START, body());
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect((await two.api.send('GET', 'goals')).body.goals).toHaveLength(1);
    expect((await two.api.send('GET', 'tasks/launches')).body.launches).toHaveLength(1);
  });

  it('refuses the same key for other values with 409, and makes nothing more', async () => {
    const { harness: target, api } = await started();
    await api.send('POST', START, body());
    const other = await api.send(
      'POST',
      START,
      body({ inputs: { page: PAGE, question: 'Other?' } }),
    );
    expect(other.status).toBe(409);
    expect(other.body).toEqual({
      error: 'This key was already used for a different request. Start the task again.',
    });
    await settled(target);
    expect((await api.send('GET', 'goals')).body.goals).toHaveLength(1);
  });

  it('refuses a task that is not ready with 422 and the readiness, keeping nothing', async () => {
    const { harness: target, api } = await started({ browser: false });
    const refused = await api.send('POST', START, body());
    expect(refused.status).toBe(422);
    expect(refused.body).toEqual({
      error: 'This task is not ready to start.',
      readiness: {
        state: 'unavailable',
        reason: 'the local browser is not available on this machine',
      },
    });
    // A task whose capabilities nobody verified is refused the same way.
    const mail = await api.send('POST', 'tasks/definitions/catch-up-on-mailbox/start', {
      idempotencyKey: keyOf(2),
      inputs: { period: 'Last day' },
    });
    expect(mail.status).toBe(422);
    expect(mail.body.readiness).toEqual({
      state: 'unavailable',
      reason: 'no verified binding for mail.search yet',
    });
    expect((await api.send('GET', 'goals')).body.goals).toEqual([]);
    expect((await api.send('GET', 'tasks/launches')).body.launches).toEqual([]);
    expect(target.model.requests).toEqual([]);
  });

  it('refuses a request it cannot start from with 400 or 404, keeping nothing', async () => {
    const { api } = await started();
    const cases: [string, unknown, number, RegExp][] = [
      [START, body({ idempotencyKey: 'short' }), 400, /idempotencyKey/u],
      [START, body({ idempotencyKey: undefined }), 400, /idempotencyKey/u],
      [START, body({ inputs: { page: 'file:///etc/passwd', question: QUESTION } }), 400, /https/u],
      [START, body({ inputs: { page: PAGE } }), 400, /What to check: this is needed/u],
      [
        START,
        body({ inputs: { page: PAGE, question: QUESTION, shell: 'rm -rf /' } }),
        400,
        /does not ask for shell/u,
      ],
      [START, body({ inputs: 'page' }), 400, /inputs must be an object/u],
      [
        START,
        body({ inputs: { page: 'https://127.0.0.1/', question: QUESTION } }),
        400,
        /public site/u,
      ],
      [START, [body()], 400, /JSON object/u],
      [START, body({ extra: true }), 400, /not part of it/u],
      ['tasks/definitions/no-such-task/start', body(), 404, /no such task/u],
    ];
    for (const [path, sent, status, message] of cases) {
      const answer = await api.send('POST', path, sent);
      expect(answer.status, JSON.stringify(sent)).toBe(status);
      expect(answer.body.error).toMatch(message);
    }
    expect((await api.send('POST', START)).status).toBe(400);
    expect((await api.send('GET', 'goals')).body.goals).toEqual([]);
    expect((await api.send('GET', 'tasks/launches')).body.launches).toEqual([]);
  });

  it('refuses a request body that is too large with 413', async () => {
    const { api } = await started();
    const large = await api.send(
      'POST',
      START,
      body({ inputs: { page: PAGE, question: 'x'.repeat(9000) } }),
    );
    expect(large.status).toBe(413);
    expect(large.body).toEqual({ error: 'The request is too large' });
    const many = await api.send(
      'POST',
      START,
      body({
        inputs: Object.fromEntries(
          Array.from({ length: 40 }, (_, i) => [`v${i}`, 'x'.repeat(300)]),
        ),
      }),
    );
    expect(many.status).toBe(413);
    expect((await api.send('GET', 'goals')).body.goals).toEqual([]);
  });

  it('answers only the person’s own browser, and only with the write header', async () => {
    const { api } = await started();
    expect((await api.send('POST', START, body(), { cookie: false })).status).toBe(403);
    expect((await api.send('POST', START, body(), { write: false })).status).toBe(403);
    expect((await api.send('GET', 'tasks/launches', undefined, { cookie: false })).status).toBe(
      403,
    );
    expect(
      (await api.send('GET', 'tasks/launches/launch-x', undefined, { cookie: false })).status,
    ).toBe(403);
    expect((await api.send('GET', 'goals')).body.goals).toEqual([]);
  });

  it('changes nothing through any other task route', async () => {
    const { api } = await started();
    for (const path of [
      'tasks/definitions',
      'tasks/offers',
      'tasks/launches',
      'tasks/launches/launch-x',
      'tasks/definitions/check-fact-on-page',
      'tasks/definitions/check-fact-on-page/start/more',
      'tasks',
    ]) {
      for (const method of ['POST', 'PUT', 'DELETE'])
        expect((await api.send(method, path, body())).status, `${method} ${path}`).toBe(404);
    }
    expect((await api.send('GET', START)).status, `GET ${START}`).toBe(404);
    for (const method of ['PUT', 'DELETE'])
      expect((await api.send(method, START, body())).status, `${method} ${START}`).toBe(404);
    expect((await api.send('GET', 'tasks/launches/launch-x')).status).toBe(404);
    expect((await api.send('GET', 'goals')).body.goals).toEqual([]);
  });

  it('lists the newest launches first, at most fifty', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'task-launch-api-'));
    directories.push(stateDir);
    mkdirSync(join(stateDir, 'task-catalog'), { recursive: true, mode: 0o700 });
    const ended = Array.from({ length: 60 }, (_, index) =>
      launchIntent(index + 1, {
        status: 'failed',
        failure: { kind: 'goal', message: 'Your agent could not set this task up.' },
      }),
    );
    writeFileSync(
      join(stateDir, 'task-catalog', 'launches.json'),
      JSON.stringify({ launches: ended }),
    );
    const { api } = await started({ stateDir });
    const listed = (await api.send('GET', 'tasks/launches')).body.launches as any[];
    expect(listed).toHaveLength(50);
    expect(listed[0].id).toBe(launchIntent(60).id);
    expect(listed[49].id).toBe(launchIntent(11).id);
    expect((await api.send('GET', `tasks/launches/${launchIntent(3).id}`)).body.launch.status).toBe(
      'failed',
    );
  });

  it('shows no path of this machine, no access code, no key and no digest of the request', async () => {
    const { harness: target, api } = await started();
    const first = await api.send('POST', START, body());
    await settled(target);
    const shown = JSON.stringify([
      first.body,
      (await api.send('GET', 'tasks/launches')).body,
      (await api.send('GET', `tasks/launches/${first.body.launch.id}`)).body,
      (
        await api.send(
          'POST',
          START,
          body({ inputs: { page: 'file:///etc/passwd', question: QUESTION } }),
        )
      ).body,
    ]);
    for (const hidden of [
      target.stateDir,
      'task-catalog',
      target.local.gui!.accessCode,
      'scripted-key',
      keyOf(1),
      'requestDigest',
      'idempotencyKey',
    ])
      expect(shown, hidden).not.toContain(hidden);
  });

  it('does not let a goal made another way carry a launch mark', async () => {
    const { harness: target, api } = await started();
    const made = await api.send('POST', 'goals', {
      title: 'Mine',
      instructions: 'Look at the weather.',
      launch: { id: 'launch-forged' },
    });
    expect(made.status).toBe(200);
    expect(made.body.goal).not.toHaveProperty('launch');
    expect((await target.capabilities.goals.list())[0]).not.toHaveProperty('launch');
  });
});

/** A reserved launch of the page check, as a stopped agent leaves it, kept in the state directory. */
async function leftReserved(stateDir: string, change: Record<string, unknown> = {}) {
  const directory = join(stateDir, 'task-catalog');
  const stamp = new Date().toISOString();
  const store = createFileLaunchStore({ directory });
  const intent = launchIntent(1, {
    // The same request the page makes, so its key is answered by this launch and not taken as another.
    requestDigest: digestOf({
      definitionId: 'check-fact-on-page',
      inputs: { page: PAGE, question: QUESTION },
    }),
    definitionDigest: digestOf(BUILT_IN_DEFINITIONS[3]),
    inputs: { page: PAGE, question: QUESTION },
    bindings: [
      {
        capability: 'web.read',
        adapter: 'local-browser',
        effect: 'read-only',
        argumentBoundary:
          "https pages the person names, read in the agent's own browser; nothing is submitted",
      },
    ],
    createdAt: stamp,
    updatedAt: stamp,
    ...change,
  });
  await store.reserve(intent);
  return { intent, store };
}

describe('a start a stopped agent left half way', () => {
  it('is settled when the agent starts again: the one goal is made, runs, and reports', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'task-launch-api-'));
    directories.push(stateDir);
    const { intent } = await leftReserved(stateDir);
    const { harness: target, api } = await started({ stateDir });
    const goals = await target.capabilities.goals.list();
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({ launch: { id: intent.id }, readOnly: true });
    await settled(target);
    const kept = (await api.send('GET', `tasks/launches/${intent.id}`)).body.launch;
    expect(kept).toMatchObject({ status: 'launched', goalId: goals[0]!.id });
    expect((await target.capabilities.goals.feed()).map((item) => item.kind)).toEqual(['report']);
    // The key the page held is answered with that goal, and makes no second.
    const again = await api.send('POST', START, body({ idempotencyKey: intent.idempotencyKey }));
    expect(again).toMatchObject({ status: 200, body: { goalId: goals[0]!.id } });
    expect(await target.capabilities.goals.list()).toHaveLength(1);
  });

  it('is ended as failed, with no goal, when the task changed while the agent was stopped', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'task-launch-api-'));
    directories.push(stateDir);
    const { intent } = await leftReserved(stateDir, { definitionDigest: 'c'.repeat(64) });
    const { harness: target, api } = await started({ stateDir });
    expect(await target.capabilities.goals.list()).toEqual([]);
    expect((await api.send('GET', `tasks/launches/${intent.id}`)).body.launch).toMatchObject({
      status: 'failed',
      failure: { kind: 'stale' },
    });
    const again = await api.send('POST', START, body({ idempotencyKey: intent.idempotencyKey }));
    expect(again.status).toBe(422);
    expect(again.body.launch.status).toBe('failed');
    expect(target.model.requests).toEqual([]);
  });

  it('keeps a goal from running until its launch is recorded, then runs it with the launch’s tools', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'task-launch-api-'));
    directories.push(stateDir);
    const { harness: target } = await started({ stateDir });
    const { intent, store } = await leftReserved(stateDir);
    const goal = await target.capabilities.goals.create({
      title: 'Check a fact on a page',
      instructions: 'Look at the page.',
      readOnly: true,
      launch: { id: intent.id },
    });
    const runner = target.capabilities.runner()!;
    expect(await runner.runDue()).toBe(0);
    expect(target.model.requests).toEqual([]);
    await store.advance(intent.id, { status: 'launched', goalId: goal.id });
    expect(await runner.runDue()).toBe(1);
    await runner.settled();
    expect(
      (target.model.requests[0]!.tools ?? []).map((tool) => tool.function?.name).sort(),
    ).toEqual(expect.arrayContaining(['BrowserOpen', 'BrowserView']));
    expect((await target.capabilities.goals.get(goal.id))?.status).toBe('done');
  });
});
