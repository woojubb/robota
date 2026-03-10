import { describe, expect, it } from 'vitest';
import { mapVideoStatus, mapInitialStatus, mapVideoJobSnapshot, toIsoTimestamp } from './status-mapper';
import type { IBytedanceVideoTaskResponse } from './types';

describe('mapVideoStatus', () => {
    it.each([
        ['queued', 'queued'],
        ['pending', 'queued'],
        ['submitted', 'queued'],
        ['running', 'running'],
        ['processing', 'running'],
        ['in_progress', 'running'],
        ['succeeded', 'succeeded'],
        ['success', 'succeeded'],
        ['completed', 'succeeded'],
        ['failed', 'failed'],
        ['error', 'failed'],
        ['cancelled', 'cancelled'],
        ['canceled', 'cancelled']
    ])('maps "%s" to "%s"', (input, expected) => {
        const result = mapVideoStatus(input);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value).toBe(expected);
        }
    });

    it('trims whitespace and normalizes case', () => {
        const result = mapVideoStatus('  QUEUED  ');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value).toBe('queued');
        }
    });

    it('returns PROVIDER_UPSTREAM_ERROR for unknown status', () => {
        const result = mapVideoStatus('unknown_state');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('PROVIDER_UPSTREAM_ERROR');
            expect(result.error.message).toContain('unknown_state');
        }
    });
});

describe('mapInitialStatus', () => {
    it('returns queued when status is undefined', () => {
        const result = mapInitialStatus(undefined);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value).toBe('queued');
        }
    });

    it('returns queued when status is empty string', () => {
        const result = mapInitialStatus('');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value).toBe('queued');
        }
    });

    it('returns queued when status is whitespace-only', () => {
        const result = mapInitialStatus('   ');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value).toBe('queued');
        }
    });

    it.each([
        ['queued', 'queued'],
        ['pending', 'queued'],
        ['submitted', 'queued'],
        ['running', 'running'],
        ['processing', 'running'],
        ['in_progress', 'running']
    ])('maps "%s" to "%s"', (input, expected) => {
        const result = mapInitialStatus(input);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value).toBe(expected);
        }
    });

    it('returns error for status that is not queued or running', () => {
        const result = mapInitialStatus('completed');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('PROVIDER_UPSTREAM_ERROR');
        }
    });
});

describe('toIsoTimestamp', () => {
    it('converts epoch seconds to ISO string', () => {
        const epochSeconds = 1700000000;
        const result = toIsoTimestamp(epochSeconds);
        expect(result).toBe(new Date(epochSeconds * 1000).toISOString());
    });

    it('converts epoch milliseconds to ISO string', () => {
        const epochMs = 1700000000000;
        const result = toIsoTimestamp(epochMs);
        expect(result).toBe(new Date(epochMs).toISOString());
    });

    it('converts numeric string to ISO string', () => {
        const result = toIsoTimestamp('1700000000');
        expect(result).toBe(new Date(1700000000 * 1000).toISOString());
    });

    it('converts ISO string to ISO string', () => {
        const isoString = '2024-01-15T12:00:00.000Z';
        const result = toIsoTimestamp(isoString);
        expect(result).toBe(new Date(isoString).toISOString());
    });

    it('returns current time for undefined', () => {
        const before = Date.now();
        const result = toIsoTimestamp(undefined);
        const after = Date.now();
        const resultMs = new Date(result).getTime();
        expect(resultMs).toBeGreaterThanOrEqual(before);
        expect(resultMs).toBeLessThanOrEqual(after);
    });

    it('returns current time for non-parsable string', () => {
        const before = Date.now();
        const result = toIsoTimestamp('not-a-date');
        const after = Date.now();
        const resultMs = new Date(result).getTime();
        expect(resultMs).toBeGreaterThanOrEqual(before);
        expect(resultMs).toBeLessThanOrEqual(after);
    });

    it('returns current time for NaN number', () => {
        const before = Date.now();
        const result = toIsoTimestamp(NaN);
        const after = Date.now();
        const resultMs = new Date(result).getTime();
        expect(resultMs).toBeGreaterThanOrEqual(before);
        expect(resultMs).toBeLessThanOrEqual(after);
    });
});

