/**
 * Deciding — before the first model call — which transport can carry a schema. CORE-043.
 *
 * `robotaRunStructured` wrapped an ordinary run in a validate-and-retry loop and asked the provider
 * for `responseFormat: 'json_schema'` unconditionally. A provider whose surface cannot express that
 * accepted the option and ignored it, so the schema never reached the model; the loop then spent its
 * full retry budget rediscovering that, and reported "failed schema validation after 3 attempts" —
 * a description of the symptom, on a fact that was knowable before anything was sent.
 *
 * The decision lives HERE, at the seam that builds the wire option, rather than in
 * `robotaRunStructured`. That function has no provider — it composes a run out of the public API and
 * never sees which model will serve it, so a decision made there would have to guess at exactly the
 * thing being decided. `buildChatResponseFormat` is the one place every structured request passes
 * through with the resolved provider in hand.
 */

import { modelDeclaresCapability } from '../interfaces/model-capability.js';

import type { IProviderCapabilityTable } from '../interfaces/model-capability.js';
import type {
  IProviderStructuredOutputCapability,
  TStructuredOutputMechanism,
} from '../interfaces/structured-output-capability.js';

export interface IStructuredOutputResolutionInput {
  /** The provider's own declaration, or `undefined` when it declares nothing. */
  table: IProviderCapabilityTable | undefined;
  /**
   * Which model will serve the request. Required, not optional.
   *
   * Capability is a property of a (provider, model) pair — `deepseek-chat` and `deepseek-reasoner`
   * differ — so an optional model argument would let a caller ask a question that has no answer and
   * receive a confident one.
   */
  model: string;
  /**
   * Whether the provider is pointed at its vendor's own endpoint (CORE-043).
   *
   * Deliberately NOT a field on the capability table. Endpoint identity and capability declaration
   * are independent facts: a provider that declines to declare a table — because it has no verified
   * source for one — must still be able to say it is pointed at a gateway. Coupling them would force
   * that provider to invent a table in order to report an endpoint, which is exactly the fabricated
   * claim PROV-006 refused to make. `undefined` means the provider did not say.
   */
  endpointIsVendorDefault?: boolean | undefined;
}

/** Which transport the declared capabilities imply, most capable first. */
function mechanismFor(
  table: IProviderCapabilityTable | undefined,
  model: string,
): TStructuredOutputMechanism {
  if (modelDeclaresCapability(table, model, 'json_schema') === true) {
    return 'response_schema';
  }
  if (modelDeclaresCapability(table, model, 'json_object') === true) {
    return 'json_object';
  }
  return 'none';
}

/**
 * What this model can be asked for, and how confident that answer is.
 *
 * A model absent from a table's deviations resolves to the vendor default — that is the table's own
 * miss policy (PROV-006), not a guess made here. What this function adds is the record of WHICH of
 * those routes produced the answer, because a caller told "no schema transport" deserves to know
 * whether that was declared for this model or inherited from a baseline.
 */
export function resolveStructuredOutputCapability(
  input: IStructuredOutputResolutionInput,
): IProviderStructuredOutputCapability {
  const { table, model, endpointIsVendorDefault } = input;

  if (!table) {
    // Silence is not denial (PROV-006). A provider that declares nothing has said nothing, and
    // resolving that to `'none'` would strip a working `json_schema` from every provider that simply
    // has no verified table yet — reading a gap in our own records as a limitation of the vendor.
    // The request goes out as asked; `provenance` is what carries the uncertainty.
    if (endpointIsVendorDefault === false) {
      return {
        mechanism: 'response_schema',
        provenance: 'unverified-endpoint',
        reason:
          'a custom baseURL is configured and the provider declares no capability table, so nothing here can claim the endpoint enforces the schema',
      };
    }
    return {
      mechanism: 'response_schema',
      provenance: 'undeclared',
      reason:
        'the provider declares no capability table, so the request is sent as asked — silence is not a denial',
    };
  }

  const mechanism = mechanismFor(table, model);
  const declaredForThisModel = table.deviations?.[model] !== undefined;

  if (endpointIsVendorDefault === false) {
    return {
      mechanism,
      provenance: 'unverified-endpoint',
      reason:
        'a custom baseURL is configured, so the vendor capability table describes the protocol but not necessarily the endpoint serving it',
    };
  }

  return {
    mechanism,
    provenance: declaredForThisModel ? 'catalog' : 'vendor-default',
    ...(mechanism === 'none' && {
      reason: `${model} declares no schema transport, so the schema travels in the prompt and is enforced by validation`,
    }),
    ...(mechanism === 'json_object' && {
      reason: `${model} guarantees JSON but not its shape, so the schema travels in the prompt and is enforced by validation`,
    }),
  };
}
