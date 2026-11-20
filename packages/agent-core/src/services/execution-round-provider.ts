/**
 * Provider call helpers for execution rounds.
 * Extracted from execution-round.ts for single-responsibility.
 */

import { applyModelToolCapability } from './execution-model-capability-guards.js';
import { callProviderWithIdleTimeout } from './execution-provider-call.js';
import { assertToolChoiceValid, buildChatResponseFormat } from './execution-service-helpers';
import { applyStructuredOutputTransport } from './execution-structured-output-guard.js';
import { isValidToolCallIdentity } from './tool-call-identity.js';
import { withOutboundTraceContext } from './execution-trace-context.js';
import { randomId } from '../utils/random-id.js';
import { isCacheIdentitySafe, isPlainDataObject } from './cache/cache-key-builder';
import { appendExecutionRecord, callJournaledProvider } from './execution-journal';
import type { IModelJournalContext } from '../interfaces/execution-journal';

import type { IModelRoute } from './execution-model-route';
import type { IStructuredOutputTransportOutcome } from './execution-structured-output-guard';
import type { IResolvedProviderInfo, IExecutionRoundState } from './execution-types';
import type { TAgentExecutionConfig as IAgentConfig, IAssistantMessage } from '../interfaces/agent';
import { PROVIDER_CONTINUATION_METADATA_KEY } from '../interfaces/messages';
import type { IToolCall, TUniversalMessage } from '../interfaces/messages';
import type { IChatOptions, TToolChoice } from '../interfaces/provider';
import type { IDeferredToolCatalog } from '../interfaces/tool-search';
import type { IOutboundTraceContext } from '../interfaces/trace-context';
import type { ILogger } from '../utils/logger';
import type { ExecutionCacheService } from './cache/execution-cache-service';

type TProviderChat = (
  messages: TUniversalMessage[],
  options: IChatOptions,
) => Promise<TUniversalMessage>;

/**
 * A provider request as it will actually be sent — after every capability guard has adjusted it.
 *
 * `messages` is NOT necessarily the array the caller passed in: the structured-output guard adds a
 * system instruction when the wire cannot carry the schema. Reporting the caller's array instead
 * would put a `provider_request` in the session log that no replay could reproduce.
 */
export interface IAssembledProviderRequest {
  messages: TUniversalMessage[];
  options: IChatOptions;
  structuredOutput?: IStructuredOutputTransportOutcome;
}

/** Compute thinking context IDs for event tracking */
export function computeRoundThinkingContext(
  conversationId: string,
  roundState: IExecutionRoundState,
): { thinkingNodeId: string; previousThinkingNodeId: string | undefined } {
  const shouldChainFromPreviousToolResult =
    Array.isArray(roundState.lastTrackedAssistantMessage?.toolCalls) &&
    roundState.lastTrackedAssistantMessage.toolCalls.length > 0;
  const thinkingNodeId = `thinking_${conversationId}_round${roundState.runningAssistantCount + 1}`;
  const previousThinkingNodeId = shouldChainFromPreviousToolResult
    ? `thinking_${conversationId}_round${roundState.runningAssistantCount}`
    : undefined;
  return { thinkingNodeId, previousThinkingNodeId };
}

/**
 * A forcing directive that names a deferred tool loads it before the round assembles, so
 * `toolChoice: { tool }` fetches the schema rather than failing `assertToolChoiceValid` against a
 * list the tool is withheld from. A resident or already-loaded name is not in the catalog and
 * nothing happens; an unknown name is left for the assertion to report as it always has.
 */
function loadForcedDeferredTool(
  toolChoice: TToolChoice | undefined,
  catalog: IDeferredToolCatalog,
): void {
  if (toolChoice === undefined || typeof toolChoice !== 'object') return;
  if (catalog.listDeferredTools().some((schema) => schema.name === toolChoice.tool)) {
    catalog.loadDeferredTools([toolChoice.tool]);
  }
}

