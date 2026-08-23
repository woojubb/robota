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
 * consumed as the start of its sequence rather than as a bare `ESC`, and every 8-bit C1 form is
 * matched with its BODY before the lone-C1 alternative can take the introducer on its own.
 *
 * Each introducer appears in both spellings, because a terminal accepts both: `ESC ]` and the single
 * byte `\x9d` are the same OSC. An alternation that removed only the 7-bit spelling would leave the
 * 8-bit one's parameters standing as visible text.
 *
 *  - `\x1b][^\x07\x1b]*(?:\x07|\x1b\\)?`  OSC, terminated by BEL or ST - or unterminated at the end
 *    of the input, which is the streaming case and must still be removed rather than left visible.
 *  - `\x9d[^\x07\x1b\x9c]*(?:\x07|\x9c|\x1b\\)?`  the same, 8-bit introducer, with `\x9c` as a
 *    third accepted terminator because 8-bit ST is one byte.
 *  - `\x1b[P^_X][\s\S]*?(?:\x1b\\|\x07)`  DCS, PM, APC, SOS, terminated by ST or BEL. The
 *    terminator is MANDATORY here, and that is the difference from the OSC alternative above. OSC's
 *    body is `[^\x07\x1b]*`, which is greedy and cannot cross its own terminator, so an optional
 *    terminator costs nothing. A DCS body is `[\s\S]*?`, which is lazy - and a lazy quantifier
 *    followed by an OPTIONAL group prefers the empty match at every position, so the alternative
 *    would consume the two-character introducer and nothing else, leaving `q#0;2;0;0;0` from a Sixel
 *    sequence standing as visible text. Found in review of PR #2212, and the reason every case in
 *    the test table now asserts the exact output rather than "no control byte survives" - the weaker
 *    assertion holds for a sanitizer that strips only introducers.
 *  - `\x1b[P^_X][\s\S]*$`  the same, unterminated at the end of the input. Written as its own
 *    alternative rather than an optional terminator, for the reason directly above.
 *  - `[\x90\x98\x9e\x9f][\s\S]*?(?:\x9c|\x1b\\|\x07)` and `[\x90\x98\x9e\x9f][\s\S]*$`
 *    DCS/SOS/PM/APC again, 8-bit introducers, terminated and unterminated.
 *  - `\x1b\[[0-9;?]*[ -/]*[@-~]`  CSI, including private-mode `?` parameters.
 *  - `\x9b[0-9;?]*[ -/]*[@-~]`  the same, 8-bit introducer.
 *  - `\x1b[@-Z\\-_]`  any other two-character escape.
 *  - `[\x00-\x1f\x7f]`  a lone control character, including a bare ESC or BEL.
 *  - `[\x80-\x9f]`  a lone C1 control that started no sequence any alternative above matched.
 */
const CONTROL_SEQUENCE =
  // eslint-disable-next-line no-control-regex
  /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x9d[^\x07\x1b\x9c]*(?:\x07|\x9c|\x1b\\)?|\x1b[P^_X][\s\S]*?(?:\x1b\\|\x07)|\x1b[P^_X][\s\S]*$|[\x90\x98\x9e\x9f][\s\S]*?(?:\x9c|\x1b\\|\x07)|[\x90\x98\x9e\x9f][\s\S]*$|\x1b\[[0-9;?]*[ -/]*[@-~]|\x9b[0-9;?]*[ -/]*[@-~]|\x1b[@-Z\\-_]|[\x00-\x1f\x7f]|[\x80-\x9f]/g;

/** The longest prefix of `text` that could still become a control sequence if more text arrived. */
const INCOMPLETE_TAIL =
  // eslint-disable-next-line no-control-regex
  /(?:\x1b(?:\][^\x07\x1b]*|[P^_X][\s\S]*|\[[0-9;?]*[ -/]*|)?|\x9d[^\x07\x1b\x9c]*|[\x90\x98\x9e\x9f][\s\S]*|\x9b[0-9;?]*[ -/]*)$/;

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
