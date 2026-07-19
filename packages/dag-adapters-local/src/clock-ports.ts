import type { IClockPort } from '@robota-sdk/dag-core';

export class SystemClockPort implements IClockPort {
  public nowIso(): string {
    return new Date().toISOString();
  }

  public nowEpochMs(): number {
    return Date.now();
  }
}
