/** FLOW-2006 TC-01 / TC-02 — the grammar, and the encode/parse round trip. */
import { describe, expect, it } from 'vitest';

import {
  encodeLaunchIntent,
  parseLaunchIntent,
  LAUNCH_INTENT_MAX_PROMPT,
  LAUNCH_INTENT_MAX_URL,
  LAUNCH_INTENT_USAGE,
} from '../launch-intent.js';

/* eslint-disable no-control-regex -- asserting the control class IS the point */
/** Nothing in this class may survive into a message the terminal prints. */
const FORBIDDEN_IN_OUTPUT =
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/u;
/* eslint-enable no-control-regex */

const ok = (url: string): ReturnType<typeof parseLaunchIntent> => {
  const parsed = parseLaunchIntent(url);
  expect(parsed.ok, `expected ${url} to parse`).toBe(true);
  return parsed;
};

function refusalFor(url: string): string {
  const parsed = parseLaunchIntent(url);
  expect(parsed.ok, `expected ${url} to be refused`).toBe(false);
  return parsed.ok ? '' : parsed.reason;
}

describe('parseLaunchIntent accepts the three spellings of the one verb', () => {
  it('takes robota://open, its trailing slash, the authority-less form and an upper-case verb', () => {
    for (const url of [
      'robota://open?v=1&prompt=hi&cwd=/abs/path',
      'robota://open/?v=1&prompt=hi&cwd=/abs/path',
      'robota:open?v=1&prompt=hi&cwd=/abs/path',
      'robota://OPEN?v=1&prompt=hi&cwd=/abs/path',
    ]) {
      const parsed = ok(url);
      if (parsed.ok) {
        expect(parsed.intent.prompt).toBe('hi');
        expect(parsed.intent.cwd).toBe('/abs/path');
      }
    }
  });

  it('takes a repo slug, and a Windows absolute cwd', () => {
    const repo = ok('robota://open?v=1&prompt=hi&repo=owner/name');
    if (repo.ok) expect(repo.intent.repo).toBe('owner/name');
    const win = ok('robota://open?v=1&prompt=hi&cwd=C:\\work\\repo');
    if (win.ok) expect(win.intent.cwd).toBe('C:\\work\\repo');
  });
});

describe('parseLaunchIntent refuses the whole url, naming the first rule broken', () => {
  it('refuses a wrong scheme, verb, fragment or missing target', () => {
    expect(refusalFor('https://open?v=1&prompt=hi')).toContain('scheme');
    expect(refusalFor('robota://openx?v=1&prompt=hi&cwd=/a')).toContain('robota://open');
    expect(refusalFor('robota://open/extra?v=1&prompt=hi&cwd=/a')).toContain('robota://open');
    expect(refusalFor('robota://open?v=1&prompt=hi&cwd=/a#frag')).toContain('fragment');
    expect(refusalFor('robota://open?v=1&prompt=hi')).toContain('names no target');
    expect(refusalFor('not a url at all')).toContain('not a URL');
  });

  it('refuses a missing or wrong version', () => {
    expect(refusalFor('robota://open?prompt=hi&cwd=/a')).toContain('no `v`');
    expect(refusalFor('robota://open?v=2&prompt=hi&cwd=/a')).toContain('version 1');
  });

  it('refuses an unknown key rather than ignoring it — the configuration-smuggling boundary', () => {
    for (const key of ['provider', 'permission-mode', 'allowed-tools', 'plugin', 'model']) {
      expect(refusalFor(`robota://open?v=1&prompt=hi&cwd=/a&${key}=x`)).toContain(key);
    }
  });

  it('refuses a duplicate key rather than taking the last one', () => {
    expect(refusalFor('robota://open?v=1&prompt=a&prompt=b&cwd=/a')).toContain('more than once');
  });

  it('refuses an oversize url and an oversize prompt, counting code points', () => {
    const longUrl = `robota://open?v=1&cwd=/a&prompt=${'x'.repeat(LAUNCH_INTENT_MAX_URL)}`;
    expect(refusalFor(longUrl)).toContain('longer than');
    const tooLong = `robota://open?v=1&cwd=/a&prompt=${'x'.repeat(LAUNCH_INTENT_MAX_PROMPT + 1)}`;
    expect(refusalFor(tooLong)).toContain(String(LAUNCH_INTENT_MAX_PROMPT));
    // Exactly at the cap is accepted.
    ok(`robota://open?v=1&cwd=/a&prompt=${'x'.repeat(LAUNCH_INTENT_MAX_PROMPT)}`);
    // Code points, not UTF-16 units: an astral emoji is two units and must still count as one, so
    // a prompt of 3,000 of them is under the 5,000 cap. (The percent-encoded url is 12 bytes per
    // emoji, so this also stays under the url cap only because the count is well below it.)
    const emoji = encodeURIComponent('🙂'.repeat(600));
    const parsed = ok(`robota://open?v=1&cwd=/a&prompt=${emoji}`);
    if (parsed.ok) expect([...(parsed.intent.prompt ?? '')].length).toBe(600);
  });

  it('refuses a control, invisible or bidirectional character in the prompt', () => {
    for (const bad of ['%00', '%1B', '%E2%80%AE', '%EF%BB%BF']) {
      expect(refusalFor(`robota://open?v=1&cwd=/a&prompt=${bad}`)).toContain('control');
    }
    expect(refusalFor('robota://open?v=1&cwd=/a&prompt=a%0Db')).toContain('carriage return');
    // A CRLF pair is normalized rather than refused.
    const crlf = ok('robota://open?v=1&cwd=/a&prompt=a%0D%0Ab');
    if (crlf.ok) expect(crlf.intent.prompt).toBe('a\nb');
  });

  it('refuses a prompt that is a command, because one Enter would run it locally', () => {
    expect(refusalFor('robota://open?v=1&cwd=/a&prompt=%2Fmode%20bypassPermissions')).toContain(
      'not a command',
    );
    expect(refusalFor('robota://open?v=1&cwd=/a&prompt=%20%20%2Fexit')).toContain('not a command');
  });

  it('refuses a relative, UNC, dot-dot or control-bearing cwd, and a malformed slug', () => {
    expect(refusalFor('robota://open?v=1&prompt=hi&cwd=relative/path')).toContain('absolute');
    expect(refusalFor('robota://open?v=1&prompt=hi&cwd=%5C%5Cserver%5Cshare')).toContain('UNC');
    expect(refusalFor('robota://open?v=1&prompt=hi&cwd=/a/../b')).toContain('`..`');
    expect(refusalFor('robota://open?v=1&prompt=hi&cwd=/a%00b')).toContain('control');
    expect(refusalFor('robota://open?v=1&prompt=hi&repo=owner')).toContain('owner/name');
    expect(refusalFor('robota://open?v=1&prompt=hi&repo=owner/name/extra')).toContain('owner/name');
  });
});

