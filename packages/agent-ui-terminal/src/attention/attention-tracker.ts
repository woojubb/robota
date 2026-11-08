/**
 * SCREEN-1992: whether the user is at the terminal.
 *
 * Two sources feed one boolean. Focus reporting (DECSET 1004) was REQUESTED, not confirmed — a
 * terminal that does not implement the mode discards the request and never answers — so focus
 * becomes authoritative only once the first `CSI I`/`CSI O` has actually arrived; from then on
 * keystrokes carry no attention meaning. Until then, and wherever the mode is off, the only signal
 * is input: silence past the idle threshold means "away", the next keystroke means "back".
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
  /** Which source decides the level right now — recorded so a degraded run is never a silent default. */
  readonly source: 'focus' | 'idle';
  subscribe(listener: TAttentionListener): () => void;
}

export interface IAttentionTrackerOptions {
  /** Whether DECSET 1004 was requested; the first focus event is what makes it authoritative. */
  readonly focusReporting: boolean;
  readonly now: () => number;
  readonly idleThresholdMs?: number;
}

export class AttentionTracker implements IAttentionSource {
  private attendedState = true;
  private focusObserved = false;
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
    return this.focusObserved ? 'focus' : 'idle';
  }

  subscribe(listener: TAttentionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Arms the idle fallback; the first focus event disarms it for good. */
  start(): void {
    if (this.focusObserved) return;
    this.armIdleTimer();
  }

  focusIn(): void {
    this.observeFocus();
    this.transition(true);
  }

  focusOut(): void {
    this.observeFocus();
    this.transition(false);
  }

  /** Any key the user pressed. Only the idle source reads it. */
  keystroke(): void {
    if (this.focusObserved) return;
    this.transition(true);
    this.armIdleTimer();
  }

  private observeFocus(): void {
    if (!this.options.focusReporting) {
      throw new Error('AttentionTracker: a focus event arrived although focus reporting is off.');
    }
    if (this.focusObserved) return;
    this.focusObserved = true;
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
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
