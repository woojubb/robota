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

// Each entry is a real attack from the issue's impact list, not a synthetic control character.
const ATTACKS: Array<[string, string]> = [
  ['OSC 52 clipboard write', ESC + ']52;c;aGVsbG8=' + BEL],
  ['OSC 52 with ST terminator', ESC + ']52;c;aGVsbG8=' + ESC + '\\'],
  [
    'OSC 8 deceptive hyperlink',
    ESC + ']8;;https://evil.example' + BEL + 'click me' + ESC + ']8;;' + BEL,
  ],
  ['OSC 0 window title', ESC + ']0;pwned' + BEL],
  ['CSI cursor move', ESC + '[10;10H'],
  ['CSI erase display', ESC + '[2J'],
  ['CSI private mode', ESC + '[?1049h'],
  ['DCS', ESC + 'Pq#0;2;0;0;0' + ESC + '\\'],
  ['APC', ESC + '_Ginline=1' + ESC + '\\'],
  ['PM', ESC + '^payload' + ESC + '\\'],
  ['bare ESC', ESC],
  ['bare BEL', BEL],
  ['8-bit CSI (C1)', String.fromCharCode(0x9b) + '2J'],
  ['8-bit OSC (C1)', String.fromCharCode(0x9d) + '52;c;x' + BEL],
  ['unterminated OSC', ESC + ']52;c;dangling'],
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
  it.each(ATTACKS)('removes %s', (_label, payload) => {
    const out = sanitizeTerminalText('before' + payload + 'after');
    expect(hasTerminalControl(out), JSON.stringify(out)).toBe(false);
    // Text before the sequence always survives; only the machinery is gone.
    expect(out.startsWith('before')).toBe(true);
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

  it('passes ordinary chunked text through unchanged', () => {
    const s = createStreamingTerminalSanitizer();
    expect(s.push('hello ') + s.push('world') + s.flush()).toBe('hello world');
  });
});
