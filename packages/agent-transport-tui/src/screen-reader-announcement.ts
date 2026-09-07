/**
 * CLI-2004 — the first line the process prints.
 *
 * Two mutually exclusive lines, and never more than one:
 *  - the mode is ON  → `[Screen reader mode: on via flag|env|settings]`. It is the only
 *    self-diagnostic in the design: when someone reports "I passed the flag and nothing changed",
 *    this line says whether the mode is on and which input turned it on.
 *  - the mode is OFF and the environment looks like a reader is present → one advisory line naming
 *    the flag. That is the whole of this project's answer to the auto-detection question: opt-in
 *    keeps determinism, and a false positive costs one line of text instead of reshaping a sighted
 *    user's interface.
 *
 * Printed before Ink's first frame and never during a turn, so it cannot interleave with output a
 * reader is consuming.
 */

/** Which input turned the mode on. Mirrors the CLI resolver's channel. */
export type TScreenReaderChannel = 'flag' | 'env' | 'settings';

export interface IScreenReaderAnnouncementInputs {
  enabled: boolean;
  channel?: TScreenReaderChannel | undefined;
  /** True when the mode is off but the environment suggests a reader is running. */
  hint?: boolean | undefined;
}

/** The confirmation / advisory line, or `undefined` when neither applies. Pure. */
export function screenReaderAnnouncement(
  inputs: IScreenReaderAnnouncementInputs,
): string | undefined {
  if (inputs.enabled) {
    // A mode that is on always names a channel; `settings` is the lowest tier and the safe read
    // when a caller enables the mode without saying how.
    return `[Screen reader mode: on via ${inputs.channel ?? 'settings'}]`;
  }
  if (inputs.hint === true) {
    return '[Screen reader mode: off — run with --screen-reader]';
  }
  return undefined;
}

/** Write the line (with its newline) when there is one. Silent otherwise. */
export function writeScreenReaderAnnouncement(
  inputs: IScreenReaderAnnouncementInputs,
  write: (text: string) => void = (text) => {
    process.stdout.write(text);
  },
): void {
  const line = screenReaderAnnouncement(inputs);
  if (line === undefined) return;
  write(`${line}\n`);
}
