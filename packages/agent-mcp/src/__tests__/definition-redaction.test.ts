/**
 * Span-level redaction of what is printed: a command line and a URL stay readable, and every
 * stretch of them that is a credential — expanded from a credential-shaped variable, or a literal
 * with a credential's shape — is replaced. The shape guess is display-only: the fingerprint must
 * still see a changed literal token.
 *
 * Token fixtures are assembled at runtime so no credential-shaped literal sits in the source.
 */

import { describe, expect, it } from 'vitest';

import { materializeDefinition } from '../definition/env-template.js';
import { activationEndpoint, definitionFingerprint } from '../definition/identity.js';
import { projectEntry, REDACTED } from '../definition/projection.js';
import { looksLikeCredential, maskCredentials } from '../definition/secrecy.js';

import type { IMCPDefinitionProjection } from '../definition/projection.js';
import type { IMCPServerDefinition, IMCPServerDefinitionResolved } from '../definition/types.js';

const join = (...parts: string[]): string => parts.join('');
const mixed = (length: number): string =>
  Array.from({ length }, (_, i) => 'aB3xY7qZ9k'[i % 10]).join('');

const TOKENS: Readonly<Record<string, string>> = {
  openai: join('sk', '-proj-', mixed(24)),
  githubClassic: join('gh', 'p_', mixed(36)),
  githubOauth: join('gh', 'o_', mixed(36)),
  githubServer: join('gh', 's_', mixed(36)),
  githubFineGrained: join('github', '_pat_', mixed(40)),
  gitlab: join('gl', 'pat-', mixed(20)),
  slackBot: join('xo', 'xb-', '1234-5678-', mixed(12)),
  slackUser: join('xo', 'xp-', '1234-5678-', mixed(12)),
  aws: join('AK', 'IA', 'ABCDEFGHIJ234567'),
  google: join('AI', 'za', mixed(35)),
  jwt: join('ey', 'JhbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiIxIn0', '.', mixed(20)),
  highEntropy: mixed(40),
  upperHex: 'ABCDEF0123456789ABCDEF0123456789',
};

const stdio = (overrides: Partial<IMCPServerDefinition> = {}): IMCPServerDefinition => ({
  name: 'alpha',
  source: 'project',
  origin: '.mcp.json',
  transport: 'stdio',
  command: 'npx',
  ...overrides,
});

const http = (url: string): IMCPServerDefinition => ({
  name: 'beta',
  source: 'project',
  origin: '.mcp.json',
  transport: 'http',
  url,
});

const resolve = (
  definition: IMCPServerDefinition,
  env: Record<string, string> = {},
): IMCPServerDefinitionResolved => materializeDefinition(definition, env);

const project = (definition: IMCPServerDefinitionResolved): IMCPDefinitionProjection =>
  projectEntry({
    name: definition.name,
    source: definition.source,
    origin: definition.origin,
    status: 'resolved',
    definition,
    shadowed: [],
  });

describe('looksLikeCredential', () => {
  it.each(Object.entries(TOKENS))('%s is credential-shaped', (_label, token) => {
    expect(looksLikeCredential(token)).toBe(true);
  });

  it('treats a Bearer value as a credential', () => {
    expect(looksLikeCredential('Bearer abc123')).toBe(true);
  });

  it.each([
    ['a commit SHA', 'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3'],
    ['a sha256 digest', '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'],
    ['a package name', '@modelcontextprotocol/server-filesystem'],
    ['a long hyphenated name', 'my-very-long-mcp-server-name-for-testing'],
    ['a path', '/home/user/projects/some/deep/directory/structure'],
    ['a short flag value', '8080'],
  ])('%s is not', (_label, value) => {
    expect(looksLikeCredential(value)).toBe(false);
  });
});

