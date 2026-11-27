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
import { startStandInConnector, virtualHostFetch } from './stand-in-connector.js';
import { PAGE, QUESTION, keyOf, launchIntent } from './launch-world.js';

import type { IVerifiedConnectorBindingSpec } from '../task-catalog/binding-providers.js';
import type { ILaunchRecipe } from '../task-catalog/launch/recipes.js';
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

    // The launch as the person reads it is the one the start answered, with where it stands: the run
    // reported, but read nothing, so nothing the host recorded confirms the report.
    const standing = {
      progress: 'unverified',
      reason: 'The run finished, but nothing it read matches the page you named.',
      report: 'The page says shipping is free.',
      evidence: [],
    };
    expect((await api.send('GET', `tasks/launches/${first.body.launch.id}`)).body).toEqual({
      launch: { ...first.body.launch, ...standing, decidedAt: expect.any(String) },
    });
    expect((await api.send('GET', 'tasks/launches')).body).toEqual({
      launches: [{ ...first.body.launch, ...standing, decidedAt: expect.any(String) }],
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

describe('where a launch stands, over the API', () => {
  const STANDING_KEYS = [
    'bindings',
    'createdAt',
    'decidedAt',
    'definitionDigest',
    'definitionId',
    'definitionRevision',
    'evidence',
    'goalId',
    'id',
    'inputs',
    'origin',
    'progress',
    'reason',
    'report',
    'status',
    'updatedAt',
  ];

  it('shows the derived status, the report, the receipts and the goal, and nothing the host keeps for itself', async () => {
    const { harness: target, api } = await started();
    target.model.script({ text: 'The page says shipping is free.' });
    const first = await api.send('POST', START, body());
    await settled(target);
    const shown = (await api.send('GET', `tasks/launches/${first.body.launch.id}`)).body.launch;
    expect(Object.keys(shown).sort()).toEqual(STANDING_KEYS);
    expect(shown).toMatchObject({
      progress: 'unverified',
      goalId: first.body.goalId,
      report: 'The page says shipping is free.',
      evidence: [],
    });
    // The host's own bookkeeping, and the key and digest of the request, stay with the host.
    for (const hidden of ['receipts', 'outcome', 'idempotencyKey', 'requestDigest'])
      expect(shown, hidden).not.toHaveProperty(hidden);
  });

  it('shows a report as bounded plain text, however long it is and whatever it carries', async () => {
    const { harness: target, api } = await started();
    const marks = [String.fromCharCode(7), String.fromCharCode(0x202e)].join('');
    target.model.script({
      text: `<img src=x onerror=alert(1)> **Yes** [link](https://evil.example)${marks}\n\n\n\n\n${'y'.repeat(6000)}`,
    });
    const first = await api.send('POST', START, body());
    await settled(target);
    const { report } = (await api.send('GET', `tasks/launches/${first.body.launch.id}`)).body
      .launch;
    expect(report.length).toBeLessThanOrEqual(2000);
    expect(report.endsWith('…')).toBe(true);
    expect(report).toContain('<img src=x onerror=alert(1)> **Yes** [link](https://evil.example)');
    expect(report).not.toMatch(new RegExp(`[${marks}]`, 'u'));
    expect(report).not.toContain('\n\n\n');
    // Every launch of the list is as bounded.
    const listed = (await api.send('GET', 'tasks/launches')).body.launches as any[];
    expect(listed[0].report).toBe(report);
    for (const text of [listed[0].reason, ...listed[0].evidence.map((read: any) => read.address)])
      expect(String(text).length).toBeLessThanOrEqual(2048);
  });

  it('answers a launch kept before outcomes existed, decides it when its run ends, and then keeps what it decided', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'task-launch-api-'));
    directories.push(stateDir);
    const { harness: target, api } = await started({ stateDir });
    const { intent } = await leftReserved(stateDir);
    const goal = await target.capabilities.goals.create({
      title: 'Check a fact on a page',
      instructions: 'Look at the page.',
      readOnly: true,
      launch: { id: intent.id },
    });
    await createFileLaunchStore({ directory: join(stateDir, 'task-catalog') }).advance(intent.id, {
      status: 'launched',
      goalId: goal.id,
    });
    expect((await api.send('GET', `tasks/launches/${intent.id}`)).body.launch).toMatchObject({
      status: 'launched',
      progress: 'starting',
      evidence: [],
    });
    await target.capabilities.runner()!.runDue();
    await settled(target);
    const decided = (await api.send('GET', `tasks/launches/${intent.id}`)).body.launch;
    expect(decided).toMatchObject({
      progress: 'unverified',
      report: 'The page says shipping is free.',
    });
    expect((await api.send('GET', `tasks/launches/${intent.id}`)).body.launch).toEqual(decided);
  });

  it('decides a launch whose goal the person stopped before it ran as cancelled, when it is read, and says so', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'task-launch-api-'));
    directories.push(stateDir);
    const { harness: target, api } = await started({ stateDir });
    const { intent } = await leftReserved(stateDir);
    const goal = await target.capabilities.goals.create({
      title: 'Check a fact on a page',
      instructions: 'Look at the page.',
      readOnly: true,
      launch: { id: intent.id },
    });
    await createFileLaunchStore({ directory: join(stateDir, 'task-catalog') }).advance(intent.id, {
      status: 'launched',
      goalId: goal.id,
    });
    expect((await api.send('POST', `goals/${goal.id}/stop`, {})).status).toBe(200);
    const url = `tasks/launches/${intent.id}`;
    const cancelled = (await api.send('GET', url)).body.launch;
    expect(cancelled).toMatchObject({
      progress: 'cancelled',
      reason: 'The goal for this task was removed before it finished.',
      evidence: [],
    });
    expect(cancelled).not.toHaveProperty('report');
    // The decision is kept: asking again, or after the agent restarts, is the same answer.
    expect((await api.send('GET', url)).body.launch).toEqual(cancelled);
    expect(target.model.requests).toEqual([]);
  });

  it('takes no write to a launch beyond the waiting-request routes, and the status of one that does not exist is a 404', async () => {
    const { api } = await started();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      for (const path of [
        'tasks/launches',
        'tasks/launches/launch-x',
        'tasks/launches/launch-x/stop',
      ])
        expect((await api.send(method, path, body())).status, `${method} ${path}`).toBe(404);
    }
    expect((await api.send('GET', 'tasks/launches/launch-x')).status).toBe(404);
    expect((await api.send('GET', 'tasks/launches/launch-x/cancel')).status).toBe(404);
    expect((await api.send('GET', 'goals')).body.goals).toEqual([]);
  });

  it('answers only the person’s own browser', async () => {
    const { harness: target, api } = await started();
    const first = await api.send('POST', START, body());
    await settled(target);
    for (const path of ['tasks/launches', `tasks/launches/${first.body.launch.id}`])
      expect((await api.send('GET', path, undefined, { cookie: false })).status, path).toBe(403);
  });
});

