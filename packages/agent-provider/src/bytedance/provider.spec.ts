import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BytedanceProvider } from './provider';

describe('BytedanceProvider', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('maps createVideo response to accepted job shape', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: 'task-1', status: 'queued' }),
    });

    const provider = new BytedanceProvider({
      apiKey: 'test-key',
      baseUrl: 'https://api.byteplus.test',
    });
    const result = await provider.createVideo({
      prompt: 'test prompt',
      model: 'seedance-2.0',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected successful result');
    }
    expect(result.value.jobId).toBe('task-1');
    expect(result.value.status).toBe('queued');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.byteplus.test/contents/generations/tasks',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('maps createVideo response without status as queued', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: 'task-no-status' }),
    });
    const provider = new BytedanceProvider({
      apiKey: 'test-key',
      baseUrl: 'https://api.byteplus.test',
    });
    const result = await provider.createVideo({
      prompt: 'test prompt',
      model: 'seedance-1-5-pro-251215',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected successful result');
    }
    expect(result.value.status).toBe('queued');
    expect(result.value.jobId).toBe('task-no-status');
  });

  it('maps getVideoJob success with output uri', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          id: 'task-2',
          status: 'completed',
          video_url: 'https://cdn.test/video.mp4',
          mime_type: 'video/mp4',
          bytes: 1024,
        }),
    });

    const provider = new BytedanceProvider({
      apiKey: 'test-key',
      baseUrl: 'https://api.byteplus.test',
    });
    const result = await provider.getVideoJob('job-2');

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected successful result');
    }
    expect(result.value.status).toBe('succeeded');
    expect(result.value.output?.uri).toBe('https://cdn.test/video.mp4');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.byteplus.test/contents/generations/tasks/job-2',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('maps 404 response to PROVIDER_JOB_NOT_FOUND', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ message: 'not found' }),
    });

    const provider = new BytedanceProvider({
      apiKey: 'test-key',
      baseUrl: 'https://api.byteplus.test',
    });
    const result = await provider.getVideoJob('missing-job');

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected failed result');
    }
    expect(result.error.code).toBe('PROVIDER_JOB_NOT_FOUND');
  });

  it('rejects createVideo with empty prompt', async () => {
    const provider = new BytedanceProvider({
      apiKey: 'test-key',
      baseUrl: 'https://api.byteplus.test',
    });
    const result = await provider.createVideo({ prompt: '', model: 'seedance-2.0' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROVIDER_INVALID_REQUEST');
    }
  });

  it('rejects createVideo with empty model', async () => {
    const provider = new BytedanceProvider({
      apiKey: 'test-key',
      baseUrl: 'https://api.byteplus.test',
    });
    const result = await provider.createVideo({ prompt: 'test', model: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROVIDER_INVALID_REQUEST');
    }
  });

  it('rejects createVideo when seed is provided', async () => {
    const provider = new BytedanceProvider({
      apiKey: 'test-key',
      baseUrl: 'https://api.byteplus.test',
    });
    const result = await provider.createVideo({ prompt: 'test', model: 'seedance-2.0', seed: 42 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROVIDER_INVALID_REQUEST');
    }
  });

  it('rejects createVideo with empty task id in response', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: '', status: 'queued' }),
    });
    const provider = new BytedanceProvider({
      apiKey: 'test-key',
      baseUrl: 'https://api.byteplus.test',
    });
    const result = await provider.createVideo({ prompt: 'test', model: 'seedance-2.0' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROVIDER_UPSTREAM_ERROR');
    }
  });

  it('includes image URI content in createVideo payload', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: 'task-img', status: 'queued' }),
    });
    const provider = new BytedanceProvider({
      apiKey: 'test-key',
      baseUrl: 'https://api.byteplus.test',
    });
    const result = await provider.createVideo({
      prompt: 'animate this',
      model: 'seedance-2.0',
      inputImages: [{ kind: 'uri', uri: 'https://example.com/img.png' }],
    });
    expect(result.ok).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.content).toHaveLength(2);
    expect(body.content[1].type).toBe('image_url');
    expect(body.content[1].image_url.url).toBe('https://example.com/img.png');
  });

  it('includes inline base64 image content in createVideo payload', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: 'task-b64', status: 'queued' }),
    });
    const provider = new BytedanceProvider({
      apiKey: 'test-key',
      baseUrl: 'https://api.byteplus.test',
    });
    const result = await provider.createVideo({
      prompt: 'animate this',
      model: 'seedance-2.0',
      inputImages: [{ kind: 'inline', data: 'aGVsbG8=', mimeType: 'image/png' }],
    });
    expect(result.ok).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.content[1].image_url.url).toBe('data:image/png;base64,aGVsbG8=');
  });

  it('rejects createVideo with empty image URI', async () => {
    const provider = new BytedanceProvider({
      apiKey: 'test-key',
      baseUrl: 'https://api.byteplus.test',
    });
    const result = await provider.createVideo({
      prompt: 'test',
      model: 'seedance-2.0',
      inputImages: [{ kind: 'uri', uri: '' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROVIDER_INVALID_REQUEST');
    }
  });

  it('rejects createVideo with empty inline image data', async () => {
    const provider = new BytedanceProvider({
      apiKey: 'test-key',
      baseUrl: 'https://api.byteplus.test',
    });
    const result = await provider.createVideo({
      prompt: 'test',
      model: 'seedance-2.0',
      inputImages: [{ kind: 'inline', data: '', mimeType: 'image/png' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROVIDER_INVALID_REQUEST');
    }
  });

  it('rejects createVideo with empty inline image mimeType', async () => {
    const provider = new BytedanceProvider({
      apiKey: 'test-key',
      baseUrl: 'https://api.byteplus.test',
    });
    const result = await provider.createVideo({
      prompt: 'test',
      model: 'seedance-2.0',
      inputImages: [{ kind: 'inline', data: 'aGVsbG8=', mimeType: '' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROVIDER_INVALID_REQUEST');
    }
  });

  it('rejects getVideoJob with empty jobId', async () => {
    const provider = new BytedanceProvider({
      apiKey: 'test-key',
      baseUrl: 'https://api.byteplus.test',
    });
    const result = await provider.getVideoJob('');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROVIDER_INVALID_REQUEST');
    }
  });

  it('rejects cancelVideoJob with empty jobId', async () => {
    const provider = new BytedanceProvider({
      apiKey: 'test-key',
      baseUrl: 'https://api.byteplus.test',
    });
    const result = await provider.cancelVideoJob('');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROVIDER_INVALID_REQUEST');
    }
  });

  it('uses POST method for cancelVideoJob when configured', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: 'task-cancel', status: 'cancelled' }),
    });
    const provider = new BytedanceProvider({
      apiKey: 'test-key',
      baseUrl: 'https://api.byteplus.test',
      cancelVideoTaskMethod: 'POST',
    });
    await provider.cancelVideoJob('task-cancel');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('uses DELETE by default for cancelVideoJob', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          id: 'task-3',
          status: 'cancelled',
        }),
    });
    const provider = new BytedanceProvider({
      apiKey: 'test-key',
      baseUrl: 'https://api.byteplus.test',
    });
    const result = await provider.cancelVideoJob('task-3');

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.byteplus.test/contents/generations/tasks/task-3',
      expect.objectContaining({
        method: 'DELETE',
      }),
    );
  });
});