describe('a projected command line', () => {
  it.each(Object.entries(TOKENS))('masks a literal %s argument', (_label, token) => {
    const projection = project(resolve(stdio({ args: ['-y', 'server', token] })));
    expect(projection.args).toEqual(['-y', 'server', 'secret:literal']);
    expect(JSON.stringify(projection)).not.toContain(token);
  });

  it('masks the value after a credential-named flag, split or joined', () => {
    const projection = project(
      resolve(
        stdio({
          args: ['--token', 'plain1', '--api-key=plain2', '--password', 'plain3', '--port', '80'],
        }),
      ),
    );
    expect(projection.args).toEqual([
      '--token',
      'secret:literal',
      '--api-key=secret:literal',
      '--password',
      'secret:literal',
      '--port',
      '80',
    ]);
  });

  it('leaves a single-letter flag and an ordinary argument readable', () => {
    const projection = project(
      resolve(stdio({ args: ['-p', '3000', '@modelcontextprotocol/server-filesystem', '/tmp'] })),
    );
    expect(projection.command).toBe('npx');
    expect(projection.args).toEqual([
      '-p',
      '3000',
      '@modelcontextprotocol/server-filesystem',
      '/tmp',
    ]);
  });

  it('keeps a commit SHA and a sha256 digest', () => {
    const sha = 'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3';
    const digest = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
    const projection = project(resolve(stdio({ args: ['--rev', sha, `sha256:${digest}`] })));
    expect(projection.args).toEqual(['--rev', sha, `sha256:${digest}`]);
  });

  it('names the variable a credential came from and keeps a plain one', () => {
    const projection = project(
      resolve(stdio({ args: ['--api-key', '${OPENAI_API_KEY}', '--port', '${PORT}'] }), {
        OPENAI_API_KEY: TOKENS.openai!,
        PORT: '8080',
      }),
    );
    expect(projection.args).toEqual(['--api-key', 'secret:OPENAI_API_KEY', '--port', '8080']);
  });

  it('masks a literal token in the command and the cwd', () => {
    const projection = project(
      resolve(stdio({ command: `/opt/${TOKENS.highEntropy}/bin`, cwd: `/work/${TOKENS.aws}` })),
    );
    expect(projection.command).toBe('/opt/secret:literal/bin');
    expect(projection.cwd).toBe('/work/secret:literal');
  });

  it('masks a Bearer value inside an argument', () => {
    const projection = project(
      resolve(stdio({ args: ['--header', 'Authorization: Bearer opaque-value'] })),
    );
    expect(projection.args).toEqual(['--header', 'Authorization: Bearer secret:literal']);
  });
});

describe('a projected url', () => {
  it('masks the userinfo password and keeps the user and host', () => {
    expect(project(resolve(http('https://admin:hunter2@db.example.com/mcp'))).url).toBe(
      'https://admin:secret:literal@db.example.com/mcp',
    );
  });

  it('masks a credential-named query parameter and keeps the others', () => {
    expect(project(resolve(http('https://h.example.com/mcp?api_key=abc&region=eu'))).url).toBe(
      'https://h.example.com/mcp?api_key=secret:literal&region=eu',
    );
  });

  it('keeps a variable marker in a credential-named parameter', () => {
    const definition = resolve(http('https://h.example.com/?token=${SERVICE_TOKEN}&x=1'), {
      SERVICE_TOKEN: 'tok-live-123',
    });
    expect(project(definition).url).toBe('https://h.example.com/?token=secret:SERVICE_TOKEN&x=1');
  });

  it('falls back to the shape detector for a value that is not a URL', () => {
    expect(maskCredentials(`not a url ${TOKENS.githubClassic}`)).toBe('not a url secret:literal');
  });
});

describe('env and header values', () => {
  it('stay fully redacted whatever their shape', () => {
    const projection = project(
      resolve({
        ...http('https://h.example.com/mcp'),
        headers: { 'X-Region': 'eu' },
        env: { LOG_LEVEL: 'debug' },
      }),
    );
    expect(projection.headers).toEqual({ 'X-Region': REDACTED });
    expect(projection.env).toEqual({ LOG_LEVEL: REDACTED });
  });
});

