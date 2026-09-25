/**
 * The product side of MCP OAuth: `robota mcp login` finds the server a session would connect to,
 * runs the sign-in without a real browser, and keeps the credential owner-only under the user's
 * Robota home; a session then sends it, and never connects an OAuth server without it.
 */

import { request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { browserCommand, openInBrowser } from '../browser-opener.js';
import { runMcpLoginCommand } from '../mcp-login-command.js';
import { formatMcpOAuthNotice, mcpCredentialDirectory } from '../mcp-oauth-host.js';
import { createRobotaUserSettingsSources } from '../../product/robota-user-settings.js';

const MCP_URL = 'https://mcp.example.test/mcp';
const AS_URL = 'https://auth.example.test/';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A temporary HOME holding a user settings file with these servers. */
function home(servers: Record<string, unknown>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'robota-mcp-oauth-home-')));
  roots.push(root);
  mkdirSync(join(root, '.robota'), { recursive: true });
  writeFileSync(join(root, '.robota', 'settings.json'), JSON.stringify({ mcpServers: servers }));
  return root;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Just enough authorization server for one sign-in; the "browser" approves and follows. */
function fakeAuthorizationServer() {
  const codes = new Map<string, string>();
  const fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body === undefined || init.body === null ? '' : String(init.body);
    if (url.href === 'https://mcp.example.test/.well-known/oauth-protected-resource/mcp') {
      return json({ resource: MCP_URL, authorization_servers: [AS_URL] });
    }
    if (url.href === 'https://auth.example.test/.well-known/oauth-authorization-server') {
      return json({
        issuer: AS_URL,
        authorization_endpoint: 'https://auth.example.test/authorize',
        token_endpoint: 'https://auth.example.test/token',
        registration_endpoint: 'https://auth.example.test/register',
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
      });
    }
    if (url.href === 'https://auth.example.test/register') {
      return json({ ...JSON.parse(body), client_id: 'dynamic-client' }, 201);
    }
    if (url.href === 'https://auth.example.test/token') {
      const form = new URLSearchParams(body);
      const challenge = codes.get(form.get('code') ?? '');
      const verified =
        challenge !== undefined &&
        createHash('sha256')
          .update(form.get('code_verifier') ?? '')
          .digest('base64url') === challenge;
      if (!verified) return json({ error: 'invalid_grant' }, 400);
      return json({
        access_token: 'access-token-value',
        refresh_token: 'refresh-token-value',
        token_type: 'Bearer',
        expires_in: 3600,
      });
    }
    return json({}, 404);
  }) as typeof globalThis.fetch;
  const browse = async (authorization: URL): Promise<void> => {
    codes.set('the-code', authorization.searchParams.get('code_challenge') ?? '');
    const redirect = new URL(authorization.searchParams.get('redirect_uri') ?? '');
    redirect.searchParams.set('code', 'the-code');
    redirect.searchParams.set('state', authorization.searchParams.get('state') ?? '');
    const request = httpRequest(redirect, (response) => response.resume());
    request.on('error', () => undefined);
    request.end();
  };
  return { fetch, lookup: async () => ['203.0.113.10'], browse };
}

async function login(
  args: readonly string[],
  userHome: string,
  extra: { promptSecret?: () => Promise<string> } = {},
) {
  const server = fakeAuthorizationServer();
  const out: string[] = [];
  const err: string[] = [];
  const opened: URL[] = [];
  const code = await runMcpLoginCommand(args, {
    settingsSources: createRobotaUserSettingsSources(userHome),
    env: { HOME: userHome },
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    openBrowser: async (url) => {
      opened.push(url);
      await server.browse(url);
    },
    network: { fetch: server.fetch, lookup: server.lookup },
    credentialDirectory: mcpCredentialDirectory(userHome),
    callbackTimeoutMs: 5_000,
    ...(extra.promptSecret === undefined ? {} : { promptSecret: extra.promptSecret }),
  });
  return { code, out: out.join(''), err: err.join(''), opened };
}

