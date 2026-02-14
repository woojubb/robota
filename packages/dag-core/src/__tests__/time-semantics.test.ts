import { describe, expect, it } from 'vitest';
import { FakeClockPort } from '../testing/fake-clock-port.js';
import { TimeSemanticsService } from '../services/time-semantics.js';

describe('TimeSemanticsService', () => {
    it('uses current UTC time as logicalDate for manual trigger when logicalDate is missing', () => {
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 1, 30, 0));
        const service = new TimeSemanticsService(clock);

        const resolved = service.resolve('manual');
        expect(resolved.ok).toBe(true);
        if (!resolved.ok) {
            return;
        }

        expect(resolved.value.logicalDate).toBe('2026-02-14T01:30:00.000Z');
        expect(resolved.value.requestedAt).toBe('2026-02-14T01:30:00.000Z');
    });

    it('normalizes offset logicalDate to UTC ISO string', () => {
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 0, 0, 0));
        const service = new TimeSemanticsService(clock);

        const resolved = service.resolve('api', '2026-02-14T10:00:00+09:00');
        expect(resolved.ok).toBe(true);
        if (!resolved.ok) {
            return;
        }

        expect(resolved.value.logicalDate).toBe('2026-02-14T01:00:00.000Z');
    });

    it('rejects scheduled trigger without logicalDate', () => {
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 0, 0, 0));
        const service = new TimeSemanticsService(clock);

        const resolved = service.resolve('scheduled');
        expect(resolved.ok).toBe(false);
        if (resolved.ok) {
            return;
        }

        expect(resolved.error.code).toBe('DAG_VALIDATION_MISSING_LOGICAL_DATE');
    });

    it('rejects invalid logicalDate format', () => {
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 0, 0, 0));
        const service = new TimeSemanticsService(clock);

        const resolved = service.resolve('manual', 'not-a-date');
        expect(resolved.ok).toBe(false);
        if (resolved.ok) {
            return;
        }

        expect(resolved.error.code).toBe('DAG_VALIDATION_INVALID_LOGICAL_DATE');
    });
});
