import { MINUTES_PER_HOUR, MS_PER_MINUTE } from './time-units.js';

import type { TExecutionNormalizedState } from '@robota-sdk/agent-interface-execution';

/**
 * SCREEN-1992: one line for what happened while the user was away.
 *
 * Counts only while unattended; `onReturned` renders the interval and resets it. Nothing here
 * inspects the session — the coordinator feeds it the channel events it already receives.
 */
export const RECAP_MAX_WIDTH = 120;

type TTurnSource = 'user' | 'agent-wakeup' | 'peer' | string;

const TERMINAL_STATES: ReadonlySet<TExecutionNormalizedState> = new Set([
  'completed',
  'failed',
  'stopped',
]);

export class IntervalRecap {
  private lostAt: number | undefined;
  private lastTurnSource: TTurnSource = 'user';
  private turnsFinished = 0;
  private wakeTurnsFinished = 0;
  private needsInputCount = 0;
  private errorCount = 0;
  private readonly terminalEntries = new Map<string, TExecutionNormalizedState>();

  get away(): boolean {
    return this.lostAt !== undefined;
  }

  onLost(atIso: string): void {
    this.lostAt = Date.parse(atIso);
    this.reset();
  }

  /** The recap line for the interval just ended, or undefined when there is nothing to say. */
  onReturned(atIso: string): string | undefined {
    if (this.lostAt === undefined) return undefined;
    const elapsedMs = Math.max(0, Date.parse(atIso) - this.lostAt);
    this.lostAt = undefined;
    const parts = this.parts();
    this.reset();
    if (parts.length === 0) return undefined;
    return bound(`While away ${formatElapsed(elapsedMs)}: ${parts.join(' · ')}`);
  }

  turnSource(source: TTurnSource): void {
    this.lastTurnSource = source;
  }

  turnCompleted(): void {
    if (!this.away) return;
    this.turnsFinished += 1;
    if (this.lastTurnSource === 'agent-wakeup') this.wakeTurnsFinished += 1;
  }

  needsInput(): void {
    if (this.away) this.needsInputCount += 1;
  }

  error(): void {
    if (this.away) this.errorCount += 1;
  }

  /** A workspace entry's current state; only a transition INTO a terminal state is counted. */
  entryState(entryId: string, state: TExecutionNormalizedState): void {
    if (!this.away) return;
    if (!TERMINAL_STATES.has(state)) {
      this.terminalEntries.delete(entryId);
      return;
    }
    this.terminalEntries.set(entryId, state);
  }

  private parts(): string[] {
    const parts: string[] = [];
    if (this.turnsFinished > 0) {
      const wake = this.wakeTurnsFinished > 0 ? ` (${this.wakeTurnsFinished} wake)` : '';
      parts.push(`${this.turnsFinished} ${plural(this.turnsFinished, 'turn')} finished${wake}`);
    }
    if (this.needsInputCount > 0) parts.push(`${this.needsInputCount} needs input`);
    const byState = { completed: 0, failed: 0, stopped: 0 };
    for (const state of this.terminalEntries.values()) {
      if (state in byState) byState[state as keyof typeof byState] += 1;
    }
    for (const state of ['completed', 'failed', 'stopped'] as const) {
      if (byState[state] > 0) parts.push(`${byState[state]} ${state}`);
    }
    if (this.errorCount > 0) {
      parts.push(`${this.errorCount} ${plural(this.errorCount, 'error')}`);
    }
    return parts;
  }

  private reset(): void {
    this.turnsFinished = 0;
    this.wakeTurnsFinished = 0;
    this.needsInputCount = 0;
    this.errorCount = 0;
    this.terminalEntries.clear();
  }
}

function plural(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}

function formatElapsed(elapsedMs: number): string {
  const totalMinutes = Math.floor(elapsedMs / MS_PER_MINUTE);
  if (totalMinutes < 1) return '<1m';
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function bound(line: string): string {
  return line.length <= RECAP_MAX_WIDTH ? line : `${line.slice(0, RECAP_MAX_WIDTH - 1)}…`;
}
