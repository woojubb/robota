/**
 * SCREEN-1992 — DECSET/DECRST 1004: ask the terminal to report focus changes (`CSI I` / `CSI O`).
 *
 * Written OUTSIDE Ink, following the `terminal-marks.ts` carve-out: the two sequences are constants,
 * so nothing needs sanitizing, and no component may emit an escape sequence. A terminal that does not
 * implement the mode discards the request; `supportsFocusReporting()` (terminal-capabilities.ts)
 * carries the gate, and `negotiated` is what the stdin filter and the attention tracker consult.
 */
const FOCUS_REPORTING_ENABLE = '\x1b[?1004h';
const FOCUS_REPORTING_DISABLE = '\x1b[?1004l';

export interface IFocusReportingWriterOptions {
  /** The capability gate, read at enable time. */
  supported: () => boolean;
  /** Injected sink; defaults to the process's own stdout. */
  write?: (text: string) => void;
}

export interface IFocusReportingWriter {
  /** True between a successful `enable()` and the next `disable()`. */
  readonly negotiated: boolean;
  enable(): void;
  disable(): void;
}

export function createFocusReportingWriter(
  options: IFocusReportingWriterOptions,
): IFocusReportingWriter {
  const write =
    options.write ??
    ((text: string): void => {
      process.stdout.write(text);
    });
  let negotiated = false;
  return {
    get negotiated(): boolean {
      return negotiated;
    },
    enable(): void {
      if (negotiated || !options.supported()) return;
      negotiated = true;
      write(FOCUS_REPORTING_ENABLE);
    },
    disable(): void {
      if (!negotiated) return;
      negotiated = false;
      write(FOCUS_REPORTING_DISABLE);
    },
  };
}