describe('the activation endpoint', () => {
  it('masks literal tokens in a command line', () => {
    const definition = resolve(stdio({ args: ['server', '--token', 'plain1', TOKENS.jwt!] }));
    expect(activationEndpoint(definition)).toBe('npx server --token secret:literal secret:literal');
  });

  it('masks a URL password and a credential-named query parameter', () => {
    expect(activationEndpoint(resolve(http('https://u:pw@h.example.com/?apikey=abc&v=2')))).toBe(
      'https://u:secret:literal@h.example.com/?apikey=secret:literal&v=2',
    );
  });

  it('is deterministic, so the transport can re-check it', () => {
    const definition = resolve(stdio({ args: ['--token', 'plain1', TOKENS.aws!] }));
    expect(activationEndpoint(definition)).toBe(activationEndpoint(definition));
  });
});

describe('the fingerprint does not use the shape detector', () => {
  it('changes when a literal token in args changes', () => {
    const one = resolve(stdio({ args: ['--token', 'first-literal', TOKENS.githubClassic!] }));
    const two = resolve(stdio({ args: ['--token', 'second-literal', TOKENS.githubClassic!] }));
    const three = resolve(stdio({ args: ['--token', 'first-literal', TOKENS.githubOauth!] }));
    expect(activationEndpoint(one)).toBe(activationEndpoint(two));
    expect(definitionFingerprint(one)).not.toBe(definitionFingerprint(two));
    expect(definitionFingerprint(one)).not.toBe(definitionFingerprint(three));
  });
});

describe('header-form, connection-string and fragment credentials', () => {
  it.each([
    ['X-API-Key: abc123def', 'X-API-Key: secret:literal'],
    ['X-API-Key:abc123def', 'X-API-Key:secret:literal'],
    ['Authorization: Basic dXNlcjpwYXNz', 'Authorization: Basic secret:literal'],
    ['Authorization: Token abc123', 'Authorization: Token secret:literal'],
    ['Authorization: opaque-without-scheme', 'Authorization: secret:literal'],
    [
      'Proxy-Authorization: Digest username="u", response="r"',
      'Proxy-Authorization: Digest secret:literal',
    ],
    ['X-Region: eu', 'X-Region: eu'],
  ])('shows %s as %s', (header, shown) => {
    expect(project(resolve(stdio({ args: ['--header', header] }))).args).toEqual([
      '--header',
      shown,
    ]);
  });

  it('masks a credential-named value inside a connection string', () => {
    expect(maskCredentials('Server=h;User Id=sa;Password=abc;')).toBe(
      'Server=h;User Id=sa;Password=secret:literal;',
    );
    expect(maskCredentials('host=h&password=abc&db=x')).toBe('host=h&password=secret:literal&db=x');
  });

  it('splits URL userinfo at the last @, so no piece of the password leaks', () => {
    const url = project(resolve(http('https://u:p@ss@host.example/x'))).url;
    expect(url).toBe('https://u:secret:literal@host.example/x');
    expect(url).not.toContain('ss@');
  });

  it('masks a credential-named fragment parameter', () => {
    expect(project(resolve(http('https://h.example/cb#access_token=abc&state=xyz'))).url).toBe(
      'https://h.example/cb#access_token=secret:literal&state=xyz',
    );
  });
});

describe('flags whose argument is not a credential', () => {
  it('keeps the argument of a negated flag', () => {
    expect(project(resolve(stdio({ args: ['--no-auth', '/srv/data'] }))).args).toEqual([
      '--no-auth',
      '/srv/data',
    ]);
  });

  it('keeps the path after a --*-file or --*-path flag', () => {
    const args = ['--key-file', '/etc/k.pem', '--password-file=/run/pw', '--token-path', '/t'];
    expect(project(resolve(stdio({ args }))).args).toEqual(args);
  });
});

