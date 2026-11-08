/**
 * CLI-2004 — OSC 133 shell-integration marks at agent-turn boundaries.
 *
 * `OSC 133 ; A` marks prompt start, `; B` prompt end, `; C` pre-execution and `; D` execution
 * finished. Terminals that implement the protocol turn those into jump-to-previous-prompt
 * navigation, which is how a reader reviews a long session without scrolling line by line.
 *
 * Written OUTSIDE Ink, following the `use-terminal-title.ts` carve-out: `sanitize-terminal-text.ts`
 * strips OSC from untrusted text and the `tui-safe-text-boundary` scan permits only `SafeText` to
 * import Ink's `Text`, so an escape sequence this package writes deliberately cannot go through a
 * component. Unlike the title writer there is no interpolated payload here at all — the four
 * sequences are constants — so nothing needs sanitizing.
 *
 * A terminal that does not implement OSC 133 discards the unknown sequence silently, so emission is
 * safe wherever it is on; `supportsTurnMarks()` (terminal-capabilities.ts) carries the documented
 * negatives rather than a capability probe.
 */

/** The four boundary marks, in the order one turn emits them. */
export type TTurnMark = 'promptStart' | 'promptEnd' | 'turnStart' | 'turnEnd';

const MARK_CODES: Readonly<Record<TTurnMark, string>> = {
  promptStart: 'A',
  promptEnd: 'B',
  turnStart: 'C',
  turnEnd: 'D',
};

/** The exact byte sequence for one mark. */
export function turnMarkSequence(mark: TTurnMark): string {
  return `\x1b]133;${MARK_CODES[mark]}\x07`;
}

export interface ITurnMarkWriterOptions {
  /** Screen-reader mode. Off ⇒ nothing is ever written. */
  enabled: boolean;
  /** Documented per-terminal support gate. */
  supported: () => boolean;
  /** Injected sink; defaults to the process's own stdout. */
  write?: (text: string) => void;
}

export interface ITurnMarkWriter {
  emit(mark: TTurnMark): void;
}

/**
 * Build the mark writer. Both gates are read at emit time, not construction time, so a test can flip
 * the support gate between emissions without rebuilding the writer.
 */
export function createTurnMarkWriter(options: ITurnMarkWriterOptions): ITurnMarkWriter {
  const write =
    options.write ??
    ((text: string): void => {
      process.stdout.write(text);
    });
  return {
    emit(mark: TTurnMark): void {
      if (!options.enabled || !options.supported()) return;
      write(turnMarkSequence(mark));
    },
  };
}
