import { describe, expect, it, vi } from 'vitest';
import { EXECUTION_PROGRESS_EVENTS, type TRunProgressEvent } from '@robota-sdk/dag-core';
import { RunProgressEventBus, type IRunProgressLogger } from '../composition/run-progress-event-bus.js';

function createStartedEvent(): TRunProgressEvent {
    return {
        dagRunId: 'run-test-1',
        eventType: EXECUTION_PROGRESS_EVENTS.STARTED,
        occurredAt: '2026-02-18T00:00:00.000Z',
        dagId: 'dag-test-1',
        version: 1
    };
}

function createMockLogger(): IRunProgressLogger {
    return {
        error: vi.fn()
    };
}

describe('RunProgressEventBus', () => {
    it('with logger: keeps publishing and logs error when one listener throws', () => {
        const logger = createMockLogger();
        const bus = new RunProgressEventBus(logger);
        const healthyListener = vi.fn();
        bus.subscribe(() => {
            throw new Error('listener failure');
        });
        bus.subscribe(healthyListener);

        expect(() => bus.publish(createStartedEvent())).not.toThrow();
        expect(healthyListener).toHaveBeenCalledTimes(1);
        expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it('with logger: keeps failed listener on subsequent publishes', () => {
        const logger = createMockLogger();
        const bus = new RunProgressEventBus(logger);
        const flaky = vi.fn(() => {
            throw new Error('listener failure');
        });
        const healthy = vi.fn();
        bus.subscribe(flaky);
        bus.subscribe(healthy);

        bus.publish(createStartedEvent());
        bus.publish(createStartedEvent());

        expect(flaky).toHaveBeenCalledTimes(2);
        expect(healthy).toHaveBeenCalledTimes(2);
        expect(logger.error).toHaveBeenCalledTimes(2);
    });

    it('without logger: re-throws after notifying all listeners', () => {
        const bus = new RunProgressEventBus();
        const healthyListener = vi.fn();
        bus.subscribe(() => {
            throw new Error('listener failure');
        });
        bus.subscribe(healthyListener);

        expect(() => bus.publish(createStartedEvent())).toThrow('listener failure');
        expect(healthyListener).toHaveBeenCalledTimes(1);
    });
});
