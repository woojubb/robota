import { randomUUID } from 'node:crypto';
import {
  SERVER_INFO_META_KEY,
  SdkError,
  SdkErrorCode,
  SdkHttpError,
  UnsupportedProtocolVersionError,
} from '@modelcontextprotocol/client';

import { MCPSkillError } from '../skills/manifest.js';
import { createSkillsSession, hasSkillsCapability } from '../skills/session.js';
import { enableSkillReceiveBudget } from './receive-budget.js';
import { discoverAll } from './discovery.js';
import {
  MCPStatelessProtocolError,
  OBJECT_RESULT_SCHEMA,
  statelessCacheHint,
} from './stateless-result.js';
import {
  buildDeclaredCapabilities,
  createMcpClient,
  DEFAULT_CLIENT_INFO,
  isRequestTimeout,
  MCPSessionError,
  STATELESS_PROTOCOL_VERSION,
  toToolCallResult,
} from './session-protocol.js';
import { MCPStdioError } from './stdio-transport.js';
import { callTraceRegistryOf, runInCallTraceScope } from './trace-propagation.js';
import { lastHttpAnswerOf } from './transport.js';

import type { Client, Result, Transport } from '@modelcontextprotocol/client';
import type { IMCPSkillRequestOptions } from '../skills/types.js';
import type { IMCPOpenSessionOptions, IMCPSession } from './session-types.js';

/** The SDK attaches the carrier only once its connect-time exchange begins; one it never reached is closed here. */
async function closeCarrier(client: Client, transport: Transport): Promise<void> {
  const attached = client.transport !== undefined;
  await client.close();
  if (!attached) await transport.close();
}

/** The SDK wraps what the carrier threw during its probe; the carrier's own refusal keeps its class. */
function probeCause(error: unknown): unknown {
  if (!(error instanceof SdkError) || error.code !== SdkErrorCode.EraNegotiationFailed) return error;
  const cause = (error.data as { readonly cause?: unknown } | undefined)?.cause;
  return cause instanceof Error ? cause : error;
}

/** The server answered, but not with the explicitly selected revision; transport failures keep their own class. */
function isUnofferedRevision(error: unknown): boolean {
  if (error instanceof UnsupportedProtocolVersionError) return true;
  return (
    error instanceof SdkError &&
    !(error instanceof SdkHttpError) &&
    error.code === SdkErrorCode.EraNegotiationFailed &&
    error.data === undefined
  );
}

const JSON_CONTENT_TYPE = /^application\/json\b/i;

/**
 * The SDK reads every answer it cannot parse as the protocol as a legacy server. A JSON answer is
 * the server speaking (a legacy peer refusing the probe); a non-JSON HTTP error is the address
 * failing, named by its status so the caller classifies it as on the legacy path.
 */
function unofferedRevision(error: unknown, transport: Transport): MCPSessionError {
  const answer = lastHttpAnswerOf(transport);
  if (
    !(error instanceof UnsupportedProtocolVersionError) &&
    answer !== undefined &&
    !(answer.contentType !== undefined && JSON_CONTENT_TYPE.test(answer.contentType))
  )
    return new MCPSessionError(
      'initialize-failed',
      `Stateless MCP discovery was answered with HTTP ${answer.status}`,
      { status: answer.status },
    );
  return new MCPSessionError(
    'unsupported-protocol-version',
    'Server does not support the explicitly selected stateless MCP version',
  );
}

/** A completion discriminator other than `complete`: the result is not one this surface can act on. */
function unsupportedResult(error: unknown): MCPStatelessProtocolError | undefined {
  if (!(error instanceof SdkError) || error.code !== SdkErrorCode.UnsupportedResultType)
    return undefined;
  const resultType = (error.data as { readonly resultType?: unknown } | undefined)?.resultType;
  return new MCPStatelessProtocolError(
    resultType === 'input_required' ? 'input_required' : 'unknown-result',
  );
}

function isInvalidResult(error: unknown): boolean {
  return error instanceof SdkError && error.code === SdkErrorCode.InvalidResult;
}