describe('a start that needs setup over the API', () => {
  const HOST = 'mail.stand-in.test';
  const TOKEN = ['static', 'token', 'launch', '0001'].join('-');
  const SEARCH: IVerifiedConnectorBindingSpec = {
    capability: 'mail.search',
    service: { kind: 'mail', endpointOrigin: `https://${HOST}` },
    tool: 'search_mail',
    effect: 'read-only',
    argumentBoundary: 'search words in the connected mailbox; nothing is sent',
  };
  const recipe: ILaunchRecipe = {
    definitionId: 'catch-up-on-mailbox',
    revision: 1,
    title: 'Catch up on a connected mailbox',
    pages: [],
    instructions: () => 'Summarise the recent mail.',
  };
  const MAIL_START = 'tasks/definitions/catch-up-on-mailbox/start';
  const mailBody = (change: Record<string, unknown> = {}): Record<string, unknown> => ({
    idempotencyKey: keyOf(1),
    inputs: { period: 'Last day' },
    ...change,
  });
  const closers: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close();
  });

  async function mailWorld() {
    const mail = await startStandInConnector({
      access: { token: TOKEN },
      tools: [{ name: 'search_mail', annotations: { readOnlyHint: true }, run: () => 'none' }],
      publicBase: `https://${HOST}`,
    });
    closers.push(mail.close);
    harness = await startHarness({
      gui: true,
      webRoot: createFixtureWebRoot(),
      browserAvailable: () => false,
      connectorBindingSpecs: [SEARCH],
      taskLaunch: { recipes: [recipe], capabilityTools: { 'mail.search': [] } },
      connectorNetwork: {
        fetch: virtualHostFetch({ [HOST]: mail.port }),
        lookup: async () => ['203.0.113.10'],
      },
    });
    harness.model.script({ text: 'Nothing needs your attention.' });
    const api = await client(harness);
    const signIn = async (): Promise<string> => {
      const made = await api.send('POST', 'connectors', {
        title: 'Work mail',
        kind: 'mail',
        endpoint: `https://${HOST}/mcp`,
        auth: 'token',
      });
      expect(made.status).toBe(200);
      const id = made.body.connector.id as string;
      expect((await api.send('POST', `connectors/${id}/connect`, { token: TOKEN })).status).toBe(
        200,
      );
      return id;
    };
    return { harness, api, signIn };
  }

  it('lists which tasks the host can start, and answers 202 with the waiting request and its steps', async () => {
    const { api } = await mailWorld();
    const listed = (await api.send('GET', 'tasks/definitions')).body.definitions as any[];
    expect(listed.map((entry) => [entry.id, entry.startable])).toEqual([
      ['catch-up-on-mailbox', true],
      ['prepare-my-week', false],
      ['draft-reply-to-message', false],
      ['check-fact-on-page', false],
    ]);
    const first = await api.send('POST', MAIL_START, mailBody());
    expect(first.status).toBe(202);
    expect(Object.keys(first.body)).toEqual(['launch']);
    expect(first.body.launch).toMatchObject({
      status: 'setup',
      progress: 'setup',
      steps: [{ type: 'connect', kind: 'mail' }],
      inputs: { period: 'Last day' },
    });
    expect(first.body.launch).not.toHaveProperty('goalId');
    // A retry and a second tab are the same waiting request.
    for (const key of [1, 2]) {
      const again = await api.send('POST', MAIL_START, mailBody({ idempotencyKey: keyOf(key) }));
      expect(again.status).toBe(202);
      expect(again.body.launch.id).toBe(first.body.launch.id);
    }
    expect((await api.send('GET', 'goals')).body.goals).toEqual([]);
    // A task the host has no way to start is refused, as it was.
    const other = await api.send('POST', 'tasks/definitions/prepare-my-week/start', {
      idempotencyKey: keyOf(5),
      inputs: { days: 7 },
    });
    expect(other.status).toBe(422);
  });

  it('is finished by the person: the sign-in is done, they look at the access, and confirm what they saw', async () => {
    const { harness: target, api, signIn } = await mailWorld();
    const first = await api.send('POST', MAIL_START, mailBody());
    const id = first.body.launch.id as string;
    const connector = await signIn();
    // The connector did not exist when Start was pressed, so the request waits for a look.
    const review = (await api.send('GET', `tasks/launches/${id}`)).body.launch;
    expect(review).toMatchObject({
      status: 'review',
      progress: 'review',
      proposed: [{ capability: 'mail.search', adapter: 'connector', account: connector }],
    });
    expect((await api.send('GET', 'goals')).body.goals).toEqual([]);
    const wrong = await api.send('POST', `tasks/launches/${id}/confirm`, {
      reviewDigest: 'a'.repeat(64),
    });
    expect(wrong.status).toBe(409);
    expect(wrong.body.launch).toMatchObject({ status: 'review' });
    const confirmed = await api.send('POST', `tasks/launches/${id}/confirm`, {
      reviewDigest: review.reviewDigest,
    });
    expect(confirmed.status).toBe(200);
    expect(Object.keys(confirmed.body)).toEqual(['launch']);
    expect(confirmed.body.launch).toMatchObject({ status: 'launched' });
    await settled(target);
    expect((await api.send('GET', 'goals')).body.goals).toHaveLength(1);
    // Confirming twice is refused and makes nothing more.
    const twice = await api.send('POST', `tasks/launches/${id}/confirm`, {
      reviewDigest: review.reviewDigest,
    });
    expect(twice.status).toBe(409);
    expect((await api.send('GET', 'goals')).body.goals).toHaveLength(1);
  });

  it('takes account, confirm and cancel with exactly their fields, a small body, and their own refusals', async () => {
    const { api } = await mailWorld();
    const id = (await api.send('POST', MAIL_START, mailBody())).body.launch.id as string;
    const base = `tasks/launches/${id}`;
    const refused = async (path: string, send: unknown, status: number) =>
      expect((await api.send('POST', path, send)).status, `${path} ${JSON.stringify(send)}`).toBe(
        status,
      );
    // Exactly the keys the route takes.
    await refused(`${base}/account`, {}, 400);
    await refused(`${base}/account`, { connectorId: 'connector-x', extra: 1 }, 400);
    await refused(`${base}/account`, { connectorId: 7 }, 400);
    await refused(`${base}/account`, [], 400);
    await refused(`${base}/confirm`, { reviewDigest: 'a'.repeat(64), extra: 1 }, 400);
    await refused(`${base}/confirm`, { reviewDigest: 'short' }, 400);
    await refused(`${base}/cancel`, { now: true }, 400);
    await refused(`${base}/cancel`, 'cancel', 400);
    // Small.
    await refused(`${base}/account`, { connectorId: 'c'.repeat(2000) }, 413);
    // An account this task does not offer, a request that is not in review, and one that is not there.
    await refused(`${base}/account`, { connectorId: 'connector-ghost' }, 422);
    await refused(`${base}/confirm`, { reviewDigest: 'a'.repeat(64) }, 409);
    await refused('tasks/launches/launch-none/account', { connectorId: 'connector-x' }, 404);
    await refused('tasks/launches/launch-none/confirm', { reviewDigest: 'a'.repeat(64) }, 404);
    await refused('tasks/launches/launch-none/cancel', {}, 404);
    // Cancelling ends it, and a second click is the same answer.
    for (let click = 0; click < 2; click += 1) {
      const cancelled = await api.send('POST', `${base}/cancel`, {});
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.launch).toMatchObject({ status: 'cancelled', progress: 'cancelled' });
    }
    expect((await api.send('GET', base)).body.launch).toMatchObject({ status: 'cancelled' });
    // Only the person's own browser may move a request.
    expect((await api.send('POST', `${base}/cancel`, {}, { cookie: false })).status).toBe(403);
    expect((await api.send('GET', 'goals')).body.goals).toEqual([]);
  });
});
