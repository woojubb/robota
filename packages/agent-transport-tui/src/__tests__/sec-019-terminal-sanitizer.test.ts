import { describe, expect, it } from 'vitest';

import { renderMarkdown } from '../render-markdown.js';
import {
  createStreamingTerminalSanitizer,
  sanitizeTerminalText,
} from '../sanitize-terminal-text.js';

/**
 * SEC-019 (issue #2022) - untrusted text may not act on the terminal.
 *
 * Model output, tool output, file contents and plugin text reach Ink `<Text>`, and Ink passes control
 * sequences through. These assert the property rather than the implementation: after sanitization the
 * string contains no byte a terminal interprets as a command, and ordinary content is untouched.
 */
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

// Each entry is a real attack from the issue's impact list, not a synthetic control character, and
// each carries the EXACT output expected from `'before' + payload + 'after'`.
//
// The exact string is the point. The first version of this table asserted only that no control byte
// survived and that `before` was still there, and both held for a sanitizer that stripped a DCS
// introducer and left `q#0;2;0;0;0` standing as visible text — the defect review found on PR #2212.
// An assertion that a buggy implementation also satisfies is not a regression test.
const C1 = (code: number): string => String.fromCharCode(code);
const ATTACKS: Array<[string, string, string]> = [
  ['OSC 52 clipboard write', ESC + ']52;c;aGVsbG8=' + BEL, 'beforeafter'],
  ['OSC 52 with ST terminator', ESC + ']52;c;aGVsbG8=' + ESC + '\\', 'beforeafter'],
  [
    'OSC 8 deceptive hyperlink',
    ESC + ']8;;https://evil.example' + BEL + 'click me' + ESC + ']8;;' + BEL,
    // The visible half survives as ordinary text; only the target and its framing are gone, which is
    // exactly the deception being removed — the link text was never the dangerous part.
    'beforeclick meafter',
  ],
  ['OSC 0 window title', ESC + ']0;pwned' + BEL, 'beforeafter'],
  ['CSI cursor move', ESC + '[10;10H', 'beforeafter'],
  ['CSI erase display', ESC + '[2J', 'beforeafter'],
  ['CSI private mode', ESC + '[?1049h', 'beforeafter'],
  ['DCS', ESC + 'Pq#0;2;0;0;0' + ESC + '\\', 'beforeafter'],
  ['APC', ESC + '_Ginline=1' + ESC + '\\', 'beforeafter'],
  ['PM', ESC + '^payload' + ESC + '\\', 'beforeafter'],
  ['SOS with BEL terminator', ESC + 'Xdata' + BEL, 'beforeafter'],
  ['bare ESC', ESC, 'beforeafter'],
  ['bare BEL', BEL, 'beforeafter'],
  // The 8-bit spellings are the same sequences with a one-byte introducer. They are listed
  // separately because an alternation that names only `ESC [` removes the introducer and leaves the
  // parameters — the identical defect, reached by a different route.
  ['8-bit CSI (C1)', C1(0x9b) + '2J', 'beforeafter'],
  ['8-bit OSC with BEL', C1(0x9d) + '52;c;x' + BEL, 'beforeafter'],
  ['8-bit OSC with 8-bit ST', C1(0x9d) + '52;c;x' + C1(0x9c), 'beforeafter'],
  ['8-bit DCS', C1(0x90) + 'q#0;2;0;0;0' + C1(0x9c), 'beforeafter'],
  ['8-bit APC', C1(0x9f) + 'Ginline=1' + C1(0x9c), 'beforeafter'],
  ['8-bit PM', C1(0x9e) + 'payload' + C1(0x9c), 'beforeafter'],
  ['lone 8-bit ST', C1(0x9c), 'beforeafter'],
  // An unterminated sequence swallows what follows, which is what the terminal itself does.
  ['unterminated OSC', ESC + ']52;c;dangling', 'before'],
  ['unterminated 8-bit APC', C1(0x9f) + 'dangling', 'before'],
  ['unterminated DCS', ESC + 'Pq#0;2;0;0;0', 'before'],
];

/** No byte a terminal reads as a command survives. */
function hasTerminalControl(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '\t' || ch === '\n' || ch === '\r') continue;
    if (code <= 0x1f || code === 0x7f) return true;
    if (code >= 0x80 && code <= 0x9f) return true;
  }
  return false;
}

