import { randomUUID } from 'node:crypto';
import { Protocol } from '@modelcontextprotocol/sdk/shared/protocol.js';
import {
  ErrorCode,
  ListPromptsResultSchema,
  ListResourcesResultSchema,
  McpError,
  ResultSchema,
  ServerCapabilitiesSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { createSkillsSession, hasSkillsCapability } from '../skills/session.js';
import { enableSkillReceiveBudget } from './receive-budget.js';
import { discoverAll } from './discovery.js';
import {
  MCPStatelessProtocolError,
  statelessCacheHint,
  StatelessToolResultSchema,
  StatelessToolsListSchema,
} from './stateless-result.js';
import {
  buildDeclaredCapabilities,
  DEFAULT_CLIENT_INFO,
  MCPSessionError,
  toToolCallResult,
} from './session-protocol.js';
import { MCPStdioError } from './stdio-transport.js';
import { callTraceRegistryOf, runInCallTraceScope } from './trace-propagation.js';

import type { Request, Notification, Result } from '@modelcontextprotocol/sdk/types.js';
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { IMCPOpenSessionOptions, IMCPSession } from './session-types.js';

/** Framing only: v1 SDK Client.initialize is incompatible with the pinned stateless protocol. */
class StatelessFraming extends Protocol<Request, Notification, Result> {
  constructor(private readonly skillsEnabled: boolean) {
    super();
    this.removeRequestHandler('ping');
  }
  protected override assertCapabilityForMethod(method: string): void {
    if (this.skillsEnabled && ['skills/list', 'skills/get', 'resources/read'].includes(method))
      return;
    if (
      !['server/discover', 'tools/list', 'prompts/list', 'resources/list', 'tools/call'].includes(
        method,
      )
    )
      throw new Error('Unsupported stateless MCP method');
  }
  protected override assertNotificationCapability(method: string): void {
    if (method !== 'notifications/cancelled')
      throw new Error('Unsupported stateless MCP notification');
  }
  protected override assertRequestHandlerCapability(method: string): void {
    // The SDK installs this legacy handler during super(); it is removed immediately above.
    if (method !== 'ping') throw new Error('Server-initiated requests are unavailable');
  }
  protected override assertTaskCapability(): void {
    throw new Error('Tasks extension is unavailable');
  }
  protected override assertTaskHandlerCapability(): void {
    throw new Error('Tasks extension is unavailable');
  }
}

function requireComplete(result: Result): void {
  // The base specification requires treating an absent resultType as complete for old peers.
  if (result.resultType !== undefined && result.resultType !== 'complete')
    throw new MCPStatelessProtocolError(
      result.resultType === 'input_required' ? 'input_required' : 'unknown-result',
    );
}

/** The caller already admitted the carrier; no new authority or automatic legacy fallback occurs. */
export async function openStatelessSession(options: IMCPOpenSessionOptions): Promise<IMCPSession> {
  const framing = new StatelessFraming(options.skills === true);
  const transport = options.transport;
  if (options.skills === true) enableSkillReceiveBudget(transport);
  const sensitive = 'sensitiveDiagnostics' in transport && transport.sensitiveDiagnostics === true;
  const clientInfo = { ...(options.clientInfo ?? DEFAULT_CLIENT_INFO) };
  transport.setProtocolVersion?.('2026-07-28');
  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => (closePromise ??= framing.close());
  const request = async (
    method: string,
    params: Record<string, unknown>,
    requestOptions?: RequestOptions,
    cacheable = false,
  ): Promise<Result> => {
    if (closePromise) throw new Error('Stateless MCP carrier is closed');
    const result = await framing.request(
      {
        method,
        params: {
          ...params,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
            'io.modelcontextprotocol/clientInfo': clientInfo,
          },
        },
      },
      ResultSchema,
      requestOptions,
    );
    requireComplete(result);
    if (cacheable) statelessCacheHint(result);
    return result;
  };
  let discovery: Result;
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
    discovery = await Promise.race([
      framing
        .connect(transport)
        .then(() =>
          request('server/discover', {}, { timeout: budget, signal: options.signal }, true),
        ),
      deadline,
    ]);
    if (
      !Array.isArray(discovery.supportedVersions) ||
      !discovery.supportedVersions.every((value) => typeof value === 'string') ||
      !discovery.supportedVersions.includes('2026-07-28')
    )
      throw new MCPSessionError(
        'unsupported-protocol-version',
        'Server does not support the explicitly selected stateless MCP version',
      );
  } catch (error) {
    await close();
    if (sensitive) {
      if (error instanceof MCPStdioError && error.reason === 'authority') throw error;
      if (error instanceof MCPSessionError && error.kind === 'unsupported-protocol-version')
        throw error;
      throw new MCPSessionError(
        (error instanceof McpError && error.code === ErrorCode.RequestTimeout) ||
          (error instanceof MCPSessionError && error.kind === 'startup-timeout')
          ? 'startup-timeout'
          : 'initialize-failed',
        'Stdio stateless MCP startup failed',
      );
    }
    throw error;
  } finally {
    if (startupTimer !== undefined) clearTimeout(startupTimer);
    if (abortStartup) options.signal?.removeEventListener('abort', abortStartup);
  }
  try {
    const meta = discovery._meta;
    const serverInfo = meta?.['io.modelcontextprotocol/serverInfo'];
    if (
      serverInfo !== undefined &&
      (typeof serverInfo !== 'object' ||
        serverInfo === null ||
        !('name' in serverInfo) ||
        !('version' in serverInfo) ||
        typeof serverInfo.name !== 'string' ||
        typeof serverInfo.version !== 'string')
    )
      throw new Error('Stateless MCP discovery has no valid server metadata');
    const capabilities = ServerCapabilitiesSchema.parse(discovery.capabilities);
    const declaredCapabilities = buildDeclaredCapabilities(capabilities);
    const identity = {
      serverId: options.serverId,
      serverName: serverInfo === undefined ? options.serverId : (serverInfo.name as string),
      serverVersion: serverInfo === undefined ? '' : (serverInfo.version as string),
      protocolVersion: '2026-07-28',
      catalogGeneration: randomUUID(),
      ...(serverInfo === undefined ? { serverInfoProvided: false as const } : {}),
    };
    const instructions =
      typeof discovery.instructions === 'string' ? discovery.instructions : undefined;
    const callTraces = callTraceRegistryOf(transport);
    const invoke = async (
      method: string,
      params: Record<string, unknown>,
      callOptions?: RequestOptions,
      cacheable = false,
    ) => {
      try {
        return await request(method, params, callOptions, cacheable);
      } catch (error) {
        if (error instanceof MCPStatelessProtocolError) {
          await close();
          throw error;
        }
        if (
          callOptions?.signal?.aborted ||
          (error instanceof McpError && error.code === ErrorCode.RequestTimeout)
        ) {
          // Stop a carrier with uncertain in-flight effects; do not reconnect or replay the call.
          await close();
          if (sensitive) throw new MCPStdioError('cancelled');
        }
        if (sensitive) throw new MCPStdioError('send');
        throw error;
      }
    };
    const skills =
      options.skills &&
      declaredCapabilities.resources &&
      hasSkillsCapability(capabilities.extensions)
        ? createSkillsSession(identity, (method, params, opts) =>
            invoke(method, params, {
              signal: opts?.signal,
              timeout: opts?.timeoutMs ?? options.timeouts.perCallMs,
            }),
          )
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
              listTools: async (params, opts) =>
                StatelessToolsListSchema.parse(
                  await invoke('tools/list', params ?? {}, opts, true),
                ),
              listPrompts: async (params, opts) =>
                ListPromptsResultSchema.parse(
                  await invoke('prompts/list', params ?? {}, opts, true),
                ),
              listResources: async (params, opts) =>
                ListResourcesResultSchema.parse(
                  await invoke('resources/list', params ?? {}, opts, true),
                ),
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
        const call = async () => {
          const parsed = StatelessToolResultSchema.safeParse(
            await invoke(
              'tools/call',
              { name, arguments: args },
              {
                signal: callOptions?.signal,
                timeout: callOptions?.timeoutMs ?? options.timeouts.perCallMs,
              },
            ),
          );
          if (!parsed.success) throw new MCPStatelessProtocolError('invalid-tool-result');
          return toToolCallResult(parsed.data);
        };
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