describe('JSON, quoted and flag-embedded credentials', () => {
  const uuid = '8f2c1a4e-3b7d-4c9e-a1f0-5d6e7b8c9a0b';
  const args = (...values: string[]): readonly string[] | undefined =>
    project(resolve(stdio({ args: values }))).args;

  it('masks a UUID-valued apiKey in a --config JSON argument', () => {
    const shown = args('--config', `{"apiKey":"${uuid}","region":"eu"}`);
    expect(shown).toEqual(['--config', '{"apiKey":"secret:literal","region":"eu"}']);
    expect(JSON.stringify(shown)).not.toContain(uuid);
  });

  it.each([
    ['{"token":"abc"}', '{"token":"secret:literal"}'],
    ['--config={"password":"x"}', '--config={"password":"secret:literal"}'],
    ['{ "apiKey" : "a\\"b", "n": 1 }', '{ "apiKey" : "secret:literal", "n": 1 }'],
    ["{'token': 'abc'}", "{'token': 'secret:literal'}"],
    ['{"auth":{"token":"abc"},"x":1}', '{"auth":{secret:literal},"x":1}'],
    ['{"server":{"token":"abc"},"x":1}', '{"server":{"token":"secret:literal"},"x":1}'],
    ['{"env":{"apiKey":"abc"}}', '{"env":{"apiKey":"secret:literal"}}'],
    ['{"password":12345,"port":8080}', '{"password":secret:literal,"port":8080}'],
    ['{"name":"alpha","port":8080}', '{"name":"alpha","port":8080}'],
  ])('shows %s as %s', (value, shown) => {
    expect(maskCredentials(value)).toBe(shown);
    expect(args(value)).toEqual([shown]);
  });

  it.each([
    ['--header=X-API-Key: abc', '--header=X-API-Key: secret:literal'],
    ['--header=Authorization: Token abc', '--header=Authorization: Token secret:literal'],
    ['Authorization=Basic abc', 'Authorization=Basic secret:literal'],
    ['Password = hunter2', 'Password = secret:literal'],
    ['Server=h;Password="hunter 2";Db=x', 'Server=h;Password="secret:literal";Db=x'],
    ['-H "X-API-Key: abc" https://h.example', '-H "X-API-Key: secret:literal" https://h.example'],
  ])('shows %s as %s', (value, shown) => {
    expect(maskCredentials(value)).toBe(shown);
  });

  it('does not take a literal secret: prefix as a variable marker', () => {
    expect(JSON.stringify(args('--password', 'secret:hunter2'))).not.toContain('hunter2');
    expect(maskCredentials('--password secret:hunter2')).not.toContain('hunter2');
    expect(args('run secret:hunter2')?.join(' ')).not.toContain('hunter2');
  });
});

describe('object, array and oddly delimited credential values', () => {
  const uuid = '8f2c1a4e-3b7d-4c9e-a1f0-5d6e7b8c9a0b';

  it.each([
    [`{"apiKey":["${uuid}"]}`, '{"apiKey":[secret:literal]}'],
    ['--config={"secret":["hunter2"]}', '--config={"secret":[secret:literal]}'],
    ['{"password":{"value":"hunter2"}}', '{"password":{secret:literal}}'],
    ['{"apiKey":{"$value":"abc"},"region":"eu"}', '{"apiKey":{secret:literal},"region":"eu"}'],
    ['{"token":{"a":["x]","y}"]},"n":1}', '{"token":{secret:literal},"n":1}'],
    ['token=[abc] next', 'token=[secret:literal] next'],
    ['token={abc}', 'token={secret:literal}'],
    ['{"token":["abc", ["def"', '{"token":[secret:literal'],
    ['token=[abc\ndef', 'token=[secret:literal'],
    ['env:PASSWORD=abc', 'env:PASSWORD=secret:literal'],
    ['`token`: abc', '`token`: secret:literal'],
    ["token='abc\ndef' next", "token='secret:literal' next"],
    ['token = = abc', 'token = = secret:literal'],
    ['{"auth":[],"x":1}', '{"auth":[],"x":1}'],
  ])('shows %j as %j', (value, shown) => {
    expect(maskCredentials(value)).toBe(shown);
  });

  it('prints no scalar of a credential-named array in a projected argument', () => {
    const shown = project(resolve(stdio({ args: ['--config', `{"apiKey":["${uuid}"]}`] }))).args;
    expect(JSON.stringify(shown)).not.toContain(uuid);
  });
});

