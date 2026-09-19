/**
 * SCREEN-2002 TC-11 — the theme file boundary.
 *
 * Everything a user or a plugin can put in a theme file arrives here as text. The contract is
 * whole-file refusal with a path-named diagnostic: a file is either applied entirely or skipped
 * entirely, because a partially-applied theme is the state where a reader cannot tell which colours
 * are theirs and which are the base's.
 */
import { describe, expect, it } from 'vitest';

import { DARK_THEME, LIGHT_THEME } from '../built-in-themes.js';
import { parseThemeDocument } from '../theme-document.js';

import type { TThemeDocumentResult } from '../theme-document.js';

function parse(text: string, id = 'custom:mine'): TThemeDocumentResult {
  return parseThemeDocument({ id, fileName: 'mine.json', source: 'user', text });
}

function expectRefusal(text: string): string {
  const result = parse(text);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected a refusal');
  return result.error;
}

describe('parseThemeDocument', () => {
  it('applies a sparse override over its base and leaves every other token alone', () => {
    const result = parse(
      JSON.stringify({
        name: 'Mine',
        base: 'light',
        overrides: { colors: { text: { accent: '#56b4e9' } } },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected a theme');
    expect(result.theme.id).toBe('custom:mine');
    expect(result.theme.name).toBe('Mine');
    expect(result.theme.source).toBe('user');
    expect(result.theme.appearance).toBe(LIGHT_THEME.appearance);
    expect(result.theme.colors.text.accent).toBe('#56b4e9');
    expect(result.theme.colors.text.muted).toBe(LIGHT_THEME.colors.text.muted);
    expect(result.theme.syntax).toEqual(LIGHT_THEME.syntax);
    expect(result.theme.motion).toEqual(LIGHT_THEME.motion);
  });

  it('defaults to the dark base and to the id as a name', () => {
    const result = parse('{}');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected a theme');
    expect(result.theme.name).toBe('custom:mine');
    expect(result.theme.colors).toEqual(DARK_THEME.colors);
  });

  it('refuses an unknown token path, naming it', () => {
    const error = expectRefusal(
      JSON.stringify({ overrides: { colors: { text: { accnt: 'red' } } } }),
    );
    expect(error).toBe('$.overrides.colors.text.accnt is not a theme token');
  });

  it('refuses an invalid colour value, naming its path and the value', () => {
    const error = expectRefusal(
      JSON.stringify({ overrides: { colors: { text: { accent: 'not-a-colour' } } } }),
    );
    expect(error).toMatch(/^\$\.overrides\.colors\.text\.accent: "not-a-colour" is not a colour/u);
  });

  const ESCAPE = String.fromCharCode(27);

  it('refuses a raw SGR string — the grammar is the injection floor', () => {
    const error = expectRefusal(
      JSON.stringify({ overrides: { markdown: { code: `${ESCAPE}[31m` } } }),
    );
    expect(error).toMatch(/^\$\.overrides\.markdown\.code: /u);
  });

  it('keeps the refusal itself off the terminal — the message quotes what it rejected', () => {
    // The diagnostic is the one part of a refused file that reaches a terminal, and it quotes the
    // value. Interpolating it raw defeats the grammar's injection floor with the very message that
    // reports a violation of it — and a plugin's theme file is third-party content.
    const errors = [
      expectRefusal(JSON.stringify({ overrides: { markdown: { code: `${ESCAPE}[2J` } } })),
      expectRefusal(JSON.stringify({ overrides: { [`${ESCAPE}[2Jx`]: {} } })),
      expectRefusal(JSON.stringify({ [`${ESCAPE}[2Jx`]: 1 })),
      expectRefusal(`{ ${ESCAPE}[2J not json`),
      expectRefusal(JSON.stringify({ base: `${ESCAPE}[2J` })),
    ];
    for (const error of errors) expect(error).not.toContain(ESCAPE);
    // Escaped, not dropped: an author has to be able to SEE what their file holds.
    expect(errors[0]).toContain('\\u001b[2J');
  });

  it('escapes the 8-BIT spelling too, which JSON.stringify leaves standing', () => {
    // A terminal accepts `ESC [` and the single byte U+009B as the same CSI, and `JSON.stringify`
    // escapes only U+0000-U+001F — so quoting the 7-bit spelling alone leaves the other one's
    // parameters as a live sequence. `sanitize-terminal-text.ts` states the same rule.
    const csi = String.fromCharCode(0x9b);
    const osc = String.fromCharCode(0x9d);
    const del = String.fromCharCode(0x7f);
    const errors = [
      expectRefusal(JSON.stringify({ overrides: { markdown: { code: `${csi}2J` } } })),
      expectRefusal(JSON.stringify({ base: `${osc}0;x` })),
      expectRefusal(JSON.stringify({ [`${del}x`]: 1 })),
    ];
    for (const error of errors) {
      expect(error).not.toContain(csi);
      expect(error).not.toContain(osc);
      expect(error).not.toContain(del);
    }
    expect(errors[0]).toContain('\\u009b2J');
  });

  it('checks the MINTED id on the same terms as a name the file supplied', () => {
    const result = parseThemeDocument({
      id: `custom:${String.fromCharCode(0x9b)}2J`,
      fileName: 'mine.json',
      source: 'user',
      text: '{}',
    });
    expect(result.ok).toBe(false);
  });

  it('refuses a name it would then render for the whole session', () => {
    // Unlike a diagnostic, a name is APPLIED: it is drawn on every `/theme list` row and every
    // picker row until the setting changes.
    expect(expectRefusal(JSON.stringify({ name: `${ESCAPE}[2JPWNED` }))).toBe(
      '$.name: must not contain control characters',
    );
    expect(expectRefusal(JSON.stringify({ name: 'two\nlines' }))).toBe(
      '$.name: must not contain control characters',
    );
    expect(expectRefusal(JSON.stringify({ name: 'x'.repeat(61) }))).toMatch(
      /^\$\.name: must be at most 60 characters$/u,
    );
  });

  it('refuses an explicit null rather than reading it as "unset"', () => {
    expect(expectRefusal(JSON.stringify({ base: null }))).toBe(
      '$.base: expected a built-in theme id',
    );
    expect(expectRefusal(JSON.stringify({ overrides: null }))).toMatch(
      /^\$\.overrides: expected an object of tokens$/u,
    );
  });

  it('refuses a background chalk name as a foreground token value', () => {
    const error = expectRefusal(
      JSON.stringify({ overrides: { colors: { border: { focused: 'bgRed' } } } }),
    );
    expect(error).toMatch(/^\$\.overrides\.colors\.border\.focused: "bgRed" is not a colour/u);
  });

  it('refuses a malformed file WHOLE, naming the file root', () => {
    expect(expectRefusal('{ not json')).toMatch(/^\$: /u);
  });

  it('refuses an unknown base', () => {
    expect(expectRefusal(JSON.stringify({ base: 'solarized' }))).toBe(
      '$.base: "solarized" is not a built-in theme',
    );
  });

  it('refuses an unknown top-level key', () => {
    expect(expectRefusal(JSON.stringify({ colors: {} }))).toBe('$.colors is not a theme token');
  });

  it('refuses a token group replaced by a scalar, and a colour replaced by an object', () => {
    expect(expectRefusal(JSON.stringify({ overrides: { colors: 'red' } }))).toMatch(
      /^\$\.overrides\.colors: /u,
    );
    expect(
      expectRefusal(JSON.stringify({ overrides: { colors: { text: { accent: {} } } } })),
    ).toMatch(/^\$\.overrides\.colors\.text\.accent: /u);
  });

  it('refuses a motion ramp that is not exactly four colours', () => {
    expect(
      expectRefusal(JSON.stringify({ overrides: { motion: { wave: ['red', 'blue'] } } })),
    ).toMatch(/^\$\.overrides\.motion\.wave: /u);
    const ok = parse(
      JSON.stringify({ overrides: { motion: { wave: ['red', 'blue', 'green', 'cyan'] } } }),
    );
    expect(ok.ok).toBe(true);
  });

  it('refuses a name that is not a non-empty string', () => {
    expect(expectRefusal(JSON.stringify({ name: '' }))).toBe('$.name: expected a non-empty string');
  });

  it('never lets a document reach the prototype', () => {
    const error = expectRefusal('{"overrides":{"colors":{"text":{"__proto__":{"a":true}}}}}');
    expect(error).toBe('$.overrides.colors.text.__proto__ is not a theme token');
  });
});
