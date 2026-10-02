import type { ILivePromptQueueSummary } from '@robota-sdk/agent-interface-analytics';

/** Fixed-size measurement only; queue observations never grant tool ownership or authority. */
export class LiveQueueSummary {
  private seen = false;
  private durationMs = 0;
  private samples = 0;
  private invalid = 0;
  private admissionStarted = 0;
  private notDispatched = 0;

  observe(data: Readonly<Record<string, unknown>>): void {
    this.seen = true;
    const queued = typeof data.queuedAt === 'string' ? Date.parse(data.queuedAt) : NaN;
    const ended = typeof data.endedAt === 'string' ? Date.parse(data.endedAt) : NaN;
    if (typeof data.executionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(data.executionId) ||
      !Number.isSafeInteger(queued) || queued < 0 || !Number.isSafeInteger(ended) || ended < queued ||
      new Date(queued).toISOString() !== data.queuedAt || new Date(ended).toISOString() !== data.endedAt ||
      (data.disposition !== 'admission-started' && data.disposition !== 'not-dispatched') ||
      !Number.isSafeInteger(this.durationMs + ended - queued) || !Number.isSafeInteger(this.samples + 1)) {
      this.invalid++;
      return;
    }
    this.durationMs += ended - queued;
    this.samples++;
    if (data.disposition === 'admission-started') this.admissionStarted++;
    else this.notDispatched++;
  }

  finish(): ILivePromptQueueSummary | undefined {
    return this.seen ? { durationMs: this.durationMs, samples: this.samples, invalid: this.invalid,
      admissionStarted: this.admissionStarted, notDispatched: this.notDispatched } : undefined;
  }
}
