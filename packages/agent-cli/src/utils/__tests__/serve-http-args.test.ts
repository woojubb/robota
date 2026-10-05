import { describe, expect, it } from 'vitest';

import { parseCliArgs } from '../cli-args.js';
import { resolveMcpHttpOptions } from '../mcp-http-args.js';
import { resolveServeHttpOptions, SERVE_HTTP_TOKEN_MIN_LENGTH } from '../serve-http-args.js';

const TOKEN = 't'.repeat(SERVE_HTTP_TOKEN_MIN_LENGTH);

describe('--serve HTTP API flags', () => {
  it('is off unless --serve names a port', () => {
    expect(
      resolveServeHttpOptions(parseCliArgs(['--serve']), { PRODUCT_HTTP_TOKEN: TOKEN }),
    ).toBeUndefined();
  });

  it('serves the named loopback port with the bearer from PRODUCT_HTTP_TOKEN', () => {
    expect(
      resolveServeHttpOptions(parseCliArgs(['--serve', '--http-port', '8787']), {
        PRODUCT_HTTP_TOKEN: TOKEN,
      }),
    ).toEqual({ port: 8787, token: TOKEN });
  });

  it('refuses to serve without a bearer, or with one too short to guess-proof', () => {
    const args = parseCliArgs(['--serve', '--http-port', '8787']);
    expect(() => resolveServeHttpOptions(args, {})).toThrow(/PRODUCT_HTTP_TOKEN/);
    expect(() => resolveServeHttpOptions(args, { PRODUCT_HTTP_TOKEN: '' })).toThrow(
      /PRODUCT_HTTP_TOKEN/,
    );
    expect(() => resolveServeHttpOptions(args, { PRODUCT_HTTP_TOKEN: TOKEN.slice(1) })).toThrow(
      new RegExp(`at least ${SERVE_HTTP_TOKEN_MIN_LENGTH} characters`),
    );
  });

  it('takes --http-port with --serve as its own flag, not as an mcp serve one', () => {
    expect(
      resolveMcpHttpOptions(parseCliArgs(['--serve', '--http-port', '8787']), false),
    ).toBeUndefined();
  });

  it('keeps the bind address, token file and remote settings mcp serve only', () => {
    expect(() =>
      resolveMcpHttpOptions(
        parseCliArgs(['--serve', '--http-port', '8787', '--http-host', '0.0.0.0']),
        false,
      ),
    ).toThrow(/only valid for mcp serve/);
    expect(() =>
      resolveMcpHttpOptions(
        parseCliArgs(['--serve', '--http-port', '8787', '--http-token-file', '/private/token']),
        false,
      ),
    ).toThrow(/only valid for mcp serve HTTP mode/);
  });

  it('refuses --http-port outside --serve and mcp serve', () => {
    expect(() => resolveMcpHttpOptions(parseCliArgs(['--http-port', '8787']), false)).toThrow(
      '--http-port is only valid with --serve or mcp serve HTTP mode',
    );
  });
});