/** Assemble the wire options for one round, before any capability guard has adjusted them. */
function buildRoundChatOptions(
  model: string,
  config: IAgentConfig,
  resolved: IResolvedProviderInfo,
  overrides: Partial<IChatOptions> | undefined,
): IChatOptions {
  const responseFormat = buildChatResponseFormat(config.responseFormat);
  // Read PER ROUND. The tool list used to be a per-run snapshot spread here each round, so
  // a tool loaded by round N's ToolSearch call was invisible to round N+1 — the one property a
  // search tool needs. The manager applies the residency projection inside this read.
  const effectiveToolChoice = overrides?.toolChoice ?? config.defaultModel?.toolChoice;
  const tools = effectiveToolChoice === 'none' ? [] : resolved.readAvailableTools();
  return {
    model,
    // Preserve provider-default selection until the adapter resolves its verified model table.
    effort: config.defaultModel?.effort ?? 'auto',
    ...(config.defaultModel?.maxTokens !== undefined && {
      maxTokens: config.defaultModel.maxTokens,
    }),
    ...(config.defaultModel?.temperature !== undefined && {
      temperature: config.defaultModel.temperature,
    }),
    ...(config.defaultModel?.toolChoice !== undefined && {
      toolChoice: config.defaultModel.toolChoice,
    }),
    ...(tools.length > 0 && { tools }),
    ...(responseFormat ? { responseFormat } : {}),
    ...overrides,
  };
}

/** Known provider-hosted tools are effects too; a text cache cannot stand in for them. */
function mayUseNativeWebTools(
  options: IChatOptions,
  provider: IResolvedProviderInfo['provider'],
): boolean {
  const requested = options.nativeWebTools;
  if (requested?.webSearch === true || requested?.webFetch === true) return true;
  try {
    const capabilities = provider.getCapabilities?.().nativeWebTools;
    return (
      (requested?.webSearch !== false && capabilities?.webSearch.enabled === true) ||
      (requested?.webFetch !== false && capabilities?.webFetch.enabled === true)
    );
  } catch {
    // A failed capability check cannot establish that skipping the provider is safe.
    return true;
  }
}

const cacheProviderInstances = new WeakMap<object, string>();

function cacheScope(
  provider: IResolvedProviderInfo['provider'],
  options: IChatOptions,
  route: IModelRoute,
): string | undefined {
  // A wrapper's declaration may describe only its primary, not its selected or eventual route.
  if (provider.resolveModelRoute !== undefined || route.current !== undefined) return undefined;
  try {
    const scope = provider.textResponseCacheScope?.(options);
    if (typeof scope !== 'string' || scope.length === 0) return undefined;
    let instance = cacheProviderInstances.get(provider);
    if (!instance) {
      instance = randomId();
      cacheProviderInstances.set(provider, instance);
    }
    return JSON.stringify([instance, scope]);
  } catch {
    return undefined;
  }
}

const CACHE_OPTION_KEYS = [
  'model',
  'temperature',
  'maxTokens',
  'effort',
  'tools',
  'toolChoice',
  'nativeWebTools',
  'responseFormat',
  'openai',
  'anthropic',
  'google',
  'effortResolution',
  'preserveContextWindow',
] as const;
const KNOWN_CHAT_OPTIONS = new Set<string>([
  ...CACHE_OPTION_KEYS,
  'onModelEffortOutcome',
  'onTextDelta',
  'onThinkingDelta',
  'onProviderNativeRawPayload',
  'signal',
  'outboundTraceContext',
  'executionId',
  'onModelFallback',
]);

const USAGE_METADATA_KEYS = new Set([
  'inputTokens',
  'outputTokens',
  'promptTokens',
  'completionTokens',
  'totalTokens',
  'cacheReadTokens',
  'usageProvenance',
  'usage',
]);

/** Cached responses have no provider call, so they must not repeat its usage. */
function containsOnlyUsageMetadata(response: IAssistantMessage): boolean {
  const metadata = response.metadata;
  if (metadata === undefined) return !Object.hasOwn(response, 'metadata');
  return (
    metadata !== null &&
    typeof metadata === 'object' &&
    isPlainDataObject(metadata) &&
    Object.keys(metadata).every((key) => USAGE_METADATA_KEYS.has(key))
  );
}

const TEXT_RESPONSE_KEYS = new Set(['id', 'role', 'content', 'timestamp', 'state', 'metadata']);

function isReconstructibleTextResponse(response: TUniversalMessage): boolean {
  try {
    return (
      response.role === 'assistant' &&
      response.state === 'complete' &&
      typeof response.content === 'string' &&
      isPlainDataObject(response) &&
      Reflect.ownKeys(response).every(
        (key) => typeof key === 'string' && TEXT_RESPONSE_KEYS.has(key),
      ) &&
      containsOnlyUsageMetadata(response)
    );
  } catch {
    return false;
  }
}

