/**
 * The offers through the web UI's API: who may decide about one and what the decision may hold, what
 * the list shows, and starting a task from an offer: one launch for a double click, the offer accepted
 * with that launch, a stale offer refused in plain words with nothing started, and how the run ended
 * recorded on the offer apart from its acceptance. The agent, its stores and its browser are real; the
 * model and the site are stand-ins.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { findChromiumExecutable } from '../browser/playwright-browser.js';
import { createFixtureWebRoot, loginClient, startHarness } from './harness.js';
import { PAGE, QUESTION, keyOf } from './launch-world.js';
import { SHIPPING_TEXT, startStandInSite } from './stand-in-site.js';

import type { IHarness } from './harness.js';
import type { IStandInSite } from './stand-in-site.js';

interface IReply {
  readonly status: number;
  readonly body: any;
}

async function client(target: IHarness) {
  const api = await loginClient(target);
  return {
    send: (...args: Parameters<typeof api.send>) => api.send(...args) as Promise<IReply>,
  };
}

let harness: IHarness | undefined;
const sites: IStandInSite[] = [];
const directories: string[] = [];
afterEach(async () => {
  await harness?.close();
  harness = undefined;
  for (const site of sites.splice(0)) await site.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const START = 'tasks/definitions/check-fact-on-page/start';
const iso = (date: Date): string => date.toISOString().replace(/\.\d+Z$/u, 'Z');

async function started(options: { allowed?: IStandInSite; stateDir?: string } = {}) {
  harness = await startHarness({
    gui: true,
    webRoot: createFixtureWebRoot(),
    browserAvailable: () => true,
    ...(options.stateDir !== undefined && { stateDir: options.stateDir }),
    ...(options.allowed !== undefined && { browserAllowedHosts: [options.allowed.host] }),
  });
  harness.model.script({ text: 'The page says shipping is free.' });
  await harness.capabilities.wiki.remember({
    pageTitle: 'Returns policy',
    claim: 'Returns are accepted within 30 days.',
    source: { origin: 'owner' },
  });
  return { harness, api: await client(harness) };
}

/** An offer for the page check from the library page, made the way the agent makes one. */
async function offered(
  target: IHarness,
  change: { page?: string; item?: string } = {},
): Promise<string> {
  const answer = await target.capabilities.offers.proposer().propose({
    definitionId: 'check-fact-on-page',
    definitionRevision: 1,
    source: {
      kind: 'library',
      sourceItemId: change.item ?? 'returns-policy',
      observedAt: iso(new Date(Date.now() - 60_000)),
    },
    basis: 'The returns policy links to the shipping page.',
    why: 'You asked whether shipping is free.',
    suggestedInputs: { page: change.page ?? PAGE, question: QUESTION },
  });
  if (answer.status !== 'accepted') throw new Error(answer.reason);
  return answer.offerId;
}

const body = (offerId: string | undefined, change: Record<string, unknown> = {}) => ({
  idempotencyKey: keyOf(1),
  inputs: { page: PAGE, question: QUESTION },
  ...(offerId !== undefined && { offerId }),
  ...change,
});

const kept = async (target: IHarness, id: string) => target.capabilities.taskCatalog.getOffer(id);
const settled = async (target: IHarness): Promise<void> => {
  await target.capabilities.runner()!.settled();
};

