import type { IClockPort } from '@robota-sdk/dag-core';

/**
 * A manually-advanced {@link IClockPort} for deterministic tests: time only moves when the caller calls
 * {@link ManualClockPort.advanceByMs} / {@link ManualClockPort.setNowEpochMs}. (HARNESS-033: relocated from the
 * package main entry + renamed from `FakeClockPort` — it is a real, manually-driven clock, not a test double of
 * one; the no-fake-in-src rule keeps `Fake*`/`Mock*`/`Stub*` names to test code, and this now lives under
 * `./testing`.)
 */
export class ManualClockPort implements IClockPort {
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