/** Call the AI provider with optional cache lookup/store */
export async function callProviderWithCache(
  conversationMessages: TUniversalMessage[],
  config: IAgentConfig,
  resolved: IResolvedProviderInfo,
  cacheService?: ExecutionCacheService,
  overrides?: Partial<IChatOptions>,
  /**
   * Fires once, with the request as it will actually be sent.
   *
   * A callback rather than a field on `IResolvedProviderInfo`, because this describes THIS request,
   * not the provider. The caller closes over the run's event emitter, so the replay channel records
   * the assembled request rather than the inputs it was assembled from — the transport guard can add
   * a system instruction the caller's own array does not contain, and a log of the array the caller
   * passed in would not reconstruct what the model was actually asked.
   */
  onRequestAssembled?: (request: IAssembledProviderRequest) => void,
  awaitProviderSettlement?: boolean,
  onDispatch?: (disposition: 'invoked' | 'cache-hit', model: string) => void,
  /** Asked only when the adapter is actually invoked, after the request was announced. */
  resolveOutboundTraceContext?: () => IOutboundTraceContext | undefined,
  /**
   * Where the request actually goes. The cache is keyed on the model that is asked, and a reply is
   * stored under the model that gave it, so a substitute model's answer is never served as the
   * requested model's, nor the other way round.
   */
  route: IModelRoute = {},
  journalContext?: IModelJournalContext,
): Promise<TUniversalMessage> {
  if (!config.defaultModel?.model) {
    throw new Error('Model is required in defaultModel configuration. Please specify a model.');
  }
  if (typeof config.defaultModel.model !== 'string' || config.defaultModel.model.trim() === '') {
    throw new Error('Model must be a non-empty string in defaultModel configuration.');
  }

  const model = config.defaultModel.model;
  // The directive this round will carry: the round override, else the config default.
  loadForcedDeferredTool(
    overrides?.toolChoice ?? config.defaultModel.toolChoice,
    resolved.deferredTools,
  );
  const chatOptions = buildRoundChatOptions(model, config, resolved, overrides);
  assertToolChoiceValid(chatOptions.toolChoice, chatOptions.tools);
  // What this MODEL can be asked to do, as opposed to what its vendor can.
  applyModelToolCapability(chatOptions, model, resolved);
  // Which transport can carry the schema — decided before the call rather than discovered
  // by spending the retry budget. `outgoing` may carry a prompt statement of the schema, so every
  // use below (cache key included) reads it rather than the caller's history array.
  const { messages: outgoing, outcome: structuredOutcome } = applyStructuredOutputTransport(
    chatOptions,
    conversationMessages,
    model,
    resolved,
  );
  const providerChat = resolved.provider.chat.bind(resolved.provider) as TProviderChat;
  const observedChat: TProviderChat = (messages, options) =>
    callJournaledProvider(
      (admittedMessages, admittedOptions) => {
        // Invocation of the provider SDK adapter, not proof of a network attempt within that adapter.
        onDispatch?.('invoked', admittedOptions.model ?? model);
        return providerChat(
          admittedMessages,
          withOutboundTraceContext(admittedOptions, resolveOutboundTraceContext?.()),
        );
      },
      messages,
      options,
      journalContext,
    );
  // The SESSION's effort selection is the cache identity — never a locally resolved
  // effective value. An earlier version of this fix resolved the effort against
  // `resolved.provider.effortTable()` before touching the cache, but `effortTable` is optional: a
  // provider may declare none or return none (a gateway `baseURL`, another API surface), and a
  // table can simply be missing an entry for this exact model (version skew). Every such case
  // reports the same "not applied" outcome regardless of the actual selection, which would let
  // different selections collide. Keying on the raw selection sidesteps that entirely: it is known
  // upfront, is identical for every provider, and is exactly what the caller asked for.
  // `undefined` normalizes to `'auto'`, matching `buildRoundChatOptions`'s own default.
  const effortCacheIdentity = chatOptions.effort ?? 'auto';

  const scope = cacheService ? cacheScope(resolved.provider, chatOptions, route) : undefined;
  const cacheModel = chatOptions.model ?? model;
  const cacheProvider = config.defaultModel.provider;
  const cacheOptions = {
    ...(chatOptions.temperature !== undefined && { temperature: chatOptions.temperature }),
    ...(chatOptions.maxTokens !== undefined && { maxTokens: chatOptions.maxTokens }),
    ...(scope !== undefined && { providerScope: scope }),
    effortCacheIdentity,
    requestIdentity: {
      ...(chatOptions.tools !== undefined && { tools: chatOptions.tools }),
      ...(chatOptions.toolChoice !== undefined && { toolChoice: chatOptions.toolChoice }),
      ...(chatOptions.nativeWebTools !== undefined && {
        nativeWebTools: chatOptions.nativeWebTools,
      }),
      ...(chatOptions.responseFormat !== undefined && {
        responseFormat: chatOptions.responseFormat,
      }),
      ...(chatOptions.openai !== undefined && { openai: chatOptions.openai }),
      ...(chatOptions.anthropic !== undefined && { anthropic: chatOptions.anthropic }),
      ...(chatOptions.google !== undefined && { google: chatOptions.google }),
      ...(chatOptions.effortResolution !== undefined && {
        effortResolution: chatOptions.effortResolution,
      }),
      ...(chatOptions.preserveContextWindow !== undefined && {
        preserveContextWindow: chatOptions.preserveContextWindow,
      }),
    },
  };
  let snapshot:
    | {
        messages: TUniversalMessage[];
        options: typeof cacheOptions;
        providerMessages: TUniversalMessage[];
        providerOptions: IChatOptions;
        eventMessages: TUniversalMessage[];
        eventOptions: IChatOptions;
      }
    | undefined;
  // A text-only entry cannot represent tools, external resources, or opaque native state.
  if (
    cacheService &&
    scope !== undefined &&
    typeof chatOptions.model === 'string' &&
    typeof chatOptions.effort === 'string' &&
    (chatOptions.temperature === undefined || typeof chatOptions.temperature === 'number') &&
    (chatOptions.maxTokens === undefined || typeof chatOptions.maxTokens === 'number') &&
    (chatOptions.tools?.length ?? 0) === 0 &&
    Reflect.ownKeys(chatOptions).every(
      (key) => typeof key === 'string' && KNOWN_CHAT_OPTIONS.has(key),
    ) &&
    !CACHE_OPTION_KEYS.some(
      (key) => Object.hasOwn(chatOptions, key) && chatOptions[key] === undefined,
    ) &&
    outgoing.every(
      (message) =>
        message.metadata?.[PROVIDER_CONTINUATION_METADATA_KEY] === undefined &&
        (message.parts === undefined ||
          (Array.isArray(message.parts) && message.parts.every((part) => part?.type === 'text'))),
    ) &&
    !mayUseNativeWebTools(chatOptions, resolved.provider) &&
    isCacheIdentitySafe(outgoing, cacheModel, cacheProvider, cacheOptions)
  ) {
    try {
      // The provider consumes a separate snapshot of the very data used by the cache key.
      // Callbacks and signals remain live, while mutations by the caller or adapter cannot
      // change the request behind the saved identity.
      const messages = structuredClone(outgoing);
      const options = structuredClone(cacheOptions);
      snapshot = {
        messages,
        options,
        providerMessages: structuredClone(messages),
        providerOptions: {
          ...chatOptions,
          ...structuredClone(options.requestIdentity),
        },
        eventMessages: structuredClone(messages),
        eventOptions: {
          ...chatOptions,
          ...structuredClone(options.requestIdentity),
        },
      };
    } catch {
      // An input that cannot be snapshotted can still be passed through to the provider.
    }
  }
  onRequestAssembled?.({
    messages: snapshot?.eventMessages ?? outgoing,
    options: snapshot?.eventOptions ?? chatOptions,
    ...(structuredOutcome !== undefined && { structuredOutput: structuredOutcome }),
  });
  if (
    cacheService &&
    snapshot &&
    scope !== undefined &&
    cacheScope(resolved.provider, snapshot.providerOptions, route) === scope
  ) {
    const cacheMessages = snapshot.messages;
    const snapshotOptions = snapshot.options;
    const cachedResponse = cacheService.lookup(
      cacheMessages,
      cacheModel,
      cacheProvider,
      snapshotOptions,
    );
    if (
      cachedResponse &&
      cacheScope(resolved.provider, snapshot.providerOptions, route) === scope
    ) {
      onDispatch?.('cache-hit', chatOptions.model ?? model);
      const response: TUniversalMessage = {
        role: 'assistant',
        content: cachedResponse,
        timestamp: new Date(),
        id: randomId(),
        state: 'complete' as const,
      };
      if (journalContext)
        await appendExecutionRecord(journalContext.journal, {
          kind: 'model-cache-hit',
          checkpoint: journalContext.checkpoint,
          recordId: `${journalContext.callId}:cache`,
          executionId: journalContext.executionId,
          callId: journalContext.callId,
          ...journalContext.route(),
          response,
        });
      return response;
    }
    const response = await callProviderWithIdleTimeout(
      observedChat,
      snapshot.providerMessages,
      snapshot.providerOptions,
      config.timeout,
      awaitProviderSettlement || !!journalContext,
    );
    // Store only complete text frames the cache can reconstruct without provider metadata.
    if (
      isReconstructibleTextResponse(response) &&
      cacheScope(resolved.provider, snapshot.providerOptions, route) === scope &&
      typeof response.content === 'string'
    ) {
      cacheService.store(
        cacheMessages,
        cacheModel,
        cacheProvider,
        response.content,
        snapshotOptions,
      );
    }
    return response;
  }

  return callProviderWithIdleTimeout(
    observedChat,
    snapshot?.providerMessages ?? outgoing,
    snapshot?.providerOptions ?? chatOptions,
    config.timeout,
    awaitProviderSettlement || !!journalContext,
  );
}

