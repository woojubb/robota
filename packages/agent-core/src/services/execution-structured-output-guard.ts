/**
 * Making a structured request survive a provider that cannot carry the schema. CORE-043.
 *
 * Two defects, one seam. The turn asked every provider for `responseFormat: 'json_schema'`; a
 * provider whose surface cannot express that accepted the option and dropped it. And the only place
 * the schema was ever stated in words is `buildRetryFeedbackInput` — which runs on ATTEMPT TWO. So
 * for a provider without a schema parameter, attempt one was sent with nothing describing the shape
 * at all, and was therefore guaranteed to fail. The advertised "3 attempts" were really two, and the
 * first was spent discovering something the capability table already knew.
 *
 * Both are fixed where the request is assembled, because that is the only point that holds the
 * resolved provider AND the outgoing messages at once. `robotaRunStructured` holds neither: it
 * composes a turn out of the public API and never learns which model will serve it.
 */

import { resolveStructuredOutputCapability } from './structured-output-transport.js';
import { randomId } from '../utils/random-id.js';

import type { IResolvedProviderInfo } from './execution-types';
import type { ISystemMessage, TUniversalMessage } from '../interfaces/messages';
import type { IChatOptions } from '../interfaces/provider';
import type { IProviderStructuredOutputCapability } from '../interfaces/structured-output-capability';

/**
 * What actually happened to a structured request.
 *
 * Reports the OUTCOME, not the resolution. "This provider declares json_schema" is a fact about a
 * table; "the schema was sent as a parameter and no prompt statement was needed" is a fact about the
 * request that was made, and only the second one explains a result the caller is holding.
 */
export interface IStructuredOutputTransportOutcome {
  capability: IProviderStructuredOutputCapability;
  /** What was ultimately put on the wire — `'omitted'` when no response-format option was sent. */
  sent: 'json_schema' | 'json_object' | 'omitted';
  /** Whether the schema was stated in the prompt because the wire could not carry it. */
  schemaInPrompt: boolean;
}

/** The aligned request: what to send, and the record of why it looks that way. */
export interface IStructuredOutputTransportPlan {
  /**
   * The messages to send. A NEW array when an instruction was added — never the caller's own.
   * `conversationMessages` is conversation history; appending a per-request instruction to it would
   * persist a transport workaround into the conversation and repeat it every following round.
   */
  messages: TUniversalMessage[];
  outcome: IStructuredOutputTransportOutcome | undefined;
}

/**
 * State the schema in words, for a model that will not receive it as a parameter.
 *
 * Deliberately the same instruction the retry path already uses, rather than a second phrasing: a
 * model that fails and retries should not be told the requirement in two different ways.
 */
function schemaInstruction(schema: Record<string, unknown>): string {
  return [
    'Respond with ONLY a JSON object (no prose, no code fences) matching this JSON schema:',
    JSON.stringify(schema),
  ].join('\n');
}

/**
 * Align a structured request with what the provider can actually honour.
 *
 * Mutates `chatOptions` and appends to `messages` in place, matching `applyModelToolCapability`
 * alongside it — the request is assembled once per turn, and a second assembly path is how the
 * capability answers drifted apart before.
 *
 * Returns the outcome, or `undefined` when the request was not structured at all.
 */
export function applyStructuredOutputTransport(
  chatOptions: IChatOptions,
  messages: TUniversalMessage[],
  model: string,
  resolved: IResolvedProviderInfo,
): IStructuredOutputTransportPlan {
  const requested = chatOptions.responseFormat;
  if (requested?.type !== 'json_schema') return { messages, outcome: undefined };

  const capability = resolveStructuredOutputCapability({
    table: resolved.provider.capabilityTable?.(),
    model,
    endpointIsVendorDefault: resolved.provider.endpointIsVendorDefault?.(),
  });

  if (capability.mechanism === 'response_schema') {
    return { messages, outcome: { capability, sent: 'json_schema', schemaInPrompt: false } };
  }

  // The shape cannot ride on the wire, so it rides in the prompt — on the FIRST attempt, which is
  // the attempt that previously had no statement of the requirement at all.
  const instruction: ISystemMessage = {
    role: 'system',
    content: schemaInstruction(requested.schema),
    id: randomId(),
    timestamp: new Date(),
    state: 'complete',
  };
  const outgoing = [...messages, instruction];

  if (capability.mechanism === 'json_object') {
    // Still worth sending: it does not enforce the shape, but it does remove the prose and the code
    // fences that are the most common reason the parse step fails before validation is even reached.
    chatOptions.responseFormat = { type: 'json_object' };
    return {
      messages: outgoing,
      outcome: { capability, sent: 'json_object', schemaInPrompt: true },
    };
  }

  // `'none'` and any undeclared provider: sending an option the endpoint ignores tells the caller
  // nothing and risks a hard rejection from a strict gateway. Omit it and rely on the prompt.
  delete chatOptions.responseFormat;
  return { messages: outgoing, outcome: { capability, sent: 'omitted', schemaInPrompt: true } };
}
