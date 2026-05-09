import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';

describe('Agent Server HTTP routes', () => {
  const app = createApp();

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
      const res = await request(app).post('/api/v1/remote/chat').send({});
      expect(res.status).toBe(400);
    });

    it('rejects request without provider field with 400', async () => {
      const res = await request(app)
        .post('/api/v1/remote/chat')
        .send({ messages: [{ role: 'user', content: 'hi' }] });
      expect([400, 401, 422]).toContain(res.status);
    });

    it('rejects request with unknown provider with 400', async () => {
      const res = await request(app)
        .post('/api/v1/remote/chat')
        .send({ provider: 'unknown-provider', messages: [{ role: 'user', content: 'hi' }] });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/unknown provider/i);
    });

    it('rejects request with missing messages with 400', async () => {
      const res = await request(app).post('/api/v1/remote/chat').send({ provider: 'openai' });
      expect(res.status).toBe(400);
    });

    it('rejects request with empty messages array with 400', async () => {
      const res = await request(app)
        .post('/api/v1/remote/chat')
        .send({ provider: 'openai', messages: [] });
      expect(res.status).toBe(400);
    });
  });

  describe('404 for unknown routes', () => {
    it('returns 404 for unknown route', async () => {
      const res = await request(app).get('/no-such-route');
      expect(res.status).toBe(404);
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
