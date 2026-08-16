/**
 * How a (provider, model) pair can be asked for structured output, and how sure we are. CORE-043.
 *
 * The runtime had no way to know whether the attempt it was wrapping carried a schema at all. A
 * provider whose surface cannot express `json_schema` accepted the request and ignored it, the
 * retry loop saw prose, and the caller got "failed schema validation after 3 attempts" — three full
 * model calls to discover something knowable before the first was sent.
 *
 * Two axes, not one. An earlier shape proposed a flat `'native' | 'none' | 'unknown'`, which kept the
 * axis the runtime does not act on and discarded the one that decides what gets sent:
 *
 * - **mechanism** — WHICH transport carries the schema. This is what changes the request.
 * - **provenance** — WHERE the answer came from, and therefore how much to trust it. `'unknown'` was
 *   never a capability; it is unverified provenance, and separating the two lets a known mechanism
 *   coexist with an endpoint that may not honour it.
 *
 * Both vocabularies list only what something in this repository actually produces. A member no
 * resolver can emit is a branch consumers must handle and no test can reach.
 */

/** Which transport can carry a schema to this model. */
export type TStructuredOutputMechanism =
  /** A first-class schema parameter the endpoint enforces — Gemini `responseSchema`, OpenAI `json_schema`. */
  | 'response_schema'
  /** JSON is guaranteed, the SHAPE is not — DeepSeek. A schema must reach the model as prose. */
  | 'json_object'
  /** Nothing on the wire can carry it; the schema travels in the prompt and is validated afterwards. */
  | 'none';

/** Where the mechanism answer came from, and therefore how far to trust it. */
export type TStructuredOutputProvenance =
  /** The provider package declared this model's capabilities explicitly. */
  | 'catalog'
  /** The provider's vendor default applied — no model-specific declaration exists. */
  | 'vendor-default'
  /** The provider declares no capability table, so nothing is known about this model. */
  | 'undeclared'
  /**
   * A `baseURL` points somewhere this package cannot identify, so the vendor's own guarantees do not
   * necessarily hold — a gateway may accept the parameter and forward a request that ignores it.
   *
   * The mechanism is still reported: the request is still worth sending the declared way. What
   * changes is that a schema violation downstream is explainable rather than surprising.
   */
  | 'unverified-endpoint';

export interface IProviderStructuredOutputCapability {
  mechanism: TStructuredOutputMechanism;
  provenance: TStructuredOutputProvenance;
  /** Why, in one clause, when the answer is not the obvious one. Carried into the outcome report. */
  reason?: string;
}