describe('deciding about an offer over the API', () => {
  it('dismisses, snoozes and brings an offer back, and the list follows', async () => {
    const { harness: target, api } = await started();
    const id = await offered(target);
    const shown = (await api.send('GET', 'tasks/offers')).body;
    expect(shown.offers.map((offer: any) => offer.id)).toEqual([id]);
    expect(shown.offers[0]).toMatchObject({
      decision: 'open',
      prefilled: { page: PAGE, question: QUESTION },
      readiness: { state: 'ready' },
    });

    expect(
      await api.send('POST', `tasks/offers/${id}/decision`, { decision: 'dismissed' }),
    ).toEqual({
      status: 200,
      body: { offer: { id, decision: 'dismissed' } },
    });
    let listed = (await api.send('GET', 'tasks/offers')).body;
    expect(listed.offers).toEqual([]);
    expect(listed.setAside.map((offer: any) => [offer.id, offer.decision])).toEqual([
      [id, 'dismissed'],
    ]);

    // A dismissed offer is brought back before it is snoozed.
    expect(
      (await api.send('POST', `tasks/offers/${id}/decision`, { decision: 'open' })).status,
    ).toBe(200);
    const until = iso(new Date(Date.now() + 86_400_000));
    expect(
      (
        await api.send('POST', `tasks/offers/${id}/decision`, {
          decision: 'snoozed',
          snoozedUntil: until,
        })
      ).body,
    ).toEqual({ offer: { id, decision: 'snoozed', snoozedUntil: until } });
    listed = (await api.send('GET', 'tasks/offers')).body;
    expect(listed.offers).toEqual([]);
    expect(listed.setAside[0]).toMatchObject({ id, decision: 'snoozed', snoozedUntil: until });

    expect(
      (await api.send('POST', `tasks/offers/${id}/decision`, { decision: 'open' })).status,
    ).toBe(200);
    expect(
      (await api.send('GET', 'tasks/offers')).body.offers.map((offer: any) => offer.id),
    ).toEqual([id]);
  });

  it('is the person’s alone: no cookie and no write header are refused, and nothing changes', async () => {
    const { harness: target, api } = await started();
    const id = await offered(target);
    const path = `tasks/offers/${id}/decision`;
    expect(
      (await api.send('POST', path, { decision: 'dismissed' }, { cookie: false })).status,
    ).toBe(403);
    expect((await api.send('POST', path, { decision: 'dismissed' }, { write: false })).status).toBe(
      403,
    );
    expect((await kept(target, id))?.decision).toBe('open');
  });

  it('takes only a strict, small body, never an acceptance, and says why a request is refused', async () => {
    const { harness: target, api } = await started();
    const id = await offered(target);
    const path = `tasks/offers/${id}/decision`;
    const refused: readonly [unknown, number, RegExp][] = [
      [{ decision: 'accepted' }, 400, /decision must be one of dismissed, snoozed, open/u],
      [{ decision: 'accepted', launchId: 'launch-x' }, 400, /unknown field: launchId/u],
      [{ decision: 'dismissed', extra: 1 }, 400, /unknown field: extra/u],
      [
        { decision: 'dismissed', reactions: { verified: '2026-11-25T10:00:00Z' } },
        400,
        /unknown field: reactions/u,
      ],
      [{ decision: 'snoozed' }, 400, /snoozedUntil must be a UTC time/u],
      [
        { decision: 'snoozed', snoozedUntil: '2020-01-01T00:00:00Z' },
        400,
        /must be in the future/u,
      ],
      [{ decision: 'snoozed', snoozedUntil: '2099-01-01T00:00:00Z' }, 400, /within 30 days/u],
      [{ decision: 'dismissed', note: 'x'.repeat(2000) }, 400, /small JSON object/u],
      [['dismissed'], 400, /small JSON object/u],
      ['dismissed', 400, /small JSON object/u],
      [{}, 400, /decision must be one of/u],
    ];
    for (const [request, status, reason] of refused) {
      const answer = await api.send('POST', path, request);
      expect(answer.status, JSON.stringify(request).slice(0, 80)).toBe(status);
      expect(answer.body.error, JSON.stringify(request).slice(0, 80)).toMatch(reason);
    }
    expect(
      (await api.send('POST', 'tasks/offers/offer-nope/decision', { decision: 'dismissed' }))
        .status,
    ).toBe(404);
    const stored = await kept(target, id);
    expect(stored).toMatchObject({ decision: 'open' });
    expect(stored?.reactions?.dismissed).toBeUndefined();
  });

  it('leaves the other task routes as they were, and reads one offer, which records that it was opened', async () => {
    const { harness: target, api } = await started();
    const id = await offered(target);
    for (const [method, path] of [
      ['POST', 'tasks/offers'],
      ['PUT', `tasks/offers/${id}`],
      ['DELETE', `tasks/offers/${id}`],
      ['POST', `tasks/offers/${id}`],
      ['GET', `tasks/offers/${id}/decision`],
      ['PUT', `tasks/offers/${id}/decision`],
      ['POST', `tasks/offers/${id}/other`],
      ['POST', `tasks/offers/${id}/decision/more`],
      ['POST', 'tasks/definitions'],
      ['DELETE', 'tasks/definitions/check-fact-on-page'],
    ] as const) {
      expect(
        (await api.send(method, path, method === 'GET' ? undefined : {})).status,
        `${method} ${path}`,
      ).toBe(404);
    }
    expect((await api.send('GET', 'tasks/offers/offer-nope')).status).toBe(404);
    expect((await kept(target, id))?.reactions?.opened).toBeUndefined();
    const one = await api.send('GET', `tasks/offers/${id}`);
    expect(one.status).toBe(200);
    expect(one.body.offer).toMatchObject({ id, reason: 'You asked whether shipping is free.' });
    expect((await kept(target, id))?.reactions).toMatchObject({
      shown: expect.any(String),
      opened: expect.any(String),
    });
  });

  it('shows no key, no bookkeeping and no path of this machine', async () => {
    const { harness: target, api } = await started();
    await offered(target);
    const text = JSON.stringify((await api.send('GET', 'tasks/offers')).body);
    for (const hidden of ['dedupeKey', 'reactions', target.stateDir, 'task-catalog']) {
      expect(text, hidden).not.toContain(hidden);
    }
  });
});