/** The caller already admitted the carrier; no new authority or automatic legacy fallback occurs. */
export async function openStatelessSession(options: IMCPOpenSessionOptions): Promise<IMCPSession> {
  const transport = options.transport;
  if (options.skills === true) enableSkillReceiveBudget(transport);
  const sensitive = 'sensitiveDiagnostics' in transport && transport.sensitiveDiagnostics === true;
  const client = createMcpClient(
    options.clientInfo ?? DEFAULT_CLIENT_INFO,
    STATELESS_PROTOCOL_VERSION,
  );
  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => (closePromise ??= closeCarrier(client, transport));
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let abortStartup: (() => void) | undefined;
  try {
    options.signal?.throwIfAborted();
    const budget =
      'stdioStartupMs' in transport && typeof transport.stdioStartupMs === 'number'
        ? Math.min(options.timeouts.startupMs, transport.stdioStartupMs)
        : options.timeouts.startupMs;
    const deadline = new Promise<never>((_resolve, reject) => {
      startupTimer = setTimeout(
        () => reject(new MCPSessionError('startup-timeout', 'Stateless MCP startup timed out')),
        budget,
      );
      abortStartup = () =>
        reject(new MCPSessionError('initialize-failed', 'Stateless MCP startup cancelled'));
      options.signal?.addEventListener('abort', abortStartup, { once: true });
    });
    await Promise.race([
      client.connect(transport, { timeout: budget, signal: options.signal }),
      deadline,
    ]);
    if (client.getNegotiatedProtocolVersion() !== STATELESS_PROTOCOL_VERSION)
      throw new MCPSessionError(
        'unsupported-protocol-version',
        'Server does not support the explicitly selected stateless MCP version',
      );
  } catch (caught) {
    await close();
    const error = probeCause(caught);
    const failure = isUnofferedRevision(error) ? unofferedRevision(error, transport) : error;
    // The SDK reports an aborted request as a timeout too; an abort the caller asked for is not one.
    const timedOut =
      (isRequestTimeout(failure) && options.signal?.aborted !== true) ||
      (failure instanceof MCPSessionError && failure.kind === 'startup-timeout');
    if (sensitive) {
      if (failure instanceof MCPStdioError && failure.reason === 'authority') throw failure;
      if (failure instanceof MCPSessionError && failure.kind === 'unsupported-protocol-version')
        throw failure;
      throw new MCPSessionError(
        timedOut ? 'startup-timeout' : 'initialize-failed',
        'Stdio stateless MCP startup failed',
      );
    }
    if (timedOut && !(failure instanceof MCPSessionError))
      throw new MCPSessionError('startup-timeout', 'Stateless MCP startup timed out');
    throw failure;
  } finally {
    if (startupTimer !== undefined) clearTimeout(startupTimer);
    if (abortStartup) options.signal?.removeEventListener('abort', abortStartup);
  }
  try {
    const discovery = client.getDiscoverResult();
    if (discovery === undefined) throw new Error('Stateless MCP discovery was not retained');
    const serverInfo = client.getServerVersion();
    // The SDK reads an identity it cannot validate as an absent one; a present malformed identity stays a refusal.
    if (discovery._meta?.[SERVER_INFO_META_KEY] !== undefined && serverInfo === undefined)
      throw new Error('Stateless MCP discovery has no valid server metadata');
    const capabilities = client.getServerCapabilities() ?? {};
    const declaredCapabilities = buildDeclaredCapabilities(capabilities);
    const identity = {
      serverId: options.serverId,
      serverName: serverInfo === undefined ? options.serverId : serverInfo.name,
      serverVersion: serverInfo === undefined ? '' : serverInfo.version,
      protocolVersion: STATELESS_PROTOCOL_VERSION,
      catalogGeneration: randomUUID(),
      ...(serverInfo === undefined ? { serverInfoProvided: false as const } : {}),
    };
    const instructions = client.getInstructions();
    const callTraces = callTraceRegistryOf(transport);
    /**
     * Every request after discovery passes here. A result the surface cannot act on, a deadline or an
     * abort leaves effects uncertain: the carrier closes, and nothing is ever replayed on a new one.
     */
    const invoke = async <TResult>(
      call: () => Promise<TResult>,
      signal: AbortSignal | undefined,
      invalid?: () => Error,
    ): Promise<TResult> => {
      try {
        if (closePromise) throw new Error('Stateless MCP carrier is closed');
        return await call();
      } catch (error) {
        const unsupported = unsupportedResult(error);
        if (unsupported !== undefined) {
          await close();
          throw unsupported;
        }
        if (invalid !== undefined && isInvalidResult(error)) {
          const refusal = invalid();
          if (refusal instanceof MCPStatelessProtocolError) await close();
          throw refusal;
        }
        if (signal?.aborted || isRequestTimeout(error)) {
          // Stop a carrier with uncertain in-flight effects; do not reconnect or replay the call.
          await close();
          if (sensitive) throw new MCPStdioError('cancelled');
        }
        if (sensitive) throw new MCPStdioError('send');
        throw error;
      }
    };
    const skillRequest = (
      method: string,
      params: Record<string, unknown>,
      skillOptions?: IMCPSkillRequestOptions,
    ): Promise<Result> => {
      const requestOptions = {
        signal: skillOptions?.signal,
        timeout: skillOptions?.timeoutMs ?? options.timeouts.perCallMs,
      };
      return invoke(
        async () => {
          // A verified file is never served from the SDK's response cache.
          const result =
            method === 'resources/read'
              ? await client.readResource(
                  { uri: String(params['uri']) },
                  { ...requestOptions, cacheMode: 'bypass' },
                )
              : await client.request({ method, params }, OBJECT_RESULT_SCHEMA, requestOptions);
          // The SDK resolves only complete results and has consumed the discriminator.
          return { ...result, resultType: 'complete' };
        },
        skillOptions?.signal,
        () =>
          new MCPSkillError(method === 'resources/read' ? 'invalid-resource' : 'invalid-manifest'),
      );
    };
    const skills =
      options.skills &&
      declaredCapabilities.resources &&
      hasSkillsCapability(capabilities.extensions)
        ? createSkillsSession(identity, skillRequest)
        : undefined;
    return {
      ...(skills === undefined ? {} : { skills }),
      identity,
      instructions,
      declaredCapabilities,
      discoveryCacheHint: statelessCacheHint(discovery),
      compatibilityDiagnostics: [
        ...(options.skills && skills === undefined
          ? [
              {
                capability: 'skills',
                reason: 'Skills requires a valid advertised extension and Resources capability.',
              },
            ]
          : []),
        {
          capability: 'input_required',
          reason:
            'No MRTR client input capability is offered; unsupported results close the carrier without replay.',
        },
        {
          capability: 'subscriptions',
          reason:
            'This surface does not open subscription streams; listChanged watches require explicit host refresh.',
        },
        {
          capability: 'extensions',
          reason:
            skills === undefined
              ? 'No optional extension is offered or activated by this surface.'
              : 'Only host-selected Skills metadata and verified file reads are available; activation stays host-owned.',
        },
      ],
      discover: async (discoverOptions) => {
        try {
          return await discoverAll(
            {
              request: (request, requestOptions) =>
                invoke(() => client.request(request, requestOptions), requestOptions.signal),
            },
            declaredCapabilities,
            identity,
            instructions,
            discoverOptions,
          );
        } catch (error) {
          if (sensitive) throw new MCPStdioError('send');
          throw error;
        }
      },
      async callTool(name, args, callOptions) {
        if (!declaredCapabilities.tools)
          throw new Error('Stateless MCP server did not declare tools');
        const call = async () =>
          toToolCallResult(
            await invoke(
              // `request`, not `callTool`: the latter re-lists and replays the call on a header
              // mismatch, and this surface sends each effectful request exactly once.
              () =>
                client.request(
                  { method: 'tools/call', params: { name, arguments: args } },
                  {
                    signal: callOptions?.signal,
                    timeout: callOptions?.timeoutMs ?? options.timeouts.perCallMs,
                  },
                ),
              callOptions?.signal,
              () => new MCPStatelessProtocolError('invalid-tool-result'),
            ),
          );
        const scope = callTraces
          ? {
              requestAbortController: new AbortController(),
              ...(callOptions?.outboundTraceContext
                ? { outbound: callOptions.outboundTraceContext }
                : {}),
            }
          : undefined;
        try {
          return scope ? await runInCallTraceScope(scope, call) : await call();
        } catch (error) {
          if (error instanceof MCPStatelessProtocolError) {
            await close();
            throw error;
          }
          if (sensitive && !(error instanceof MCPStdioError)) throw new MCPStdioError('send');
          throw error;
        } finally {
          if (scope) callTraces?.release(scope);
        }
      },
      // No subscription capability is offered by this initial surface; unsolicited events cannot refresh it.
      onListChanged: () => () => undefined,
      close,
    };
  } catch (error) {
    await close();
    if (sensitive)
      throw new MCPSessionError(
        'initialize-failed',
        'Invalid stdio stateless MCP discovery metadata',
      );
    throw error;
  }
}
