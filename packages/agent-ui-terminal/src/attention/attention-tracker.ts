/**
 * SCREEN-1992: whether the user is at the terminal.
 *
 * Two sources feed one boolean. When the terminal negotiated focus reporting (DECSET 1004) the
 * focus events are authoritative and keystrokes carry no attention meaning. Without it, the only
 * signal is input: silence past the idle threshold means "away", the next keystroke means "back".
 */
import { MS_PER_MINUTE } from './time-units.js';

const DEFAULT_IDLE_THRESHOLD_MINUTES = 5;
export const DEFAULT_IDLE_THRESHOLD_MS = DEFAULT_IDLE_THRESHOLD_MINUTES * MS_PER_MINUTE;

export type TAttentionChangeKind = 'lost' | 'returned';

export interface IAttentionChange {
  readonly kind: TAttentionChangeKind;
  /** ISO timestamp of the transition, from the injected clock. */
  readonly at: string;
}

export type TAttentionListener = (change: IAttentionChange) => void;

/** What a consumer of attention sees: the level, and every transition. */
export interface IAttentionSource {
  readonly attended: boolean;
  /** Which source decides the level — recorded so a degraded run is never a silent default. */
  readonly source: 'focus' | 'idle';
  subscribe(listener: TAttentionListener): () => void;
}

export interface IAttentionTrackerOptions {
  readonly focusReporting: boolean;
  readonly now: () => number;
  readonly idleThresholdMs?: number;
}

export class AttentionTracker implements IAttentionSource {
  private attendedState = true;
  private readonly listeners = new Set<TAttentionListener>();
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly idleThresholdMs: number;

  constructor(private readonly options: IAttentionTrackerOptions) {
    this.idleThresholdMs = options.idleThresholdMs ?? DEFAULT_IDLE_THRESHOLD_MS;
  }

  get attended(): boolean {
    return this.attendedState;
  }

  get source(): 'focus' | 'idle' {
    return this.options.focusReporting ? 'focus' : 'idle';
  }

  subscribe(listener: TAttentionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Arms the idle fallback. A no-op when focus reporting is authoritative. */
  start(): void {
    if (this.options.focusReporting) return;
    this.armIdleTimer();
  }

  focusIn(): void {
    if (!this.options.focusReporting) return;
    this.transition(true);
  }

  focusOut(): void {
    if (!this.options.focusReporting) return;
    this.transition(false);
  }

  /** Any key the user pressed. Only the idle source reads it. */
  keystroke(): void {
    if (this.options.focusReporting) return;
    this.transition(true);
    this.armIdleTimer();
  }

  dispose(): void {
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    this.listeners.clear();
  }

  private armIdleTimer(): void {
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      this.transition(false);
    }, this.idleThresholdMs);
    // Never keep the process alive for an attention timer.
    if (typeof this.idleTimer === 'object' && 'unref' in this.idleTimer) this.idleTimer.unref();
  }

  private transition(attended: boolean): void {
    if (this.attendedState === attended) return;
    this.attendedState = attended;
    const change: IAttentionChange = {
      kind: attended ? 'returned' : 'lost',
      at: new Date(this.options.now()).toISOString(),
    };
    for (const listener of this.listeners) listener(change);
  }
}
