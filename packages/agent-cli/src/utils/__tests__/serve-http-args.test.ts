import { describe, expect, it } from 'vitest';

import { parseCliArgs } from '../cli-args.js';
import { resolveMcpHttpOptions } from '../mcp-http-args.js';
import { resolveServeHttpOptions, SERVE_HTTP_TOKEN_MIN_LENGTH } from '../serve-http-args.js';

const TOKEN = 't'.repeat(SERVE_HTTP_TOKEN_MIN_LENGTH);
/** The running product's own alias prefix: the name an error must give, not the canonical one. */
const ENV_PREFIX = 'CEDAR_';

describe('--serve HTTP API flags', () => {
  it('is off unless --serve names a port', () => {
    expect(
      resolveServeHttpOptions(parseCliArgs(['--serve']), { PRODUCT_HTTP_TOKEN: TOKEN }, ENV_PREFIX),
    ).toBeUndefined();
  });

  it('serves the named loopback port with the bearer from the HTTP token variable', () => {
    expect(
      resolveServeHttpOptions(
        parseCliArgs(['--serve', '--http-port', '8787']),
        { PRODUCT_HTTP_TOKEN: TOKEN },
        ENV_PREFIX,
      ),
    ).toEqual({ port: 8787, token: TOKEN });
  });

  it('refuses to serve without a bearer, or with one too short to guess-proof', () => {
    const args = parseCliArgs(['--serve', '--http-port', '8787']);
    const missing =
      '--serve --http-port needs CEDAR_HTTP_TOKEN: the bearer every HTTP client presents';
    expect(() => resolveServeHttpOptions(args, {}, ENV_PREFIX)).toThrow(missing);
    expect(() => resolveServeHttpOptions(args, { PRODUCT_HTTP_TOKEN: '' }, ENV_PREFIX)).toThrow(
      missing,
    );
    expect(() =>
      resolveServeHttpOptions(args, { PRODUCT_HTTP_TOKEN: TOKEN.slice(1) }, ENV_PREFIX),
    ).toThrow(`CEDAR_HTTP_TOKEN must be at least ${SERVE_HTTP_TOKEN_MIN_LENGTH} characters`);
  });

  it('takes --http-port with --serve as its own flag, not as an mcp serve one', () => {
    expect(
      resolveMcpHttpOptions(parseCliArgs(['--serve', '--http-port', '8787']), false),
    ).toBeUndefined();
  });

  it('keeps the token file mcp serve only', () => {
    expect(() =>
      resolveMcpHttpOptions(
        parseCliArgs(['--serve', '--http-port', '8787', '--http-token-file', '/private/token']),
        false,
      ),
    ).toThrow(/only valid for mcp serve HTTP mode/);
  });

  it('leaves the bind address and remote settings of --serve to its own resolver', () => {
    expect(
      resolveMcpHttpOptions(parseCliArgs(['--serve', '--http-port', '8787', ...REMOTE]), false),
    ).toBeUndefined();
  });
});

const REMOTE = [
  '--http-public-url',
  'https://agents.example.test/agent',
  '--oauth-issuer',
  'https://auth.example.test',
  '--oauth-scopes',
  'agent.run',
  '--oauth-allowed-subjects',
  'client-a',
];

describe('--serve HTTP API as an OAuth resource server', () => {
  it('serves the remote settings on the named address, without a bearer', () => {
    expect(
      resolveServeHttpOptions(
        parseCliArgs([
          '--serve',
          '--http-port',
          '8787',
          '--http-host',
          '0.0.0.0',
          '--trusted-proxy',
          '10.0.0.1',
          ...REMOTE,
        ]),
        {},
        ENV_PREFIX,
      ),
    ).toEqual({
      port: 8787,
      remote: {
        host: '0.0.0.0',
        publicUrl: 'https://agents.example.test/agent',
        issuer: 'https://auth.example.test',
        scopes: ['agent.run'],
        allowedSubjects: ['client-a'],
        trustedProxies: ['10.0.0.1'],
      },
    });
  });

  it('binds loopback by default in remote mode', () => {
    expect(
      resolveServeHttpOptions(
        parseCliArgs(['--serve', '--http-port', '8787', ...REMOTE]),
        {},
        ENV_PREFIX,
      )?.remote?.host,
    ).toBe('127.0.0.1');
  });

  it('refuses a non-loopback bind without the remote settings', () => {
    expect(() =>
      resolveServeHttpOptions(
        parseCliArgs(['--serve', '--http-port', '8787', '--http-host', '0.0.0.0']),
        { PRODUCT_HTTP_TOKEN: TOKEN },
        ENV_PREFIX,
      ),
    ).toThrow(/non-loopback address only with --http-public-url/);
  });

  it('requires the remote settings together, as https URLs and literal addresses', () => {
    const run = (extra: string[]) => () =>
      resolveServeHttpOptions(
        parseCliArgs(['--serve', '--http-port', '8787', ...extra]),
        {},
        ENV_PREFIX,
      );
    expect(run(REMOTE.slice(0, 6))).toThrow(/requires --http-public-url.*together/);
    expect(run(['--http-public-url', 'http://a.test/agent', ...REMOTE.slice(2)])).toThrow(
      '--http-public-url must be an https URL',
    );
    expect(run([...REMOTE, '--http-host', 'example.test'])).toThrow(
      '--http-host must be a literal IP address',
    );
    expect(run([...REMOTE, '--trusted-proxy', 'proxy.test'])).toThrow(
      '--trusted-proxy must be a literal IP address',
    );
  });

  it('refuses the static bearer in remote mode', () => {
    expect(() =>
      resolveServeHttpOptions(
        parseCliArgs(['--serve', '--http-port', '8787', ...REMOTE]),
        { PRODUCT_HTTP_TOKEN: TOKEN },
        ENV_PREFIX,
      ),
    ).toThrow('CEDAR_HTTP_TOKEN is loopback-only and cannot be combined with remote authorization');
  });

  it('refuses the remote settings with --serve but no --http-port', () => {
    expect(() => resolveMcpHttpOptions(parseCliArgs(['--serve', ...REMOTE]), false)).toThrow(
      /with mcp serve or --serve --http-port/,
    );
  });

  it('keeps the remote settings refused outside --serve and mcp serve', () => {
    expect(() => resolveMcpHttpOptions(parseCliArgs(REMOTE), false)).toThrow(
      /with mcp serve or --serve --http-port/,
    );
  });
  it('refuses --http-port outside --serve and mcp serve', () => {
    expect(() => resolveMcpHttpOptions(parseCliArgs(['--http-port', '8787']), false)).toThrow(
      '--http-port is only valid with --serve or mcp serve HTTP mode',
    );
  });
});