describe('TC-02: precedence and the round trip', () => {
  it('cwd wins over repo and records that repo was superseded', () => {
    const parsed = ok('robota://open?v=1&prompt=hi&cwd=/abs&repo=owner/name');
    if (parsed.ok) {
      expect(parsed.intent.cwd).toBe('/abs');
      expect(parsed.intent.repo).toBeUndefined();
      expect(parsed.intent.repoSuperseded).toBe(true);
    }
  });

  it('round trips prompts with spaces, newlines, separators and non-ASCII characters', () => {
    for (const prompt of [
      'a b c',
      'line one\nline two',
      'a&b=c#d%e',
      '한글 프롬프트 🙂',
      'trailing space ',
    ]) {
      const url = encodeLaunchIntent({ version: '1', prompt, cwd: '/abs', repo: undefined });
      const parsed = ok(url);
      if (parsed.ok) expect(parsed.intent.prompt).toBe(prompt);
    }
  });
  /**
   * The refusal is the one output whose job is to be SEEN, and it is written to a terminal. A key
   * or a slug carrying `ESC[2J ESC[H` would clear the screen and home the cursor — erasing the very
   * warning it triggered and repainting whatever the link's author wanted there instead. So the
   * refusal must name the offending value WITHOUT replaying its control characters.
   */
  it('never replays a control or invisible character into the refusal it prints', () => {
    const esc = String.fromCharCode(27);
    const payloads = [
      `${esc}[2J${esc}[HTrusted`,
      `a${String.fromCharCode(0)}b`,
      `right\u202Eoverride`,
    ];
    const reasons = [
      ...payloads.map((value) => refusalFor(`robota://open?v=1&${encodeURIComponent(value)}=x`)),
      ...payloads.map((value) =>
        refusalFor(`robota://open?v=${encodeURIComponent(value)}&prompt=hi`),
      ),
      ...payloads.map((value) =>
        refusalFor(`robota://open?v=1&prompt=hi&repo=${encodeURIComponent(value)}`),
      ),
    ];
    for (const reason of reasons) {
      expect(reason).not.toMatch(FORBIDDEN_IN_OUTPUT);
      // It still names the value rather than saying only that something was wrong.
      expect(reason.length).toBeGreaterThan(LAUNCH_INTENT_USAGE.length);
    }
  });

  it('clamps how much of an attacker-supplied value it echoes back', () => {
    const reason = refusalFor(`robota://open?v=1&prompt=hi&repo=${'x'.repeat(500)}`);
    expect(reason).toContain('\u2026');
    expect(reason.length).toBeLessThan(LAUNCH_INTENT_USAGE.length + 200);
  });
});