describe('mapVideoJobSnapshot', () => {
    it('maps a succeeded response with video output', () => {
        const response: IBytedanceVideoTaskResponse = {
            id: 'task-1',
            status: 'completed',
            video_url: 'https://cdn.test/video.mp4',
            mime_type: 'video/mp4',
            bytes: 2048,
            created_at: 1700000000
        };
        const result = mapVideoJobSnapshot(response);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.jobId).toBe('task-1');
            expect(result.value.status).toBe('succeeded');
            expect(result.value.output).toEqual({
                kind: 'uri',
                uri: 'https://cdn.test/video.mp4',
                mimeType: 'video/mp4',
                bytes: 2048
            });
            expect(result.value.error).toBeUndefined();
        }
    });

    it('maps a failed response with error message', () => {
        const response: IBytedanceVideoTaskResponse = {
            id: 'task-2',
            status: 'failed',
            error_message: 'Content policy violation',
            created_at: 1700000000
        };
        const result = mapVideoJobSnapshot(response);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.status).toBe('failed');
            expect(result.value.error?.code).toBe('PROVIDER_UPSTREAM_ERROR');
            expect(result.value.error?.message).toBe('Content policy violation');
            expect(result.value.output).toBeUndefined();
        }
    });

    it('returns error when task id is empty', () => {
        const response: IBytedanceVideoTaskResponse = {
            id: '',
            status: 'completed',
            created_at: 1700000000
        };
        const result = mapVideoJobSnapshot(response);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('PROVIDER_UPSTREAM_ERROR');
            expect(result.error.message).toContain('missing task id');
        }
    });

    it('returns error when task id is whitespace-only', () => {
        const response: IBytedanceVideoTaskResponse = {
            id: '   ',
            status: 'completed',
            created_at: 1700000000
        };
        const result = mapVideoJobSnapshot(response);
        expect(result.ok).toBe(false);
    });

    it('returns error for unknown status', () => {
        const response: IBytedanceVideoTaskResponse = {
            id: 'task-3',
            status: 'bizarre_state',
            created_at: 1700000000
        };
        const result = mapVideoJobSnapshot(response);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('PROVIDER_UPSTREAM_ERROR');
        }
    });

    it('prefers updated_at over created_at for timestamp', () => {
        const response: IBytedanceVideoTaskResponse = {
            id: 'task-4',
            status: 'queued',
            created_at: 1700000000,
            updated_at: 1700001000
        };
        const result = mapVideoJobSnapshot(response);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.updatedAt).toBe(new Date(1700001000 * 1000).toISOString());
        }
    });

    it('falls back to created_at when updated_at is absent', () => {
        const response: IBytedanceVideoTaskResponse = {
            id: 'task-5',
            status: 'queued',
            created_at: 1700000000
        };
        const result = mapVideoJobSnapshot(response);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.updatedAt).toBe(new Date(1700000000 * 1000).toISOString());
        }
    });

    it('resolves video url from content.video_url when direct url is absent', () => {
        const response: IBytedanceVideoTaskResponse = {
            id: 'task-6',
            status: 'succeeded',
            content: { video_url: 'https://cdn.test/content-video.mp4' },
            created_at: 1700000000
        };
        const result = mapVideoJobSnapshot(response);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.output?.uri).toBe('https://cdn.test/content-video.mp4');
        }
    });

    it('prefers direct video_url over content.video_url', () => {
        const response: IBytedanceVideoTaskResponse = {
            id: 'task-7',
            status: 'succeeded',
            video_url: 'https://cdn.test/direct.mp4',
            content: { video_url: 'https://cdn.test/content.mp4' },
            created_at: 1700000000
        };
        const result = mapVideoJobSnapshot(response);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.output?.uri).toBe('https://cdn.test/direct.mp4');
        }
    });

    it('returns undefined output when no video url is present', () => {
        const response: IBytedanceVideoTaskResponse = {
            id: 'task-8',
            status: 'queued',
            created_at: 1700000000
        };
        const result = mapVideoJobSnapshot(response);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.output).toBeUndefined();
        }
    });
});
