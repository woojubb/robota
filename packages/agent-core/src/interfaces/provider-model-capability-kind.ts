/**
 * The vocabulary of per-model capability flags (PROV-006 / PROV-008).
 *
 * Extracted from `provider-definition.ts` into its own leaf module: `model-capability.ts` needs
 * only this vocabulary, not the rest of `provider-definition.ts` (which itself depends on
 * `IAIProvider` from `provider.ts`) — importing the whole module there created a module-level
 * import cycle (`provider.ts` -> `model-capability.ts` -> `provider-definition.ts` ->
 * `provider.ts`). `provider-definition.ts` re-exports this name, so existing
 * `from './provider-definition'` imports are unaffected.
 */
export type TProviderModelCapability =
  | 'tools'
  | 'vision'
  /** A first-class schema parameter the endpoint enforces. */
  | 'json_schema'
  /**
   * JSON is guaranteed, the SHAPE is not (CORE-043).
   *
   * Without this DeepSeek is unrepresentable: the vocabulary offered only `json_schema`, which
   * DeepSeek does not support, so its catalog entry was wrong and DELETING the entry would have left
   * it wrong in the other direction — silent about a real capability.
   */
  | 'json_object'
  | 'reasoning'
  | 'native_web'
  | 'streaming'
  /**
   * CLI-1990: the vendor documents a server-side tool search — deferred definitions the API expands
   * on demand. Declaration-only in v1: Robota runs its own client-side catalog on every provider
   * and emits no vendor block. The member exists so a later offload can be capability-gated in this
   * table rather than by provider name.
   */
  | 'tool_search';