describe('SEC-019 - a control sequence in untrusted text is neutralized', () => {
  it.each(ATTACKS)('removes %s', (_label, payload, expected) => {
    const out = sanitizeTerminalText('before' + payload + 'after');
    // The exact output, not a property. `hasTerminalControl` is asserted as well because the two
    // claims are different: one says the string is safe, the other says the whole sequence is gone.
    expect(out).toBe(expected);
    expect(hasTerminalControl(out), JSON.stringify(out)).toBe(false);
  });

  it('keeps the text after a TERMINATED sequence', () => {
    const out = sanitizeTerminalText('before' + ESC + ']52;c;aGk=' + BEL + 'after');
    expect(out).toBe('beforeafter');
  });

  it('swallows what follows an UNTERMINATED sequence, as a terminal would', () => {
    // An unterminated OSC consumes subsequent bytes until a terminator arrives, so dropping the tail
    // matches what the terminal itself does. Keeping it would print the payload's own text as if it
    // were content, which is the deceptive half of OSC 8.
    const out = sanitizeTerminalText('before' + ESC + ']52;c;dangling-and-then-some');
    expect(out).toBe('before');
  });

  // The two cases below repeat rows of the table above under literal titles ON PURPOSE.
  //
  // `it.each` builds each case's title from a printf placeholder (`'removes %s'`), and the
  // accidental-green floor reads added case titles out of the diff — where the only text present is
  // `removes %s`, which matches no runtime title. Every `it.each` case is therefore invisible to it,
  // so a suite built entirely from tables can supply no red proof at all. Measured on this branch:
  // reversing the fix turned 5 `it.each` cases red and the floor still reported accidental-green.
  //
  // These two are the named proof for the defect review found on PR #2212, and they are the cases
  // that must go red if anyone restores the introducer-only behaviour.

  it('removes the whole DCS sequence, not only its two-character introducer', () => {
    // The lazy-quantifier bug left this as 'beforeq#0;2;0;0;0after' while every "no control byte
    // survives" assertion in the file stayed green.
    const out = sanitizeTerminalText('before' + ESC + 'Pq#0;2;0;0;0' + ESC + '\\' + 'after');
    expect(out).toBe('beforeafter');
    expect(out).not.toContain('q#0');
  });

  it('removes the whole 8-bit sequence, not only its one-byte C1 introducer', () => {
    // A terminal reads \x9b and `ESC [` as the same CSI. An alternation that names only the 7-bit
    // spelling leaves the parameters standing: '2J' and '52;c;x' as visible text.
    expect(sanitizeTerminalText('before' + C1(0x9b) + '2J' + 'after')).toBe('beforeafter');
    expect(sanitizeTerminalText('before' + C1(0x9d) + '52;c;x' + BEL + 'after')).toBe(
      'beforeafter',
    );
    expect(sanitizeTerminalText('before' + C1(0x9f) + 'Ginline=1' + C1(0x9c) + 'after')).toBe(
      'beforeafter',
    );
  });

  it('keeps tab, newline and carriage return, which are content', () => {
    expect(sanitizeTerminalText('a\tb\nc\rd')).toBe('a\tb\nc\rd');
  });

  it('leaves ordinary Unicode alone - the goal is what the TERMINAL acts on', () => {
    const text = 'héllo 世界 🙂 café — “quoted”';
    expect(sanitizeTerminalText(text)).toBe(text);
  });

  it('cannot be bypassed through a markdown code fence', () => {
    // A fence is where an author expects raw text to survive verbatim, which is exactly why it is
    // the first place an attacker would put an escape.
    const out = renderMarkdown('```\n' + ESC + ']52;c;aGk=' + BEL + '\n```', { color: false });
    expect(out).not.toContain(ESC + ']');
    expect(out).not.toContain(BEL);
  });

  it('cannot be bypassed through a markdown link target', () => {
    const out = renderMarkdown('[text](' + ESC + ']8;;https://evil.example' + BEL + ')', {
      color: false,
    });
    expect(out).not.toContain(BEL);
  });

  it('cannot be bypassed through a diff block or a carriage return', () => {
    const out = renderMarkdown('```diff\n- a' + ESC + '[2J\r+ b\n```', { color: false });
    expect(out).not.toContain(ESC + '[2J');
  });

  it('still emits the colours the renderer generates AFTER sanitization', () => {
    // The ordering is the design: sanitize the INPUT, never the output. If the sanitizer were moved
    // to the output this goes red, because the repository's own diff colouring is ANSI too.
    //
    // A diff block rather than `**bold**`: bold comes from chalk, which disables itself off a TTY, so
    // that assertion would be testing chalk's environment detection instead of this ordering.
    const out = renderMarkdown('```diff\n- removed\n+ added\n```', { color: true });
    expect(out, 'internally generated ANSI was stripped').toContain(ESC + '[');
  });
});

