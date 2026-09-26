/**
 * How many turns one peer's messages may start in this session over time.
 *
 * A message from another session carries no authority, but it still runs this session's model, at
 * this owner's cost. The conversation limits bound one exchange; nothing bounded a peer that keeps
 * opening new ones. This does, per sender, over sliding windows.
 */

export interface IPeerTurnRateWindow {
  readonly windowMs: number;
  readonly maxTurns: number;
}

/**
 * A burst of six a minute lets one conversation run its whole course without waiting — this session
 * answers at most four times in one — and thirty an hour stops a sender that opens conversation after
 * conversation from running the model more than about once every two minutes.
 */
export const DEFAULT_PEER_TURN_RATE_WINDOWS: readonly IPeerTurnRateWindow[] = [
  { windowMs: 60_000, maxTurns: 6 },
  { windowMs: 3_600_000, maxTurns: 30 },
];

/** Senders remembered before those with nothing inside any window are forgotten. */
const MAX_SENDERS = 1000;

/**
 * Counts each sender's messages the session took for a turn — one later coalesced or dropped by the
 * queue included, so a flood cannot slip past by being replaced — and refuses those over a limit.
 */
export class PeerTurnRateLimiter {
  private readonly started = new Map<string, number[]>();
  private readonly longestWindowMs: number;

  constructor(
    private readonly windows: readonly IPeerTurnRateWindow[] = DEFAULT_PEER_TURN_RATE_WINDOWS,
    private readonly now: () => number = Date.now,
  ) {
    this.longestWindowMs = Math.max(0, ...windows.map((window) => window.windowMs));
  }

  /**
   * Admit one more message from `sender` and count it, or say why not. A message refused here is not
   * counted, so a sender that keeps sending is not locked out beyond the window.
   */
  admit(sender: string): string | undefined {
    const at = this.now();
    if (this.started.size > MAX_SENDERS) this.forgetIdleSenders(at);
    const recent = (this.started.get(sender) ?? []).filter(
      (time) => at - time < this.longestWindowMs,
    );
    for (const window of this.windows) {
      const inWindow = recent.filter((time) => at - time < window.windowMs).length;
      if (inWindow >= window.maxTurns) {
        this.started.set(sender, recent);
        return (
          `too many messages from ${sender}: at most ${window.maxTurns} may start a turn in ` +
          `${Math.round(window.windowMs / 1000)} s. Try again later.`
        );
      }
    }
    recent.push(at);
    this.started.set(sender, recent);
    return undefined;
  }

  private forgetIdleSenders(at: number): void {
    for (const [sender, times] of this.started) {
      if (times.every((time) => at - time >= this.longestWindowMs)) this.started.delete(sender);
    }
  }
}
