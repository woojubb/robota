import type { ILivePromptTraceBatch, IProviderCallTraceEntry } from '@robota-sdk/agent-interface-analytics';

import { genAiProviderName, label } from './projection.js';
import type { TOtelAttributes } from './projection.js';

/**
 * Bucket boundaries the GenAI conventions recommend, as pinned at semantic-conventions-genai
 * f3c6d0c9bb66ebd474668a3a0be25c61226f02c2. A histogram needs one more count than it has boundaries,
 * for values above the last one.
 */
export const GEN_AI_DURATION_BUCKETS_S: readonly number[] =
  [0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.28, 2.56, 5.12, 10.24, 20.48, 40.96, 81.92];
export const GEN_AI_AGENT_DURATION_BUCKETS_S: readonly number[] =
  [0.1, 0.2, 0.4, 0.8, 1.6, 3.2, 6.4, 12.8, 25.6, 51.2, 102.4, 204.8, 409.6];
export const GEN_AI_TOKEN_BUCKETS: readonly number[] =
  [1, 4, 16, 64, 256, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304, 16777216, 67108864];
export const GEN_AI_CALL_COUNT_BUCKETS: readonly number[] = [1, 2, 4, 8, 16, 32, 64, 128];

/** One measurement to record, independent of any OpenTelemetry SDK: a counter increment or a histogram value. */
export interface IOtelMetricSample {
  readonly name: string;
  readonly instrument: 'counter' | 'histogram';
  readonly unit: string;
  readonly value: number;
  readonly attributes: TOtelAttributes;
  /** Explicit bucket upper bounds of a histogram; absent for a counter. */
  readonly boundaries?: readonly number[];
}

export interface IOtelMetricSampleOptions {
  /** Host-chosen agent name carried on the agent, tool and root metrics. */
  readonly agentName?: string;
}

/** Same fallback value the span projection uses: the batch records that a call failed, not why. */
const ERROR_TYPE = { 'error.type': '_OTHER' } as const;

const seconds = (startedAt: string, endedAt: string): number | undefined => {
  const value = (Date.parse(endedAt) - Date.parse(startedAt)) / 1000;
  return Number.isFinite(value) && value >= 0 ? value : undefined;
};
const tokenCount = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

function providerCallSamples(trace: IProviderCallTraceEntry): IOtelMetricSample[] {
  const providerName = genAiProviderName(trace.providerId);
  const model = label(trace.modelId);
  const base: TOtelAttributes = {
    'gen_ai.operation.name': 'chat',
    ...(providerName ? { 'gen_ai.provider.name': providerName } : {}),
    ...(model ? { 'gen_ai.request.model': model } : {}),
  };
  const attributes: TOtelAttributes = trace.outcome === 'failure' ? { ...base, ...ERROR_TYPE } : base;
  // Without a complete count the conventions ask for 0, not for a missing sample; providers do not
  // report usage per modality, so the counters' modality is `unknown`.
  const promptTokens = tokenCount(trace.promptTokens);
  const completionTokens = tokenCount(trace.completionTokens);
  const known = trace.usageProvenance === 'complete' && promptTokens !== undefined && completionTokens !== undefined;
  const input = known ? promptTokens : 0;
  const output = known ? completionTokens : 0;
  const counterAttributes: TOtelAttributes = { ...base, 'gen_ai.token.modality': 'unknown' };
  const duration = seconds(trace.startedAt, trace.endedAt);
  const tokens = (name: string, value: number): IOtelMetricSample => ({
    name, instrument: 'histogram', unit: '{token}', value, attributes, boundaries: GEN_AI_TOKEN_BUCKETS,
  });
  return [
    ...(duration === undefined ? [] : [{
      name: 'gen_ai.client.inference.duration', instrument: 'histogram' as const, unit: 's', value: duration,
      attributes, boundaries: GEN_AI_DURATION_BUCKETS_S,
    }]),
    { name: 'gen_ai.client.inference.usage.input_tokens', instrument: 'counter', unit: '{token}', value: input, attributes: counterAttributes },
    { name: 'gen_ai.client.inference.usage.output_tokens', instrument: 'counter', unit: '{token}', value: output, attributes: counterAttributes },
    tokens('gen_ai.client.inference.operation.input_tokens', input),
    tokens('gen_ai.client.inference.operation.output_tokens', output),
  ];
}

/**
 * Map one live prompt trace batch onto the GenAI metrics a host records: one inference measurement set
 * per invoked provider call, one duration per tool body, and the prompt's agent-level duration and call
 * counts. Provider-derived samples are left out when the batch omitted provider children, and
 * tool-derived ones when it omitted tool children, because a bounded child list cannot prove a complete
 * total. Cache hits and refused calls were not inferences, and permission decisions have no duration, so
 * they produce nothing. Like the span projection, it is pure and content-free.
 */
export function projectLivePromptMetricSamples(
  batch: ILivePromptTraceBatch, options: IOtelMetricSampleOptions,
): IOtelMetricSample[] {
  const agent: TOtelAttributes = options.agentName ? { 'gen_ai.agent.name': options.agentName } : {};
  const samples: IOtelMetricSample[] = [];
  const providerComplete = batch.omittedChildren.provider === 0;
  const toolComplete = batch.omittedChildren.tool === 0;
  let invokedCalls = 0;
  let toolBodies = 0;

  for (const child of batch.children) {
    if (child.kind !== 'provider' || child.trace.disposition !== 'invoked') continue;
    invokedCalls += 1;
    if (providerComplete) samples.push(...providerCallSamples(child.trace));
  }
  for (const child of batch.children) {
    if (child.kind !== 'tool') continue;
    toolBodies += 1;
    const duration = toolComplete ? seconds(child.trace.startedAt, child.trace.endedAt) : undefined;
    if (duration === undefined) continue;
    const toolName = label(child.trace.toolName);
    samples.push({
      name: 'gen_ai.execute_tool.duration', instrument: 'histogram', unit: 's', value: duration,
      boundaries: GEN_AI_DURATION_BUCKETS_S,
      attributes: {
        ...(toolName ? { 'gen_ai.tool.name': toolName } : {}), ...agent,
        ...(child.trace.outcome === 'failure' ? ERROR_TYPE : {}),
      },
    });
  }

  const rootDuration = seconds(batch.root.startedAt, batch.root.endedAt);
  if (rootDuration !== undefined) samples.push({
    name: 'gen_ai.invoke_agent.duration', instrument: 'histogram', unit: 's', value: rootDuration,
    boundaries: GEN_AI_AGENT_DURATION_BUCKETS_S,
    attributes: { ...agent, ...(batch.root.outcome === 'failure' ? ERROR_TYPE : {}) },
  });
  if (providerComplete) samples.push({
    name: 'gen_ai.invoke_agent.inference_calls', instrument: 'histogram', unit: '{inference_call}',
    value: invokedCalls, attributes: agent, boundaries: GEN_AI_CALL_COUNT_BUCKETS,
  });
  if (toolComplete) samples.push({
    name: 'gen_ai.invoke_agent.tool_calls', instrument: 'histogram', unit: '{tool_call}',
    value: toolBodies, attributes: agent, boundaries: GEN_AI_CALL_COUNT_BUCKETS,
  });
  return samples;
}