describe('robota mcp login', () => {
  it('signs in and stores the credential owner-only under ~/.robota/mcp-credentials', async () => {
    const userHome = home({ files: { type: 'http', url: MCP_URL, oauth: {} } });
    const result = await login(['files'], userHome);
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(result.out).toContain('Signed in to MCP server "files"');
    expect(result.opened[0]?.protocol).toBe('https:');
    const directory = join(userHome, '.robota', 'mcp-credentials');
    const files = readdirSync(directory).filter((name) => name.endsWith('.json'));
    expect(files).toHaveLength(1);
    if (process.platform !== 'win32') {
      expect(statSync(directory).mode & 0o777).toBe(0o700);
      expect(statSync(join(directory, files[0]!)).mode & 0o777).toBe(0o600);
    }
    // Nothing a sign-in obtained is printed.
    expect(`${result.out}${result.err}`).not.toMatch(
      /access-token-value|refresh-token-value|the-code/,
    );
  });

  it('refuses a server that does not declare oauth, an unknown one, and a bad invocation', async () => {
    const userHome = home({ plain: { type: 'http', url: MCP_URL } });
    expect((await login(['plain'], userHome)).err).toContain('does not declare `oauth`');
    expect((await login(['missing'], userHome)).err).toContain('No MCP server named "missing"');
    expect((await login([], userHome)).err).toContain('Usage: robota mcp login');
    expect((await login(['a', 'b'], userHome)).code).toBe(1);
  });

  it('asks for a client secret only for a pre-registered client, and never echoes it', async () => {
    const dynamic = home({ files: { type: 'http', url: MCP_URL, oauth: {} } });
    let asked = 0;
    const refused = await login(['files', '--client-secret'], dynamic, {
      promptSecret: async () => {
        asked += 1;
        return 'client-secret-value';
      },
    });
    expect(refused.code).toBe(1);
    expect(asked).toBe(0);
    expect(refused.err).toContain('oauth.clientId');

    const port = 40_000 + Math.floor(Math.random() * 20_000);
    const registered = home({
      files: { type: 'http', url: MCP_URL, oauth: { clientId: 'robota', callbackPort: port } },
    });
    const result = await login(['files', '--client-secret'], registered, {
      promptSecret: async () => 'client-secret-value',
    });
    expect(result.code).toBe(0);
    expect(`${result.out}${result.err}`).not.toContain('client-secret-value');
  });

  it('reports a failed sign-in by reason only', async () => {
    const userHome = home({
      files: { type: 'http', url: 'https://mcp.example.test/other', oauth: {} },
    });
    const result = await login(['files'], userHome);
    expect(result.code).toBe(1);
    expect(result.err).toBe('Sign-in to MCP server "files" failed (discovery-failed).\n');
  });
});

describe('MCP OAuth notices and browser', () => {
  it('tells the user how to sign in, and which scope is missing', () => {
    expect(formatMcpOAuthNotice({ kind: 'login-required', serverId: 'files' })).toContain(
      'run robota mcp login files',
    );
    expect(
      formatMcpOAuthNotice({ kind: 'insufficient-scope', serverId: 'files', scope: 'files:write' }),
    ).toContain('"files:write"');
  });

  it('opens only https URLs, by argv, with each platform opener', async () => {
    const url = new URL('https://auth.example.test/authorize?a=1&b=2');
    expect(browserCommand(url, 'darwin')).toEqual({ command: 'open', args: [url.href] });
    expect(browserCommand(url, 'linux')).toEqual({ command: 'xdg-open', args: [url.href] });
    expect(browserCommand(url, 'win32')).toEqual({
      command: 'rundll32',
      args: ['url.dll,FileProtocolHandler', url.href],
    });
    expect(() => browserCommand(new URL('http://auth.example.test/'), 'linux')).toThrow();
    expect(() => browserCommand(new URL('file:///etc/passwd'), 'linux')).toThrow();
    const calls: [string, readonly string[]][] = [];
    await openInBrowser(url, {
      platform: 'linux',
      execFile: (command, args, callback) => {
        calls.push([command, args]);
        callback(null);
      },
    });
    expect(calls).toEqual([['xdg-open', [url.href]]]);
  });
});
