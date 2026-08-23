/**
 * SEC-019 (issue #2022) - the one place untrusted text is made safe to put on a terminal.
 *
 * Model output, tool output, file contents and plugin text all reach Ink `<Text>`, and Ink does not
 * strip control sequences - it passes them through. So a repository, a fetched document, a plugin or
 * a model response could emit OSC and CSI sequences that act on the terminal independently of what
 * the transcript appears to say: OSC 52 writes the clipboard, OSC 8 makes a link whose visible text
 * and target differ, and CSI moves the cursor or erases what is already on screen.
 *
 * ## Allowlist, not denylist
 *
 * Everything is passed through EXCEPT the control range, and inside that range exactly three
 * characters survive - tab, newline, carriage return. A denylist of "known dangerous sequences" is
 * wrong for the same reason it is wrong for shell metacharacters: the set belongs to the terminal
 * emulator, and a list written today is incomplete the next time one adds an escape.
 *
 * ## Ordering: sanitize BEFORE rendering, never after
 *
 * The renderer ADDS ANSI - colours, bold, code-block framing. Sanitizing its output would strip the
 * repository's own presentation along with the attacker's. Sanitizing its input removes the escapes
 * that arrived from outside and leaves the ones generated after. That ordering is the whole design,
 * and it is why this is a function on the untrusted string rather than a filter on the rendered one.
 *
 * ## Streaming
 *
 * A sequence split across two deltas - `\x1b]5` then `2;c;...\x07` - is invisible to a sanitizer that
 * sees each chunk alone. {@link createStreamingTerminalSanitizer} holds the incomplete tail back until
 * the chunk that completes it arrives. The TUI's own stream path accumulates before rendering
 * (`tui-state-manager` appends each delta to a buffer and renders the buffer), so the stateless
 * function is sufficient THERE - but a caller that sanitizes per chunk needs the stateful one, and
 * having only the stateless function available is how that caller would get it wrong.
 */

/** Tab, newline and carriage return are content; every other C0 control is not. */
const KEPT_C0 = new Set(['\t', '\n', '\r']);

/**
 * One escape sequence, or a lone control character.
 *
 * The alternation is ordered longest-context-first so a two-character C1 introducer (`ESC ]`) is
 * consumed as the start of its sequence rather than as a bare `ESC`.
 *
 *  - `\x1b][^\x07\x1b]*(?:\x07|\x1b\\)?`  OSC, terminated by BEL or ST - or unterminated at the end
 *    of the input, which is the streaming case and must still be removed rather than left visible.
 *  - `\x1b[P^_X][\s\S]*?(?:\x1b\\|\x07)?` DCS, PM, APC, SOS - same shape, different introducer.
 *  - `\x1b\[[0-9;?]*[ -/]*[@-~]`          CSI, including private-mode `?` parameters.
 *  - `\x1b[@-Z\\-_]`                      any other two-character escape.
 *  - `[\x00-\x1f\x7f]`                    a lone control character, including a bare ESC or BEL.
 *  - `[\x80-\x9f]`                        the 8-bit C1 controls, which are OSC/CSI without the ESC.
 */
const CONTROL_SEQUENCE =
  // eslint-disable-next-line no-control-regex
  /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[P^_X][\s\S]*?(?:\x1b\\|\x07)?|\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-Z\\-_]|[\x00-\x1f\x7f]|[\x80-\x9f]/g;

/** The longest prefix of `text` that could still become a control sequence if more text arrived. */
// eslint-disable-next-line no-control-regex
const INCOMPLETE_TAIL = /(?:\x1b(?:\][^\x07\x1b]*|[P^_X][\s\S]*|\[[0-9;?]*[ -/]*|)?)$/;

/**
 * `text` with every terminal control sequence removed, and tab/newline/carriage return preserved.
 *
 * Ordinary Unicode - including characters far outside ASCII - is untouched: the goal is to remove
 * what the TERMINAL acts on, not to restrict what a document may say.
 */
export function sanitizeTerminalText(text: string): string {
  return text.replace(CONTROL_SEQUENCE, (match) => (KEPT_C0.has(match) ? match : ''));
}

/** A sanitizer that carries an incomplete escape across chunk boundaries. */
export interface IStreamingTerminalSanitizer {
  /** Sanitize one chunk, holding back any tail that could still become an escape. */
  push(chunk: string): string;
  /** Emit whatever is held back, sanitized. Call when the stream ends. */
  flush(): string;
}

/**
 * A stateful sanitizer for callers that sanitize each chunk as it arrives.
 *
 * The held-back tail is bounded by the incomplete-prefix pattern rather than by a byte count: a
 * partial OSC can be arbitrarily long, and truncating the buffer would emit the middle of a sequence
 * as visible text while dropping the part that made it dangerous.
 */
export function createStreamingTerminalSanitizer(): IStreamingTerminalSanitizer {
  let pending = '';
  return {
    push(chunk: string): string {
      const combined = pending + chunk;
      const tail = INCOMPLETE_TAIL.exec(combined);
      const holdFrom = tail && tail[0].length > 0 ? tail.index : combined.length;
      pending = combined.slice(holdFrom);
      return sanitizeTerminalText(combined.slice(0, holdFrom));
    },
    flush(): string {
      const remaining = pending;
      pending = '';
      return sanitizeTerminalText(remaining);
    },
  };
}
