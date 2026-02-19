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
            text: async () => JSON.stringify({ jobId: 'job-1', status: 'queued' })
        });

        const provider = new BytedanceProvider({
            apiKey: 'test-key',
            baseUrl: 'https://api.byteplus.test'
        });
        const result = await provider.createVideo({
            prompt: 'test prompt',
            model: 'seedance-2.0'
        });

        expect(result.ok).toBe(true);
        if (!result.ok) {
            throw new Error('Expected successful result');
        }
        expect(result.value.jobId).toBe('job-1');
        expect(result.value.status).toBe('queued');
    });

    it('maps getVideoJob success with output uri', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            text: async () => JSON.stringify({
                jobId: 'job-2',
                status: 'succeeded',
                outputUrl: 'https://cdn.test/video.mp4',
                mimeType: 'video/mp4',
                bytes: 1024
            })
        });

        const provider = new BytedanceProvider({
            apiKey: 'test-key',
            baseUrl: 'https://api.byteplus.test'
        });
        const result = await provider.getVideoJob('job-2');

        expect(result.ok).toBe(true);
        if (!result.ok) {
            throw new Error('Expected successful result');
        }
        expect(result.value.status).toBe('succeeded');
        expect(result.value.output?.uri).toBe('https://cdn.test/video.mp4');
    });

    it('maps 404 response to PROVIDER_JOB_NOT_FOUND', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 404,
            text: async () => JSON.stringify({ message: 'not found' })
        });

        const provider = new BytedanceProvider({
            apiKey: 'test-key',
            baseUrl: 'https://api.byteplus.test'
        });
        const result = await provider.getVideoJob('missing-job');

        expect(result.ok).toBe(false);
        if (result.ok) {
            throw new Error('Expected failed result');
        }
        expect(result.error.code).toBe('PROVIDER_JOB_NOT_FOUND');
    });
});