describe('JSON escaped inside a JSON string', () => {
  const uuid = '8f2c1a4e-3b7d-4c9e-a1f0-5d6e7b8c9a0b';

  it('masks the apiKey of a double-encoded config argument', () => {
    const arg = String.raw`"{\"apiKey\":\"${uuid}\"}"`;
    const shown = project(resolve(stdio({ args: ['--config', arg] }))).args;
    expect(shown).toEqual(['--config', String.raw`"{\"apiKey\":\"secret:literal\"}"`]);
    expect(JSON.stringify(shown)).not.toContain(uuid);
  });

  it.each([
    [String.raw`{\"password\":\"hunter2\"}`, String.raw`{\"password\":\"secret:literal\"}`],
    [
      String.raw`{\"password\":\"hun\\\"ter2\",\"region\":\"eu\"}`,
      String.raw`{\"password\":\"secret:literal\",\"region\":\"eu\"}`,
    ],
    [
      String.raw`{\\\"apiKey\\\":\\\"abc\\\",\\\"n\\\":1}`,
      String.raw`{\\\"apiKey\\\":\\\"secret:literal\\\",\\\"n\\\":1}`,
    ],
    [
      String.raw`{\"apiKey\":[\"abc\",\"x]\"],\"region\":\"eu\"}`,
      String.raw`{\"apiKey\":[secret:literal],\"region\":\"eu\"}`,
    ],
    [
      String.raw`{\"auth\":{\"value\":\"abc\"},\"n\":1}`,
      String.raw`{\"auth\":{secret:literal},\"n\":1}`,
    ],
    [String.raw`{\"password\":\"unclosed`, String.raw`{\"password\":\"secret:literal`],
    [String.raw`{\"name\":\"alpha\"}`, String.raw`{\"name\":\"alpha\"}`],
  ])('shows %s as %s', (value, shown) => {
    expect(maskCredentials(value)).toBe(shown);
  });
});

describe('masking stays linear on long input', () => {
  const huge = 200_000;
  // A super-linear pattern takes tens of seconds on this input; a linear pass takes well under
  // a second even on a loaded CI runner. The bound sits between the two, far from both.
  const boundMs = 2_000;
  it.each([
    ['a scheme-character run', 'a'.repeat(huge)],
    ['a URL', `https://${'a'.repeat(huge)}`],
    ['a URL with a long query', `https://h/?${'k=v&'.repeat(huge / 8)}`],
    ['spaced words', 'ab '.repeat(huge / 3)],
    ['a header name before a space run', `${'a'.repeat(huge)}${' '.repeat(huge)}`],
    ['an encoded run followed by padding', `${'aB3'.repeat(huge / 3)}===x`],
    ['a dotted token', `eyJ${'a.'.repeat(huge / 2)}`],
    ['repeated flags', '--token '.repeat(huge / 8)],
    ['repeated JSON names', '{"a":'.repeat(huge / 5)],
    ['repeated quoted names', '"a" '.repeat(huge / 4)],
    ['an unclosed credential string', `{"token":"${'\\"'.repeat(huge / 2)}`],
    ['repeated credential assignments', 'password= '.repeat(huge / 10)],
    ['repeated empty headers', 'X-Api-Key: \n'.repeat(huge / 12)],
    ['a long name before a separator run', `${'a'.repeat(huge)}${'='.repeat(huge)}`],
    ['a deeply nested credential value', `{"token":${'['.repeat(huge)}`],
    ['repeated unbalanced credential arrays', '{"token":['.repeat(huge / 10)],
    ['a credential array of unclosed strings', `token=[${'"a\\'.repeat(huge / 3)}`],
    ['deep nesting under a plain name', `{"a":${'[{'.repeat(huge / 2)}`],
    ['a spaced separator run', `token${' ='.repeat(huge / 2)}`],
    ['repeated backtick names', '`a`: '.repeat(huge / 5)],
    ['a long backslash run', `{${'\\'.repeat(huge)}"token":1`],
    ['repeated escaped credential names', String.raw`{\"token\":\"a`.repeat(huge / 14)],
    [
      'an escaped credential value of backslash runs',
      `{\\"token\\":\\"${'\\\\\\x'.repeat(huge / 4)}`,
    ],
    ['an escaped credential array of backslash runs', `{\\"token\\":[${'\\'.repeat(huge)}`],
  ])('masks %s within the time bound', (_label, value) => {
    const definition = resolve(stdio({ args: [value] }));
    const started = performance.now();
    activationEndpoint(definition);
    expect(performance.now() - started).toBeLessThan(boundMs);
  });
});