describe('SEC-019 - a sequence split across streaming chunks is still removed', () => {
  const PAYLOAD = 'A' + ESC + ']52;c;aGVsbG8=' + BEL + 'B';

  // EVERY split point, not a sampled one: the issue asks for exactly this.
  const SPLITS = Array.from({ length: PAYLOAD.length - 1 }, (_, i) => i + 1);

  it.each(SPLITS)('split at %i', (at) => {
    const s = createStreamingTerminalSanitizer();
    const out = s.push(PAYLOAD.slice(0, at)) + s.push(PAYLOAD.slice(at)) + s.flush();
    expect(hasTerminalControl(out), JSON.stringify(out)).toBe(false);
    expect(out).toBe('AB');
  });

  // The 8-bit spelling has its own held-back tail in `INCOMPLETE_TAIL`, and a claim with no test is
  // the thing this file exists to refuse. Same exhaustive split, different introducer.
  const C1_PAYLOAD = 'A' + C1(0x9d) + '52;c;aGVsbG8=' + C1(0x9c) + 'B';
  const C1_SPLITS = Array.from({ length: C1_PAYLOAD.length - 1 }, (_, i) => i + 1);

  it.each(C1_SPLITS)('8-bit OSC split at %i', (at) => {
    const s = createStreamingTerminalSanitizer();
    const out = s.push(C1_PAYLOAD.slice(0, at)) + s.push(C1_PAYLOAD.slice(at)) + s.flush();
    expect(out).toBe('AB');
    expect(hasTerminalControl(out), JSON.stringify(out)).toBe(false);
  });

  it('holds back an incomplete tail rather than emitting its visible half', () => {
    const s = createStreamingTerminalSanitizer();
    // `ESC ]52;c;` alone is not yet dangerous and not yet safe to print — emitting `52;c;` as text
    // would show the middle of a sequence while dropping the part that made it an escape.
    expect(s.push('x' + ESC + ']52;c;')).toBe('x');
    expect(s.push('aGk=' + BEL + 'y')).toBe('y');
  });

  it('flushes an escape that never completes, rather than leaking it', () => {
    const s = createStreamingTerminalSanitizer();
    expect(s.push('x' + ESC + ']52;c;dangling')).toBe('x');
    expect(hasTerminalControl(s.flush())).toBe(false);
  });

  // A sequence that ENDED inside the chunk is not an incomplete tail, and treating it as one is a
  // stall rather than a leak: `push` returns the text before it and holds everything after, so the
  // trailing content does not appear until the next chunk or the flush. Found in review of PR #2212
  // — the streaming table above splits an OSC and never puts a COMPLETE sequence mid-chunk, so it
  // could not see this.

  it('emits text that follows a DCS sequence already terminated inside the chunk', () => {
    const s = createStreamingTerminalSanitizer();
    expect(s.push('hello' + ESC + 'Pq#0;2;0;0;0' + ESC + '\\' + 'world')).toBe('helloworld');
    expect(s.flush()).toBe('');
  });

  it('emits text that follows an 8-bit APC sequence already terminated inside the chunk', () => {
    const s = createStreamingTerminalSanitizer();
    expect(s.push('hello' + C1(0x9f) + 'Ginline=1' + C1(0x9c) + 'world')).toBe('helloworld');
    expect(s.flush()).toBe('');
  });

  // Exhaustive splits for the DCS family too, not only OSC. The 7-bit and 8-bit bodies are the two
  // branches that carry the lookahead, so they are the two that must survive every boundary.
  const DCS_PAYLOAD = 'A' + ESC + 'Pq#0;2;0;0;0' + ESC + '\\' + 'B';
  const DCS_SPLITS = Array.from({ length: DCS_PAYLOAD.length - 1 }, (_, i) => i + 1);

  it.each(DCS_SPLITS)('DCS split at %i', (at) => {
    const s = createStreamingTerminalSanitizer();
    const out = s.push(DCS_PAYLOAD.slice(0, at)) + s.push(DCS_PAYLOAD.slice(at)) + s.flush();
    expect(out).toBe('AB');
  });

  const APC8_PAYLOAD = 'A' + C1(0x9f) + 'Ginline=1' + C1(0x9c) + 'B';
  const APC8_SPLITS = Array.from({ length: APC8_PAYLOAD.length - 1 }, (_, i) => i + 1);

  it.each(APC8_SPLITS)('8-bit APC split at %i', (at) => {
    const s = createStreamingTerminalSanitizer();
    const out = s.push(APC8_PAYLOAD.slice(0, at)) + s.push(APC8_PAYLOAD.slice(at)) + s.flush();
    expect(out).toBe('AB');
  });

  it('passes ordinary chunked text through unchanged', () => {
    const s = createStreamingTerminalSanitizer();
    expect(s.push('hello ') + s.push('world') + s.flush()).toBe('hello world');
  });
});
