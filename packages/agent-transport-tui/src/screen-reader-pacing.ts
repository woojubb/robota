/**
 * CLI-2004 — the startup quiet period.
 *
 * A terminal has no `aria-live`. The ONLY way to influence what a reader announces is which bytes
 * land in the buffer and WHEN, which is why this wait exists at all: it lets the reader finish
 * speaking the confirmation line before the first prompt frame overwrites the region it is reading.
 * A keypress ends it early.
 *
 * THE PRE-WRITE PARK IS NOT SHIPPED. § Decision verdict (i) adopted a second wait — a column-0 move
 * and a pause before each changed line — and it is not here, because there is no honest place to put
 * it: every transcript line is written by Ink's own frame loop, which writes synchronously. Wrapping
 * that write with a delay means either blocking the event loop or reordering frames. Rather than
 * ship a documented tunable that silently does nothing, the variable is not read at all; the gap is
 * recorded in the Task and in this package's SPEC under Known limitations.
 *
 * The DEFAULT IS MEASURED AGAINST THIS RENDER LOOP, not copied: `DEFAULT_STARTUP_QUIET_MS` is the
 * observed boot-to-first-prompt interval of this binary (~450 ms in the PTY harness) doubled, so the
 * confirmation line is spoken before the prompt lands without the reference's 3 s stall, which is
 * tuned to a heavier boot.
 *
 * The cap is a sanity bound, not policy: a value above it is clamped AND REPORTED. Nothing here
 * silently substitutes a number — an unparseable value is refused with a note on stderr and the
 * default stands (No-Fallback: the refusal is visible).
 */

/** Sanity bound on the startup quiet period (10 minutes). */
export const STARTUP_QUIET_MS_MAX = 600_000;
/** Boot-to-first-prompt of this binary, doubled. */
export const DEFAULT_STARTUP_QUIET_MS = 900;

export const STARTUP_QUIET_ENV = 'ROBOTA_SCREEN_READER_STARTUP_QUIET_MS';

/** The resolved pacing. `0` whenever the mode is off. */
export interface IScreenReaderPacing {
  startupQuietMs: number;
}

export interface IResolvePacingInputs {
  /** Screen-reader mode. Off ⇒ the wait is 0 regardless of the variable. */
  enabled: boolean;
  /** The environment to read. Defaults to the process environment. */
  env?: Readonly<Record<string, string | undefined>>;
  /** Where a clamp or a refusal is reported. Defaults to stderr. */
  warn?: (message: string) => void;
}

function reportTo(warn: IResolvePacingInputs['warn']): (message: string) => void {
  return (
    warn ??
    ((message: string): void => {
      process.stderr.write(`${message}\n`);
    })
  );
}

/**
 * Read the duration variable. Absent ⇒ the default. Non-numeric or negative ⇒ the default WITH a
 * note (never a silent 0). Above the bound ⇒ the bound WITH a note. `0` is honoured exactly — it is
 * the documented way to ask for no wait at all.
 */
function resolveDuration(
  raw: string | undefined,
  name: string,
  fallback: number,
  bound: number,
  warn: (message: string) => void,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    warn(
      `${name}: ignoring "${raw}" — expected a whole number of milliseconds. Using ${fallback}.`,
    );
    return fallback;
  }
  if (parsed > bound) {
    warn(`${name}: clamping ${parsed} to the ${bound} ms sanity bound.`);
    return bound;
  }
  return parsed;
}

/** Resolve the wait once, at startup. */
export function resolvePacing(inputs: IResolvePacingInputs): IScreenReaderPacing {
  if (!inputs.enabled) return { startupQuietMs: 0 };
  const env = inputs.env ?? process.env;
  const warn = reportTo(inputs.warn);
  return {
    startupQuietMs: resolveDuration(
      env[STARTUP_QUIET_ENV],
      STARTUP_QUIET_ENV,
      DEFAULT_STARTUP_QUIET_MS,
      STARTUP_QUIET_MS_MAX,
      warn,
    ),
  };
}

/** The one-shot keypress source that can settle the startup wait early. */
export interface IKeypressSource {
  once(event: 'data', listener: () => void): void;
  off(event: 'data', listener: () => void): void;
  resume?(): void;
  pause?(): void;
  /** Present on a TTY stdin. Without raw mode a lone key produces no `data` event. */
  isTTY?: boolean;
  setRawMode?(mode: boolean): void;
}

/**
 * Put a TTY stdin into raw mode for the duration of the wait, returning the undo.
 *
 * Without this the promise below only settles on Enter: in canonical mode the terminal buffers a
 * line, so "any keypress ends the wait" — which this package's SPEC states — would be false on a
 * real terminal and true only against a synthetic source. Ink sets raw mode itself once it renders;
 * this window closes before that, and restores whatever was set before.
 */
function withRawMode(keys: IKeypressSource | undefined): () => void {
  if (keys?.isTTY !== true || typeof keys.setRawMode !== 'function') return (): void => {};
  keys.setRawMode(true);
  return (): void => {
    keys.setRawMode?.(false);
  };
}

/**
 * Wait out the startup quiet period. Resolves at the deadline, or as soon as a key is pressed —
 * whichever comes first. A `0` wait resolves without touching the keypress source at all.
 *
 * The keystroke that ends the wait is CONSUMED, which is the documented behaviour: the wait exists
 * so the reader is not interrupted, and the key that says "I am ready" is the answer to it.
 */
export async function awaitStartupQuietPeriod(
  ms: number,
  keys?: IKeypressSource,
): Promise<'elapsed' | 'keypress'> {
  if (ms <= 0) return 'elapsed';
  const restoreRawMode = withRawMode(keys);
  return new Promise<'elapsed' | 'keypress'>((resolve) => {
    const settle = (outcome: 'elapsed' | 'keypress'): void => {
      restoreRawMode();
      keys?.pause?.();
      resolve(outcome);
    };
    const onKey = (): void => {
      clearTimeout(timer);
      settle('keypress');
    };
    const timer = setTimeout(() => {
      if (keys !== undefined) keys.off('data', onKey);
      settle('elapsed');
    }, ms);
    // Do not hold the process open on the pacing timer alone.
    timer.unref?.();
    if (keys !== undefined) {
      keys.once('data', onKey);
      keys.resume?.();
    }
  });
}
