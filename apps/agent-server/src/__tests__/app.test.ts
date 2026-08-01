import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../app.js';

describe('Agent Server HTTP routes', () => {
  const app = createApp();

  // SEC-008: `/api/v1/remote/chat` spends the OPERATOR's provider credit and is now authenticated.
  // The validation cases below are about the BODY, so they carry a valid token — otherwise they
  // would be asserting the auth gate by accident and would stop testing what they are named for.
  const TEST_SECRET = 'app-test-secret';
  const bearer = () => `Bearer ${jwt.sign({ sub: 'test-user' }, TEST_SECRET)}`;
  let previousSecret: string | undefined;
  beforeAll(() => {
    previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = TEST_SECRET;
  });
  afterAll(() => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });

  describe('GET /health', () => {
    it('returns 200', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
    });

    it('returns ok status in body', async () => {
      const res = await request(app).get('/health');
      expect(res.body.status).toBe('ok');
    });
  });

  describe('GET /api/v1/remote/health', () => {
    it('returns 200', async () => {
      const res = await request(app).get('/api/v1/remote/health');
      expect(res.status).toBe(200);
    });

    it('returns ok status in body', async () => {
      const res = await request(app).get('/api/v1/remote/health');
      expect(res.body.status).toBe('ok');
    });
  });

  describe('GET /', () => {
    it('returns 200', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
    });

    it('returns server info', async () => {
      const res = await request(app).get('/');
      expect(res.body).toMatchObject({
        name: 'Robota SDK API Server',
        endpoints: expect.objectContaining({
          health: '/api/v1/remote/health',
          chat: '/api/v1/remote/chat',
        }),
      });
    });

    it('does not advertise unimplemented stream endpoint (SRV-003 regression)', async () => {
      const res = await request(app).get('/');
      expect(res.body?.endpoints?.stream).toBeUndefined();
      expect(res.body?.endpoints?.capabilities).toBeUndefined();
    });
  });

  describe('GET /api/v1/remote/ws/status', () => {
    it('returns 200', async () => {
      const res = await request(app).get('/api/v1/remote/ws/status');
      expect(res.status).toBe(200);
    });

    it('reports websocket not initialized when no WS server attached', async () => {
      const res = await request(app).get('/api/v1/remote/ws/status');
      expect(res.body.websocket.enabled).toBe(false);
    });
  });

  describe('POST /api/v1/remote/chat', () => {
    it('rejects request with no body fields with 400', async () => {
      const res = await request(app)
        .post('/api/v1/remote/chat')
        .set('authorization', bearer())
        .send({});
      expect(res.status).toBe(400);
    });

    it('rejects request without provider field with 400', async () => {
      const res = await request(app)
        .post('/api/v1/remote/chat')
        .set('authorization', bearer())
        .send({ messages: [{ role: 'user', content: 'hi' }] });
      expect([400, 401, 422]).toContain(res.status);
    });

    it('rejects request with unknown provider with 400', async () => {
      const res = await request(app)
        .post('/api/v1/remote/chat')
        .set('authorization', bearer())
        .send({ provider: 'unknown-provider', messages: [{ role: 'user', content: 'hi' }] });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/unknown provider/i);
    });

    it('rejects request with missing messages with 400', async () => {
      const res = await request(app)
        .post('/api/v1/remote/chat')
        .set('authorization', bearer())
        .send({ provider: 'openai' });
      expect(res.status).toBe(400);
    });

    it('rejects request with empty messages array with 400', async () => {
      const res = await request(app)
        .post('/api/v1/remote/chat')
        .set('authorization', bearer())
        .send({ provider: 'openai', messages: [] });
      expect(res.status).toBe(400);
    });
  });

  /**
   * SEC-008. This route reaches providers built from the OPERATOR's `OPENAI_API_KEY` /
   * `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` and had no authentication at all — the only control was
   * a global IP rate limiter, which bounds the RATE of anonymous spending rather than preventing it.
   *
   * Every assertion here fails against the unauthenticated route: it answered 400 on a bad body and
   * would have answered 200 on a good one, whoever asked.
   */
  describe('SEC-008 regression: /api/v1/remote/chat spends operator credit and must be authenticated', () => {
    const body = { provider: 'unknown-provider', messages: [{ role: 'user', content: 'hi' }] };

    it('refuses an anonymous request before it reads the body', async () => {
      const res = await request(app).post('/api/v1/remote/chat').send(body);
      expect(res.status).toBe(401);
      // Not 400: the gate runs BEFORE validation, so an anonymous caller cannot probe the body
      // contract either.
      expect(res.body.error).toMatch(/bearer token/i);
    });

    it('refuses a token signed with a different secret', async () => {
      const res = await request(app)
        .post('/api/v1/remote/chat')
        .set('authorization', `Bearer ${jwt.sign({ sub: 'x' }, 'not-the-secret')}`)
        .send(body);
      expect(res.status).toBe(401);
    });

    it('refuses a non-bearer authorization header', async () => {
      const res = await request(app)
        .post('/api/v1/remote/chat')
        .set('authorization', 'Basic dXNlcjpwYXNz')
        .send(body);
      expect(res.status).toBe(401);
    });

    it('refuses everything when the server has no secret to verify against', async () => {
      const saved = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;
      try {
        const res = await request(app)
          .post('/api/v1/remote/chat')
          .set('authorization', bearer())
          .send(body);
        expect(res.status).toBe(503);
        expect(res.body.error).toMatch(/JWT_SECRET/);
      } finally {
        process.env.JWT_SECRET = saved;
      }
    });

    it('lets an authenticated request through to the route it was asking for', async () => {
      const res = await request(app)
        .post('/api/v1/remote/chat')
        .set('authorization', bearer())
        .send(body);
      // 400 "unknown provider" — the gate passed and the route answered.
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/unknown provider/i);
    });

    it('leaves BYOK open — the caller brings their own key, so there is no operator credit to protect', async () => {
      const res = await request(app).post('/api/v1/byok/chat').send({});
      expect(res.status).not.toBe(401);
    });
  });

  describe('404 for unknown routes', () => {
    it('returns 404 for unknown route', async () => {
      const res = await request(app).get('/no-such-route');
      expect(res.status).toBe(404);
    });
  });

  describe('Content-Security-Policy', () => {
    it('sends an API-appropriate restrictive policy on JSON responses', async () => {
      const res = await request(app).get('/health');
      const csp = res.headers['content-security-policy'];
      expect(csp).toBeDefined();
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
    });
  });

  describe('CORS headers', () => {
    it('includes Access-Control-Allow-Origin for allowed origin', async () => {
      const res = await request(app).get('/health').set('Origin', 'http://localhost:3000');
      // CORS header should be present for allowed origins
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    });
  });
});
