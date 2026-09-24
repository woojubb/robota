/**
 * Which trace context, if any, one invoked provider call carries.
 *
 * Resolved at the invocation boundary rather than while assembling the request, so a cache hit or a
 * preflight refusal never resolves one and the replay channel's `provider_request` is recorded from
 * options that do not contain it.
 */
import { outboundTraceContextFor } from '../utils/trace-context';

import type { IResolvedProviderInfo } from './execution-types';
import type { IChatOptions } from '../interfaces/provider';
import type { IOutboundTraceContext, IRunTraceContext } from '../interfaces/trace-context';

export function resolveProviderCallTraceContext(
  traceContext: IRunTraceContext | undefined,
  provider: IResolvedProviderInfo['provider'],
  providerId: string,
  callId: string,
): IOutboundTraceContext | undefined {
  if (traceContext === undefined) return undefined;
  let capable = false;
  try {
    capable = provider.canPropagateTraceContext?.() === true;
  } catch {
    // allow-fallback: a capability probe that throws is a provider that cannot propagate.
    capable = false;
  }
  if (!capable) {
    try {
      traceContext.onPropagationUnavailable?.(providerId);
    } catch {
      // A host diagnostic must never fail the provider call it describes.
    }
    return undefined;
  }
  return outboundTraceContextFor(traceContext, callId);
}

/** The options handed to the adapter: unchanged when there is nothing to propagate. */
export function withOutboundTraceContext(
  options: IChatOptions,
  outbound: IOutboundTraceContext | undefined,
): IChatOptions {
  return outbound === undefined ? options : { ...options, outboundTraceContext: outbound };
}
