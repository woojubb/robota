import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareLiveContentRedactor } from '../live-content-redaction.js';

const context = {
  getSecrets: () => [] as string[],
  cwd: '/nonexistent/work/repo',
  homedir: '/home/al',
};

function redact(text: string, overrides: Partial<typeof context> & { projectRoot?: string } = {}, maxBytes = 16384) {
  return prepareLiveContentRedactor({ ...context, ...overrides })(text, maxBytes, false);
}

// Fixture credentials are assembled at runtime so no scannable literal is ever committed.
const cat = (...parts: string[]): string => parts.join('');
const AWS_KEY = cat('AK', 'IA', 'ABCDEFGHIJKLMNOP');
const AWS_SESSION_KEY = cat('AS', 'IA', 'ABCDEFGHIJKLMNOP');
const STRIPE_KEY = cat('sk', '_live_', 'abcdefghijklmnop1234');
const STRIPE_RESTRICTED_KEY = cat('rk', '_live_', 'abcdefghijklmnop1234');
const GITLAB_TOKEN = cat('gl', 'pat-', 'abcdefghijklmnopqrstu');
const CURL_PAIR = cat('curl -', 'u admin:hunter22 https://x');
const PEM_RSA = (body: string): string =>
  cat('-----BEGIN RSA PRI', 'VATE KEY-----\n', body, '\n-----END RSA PRI', 'VATE KEY-----');
const PEM_OPEN = cat('-----BEGIN PRI', 'VATE KEY-----');

