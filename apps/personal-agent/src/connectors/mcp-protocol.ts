/**
 * The Model Context Protocol as a connector protocol: the personal pack's port, implemented with
 * `@robota-sdk/agent-mcp` on this machine.
 *
 * - Credentials are the OAuth tokens that package's sign-in obtains, kept in owner-only files under
 *   the state directory (never in the configuration), refreshed once per credential across
 *   processes, and deleted before a revocation is asked for.
 * - The person signs in in their own browser: `signIn` returns the authorization address and the
 *   sign-in finishes when that browser returns through the consent broker.
 * - Every request goes through the shared egress policy, which refuses loopback, private and
 *   metadata destinations unless the owner named a host.
 * - A connection is opened when first used and kept while the connector is connected.
 */
import { join } from 'node:path';

import {
  MCPConnectionSupervisor,
  MCPOAuthError,
  createOAuthAuthenticator,
  createStreamableHttpAdapter,
  oauthCredentialKey,
  openMcpSession,
  readMCPOAuthCredentialState,
  runMCPOAuthLogin,
  runMCPOAuthLogout,
} from '@robota-sdk/agent-mcp';
import {
  createFileOAuthCredentialStore,
  createFileOAuthRefreshLock,
  createNodeHttpEgress,
  createNodeOAuthNetwork,
} from '@robota-sdk/agent-mcp/node';

import type {
  IMCPDiscoveredTool,
  IMCPOAuthAuthenticator,
  IMCPOAuthConfig,
  IMCPTimeouts,
} from '@robota-sdk/agent-mcp';
import type { TEgressLookup } from '@robota-sdk/agent-core/node';
import type { TToolParameters } from '@robota-sdk/agent-core';
import type {
  IConnector,
  IConnectorCallResult,
  IConnectorProtocol,
  IConnectorStatus,
  IConnectorToolInfo,
  IDisconnectOutcome,
  TRevocation,
} from '@robota-sdk/agent-product/personal';
import type { IConsentBroker } from './consent.js';

export interface IMcpConnectorProtocolOptions {
  readonly stateDir: string;
  readonly broker: IConsentBroker;
  /** Exact hostnames that may be reached although they are loopback or private; the owner names them. */
  readonly allowedHosts?: readonly string[];
  /** Owner or test carrier and resolver: every request is still judged against the policy first. */
  readonly fetch?: typeof globalThis.fetch;
  readonly lookup?: TEgressLookup;
  readonly timeouts?: Partial<IMCPTimeouts>;
}

const DIRECTORY = 'connector-credentials';
const CLIENT_NAME = 'Robota personal agent';
const CLIENT_VERSION = '0.1.0';
const RESULT_BLOCK_LIMIT = 24_000;
/** Scope words as RFC 6749 allows them, space separated; anything else is the service's text and is not shown. */
const SCOPE_WORDS = /^[\x21\x23-\x5b\x5d-\x7e]+(?: [\x21\x23-\x5b\x5d-\x7e]+)*$/;
const MAX_SCOPE_LENGTH = 512;

const DEFAULT_TIMEOUTS: IMCPTimeouts = {
  startupMs: 15_000,
  perCallMs: 30_000,
  globalDefaultMs: 60_000,
  idleMs: 5 * 60_000,
  toolCallMs: 60_000,
};

interface IRuntime {
  readonly authenticator: IMCPOAuthAuthenticator;
  supervisor?: MCPConnectionSupervisor;
  signIn?: {
    readonly abort: AbortController;
    readonly announced: Promise<IConnectorStatus>;
    status: IConnectorStatus;
  };
  /** Why the last sign-in failed, as a fixed word, until the next one starts. */
  failure?: string;
  /** A request was refused for want of a sign-in. */
  needsSignIn: boolean;
}

function oauthConfig(connector: IConnector): IMCPOAuthConfig {
  return {
    ...(connector.oauth?.clientId !== undefined && { clientId: connector.oauth.clientId }),
    ...(connector.oauth?.scopes !== undefined && { scopes: connector.oauth.scopes }),
    ...(connector.oauth?.authorizationParams !== undefined && {
      authorizationParams: connector.oauth.authorizationParams,
    }),
  };
}

function mapTool(tool: IMCPDiscoveredTool): IConnectorToolInfo {
  const hints = tool.annotations;
  return {
    name: tool.name,
    ...(tool.description !== undefined && { description: tool.description }),
    inputSchema: tool.inputSchema as unknown as Record<string, unknown>,
    ...(hints !== undefined && {
      hints: {
        ...(hints.readOnlyHint !== undefined && { readOnly: hints.readOnlyHint }),
        ...(hints.destructiveHint !== undefined && { destructive: hints.destructiveHint }),
        ...(hints.idempotentHint !== undefined && { idempotent: hints.idempotentHint }),
        ...(hints.openWorldHint !== undefined && { openWorld: hints.openWorldHint }),
      },
    }),
  };
}

