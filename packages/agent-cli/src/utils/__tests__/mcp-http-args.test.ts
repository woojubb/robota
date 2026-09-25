import { describe, expect, it } from 'vitest';

import { parseCliArgs } from '../cli-args.js';
import { resolveMcpHttpOptions } from '../mcp-http-args.js';

const REMOTE = [
  '--http-public-url',
  'https://agents.example.test/robota/mcp',
  '--oauth-issuer',
  'https://auth.example.test',
  '--oauth-scopes',
  'mcp:use, mcp:admin',
  '--oauth-allowed-subjects',
  'alice,bob',
];

function resolve(argv: string[], mcpServe = true) {
  const args = parseCliArgs(mcpServe ? ['mcp', 'serve', ...argv] : argv);
  return resolveMcpHttpOptions(args, mcpServe);
}

describe('robota mcp serve HTTP flags', () => {
  it('keeps stdio and the loopback token file exactly as before', () => {
    expect(resolve([])).toBeUndefined();
    expect(resolve(['--http-token-file', '/private/token', '--http-port', '8765'])).toEqual({
      tokenFile: '/private/token',
      port: 8765,
    });
    expect(() => resolve(['--http-port', '8765'])).toThrow(
      '--http-token-file and --http-port are only valid for robota mcp serve HTTP mode',
    );
    expect(() => resolve(['--http-token-file', '/private/token'], false)).toThrow(
      '--http-token-file and --http-port are only valid for robota mcp serve HTTP mode',
    );
  });

  it('refuses a non-loopback bind without the remote authorization settings', () => {
    expect(() =>
      resolve(['--http-host', '0.0.0.0', '--http-token-file', '/private/token']),
    ).toThrow(/non-loopback address only with --http-public-url/);
    expect(() => resolve(['--http-host', '192.0.2.10'])).toThrow(/non-loopback/);
  });

  it('refuses the loopback token file together with remote authorization', () => {
    expect(() =>
      resolve([...REMOTE, '--http-host', '0.0.0.0', '--http-token-file', '/private/token']),
    ).toThrow(/loopback-only/);
  });

  it('requires every remote setting and an https public URL', () => {
    expect(() =>
      resolve(['--http-host', '0.0.0.0', '--oauth-issuer', 'https://auth.example.test']),
    ).toThrow(
      /requires --http-public-url, --oauth-issuer, --oauth-scopes and --oauth-allowed-subjects/,
    );
    const plain = [...REMOTE];
    plain[1] = 'http://agents.example.test/robota/mcp';
    expect(() => resolve(plain)).toThrow('--http-public-url must be an https URL');
    expect(() => resolve([...REMOTE, '--trusted-proxy', 'proxy.internal'])).toThrow(
      /--trusted-proxy must be a literal IP/,
    );
  });

  it('resolves a remote bind with its public URL, issuer, scopes, subjects and proxies', () => {
    expect(
      resolve([
        ...REMOTE,
        '--http-host',
        '0.0.0.0',
        '--http-port',
        '8443',
        '--trusted-proxy',
        '10.0.0.2',
        '--trusted-proxy',
        '10.0.0.3',
      ]),
    ).toEqual({
      port: 8443,
      remote: {
        host: '0.0.0.0',
        publicUrl: 'https://agents.example.test/robota/mcp',
        issuer: 'https://auth.example.test',
        scopes: ['mcp:use', 'mcp:admin'],
        allowedSubjects: ['alice', 'bob'],
        trustedProxies: ['10.0.0.2', '10.0.0.3'],
      },
    });
    expect(resolve(REMOTE)?.remote?.host).toBe('127.0.0.1');
  });

  it('refuses remote flags outside robota mcp serve', () => {
    expect(() => resolve(REMOTE, false)).toThrow(/only valid for robota mcp serve/);
  });
});
