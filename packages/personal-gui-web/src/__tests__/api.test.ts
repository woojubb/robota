import { describe, expect, it } from 'vitest';

import { API_WRITE_HEADER, ApiError, createPersonalApi } from '../api.js';
import { originLabel } from '../views/Library.js';

import type { IClaimView } from '../api.js';

function recorder(answer: { status: number; body: unknown }) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const api = createPersonalApi(async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { api, calls };
}

describe('personal API client', () => {
  it('calls the API relative to the page, so requests ride the session path and its cookie', async () => {
    const { api, calls } = recorder({ status: 200, body: { pages: [] } });
    await api.listPages();
    expect(calls[0]!.url).toBe('api/wiki/pages');
    expect(calls[0]!.init?.credentials).toBe('same-origin');
    expect(calls[0]!.init?.headers).toEqual({});
  });

  it('marks every write with the header the server requires and sends JSON', async () => {
    const { api, calls } = recorder({ status: 200, body: { removed: 1 } });
    await api.forgetClaim('c1');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(calls[0]!.init?.headers).toEqual({
      'content-type': 'application/json',
      [API_WRITE_HEADER]: '1',
    });
    expect(calls[0]!.init?.body).toBe(JSON.stringify({ claimId: 'c1' }));
  });

  it('encodes page ids and queries', async () => {
    const { api, calls } = recorder({ status: 200, body: { page: {}, results: [] } });
    await api.getPage('page/../x');
    await api.search('tea & cake');
    expect(calls.map((call) => call.url)).toEqual([
      'api/wiki/pages/page%2F..%2Fx',
      'api/search?q=tea%20%26%20cake',
    ]);
  });

  it('saves and resets case-request settings as explicit owner writes', async () => {
    const { api, calls } = recorder({ status: 200, body: { connector: {} } });
    await api.setConnectorCaseAction('service/a', 'send/message', true, 'revision-1');
    await api.setConnectorCaseAction('service/a', 'send/message', false, 'revision-2');
    await api.resetConnectorCaseActions('service/a', 'revision-3');
    await api.fenceConnectorCaseActions('service/a', 'revision-3');
    await api.fenceCaseActionRequests();
    expect(calls.map((call) => [call.init?.method, call.url, call.init?.body])).toEqual([
      [
        'POST',
        'api/connectors/service%2Fa/case-actions',
        JSON.stringify({ tool: 'send/message', allowed: true, revision: 'revision-1' }),
      ],
      [
        'POST',
        'api/connectors/service%2Fa/case-actions',
        JSON.stringify({ tool: 'send/message', allowed: false, revision: 'revision-2' }),
      ],
      [
        'POST',
        'api/connectors/service%2Fa/case-actions',
        JSON.stringify({ reset: true, revision: 'revision-3' }),
      ],
      ['POST', 'api/connectors/service%2Fa/case-actions', JSON.stringify({ fence: 'revision-3' })],
      ['POST', 'api/connectors/case-actions/fence', JSON.stringify({})],
    ]);
    for (const call of calls)
      expect(call.init?.headers).toEqual({
        'content-type': 'application/json',
        [API_WRITE_HEADER]: '1',
      });
  });

  it('answers a question by its feed item, with the choice or the reply as the body', async () => {
    const { api, calls } = recorder({ status: 200, body: { item: {}, case: {} } });
    await api.answerQuestion('feed-a/b', { choice: 'No' });
    await api.answerQuestion('feed-c', { reply: 'On a train' });
    expect(calls.map((call) => call.url)).toEqual([
      'api/feed/feed-a%2Fb/answer',
      'api/feed/feed-c/answer',
    ]);
    expect(calls.map((call) => [call.init?.method, call.init?.body])).toEqual([
      ['POST', JSON.stringify({ choice: 'No' })],
      ['POST', JSON.stringify({ reply: 'On a train' })],
    ]);
    expect(calls[0]!.init?.headers).toEqual({
      'content-type': 'application/json',
      [API_WRITE_HEADER]: '1',
    });
  });

  it('lists the cases and reads one thread', async () => {
    const listing = recorder({ status: 200, body: { cases: [{ id: 'case-1' }] } });
    expect(await listing.api.cases()).toEqual([{ id: 'case-1' }]);
    expect(listing.calls[0]!.url).toBe('api/cases');
    const one = recorder({ status: 200, body: { case: { id: 'case-1/x' } } });
    expect(await one.api.caseThread('case-1/x')).toEqual({ id: 'case-1/x' });
    expect(one.calls[0]!.url).toBe('api/cases/case-1%2Fx');
    expect(one.calls[0]!.init?.headers).toEqual({});
  });

  it('reads the delivery limits, and saves them with a PUT that carries the write header', async () => {
    const status = {
      settings: {
        dailyLimit: 3,
        quietHours: { enabled: true, from: '22:00', to: '08:00' },
        digest: { enabled: true, at: '08:00' },
      },
      today: { sent: 0, limit: 3 },
      waitingInDigest: 0,
    };
    const { api, calls } = recorder({ status: 200, body: status });
    expect(await api.delivery()).toEqual(status);
    expect(await api.saveDelivery(status.settings)).toEqual(status);
    expect(calls.map((call) => [call.url, call.init?.method])).toEqual([
      ['api/delivery', 'GET'],
      ['api/delivery', 'PUT'],
    ]);
    expect(calls[0]!.init?.headers).toEqual({});
    expect(calls[1]!.init?.headers).toEqual({
      'content-type': 'application/json',
      [API_WRITE_HEADER]: '1',
    });
    expect(calls[1]!.init?.body).toBe(JSON.stringify(status.settings));
  });

  it('reaches the notification address and the page’s own messages through writes and reads as the agent expects', async () => {
    const { api, calls } = recorder({ status: 200, body: { configured: false, format: 'plain' } });
    await api.webhook();
    await api.saveWebhook({ url: 'https://push.example.test/x', format: 'json' });
    await api.removeWebhook();
    await api.testWebhook();
    await api.notifications();
    await api.notifications(12);
    expect(calls.map((call) => [call.init?.method, call.url])).toEqual([
      ['GET', 'api/delivery/webhook'],
      ['PUT', 'api/delivery/webhook'],
      ['DELETE', 'api/delivery/webhook'],
      ['POST', 'api/delivery/webhook/test'],
      ['GET', 'api/notifications'],
      ['GET', 'api/notifications?after=12'],
    ]);
    expect(calls[1]!.init?.body).toBe(
      JSON.stringify({ url: 'https://push.example.test/x', format: 'json' }),
    );
    for (const index of [1, 2, 3])
      expect(calls[index]!.init?.headers).toEqual({
        'content-type': 'application/json',
        [API_WRITE_HEADER]: '1',
      });
    for (const index of [0, 4, 5]) expect(calls[index]!.init?.headers).toEqual({});
  });

  it('reaches the push routes: a read for the count and the key, a write to subscribe and to stop', async () => {
    const { api, calls } = recorder({ status: 200, body: { subscribed: 1, supported: true } });
    const subscription = {
      endpoint: 'https://push.example.test/x',
      keys: { p256dh: 'p', auth: 'a' },
    };
    await api.pushStatus();
    await api.pushKey();
    await api.subscribePush(subscription);
    await api.unsubscribePush(subscription.endpoint);
    await api.pushStatus(subscription.endpoint);
    await api.clearPushSubscriptions();
    expect(calls.map((call) => [call.init?.method, call.url])).toEqual([
      ['GET', 'api/push'],
      ['GET', 'api/push/key'],
      ['POST', 'api/push/subscribe'],
      ['DELETE', 'api/push/subscribe'],
      ['POST', 'api/push/status'],
      ['DELETE', 'api/push/subscriptions'],
    ]);
    expect(calls[2]!.init?.body).toBe(JSON.stringify(subscription));
    expect(calls[3]!.init?.body).toBe(JSON.stringify({ endpoint: subscription.endpoint }));
    expect(calls[4]!.init?.body).toBe(JSON.stringify({ endpoint: subscription.endpoint }));
    for (const index of [2, 3, 4, 5])
      expect(calls[index]!.init?.headers).toEqual({
        'content-type': 'application/json',
        [API_WRITE_HEADER]: '1',
      });
    for (const index of [0, 1]) expect(calls[index]!.init?.headers).toEqual({});
  });

  it('sends older browser addresses with their replacement', async () => {
    const { api, calls } = recorder({ status: 200, body: { subscribed: 1, supported: true } });
    const subscription = {
      endpoint: 'https://push.example.test/new',
      keys: { p256dh: 'p', auth: 'a' },
    };
    const replacing = ['https://push.example.test/old'];
    await api.subscribePush(subscription, replacing);
    expect(calls[0]!.init?.body).toBe(JSON.stringify({ ...subscription, replacing }));
  });

  it('turns an error answer into an ApiError carrying the server message', async () => {
    const { api } = recorder({ status: 422, body: { error: 'This looks like a secret' } });
    await expect(api.createPage({ title: 'Bank', kind: 'matter', text: 'x' })).rejects.toEqual(
      new ApiError(422, 'This looks like a secret'),
    );
  });
});

describe('claim origin', () => {
  const claim = (origin: IClaimView['source']['origin'], reference?: string): IClaimView => ({
    id: 'c1',
    text: 't',
    source: {
      origin,
      at: '2026-01-01T00:00:00.000Z',
      ...(reference !== undefined && { reference }),
    },
    validFrom: '2026-01-01T00:00:00.000Z',
  });

  it('says plainly whether the person said it or the agent read it somewhere', () => {
    expect(originLabel(claim('owner'))).toBe('You said');
    expect(originLabel(claim('agent'))).toBe('Your agent concluded');
    expect(originLabel(claim('web', 'https://shop.example/'))).toBe(
      'Read from web · https://shop.example/',
    );
  });
});

describe('goal schedule wording', () => {
  it('names a repeat interval in its largest whole unit', async () => {
    const { interval } = await import('../views/ui.js');
    expect(interval(10_080)).toBe('Every week');
    expect(interval(2_880)).toBe('Every 2 days');
    expect(interval(60)).toBe('Every hour');
    expect(interval(90)).toBe('Every 90 minutes');
    expect(interval(1)).toBe('Every minute');
  });
});