/** What a call returned, as text: the words, and a note for anything that is not words. */
function renderContent(content: readonly unknown[], structured: unknown): string {
  const parts: string[] = [];
  for (const block of content) {
    const record =
      typeof block === 'object' && block !== null ? (block as Record<string, unknown>) : {};
    if (record['type'] === 'text' && typeof record['text'] === 'string') parts.push(record['text']);
    else if (record['type'] === 'resource_link' && typeof record['uri'] === 'string')
      parts.push(`[link: ${record['uri']}]`);
    else parts.push(`[${typeof record['type'] === 'string' ? record['type'] : 'content'} omitted]`);
  }
  if (parts.length === 0 && structured !== undefined) parts.push(JSON.stringify(structured));
  const text = parts.join('\n');
  return text.length > RESULT_BLOCK_LIMIT ? text.slice(0, RESULT_BLOCK_LIMIT) : text;
}

const REVOCATION: Readonly<Record<string, TRevocation>> = {
  revoked: 'revoked',
  partial: 'partial',
  unsupported: 'unsupported',
  failed: 'failed',
  'not-attempted': 'not-attempted',
};

export function createMcpConnectorProtocol(
  options: IMcpConnectorProtocolOptions,
): IConnectorProtocol {
  const directory = join(options.stateDir, DIRECTORY);
  const store = createFileOAuthCredentialStore(directory);
  const lock = createFileOAuthRefreshLock(directory);
  const policy =
    options.allowedHosts === undefined ? undefined : { allowedHosts: options.allowedHosts };
  const carrier = {
    ...(policy !== undefined && { policy }),
    ...(options.fetch !== undefined && { fetch: options.fetch }),
    ...(options.lookup !== undefined && { lookup: options.lookup }),
  };
  const network = createNodeOAuthNetwork(carrier);
  const egress = createNodeHttpEgress(carrier);
  const timeouts: IMCPTimeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };
  const runtimes = new Map<string, IRuntime>();

  const identity = (connector: IConnector): string => `personal-connector:${connector.id}`;

  const runtimeOf = (connector: IConnector): IRuntime => {
    const existing = runtimes.get(connector.id);
    if (existing !== undefined) return existing;
    const runtime: IRuntime = {
      needsSignIn: false,
      authenticator: createOAuthAuthenticator({
        serverId: connector.id,
        securityIdentity: identity(connector),
        serverUrl: connector.endpoint,
        config: oauthConfig(connector),
        store,
        lock,
        network,
        notify: (notice) => {
          if (notice.kind === 'login-required') runtime.needsSignIn = true;
        },
      }),
    };
    runtimes.set(connector.id, runtime);
    return runtime;
  };

  const stopConnection = async (runtime: IRuntime): Promise<void> => {
    const supervisor = runtime.supervisor;
    runtime.supervisor = undefined;
    await supervisor?.shutdown().catch(() => undefined);
  };

  const connectionOf = async (connector: IConnector): Promise<MCPConnectionSupervisor> => {
    const runtime = runtimeOf(connector);
    if (runtime.supervisor !== undefined) return runtime.supervisor;
    const adapter = createStreamableHttpAdapter({ egress });
    const admission = await adapter.admit({
      url: connector.endpoint,
      authenticationRequired: true,
      authentication: {
        serverId: connector.id,
        securityIdentity: identity(connector),
        authenticator: runtime.authenticator,
      },
    });
    if (!admission.ok) throw new Error(`The endpoint was refused (${admission.reason})`);
    const supervisor = new MCPConnectionSupervisor({
      serverId: connector.id,
      openSession: (signal) =>
        openMcpSession({
          serverId: connector.id,
          transport: adapter.construct(admission.admitted),
          clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
          timeouts: { startupMs: timeouts.startupMs, perCallMs: timeouts.perCallMs },
          signal,
        }),
      timeouts,
    });
    runtime.supervisor = supervisor;
    return supervisor;
  };

  /** The scopes the service says it granted, kept only when they are plain scope words. */
  const grantedScope = async (connector: IConnector): Promise<string | undefined> => {
    try {
      const credential = await store.get(
        oauthCredentialKey(identity(connector), connector.endpoint),
      );
      const scope = credential?.scope;
      return scope !== undefined && scope.length <= MAX_SCOPE_LENGTH && SCOPE_WORDS.test(scope)
        ? scope
        : undefined;
    } catch {
      // allow-fallback: an unreadable credential file shows no scope; the state itself says what is wrong.
      return undefined;
    }
  };

  return {
    id: 'mcp',

    async status(connector): Promise<IConnectorStatus> {
      const runtime = runtimes.get(connector.id);
      // A sign-in under way is what the person has to act on, even for a connector that is connected.
      if (runtime?.signIn !== undefined) return runtime.signIn.status;
      const stored = await readMCPOAuthCredentialState({
        securityIdentity: identity(connector),
        serverUrl: connector.endpoint,
        store,
      });
      // A sign-in that failed or was abandoned leaves a working credential working.
      if (stored === 'signed-in' || stored === 'expired-refreshable') {
        const scope = await grantedScope(connector);
        return { state: 'connected', ...(scope !== undefined && { scope }) };
      }
      if (runtime?.failure !== undefined) return { state: 'failed', reason: runtime.failure };
      if (stored === 'sign-in-required' || runtime?.needsSignIn === true) {
        return { state: 'needs-sign-in' };
      }
      return { state: 'not-connected' };
    },

    async signIn(connector, context): Promise<IConnectorStatus> {
      const runtime = runtimeOf(connector);
      if (runtime.signIn !== undefined) return runtime.signIn.announced;
      runtime.failure = undefined;
      const abort = new AbortController();
      let announce!: (status: IConnectorStatus) => void;
      const announced = new Promise<IConnectorStatus>((resolve) => {
        announce = resolve;
      });
      const attempt = { abort, announced, status: { state: 'connecting' } as IConnectorStatus };
      runtime.signIn = attempt;
      runMCPOAuthLogin({
        clientName: CLIENT_NAME,
        securityIdentity: identity(connector),
        serverUrl: connector.endpoint,
        config: oauthConfig(connector),
        store,
        lock,
        network,
        callbackListener: options.broker.listenerFor(context.origin),
        // Held for this sign-in only; the login keeps it with the owner-only credential.
        ...(context.clientSecret !== undefined && { clientSecret: context.clientSecret }),
        signal: abort.signal,
        // The person's own browser opens this address; nothing on this machine does.
        openBrowser: async (url, redirectUri) => {
          attempt.status = {
            state: 'connecting',
            authorizationUrl: url.href,
            redirectUri,
          };
          announce(attempt.status);
        },
      }).then(
        async () => {
          runtime.signIn = undefined;
          runtime.needsSignIn = false;
          runtime.authenticator.forget();
          await stopConnection(runtime);
          announce({ state: 'connected' });
        },
        (error: unknown) => {
          // A sign-in the person cut short (disconnect, removal) is not a failure to report.
          if (abort.signal.aborted) {
            announce({ state: 'not-connected' });
            return;
          }
          runtime.signIn = undefined;
          runtime.failure = error instanceof MCPOAuthError ? error.reason : 'sign-in-failed';
          announce({ state: 'failed', reason: runtime.failure });
        },
      );
      return announced;
    },

    async signOut(connector): Promise<IDisconnectOutcome> {
      const runtime = runtimeOf(connector);
      runtime.signIn?.abort.abort();
      runtime.signIn = undefined;
      runtime.failure = undefined;
      runtime.needsSignIn = false;
      await stopConnection(runtime);
      // The credential is deleted first inside the logout; the revocation is asked for afterwards.
      const result = await runMCPOAuthLogout({
        securityIdentity: identity(connector),
        serverUrl: connector.endpoint,
        store,
        lock,
        network,
      });
      runtime.authenticator.forget();
      return { removed: result.removed, revocation: REVOCATION[result.revocation] ?? 'failed' };
    },

    async tools(connector): Promise<readonly IConnectorToolInfo[]> {
      const supervisor = await connectionOf(connector);
      const discovery = await supervisor.discover();
      return discovery.tools.items.map(mapTool);
    },

    async call(connector, tool, args, callOptions): Promise<IConnectorCallResult> {
      try {
        const supervisor = await connectionOf(connector);
        const result = await supervisor.callTool(tool, args as TToolParameters, {
          ...(callOptions?.signal !== undefined && { signal: callOptions.signal }),
        });
        return {
          text: renderContent(
            result.content,
            (result as { structuredContent?: unknown }).structuredContent,
          ),
          isError: result.isError,
        };
      } catch (error) {
        // Only the kind of failure is reported: a service's own error text is not passed along.
        const kind = (error as { classification?: string }).classification ?? 'failed';
        return { text: `The call did not complete (${kind}).`, isError: true };
      }
    },

    async forget(connector): Promise<void> {
      const runtime = runtimes.get(connector.id);
      if (runtime === undefined) return;
      runtime.signIn?.abort.abort();
      runtime.authenticator.close();
      await stopConnection(runtime);
      runtimes.delete(connector.id);
    },

    async close(): Promise<void> {
      for (const runtime of runtimes.values()) {
        runtime.signIn?.abort.abort();
        runtime.authenticator.close();
        await stopConnection(runtime);
      }
      runtimes.clear();
    },
  };
}
