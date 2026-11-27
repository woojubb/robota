import { afterEach, describe, expect, it } from 'vitest';

import { cleanTempDirs, KEY } from './harness.js';
import { JSON_HEADERS, rawRequest, startHost, stopHosts } from './admin-harness.js';

afterEach(async () => {
  await stopHosts();
  await cleanTempDirs();
});

const GOOD = {
  id: 'vera',
  backend: 'container',
  provider: { type: 'anthropic', model: 'm' },
  keySource: 'account',
  apiKey: KEY,
};

interface IError {
  error: { code: string; message: string };
}

describe('the admin protocol', () => {
  it('answers a typed error with a status for every malformed request', async () => {
    const host = await startHost();
    const post = (path: string, body: unknown, headers = JSON_HEADERS) =>
      rawRequest(
        host.env,
        'POST',
        path,
        typeof body === 'string' ? body : JSON.stringify(body),
        headers,
      );

    const cases: Array<[string, Awaited<ReturnType<typeof post>>, number]> = [
      ['unknown field', await post('/v1/accounts', { ...GOOD, extra: 1 }), 400],
      [
        'unknown provider field',
        await post('/v1/accounts', { ...GOOD, provider: { type: 'a', x: 1 } }),
        400,
      ],
      ['unknown limit field', await post('/v1/accounts', { ...GOOD, limits: { disk: 1 } }), 400],
      ['missing field', await post('/v1/accounts', { id: 'vera' }), 400],
      ['wrong type', await post('/v1/accounts', { ...GOOD, id: 7 }), 400],
      ['array body', await post('/v1/accounts', '[]'), 400],
      ['not JSON', await post('/v1/accounts', 'nope'), 400],
      ['no body', await post('/v1/accounts', ''), 400],
      [
        'wrong content type',
        await post('/v1/accounts', JSON.stringify(GOOD), { 'content-type': 'text/plain' }),
        415,
      ],
      [
        'oversize',
        await post(
          '/v1/accounts',
          JSON.stringify({ ...GOOD, apiKey: 'k'.repeat(70_000) }),
          JSON_HEADERS,
        ),
        413,
      ],
      [
        'parameters on a plain action',
        await post('/v1/accounts/vera/suspend', { force: true }),
        400,
      ],
      ['delete without confirmation', await post('/v1/accounts/vera/delete', {}), 400],
      ['unknown route', await rawRequest(host.env, 'GET', '/v1/nothing'), 404],
      ['unknown action', await post('/v1/accounts/vera/explode', {}), 404],
      ['wrong method', await rawRequest(host.env, 'DELETE', '/v1/accounts/vera'), 405],
      ['wrong method on status', await post('/v1/status', {}), 405],
      ['query string', await rawRequest(host.env, 'GET', '/v1/accounts?all=1'), 400],
      [
        'body on a GET',
        await rawRequest(host.env, 'GET', '/v1/accounts', '{}', {
          ...JSON_HEADERS,
          'content-length': '2',
        }),
        400,
      ],
      ['malformed id in the path', await rawRequest(host.env, 'GET', '/v1/accounts/Bad_Id'), 400],
    ];
    for (const [name, response, status] of cases) {
      expect(response.status, name).toBe(status);
      expect(response.body, name).not.toBe('');
      const body = JSON.parse(response.body) as IError;
      expect(typeof body.error.message, name).toBe('string');
      expect(response.body, name).not.toContain(KEY);
    }
    expect(host.runtime.unitCount()).toBe(0);
    expect(await host.audit()).toContain('"command":"request","account":null,"result":"refused"');
    expect(await host.audit()).not.toContain(KEY);
  });

  it('accepts an empty body or an empty object for actions without parameters', async () => {
    const host = await startHost();
    await host.cli(['add', 'vera', '--provider', 'anthropic'], KEY);
    expect((await rawRequest(host.env, 'POST', '/v1/accounts/vera/suspend')).status).toBe(200);
    expect(
      (await rawRequest(host.env, 'POST', '/v1/accounts/vera/resume', '{}', JSON_HEADERS)).status,
    ).toBe(200);
  });

  it('carries the control plane error code through', async () => {
    const host = await startHost();
    const missing = await rawRequest(host.env, 'GET', '/v1/accounts/nobody');
    expect(missing.status).toBe(404);
    expect((JSON.parse(missing.body) as IError).error.code).toBe('not-found');
    const created = await rawRequest(
      host.env,
      'POST',
      '/v1/accounts',
      JSON.stringify(GOOD),
      JSON_HEADERS,
    );
    expect(created.status).toBe(200);
    const again = await rawRequest(
      host.env,
      'POST',
      '/v1/accounts',
      JSON.stringify(GOOD),
      JSON_HEADERS,
    );
    expect(again.status).toBe(409);
    expect((JSON.parse(again.body) as IError).error.code).toBe('conflict');
  });
});
