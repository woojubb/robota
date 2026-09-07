/**
 * CLI-2004 — the two pacing waits.
 *
 * A terminal has no `aria-live`. The ONLY way to influence what a reader announces is which bytes
 * land in the buffer and WHEN, which is why these two waits exist at all:
 *
 *  - the STARTUP QUIET period lets the reader finish speaking the confirmation line before the first
 *    prompt frame overwrites the region it is reading; a keypress ends it early;
 *  - the PRE-WRITE PARK moves the cursor to column 0 and pauses briefly before a changed line, so a
 *    reader that tracks the caret restarts on the new text instead of mid-line.
 *
 * The DEFAULTS ARE MEASURED AGAINST THIS RENDER LOOP, not copied. Ink 7.1.1 renders at `maxFps: 30`
 * by default — a 33.3 ms frame — so a park shorter than one frame cannot straddle a repaint;
 * `DEFAULT_PREPARK_MS` is that frame plus a margin. `DEFAULT_STARTUP_QUIET_MS` is the observed
 * boot-to-first-prompt interval of this binary (~450 ms in the PTY harness) doubled, so the
 * confirmation line is spoken before the prompt lands without the reference's 3 s stall, which is
 * tuned to a heavier boot.
 *
 * The caps are sanity bounds, not policy: a value above them is clamped AND REPORTED. Nothing here
 * silently substitutes a number — an unparseable value is refused with a note on stderr and the
 * default stands (No-Fallback: the refusal is visible).
 */

/** Sanity bound on the startup quiet period (10 minutes). */
export const STARTUP_QUIET_MS_MAX = 600_000;
/** Sanity bound on the pre-write park (5 seconds). */
export const PREPARK_MS_MAX = 5_000;
/** Boot-to-first-prompt of this binary, doubled. */
export const DEFAULT_STARTUP_QUIET_MS = 900;
/** One Ink frame at the default `maxFps: 30` (33.3 ms), plus margin. */
export const DEFAULT_PREPARK_MS = 40;

/** Move the cursor to column 0 — the park's visible half. */
export const COLUMN_ZERO = '\r';

export const STARTUP_QUIET_ENV = 'ROBOTA_SCREEN_READER_STARTUP_QUIET_MS';
export const PREPARK_ENV = 'ROBOTA_SCREEN_READER_PREPARK_MS';

/** The resolved pacing. Both are `0` whenever the mode is off. */
export interface IScreenReaderPacing {
  startupQuietMs: number;
  preparkMs: number;
}

export interface IResolvePacingInputs {
  /** Screen-reader mode. Off ⇒ both waits are 0 regardless of the variables. */
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
 * Read one duration variable. Absent ⇒ the default. Non-numeric or negative ⇒ the default WITH a
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
    warn(`${name}: ignoring "${raw}" — expected a whole number of milliseconds. Using ${fallback}.`);
    return fallback;
  }
  if (parsed > bound) {
    warn(`${name}: clamping ${parsed} to the ${bound} ms sanity bound.`);
    return bound;
  }
  return parsed;
}

/** Resolve both waits once, at startup. */
export function resolvePacing(inputs: IResolvePacingInputs): IScreenReaderPacing {
  if (!inputs.enabled) return { startupQuietMs: 0, preparkMs: 0 };
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
    preparkMs: resolveDuration(
      env[PREPARK_ENV],
      PREPARK_ENV,
      DEFAULT_PREPARK_MS,
      PREPARK_MS_MAX,
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
  return new Promise<'elapsed' | 'keypress'>((resolve) => {
    const onKey = (): void => {
      clearTimeout(timer);
      keys?.pause?.();
      resolve('keypress');
    };
    const timer = setTimeout(() => {
      if (keys !== undefined) keys.off('data', onKey);
      keys?.pause?.();
      resolve('elapsed');
    }, ms);
    // Do not hold the process open on the pacing timer alone.
    timer.unref?.();
    if (keys !== undefined) {
      keys.once('data', onKey);
      keys.resume?.();
    }
  });
}

/**
 * Park the cursor at column 0, then wait, then perform the write. The column-0 move is what a reader
 * tracking the caret notices; the wait is what gives it time to react before the new text arrives.
 * A `0` park still writes — it just does not pause.
 */
export async function parkThenWrite(
  ms: number,
  text: string,
  write: (chunk: string) => void,
): Promise<void> {
  write(COLUMN_ZERO);
  if (ms > 0) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
    });
  }
  write(text);
}