/** Validate and normalize the provider response */
export function validateAndExtractResponse(
  response: TUniversalMessage,
  executionId: string,
  conversationId: string | undefined,
  currentRound: number,
  logger: ILogger,
): { assistantResponse: IAssistantMessage; assistantToolCalls: IToolCall[] } {
  const assistantToolCallsFromResponse =
    response.role === 'assistant' ? (response as IAssistantMessage).toolCalls : undefined;

  const hasToolCalls =
    Array.isArray(assistantToolCallsFromResponse) && assistantToolCallsFromResponse.length > 0;
  if (typeof response.content !== 'string' && !hasToolCalls) {
    throw new Error('[EXECUTION] Provider response must have content or tool calls');
  }
  if (assistantToolCallsFromResponse && !Array.isArray(assistantToolCallsFromResponse)) {
    throw new Error('[EXECUTION] assistant toolCalls must be an array');
  }
  const responseContent = response.content ?? '';
  logger.debug(`[ROUND-${currentRound}] Provider response completed`, {
    executionId,
    conversationId,
    round: currentRound,
    responseLength: responseContent.length,
    hasToolCalls:
      Array.isArray(assistantToolCallsFromResponse) && assistantToolCallsFromResponse.length > 0,
    toolCallsCount: Array.isArray(assistantToolCallsFromResponse)
      ? assistantToolCallsFromResponse.length
      : 0,
  });

  if (response.role !== 'assistant') {
    throw new Error(`Unexpected response role: ${response.role}`);
  }

  const assistantResponse = response as IAssistantMessage;
  const assistantToolCalls = assistantResponse.toolCalls ?? [];
  if (!Array.isArray(assistantToolCalls)) {
    throw new Error('[EXECUTION] assistantResponse.toolCalls must be an array');
  }

  // A call ID identifies a single action within an assistant frame. Two calls sharing it
  // cannot be paired with distinct receipts or safely recovered, even if their inputs match.
  const callIds = new Set<string>();
  for (const call of assistantToolCalls) {
    if (!isValidToolCallIdentity(call?.id)) {
      throw new Error('[EXECUTION] Tool call identity must be a non-empty string');
    }
    if (callIds.has(call.id)) {
      throw new Error('[EXECUTION] Duplicate tool call identity in assistant response');
    }
    callIds.add(call.id);
  }

  return { assistantResponse, assistantToolCalls };
}

// Re-exported from its own module (see execution-provider-call.ts) so existing importers of this
// file keep one import path for "make a provider call safely".
export { callProviderWithIdleTimeout } from './execution-provider-call.js';
