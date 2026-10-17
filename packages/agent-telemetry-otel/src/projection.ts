import type {
  ILivePromptTraceBatch,
  IProviderCallTraceEntry,
  IToolBodyTraceEntry,
} from '@robota-sdk/agent-interface-analytics';

import { timingAttributes } from './timing.js';

/**
 * Which names a projected span carries. `agent` keeps Robota's own `agent.*` names; `gen_ai` uses the
 * OpenTelemetry GenAI semantic conventions; `gen_ai/dup` uses GenAI span names and emits both attribute
 * sets, so a backend can move from one set of names to the other without a gap.
 */
export type TOtelProjectionMode = 'agent' | 'gen_ai/dup' | 'gen_ai';

export interface IOtelProjectionOptions {
  readonly mode: TOtelProjectionMode;
  /** Host-chosen agent name for the root `invoke_agent` span; GenAI modes only. */
  readonly agentName?: string;
}

export type TOtelSpanKind = 'internal' | 'client';
export type TOtelAttributes = Readonly<Record<string, string | number>>;

/** One span to record, independent of any OpenTelemetry SDK. */
export interface IOtelSpanProjection {
  readonly name: string;
  readonly kind: TOtelSpanKind;
  readonly traceId: string;
  readonly spanId: string;
  /** Absent on the root; every child's parent is the root. */
  readonly parentSpanId?: string;
  readonly startedAt: string;
  readonly endedAt: string;
  /** `error` for a failed outcome; an interrupted one is not an error. */
  readonly status: 'unset' | 'error';
  readonly attributes: TOtelAttributes;
}

export interface IOtelTraceProjection {
  /** The schema the attribute names follow; absent in `agent` mode, whose names are Robota's own. */
  readonly schemaUrl?: string;
  readonly root: IOtelSpanProjection;
  readonly children: readonly IOtelSpanProjection[];
}

/** The GenAI semantic-convention version the `gen_ai` names follow. */
export const GEN_AI_SCHEMA_URL = 'https://opentelemetry.io/schemas/gen-ai-dev/1.42.0-dev';

/** The same opaque-ID shape the framework's live-prompt-trace boundary allows through. */
const OPAQUE_ID = /^[A-Za-z0-9_-]{1,128}$/u;
/** The same label shape the framework allows for provider and model labels. */
const LABEL = /^[A-Za-z0-9._:/-]{1,128}$/u;

/**
 * Robota provider IDs whose GenAI provider name is certain. A Gemini client can point at either the
 * Gemini API or Vertex AI, so it gets the convention's name for any Google GenAI endpoint. An ID not
 * listed here gets no `gen_ai.provider.name` rather than a guessed one; `agent.provider.id` still names it.
 */
const GEN_AI_PROVIDER_NAMES: Readonly<Record<string, string>> = {
  anthropic: 'anthropic',
  openai: 'openai',
  deepseek: 'deepseek',
  gemini: 'gcp.gen_ai',
  google: 'gcp.gen_ai',
};

const opaqueId = (value: unknown): string | undefined =>
  typeof value === 'string' && OPAQUE_ID.test(value) ? value : undefined;
/** A model or tool name only in the label shape the framework allows; anything else is dropped. */
export const label = (value: unknown): string | undefined =>
  typeof value === 'string' && LABEL.test(value) ? value : undefined;
/** Own keys only: an inherited property such as `constructor` is not a provider. */
export const genAiProviderName = (providerId: string | undefined): string | undefined =>
  providerId !== undefined && Object.hasOwn(GEN_AI_PROVIDER_NAMES, providerId) ? GEN_AI_PROVIDER_NAMES[providerId] : undefined;
const status = (outcome: string): 'unset' | 'error' => outcome === 'failure' ? 'error' : 'unset';
const spanName = (operation: string, subject: string | undefined): string =>
  subject ? `${operation} ${subject}` : operation;

/**
 * GenAI conventions require `error.type` on a failed operation. The batch records that a span failed
 * but not why, so the projection uses the conventions' fallback value instead of naming a cause.
 */
function withErrorType(attributes: TOtelAttributes, outcome: string, mode: TOtelProjectionMode): TOtelAttributes {
  return mode !== 'agent' && outcome === 'failure' ? { ...attributes, 'error.type': '_OTHER' } : attributes;
}

/** A provider-call or tool-body child of a trace: the children that get a span. */
export type TSpannedChild = Exclude<ILivePromptTraceBatch['children'][number], { readonly kind: 'permission' }>;

/** A permission decision is content-free but has no duration of its own — it never gets a span. */
function hasSpan(child: ILivePromptTraceBatch['children'][number]): child is TSpannedChild {
  return child.kind !== 'permission';
}

function rootAttributes(batch: ILivePromptTraceBatch, options: IOtelProjectionOptions): TOtelAttributes {
  const shared = {
    'agent.turn.id': batch.turnId,
    'agent.outcome': batch.root.outcome,
    'agent.omitted.provider_count': batch.omittedChildren.provider,
    'agent.omitted.tool_count': batch.omittedChildren.tool,
    'agent.omitted.permission_count': batch.omittedChildren.permission,
    ...timingAttributes(batch.timingTotals),
  };
  const agent = { 'agent.session.id': batch.sessionId };
  const genAi = {
    'gen_ai.operation.name': 'invoke_agent',
    ...(options.agentName ? { 'gen_ai.agent.name': options.agentName } : {}),
    'gen_ai.conversation.id': batch.sessionId,
  };
  if (options.mode === 'agent') return { ...agent, ...shared };
  return options.mode === 'gen_ai' ? { ...genAi, ...shared } : { ...genAi, ...agent, ...shared };
}