describe('starting a task from an offer', () => {
  it('makes one goal for ten clicks at once, and the offer becomes accepted with that launch', async () => {
    const { harness: target, api } = await started();
    const id = await offered(target);
    const answers = await Promise.all(
      Array.from({ length: 10 }, () => api.send('POST', START, body(id))),
    );
    expect(answers.map((answer) => answer.status).sort()).toEqual([
      200, 200, 200, 200, 200, 200, 200, 200, 200, 201,
    ]);
    expect(new Set(answers.map((answer) => JSON.stringify(answer.body))).size).toBe(1);
    const { launch, goalId } = answers[0]!.body;
    expect(launch).toMatchObject({ origin: { kind: 'offer', offerId: id }, status: 'launched' });
    await settled(target);
    expect((await api.send('GET', 'goals')).body.goals).toHaveLength(1);
    expect((await api.send('GET', 'tasks/launches')).body.launches).toHaveLength(1);
    expect(goalId).toBe(launch.goalId);

    // The offer is accepted and names the launch; it is still listed, with no way to start it again.
    const stored = await kept(target, id);
    expect(stored).toMatchObject({ decision: 'accepted', launchId: launch.id });
    expect(stored?.reactions).toMatchObject({
      accepted: expect.any(String),
      started: expect.any(String),
    });
    const listed = (await api.send('GET', 'tasks/offers')).body.offers;
    expect(listed).toEqual([
      expect.objectContaining({ id, decision: 'accepted', launchId: launch.id }),
    ]);

    // The same request again, whatever the offer has become, is the launch it made.
    const again = await api.send('POST', START, body(id));
    expect(again.status).toBe(200);
    expect(again.body).toEqual(answers[0]!.body);
    // Another key for the offer that was started is refused in plain words.
    const other = await api.send('POST', START, body(id, { idempotencyKey: keyOf(2) }));
    expect(other).toEqual({ status: 409, body: { error: 'This offer was already started.' } });
    expect((await api.send('GET', 'goals')).body.goals).toHaveLength(1);
  });

  it('uses the values the person sent, not the suggestions, and keeps what was sent', async () => {
    const { harness: target, api } = await started();
    const id = await offered(target);
    const sent = { page: 'https://example.com/other', question: 'Is returning free?' };
    const answer = await api.send('POST', START, body(id, { inputs: sent }));
    expect(answer.status).toBe(201);
    expect(answer.body.launch.inputs).toEqual(sent);
    await settled(target);
    const { prefilled } = (await kept(target, id))!;
    expect(prefilled).toEqual({ page: PAGE, question: QUESTION });
  });

  it('records the run as unverified on the offer, apart from the acceptance, when nothing it read was checked', async () => {
    const { harness: target, api } = await started();
    const id = await offered(target);
    const answer = await api.send('POST', START, body(id));
    await settled(target);
    const shown = (await api.send('GET', `tasks/launches/${answer.body.launch.id}`)).body.launch;
    expect(shown.progress).toBe('unverified');
    let reactions = (await kept(target, id))?.reactions;
    for (let attempt = 0; attempt < 100 && reactions?.outcome === undefined; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      reactions = (await kept(target, id))?.reactions;
    }
    expect(reactions?.outcome).toMatchObject({ state: 'unverified' });
    expect(reactions?.accepted).toBeDefined();
    expect(reactions).not.toHaveProperty('verified');
  });

  it.each([
    [
      'dismissed',
      async (target: IHarness, api: Awaited<ReturnType<typeof client>>, id: string) => {
        await api.send('POST', `tasks/offers/${id}/decision`, { decision: 'dismissed' });
      },
      409,
      'You dismissed this offer. Bring it back to start it.',
    ],
    [
      'snoozed',
      async (target: IHarness, api: Awaited<ReturnType<typeof client>>, id: string) => {
        await api.send('POST', `tasks/offers/${id}/decision`, {
          decision: 'snoozed',
          snoozedUntil: iso(new Date(Date.now() + 86_400_000)),
        });
      },
      409,
      'You set this offer aside until later. Bring it back to start it.',
    ],
    [
      'resting on a library page that is gone',
      async (target: IHarness) => {
        await target.capabilities.wiki.forget({ pageId: 'returns-policy' });
      },
      409,
      'The library has no such page now.',
    ],
  ])(
    'refuses an offer that is %s, with the reason, and starts nothing',
    async (_name, change, status, error) => {
      const { harness: target, api } = await started();
      const id = await offered(target);
      await change(target, api, id);
      const refused = await api.send('POST', START, body(id));
      expect(refused).toEqual({ status, body: { error } });
      expect((await api.send('GET', 'goals')).body.goals).toEqual([]);
      expect((await api.send('GET', 'tasks/launches')).body.launches).toEqual([]);
      expect((await kept(target, id))?.decision).not.toBe('accepted');
      // The same refusal is made again for another key: nothing was kept that could be retried.
      expect((await api.send('POST', START, body(id, { idempotencyKey: keyOf(2) }))).status).toBe(
        status,
      );
    },
  );

  it('refuses an offer that does not exist, one that is not an offer id, and one for a task that cannot start', async () => {
    const { harness: target, api } = await started();
    const id = await offered(target);
    expect(await api.send('POST', START, body('offer-nope'))).toEqual({
      status: 404,
      body: { error: 'There is no such offer.' },
    });
    for (const bad of ['x', 3, '', 'offer-', 'OFFER-1', `offer-${'a'.repeat(60)}`]) {
      const answer = await api.send('POST', START, body(bad as string));
      expect(answer.status, String(bad)).toBe(400);
      expect(answer.body.error).toBe('offerId is not the id of an offer');
    }
    // A task that is not ready is refused as such before its offer is looked at.
    const mail = await api.send('POST', 'tasks/definitions/catch-up-on-mailbox/start', {
      idempotencyKey: keyOf(3),
      inputs: { period: 'Last day' },
      offerId: id,
    });
    expect(mail.status).toBe(422);
    expect((await api.send('GET', 'tasks/launches')).body.launches).toEqual([]);
  });

  it('refuses an offer for another task than the one started, and a key reused with another offer', async () => {
    const { harness: target, api } = await started();
    const id = await offered(target);
    await target.capabilities.wiki.remember({
      pageTitle: 'Returns policy 2',
      claim: 'Refunds take five days.',
      source: { origin: 'owner' },
    });
    const second = await offered(target, { item: 'returns-policy-2' });
    const first = await api.send('POST', START, body(id));
    expect(first.status).toBe(201);
    const reused = await api.send('POST', START, body(second));
    expect(reused.status).toBe(409);
    expect(reused.body.error).toBe(
      'This key was already used for a different request. Start the task again.',
    );
    await settled(target);
    expect((await api.send('GET', 'goals')).body.goals).toHaveLength(1);
  });

  it('keeps the acceptance and the outcome across a restart, and never starts a started offer again', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'task-offer-api-'));
    directories.push(stateDir);
    const one = await started({ stateDir });
    const id = await offered(one.harness);
    const first = await one.api.send('POST', START, body(id));
    await settled(one.harness);
    await one.harness.close();
    harness = undefined;

    const two = await started({ stateDir });
    const stored = await kept(two.harness, id);
    expect(stored).toMatchObject({ decision: 'accepted', launchId: first.body.launch.id });
    const again = await two.api.send('POST', START, body(id));
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect((await two.api.send('POST', START, body(id, { idempotencyKey: keyOf(2) }))).status).toBe(
      409,
    );
    expect((await two.api.send('GET', 'goals')).body.goals).toHaveLength(1);
  });
});

describe.skipIf(findChromiumExecutable() === undefined)(
  'a task started from an offer whose run read the page',
  () => {
    it('is recorded on the offer as verified, apart from its acceptance', async () => {
      const shop = await startStandInSite();
      sites.push(shop);
      const { harness: target, api } = await started({ allowed: shop });
      const address = `${shop.origin}/shipping`;
      const id = await offered(target, { page: address });
      target.model.script(
        { tool: 'BrowserOpen', args: { url: address } },
        { tool: 'BrowserView', args: {} },
        { text: `Yes. The page says: "${SHIPPING_TEXT}."` },
      );
      const answer = await api.send(
        'POST',
        START,
        body(id, { inputs: { page: address, question: QUESTION } }),
      );
      expect(answer.status).toBe(201);
      await target.capabilities.runner()!.settled(answer.body.goalId);
      let reactions = (await kept(target, id))?.reactions;
      for (let attempt = 0; attempt < 100 && reactions?.outcome === undefined; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        reactions = (await kept(target, id))?.reactions;
      }
      expect(reactions).toMatchObject({
        accepted: expect.any(String),
        started: expect.any(String),
        verified: expect.any(String),
        outcome: { state: 'verified' },
      });
    });
  },
);
