import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { RemoteUsageStorage } from '../remote-storage';
import type { IUsageStats } from '../../types';

function makeStat(): IUsageStats {
  return {
    conversationId: 'conv-1',
    timestamp: new Date('2026-06-01T00:00:00.000Z'),
    provider: 'openai',
    model: 'gpt',
    tokensUsed: { input: 10, output: 5, total: 15 },
    requestCount: 1,
    duration: 100,
    success: true,
  };
}

describe('RemoteUsageStorage (PLUGIN-001: HTTP REST contract)', () => {
  let storage: RemoteUsageStorage;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ stats: [] }) });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    if (storage) await storage.close();
    vi.unstubAllGlobals();
  });

  it('POSTs the batch to the endpoint on flush', async () => {
    // small batchSize so save triggers a flush
    storage = new RemoteUsageStorage('http://example.com/usage', 'key', 0, {}, 1);
    await storage.save(makeStat());
    expect(fetchMock).toHaveBeenCalledWith(
      'http://example.com/usage',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('re-queues the batch when the endpoint fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    storage = new RemoteUsageStorage('http://example.com/usage', '', 0, {}, 100);
    await storage.save(makeStat());
    await expect(storage.flush()).rejects.toThrow('Failed to send usage stats to remote endpoint');
    // re-queued → a subsequent ok flush sends it
    await expect(storage.flush()).resolves.toBeUndefined();
  });

  it('getStats parses the response and revives timestamps', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ stats: [makeStat()] }),
    });
    storage = new RemoteUsageStorage('http://example.com/usage', '', 0);
    const stats = await storage.getStats('conv-1');
    expect(stats).toHaveLength(1);
    expect(stats[0]!.timestamp).toBeInstanceOf(Date);
  });
});
