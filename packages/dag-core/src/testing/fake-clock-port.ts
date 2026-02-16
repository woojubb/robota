import type { IClockPort } from '../interfaces/ports.js';

export class FakeClockPort implements IClockPort {
    private nowMs: number;

    public constructor(initialEpochMs: number = Date.now()) {
        this.nowMs = initialEpochMs;
    }

    public nowIso(): string {
        return new Date(this.nowMs).toISOString();
    }

    public nowEpochMs(): number {
        return this.nowMs;
    }

    public advanceByMs(durationMs: number): void {
        this.nowMs += durationMs;
    }

    public setNowEpochMs(nextEpochMs: number): void {
        this.nowMs = nextEpochMs;
    }
}

export class SystemClockPort implements IClockPort {
    public nowIso(): string {
        return new Date().toISOString();
    }

    public nowEpochMs(): number {
        return Date.now();
    }
}