describe('live content redaction', () => {
  it.each([
    ['an AWS access key', `id ${AWS_KEY} here`, AWS_KEY],
    ['an AWS session key', `id ${AWS_SESSION_KEY} here`, AWS_SESSION_KEY],
    ['a JWT', 'auth eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl done', 'eyJhbGciOiJIUzI1NiJ9'],
    ['a GitHub fine-grained token', 'github_pat_11ABCDEFG0123456789_abcdefghijklmnop', 'github_pat_11ABCDEFG'],
    ['a GitHub OAuth token', 'gho_abcdefghijklmnopqrstuvwxyz0123', 'gho_abcdefghij'],
    ['a GitHub server token', 'ghs_abcdefghijklmnopqrstuvwxyz0123', 'ghs_abcdefghij'],
    ['a Stripe secret key', STRIPE_KEY, STRIPE_KEY.slice(0, 18)],
    ['a Stripe restricted key', STRIPE_RESTRICTED_KEY, STRIPE_RESTRICTED_KEY.slice(0, 18)],
    ['an npm token', 'npm_abcdefghijklmnopqrstuvwxyz0123456789', 'npm_abcdefghij'],
    ['a GitLab token', GITLAB_TOKEN, GITLAB_TOKEN.slice(0, 16)],
    ['a doctor-known vendor key', 'key sk-ant-abcdefghijklmnop', 'sk-ant-abcdefghij'],
    ['a bearer token', 'Authorization: Bearer abcdefghijklmnop', 'abcdefghijklmnop'],
    ['URL userinfo', 'https://user:hunter22@example.com/x', 'hunter22'],
    ['a curl credential pair', CURL_PAIR, 'hunter22'],
    ['a secret assignment', 'export OPENAI_API_KEY=abc123def456', 'abc123def456'],
    ['a quoted password assignment', 'db_password="correct horse"', 'correct horse'],
    ['a token assignment', 'GITHUB_TOKEN=zzzz9999', 'zzzz9999'],
  ])('masks %s', (_label, text, secret) => {
    const out = redact(text).text;
    expect(out).not.toContain(secret);
    expect(out).toContain('[redacted]');
  });

  it('masks a PEM private key block through its END line, or to the end when cut off', () => {
    const pem = PEM_RSA('MIIEpAIBAAKCAQEA\nabcdef');
    expect(redact(`before\n${pem}\nafter`).text).toBe('before\n[redacted]\nafter');
    expect(redact(`x ${PEM_OPEN}\nMIIEvQIBADANBgkq`).text).toBe('x [redacted]');
  });

  it('masks literal secrets longest first, so a shorter one cannot leave part of a longer one', () => {
    const out = prepareLiveContentRedactor({
      ...context,
      getSecrets: () => ['abcd', 'abcd-efgh-ijkl'],
    })('value abcd-efgh-ijkl and abcd', 16384, false).text;
    expect(out).toBe('value [redacted] and [redacted]');
  });

  it('masks workspace paths before home, by whole segment only', () => {
    const out = redact(
      'see /home/al/work/repo/src/a.ts and /home/al/notes and /home/alice/x and /x/home/al/y and /home/al.',
      { cwd: '/home/al/work/repo' },
    ).text;
    expect(out).toBe('see <workspace>/src/a.ts and ~/notes and /home/alice/x and /x/home/al/y and ~.');
  });

  it('masks the real path of the working directory, its plain path and a separate project root', () => {
    const base = mkdtempSync(join(tmpdir(), 'robota-content-'));
    try {
      const real = realpathSync(base);
      const link = join(real, 'link');
      symlinkSync(real, link);
      const out = redact(`${real}/a ${link}/b /srv/project/c`, { cwd: link, projectRoot: '/srv/project' }).text;
      expect(out).toBe('<workspace>/a <workspace>/b <workspace>/c');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('masks the real path of a symlinked home directory and project root', () => {
    const base = mkdtempSync(join(tmpdir(), 'robota-content-home-'));
    try {
      const real = realpathSync(base);
      const home = join(real, 'home-link');
      symlinkSync(real, home);
      const root = join(real, 'root-link');
      mkdirSync(join(real, 'project'));
      symlinkSync(join(real, 'project'), root);
      const out = redact(`${real}/notes ${real}/project/a`, { cwd: '/nonexistent/other', homedir: home, projectRoot: root }).text;
      expect(out).toBe('~/notes <workspace>/a');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('replaces C0 and C1 controls except newline and tab', () => {
    expect(redact('a\u001b[31mb\r\nc\td\u0085e\u0000').text).toBe('a\uFFFD[31mb\uFFFD\nc\td\uFFFDe\uFFFD');
  });

  it('cuts exactly on a UTF-8 boundary after redaction, never splitting an emoji', () => {
    const text = `${'a'.repeat(254)} 😀😀`;
    const out = prepareLiveContentRedactor(context)(text, 257, false);
    expect(out.truncated).toBe(true);
    expect(out.text).toBe(`${'a'.repeat(254)} `);
    expect(Buffer.byteLength(out.text, 'utf8')).toBeLessThanOrEqual(257);
    const fits = prepareLiveContentRedactor(context)(`${'a'.repeat(250)} 😀`, 256, false);
    expect(fits).toEqual({ text: `${'a'.repeat(250)} 😀`, truncated: false });
  });

  it('cuts after redaction, so a secret straddling the bound is never half-exported', () => {
    const secret = AWS_KEY;
    const text = `${'a '.repeat(120)}${secret} tail`;
    const out = prepareLiveContentRedactor(context)(text, 250, false).text;
    expect(out).not.toMatch(/AKIA/u);
  });

  it('masks a long partial token at the cut edge, and keeps a short one', () => {
    const token = 'Zq9xLm2vPq8r'.repeat(10);
    const long = prepareLiveContentRedactor(context)(`${'w '.repeat(100)}${token} rest`, 256, false);
    expect(long.text).toBe(`${'w '.repeat(100)}[truncated]`);
    // No room for the marker: the partial token is still dropped.
    const tight = prepareLiveContentRedactor(context)(`${'w '.repeat(124)}${token}`, 256, false);
    expect(tight.text).toBe('w '.repeat(124));
    const short = prepareLiveContentRedactor(context)(`${'w '.repeat(126)}abcdef rest`, 256, false);
    expect(short.text.endsWith('abcd')).toBe(true);
  });

  it('masks a short edge token that could be the head of a known secret shape', () => {
    for (const head of ['sk-a', 'AKI', 'ghp_', 'eyJh', 'KEY=sk-']) {
      const out = prepareLiveContentRedactor(context)(`hello ${head}`, 2048, true);
      expect(out.text).toBe('hello [truncated]');
    }
    expect(prepareLiveContentRedactor(context)('hello wor', 2048, true).text).toBe('hello wor');
  });

  it('masks a workspace path inside a file URL', () => {
    expect(redact('open file:///home/al/work/repo/a.ts', { cwd: '/home/al/work/repo' }).text)
      .toBe('open file://<workspace>/a.ts');
  });

  it('treats a framework pre-truncated text as cut at its end', () => {
    const out = prepareLiveContentRedactor(context)('hello Zq9xLm2vPq8r', 2048, true);
    expect(out).toEqual({ text: 'hello [truncated]', truncated: true });
  });

  it('throws when the secrets getter throws, so the caller can drop the batch', () => {
    expect(() => prepareLiveContentRedactor({
      ...context,
      getSecrets: () => { throw new Error('settings unreadable'); },
    })).toThrow();
  });

  it('masks the value of a JSON pair whose name looks secret, keeping the name', () => {
    const pair = (name: string, value: string): string => cat('"', name, '": "', value, '"');
    const text = [
      pair(cat('session', '_tok', 'en'), 'plain-value-one'),
      pair(cat('db_pass', 'word'), 'with \\"escaped\\" quote'),
      pair(cat('x-', 'auth'), 'v3'),
      pair(cat('private', '_key'), 'v4'),
      pair(cat('api', '_key'), 'v5'),
      pair('cookieJar', 'v6'),
      pair('credentials', 'v7'),
      pair('name', 'kept-value'),
    ].join(', ');
    const out = redact(`{${text}}`).text;
    for (const value of ['plain-value-one', 'escaped', 'v3', 'v4', 'v5', 'v6', 'v7']) expect(out).not.toContain(value);
    expect(out).toContain(cat('"session', '_tok', 'en": "[redacted]"'));
    expect(out).toContain('"name": "kept-value"');
  });

  it('masks a secret header line whole, keeping the header name', () => {
    const text = [
      cat('Author', 'ization: Basic ', 'dXNlcjpwYXNz'),
      'Cookie: sid=abc; theme=dark',
      'set-cookie: sid=def; Path=/',
      cat('X-Upload-', 'Token: plain-header-value'),
      'Content-Type: text/plain',
      'The cookie: is not a header here',
    ].join('\r\n');
    const out = redact(text).text;
    expect(out).not.toMatch(/dXNlcjpwYXNz|sid=|plain-header-value/u);
    expect(out).toContain('Authorization: [redacted]');
    expect(out).toContain('Cookie: [redacted]');
    expect(out).toContain('set-cookie: [redacted]');
    expect(out).toContain(cat('X-Upload-', 'Token: [redacted]'));
    expect(out).toContain('Content-Type: text/plain');
    expect(out).toContain('The cookie: is not a header here');
  });

  it('stays fast on adversarial input for the JSON-pair and header patterns', () => {
    const cases = [
      `"${'token'.repeat(3300)}`,
      `"${'a'.repeat(120)}token${'b'.repeat(120)}" : "${'\\'.repeat(16400)}`,
      `${'"secret'.repeat(2400)}`,
      `x-${'-'.repeat(16400)}`,
      `${'"a":"'.repeat(3300)}`,
    ];
    for (const text of cases) {
      expect(Buffer.byteLength(text)).toBeGreaterThanOrEqual(16 * 1024);
      const started = performance.now();
      redact(text, {}, 16384);
      expect(performance.now() - started).toBeLessThan(200);
    }
  });
});