function providerAttributes(trace: IProviderCallTraceEntry, mode: TOtelProjectionMode): TOtelAttributes {
  const complete = trace.usageProvenance === 'complete';
  const requestId = opaqueId(trace.providerRequestId);
  const agentOnly = mode !== 'gen_ai';
  // The CLI's attribute order, with the facts GenAI names differently present only outside `gen_ai`.
  const robota = {
    'agent.outcome': trace.outcome,
    'agent.provider.round': trace.round,
    ...(trace.disposition ? { 'agent.provider.disposition': trace.disposition } : {}),
    ...(trace.providerId ? { 'agent.provider.id': trace.providerId } : {}),
    ...(agentOnly && trace.modelId ? { 'agent.model.id': trace.modelId } : {}),
    ...(trace.usageProvenance ? { 'agent.usage.provenance': trace.usageProvenance } : {}),
    ...(complete ? {
      ...(agentOnly ? {
        'agent.usage.input_tokens': trace.promptTokens ?? 0,
        'agent.usage.output_tokens': trace.completionTokens ?? 0,
      } : {}),
      // GenAI conventions define input and output tokens but no total.
      'agent.usage.total_tokens': trace.totalTokens ?? 0,
    } : {}),
    ...(requestId ? { 'agent.provider.request_id': requestId } : {}),
  };
  const providerName = genAiProviderName(trace.providerId);
  const genAi = {
    'gen_ai.operation.name': 'chat',
    ...(providerName ? { 'gen_ai.provider.name': providerName } : {}),
    ...(trace.modelId ? { 'gen_ai.request.model': trace.modelId } : {}),
    ...(complete ? {
      'gen_ai.usage.input_tokens': trace.promptTokens ?? 0,
      'gen_ai.usage.output_tokens': trace.completionTokens ?? 0,
    } : {}),
  };
  return mode === 'agent' ? robota : { ...genAi, ...robota };
}

function toolAttributes(trace: IToolBodyTraceEntry, mode: TOtelProjectionMode): TOtelAttributes {
  const callId = opaqueId(trace.toolCallId);
  const toolName = label(trace.toolName);
  const shared = { 'agent.outcome': trace.outcome };
  const agent: TOtelAttributes = callId ? { 'agent.tool.call_id': callId } : {};
  const genAi = {
    'gen_ai.operation.name': 'execute_tool',
    ...(toolName ? { 'gen_ai.tool.name': toolName } : {}),
    ...(callId ? { 'gen_ai.tool.call.id': callId } : {}),
  };
  if (mode === 'agent') return { ...shared, ...agent };
  return mode === 'gen_ai' ? { ...genAi, ...shared } : { ...genAi, ...shared, ...agent };
}

/** One child's span under `parentSpanId` in trace `traceId`; shared by the batch projection and the run observer. */
export function projectTraceChild(
  child: TSpannedChild, traceId: string, parentSpanId: string, mode: TOtelProjectionMode,
): IOtelSpanProjection {
  const { trace } = child;
  const common = {
    traceId,
    spanId: trace.spanId,
    parentSpanId,
    startedAt: trace.startedAt,
    endedAt: trace.endedAt,
    status: status(trace.outcome),
  };
  if (child.kind === 'provider') {
    return {
      ...common,
      name: mode === 'agent' ? 'agent.provider_call' : spanName('chat', child.trace.modelId),
      kind: mode === 'agent' ? 'internal' : 'client',
      attributes: withErrorType(providerAttributes(child.trace, mode), trace.outcome, mode),
    };
  }
  return {
    ...common,
    name: mode === 'agent' ? 'agent.tool_body' : spanName('execute_tool', label(child.trace.toolName)),
    kind: 'internal',
    attributes: withErrorType(toolAttributes(child.trace, mode), trace.outcome, mode),
  };
}

/**
 * Map one live prompt trace batch onto the spans an OpenTelemetry exporter records: the prompt root,
 * then one child per provider call and tool body, in batch order. Permission decisions get no span.
 * The result carries only what the batch carries, so it stays content-free.
 */
export function projectLivePromptTrace(
  batch: ILivePromptTraceBatch, options: IOtelProjectionOptions,
): IOtelTraceProjection {
  const { mode } = options;
  const root: IOtelSpanProjection = {
    name: mode === 'agent' ? 'agent.prompt_execution' : spanName('invoke_agent', options.agentName),
    kind: 'internal',
    traceId: batch.root.traceId,
    spanId: batch.root.spanId,
    startedAt: batch.root.startedAt,
    endedAt: batch.root.endedAt,
    status: status(batch.root.outcome),
    attributes: withErrorType(rootAttributes(batch, options), batch.root.outcome, mode),
  };
  // Every child belongs to the root's trace, whatever trace ID an unchecked batch gave it.
  const children = batch.children.filter(hasSpan)
    .map((child) => projectTraceChild(child, root.traceId, root.spanId, mode));
  return { ...(mode === 'agent' ? {} : { schemaUrl: GEN_AI_SCHEMA_URL }), root, children };
}
