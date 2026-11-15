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
