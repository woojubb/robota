import { getProviderCapabilities } from '@robota-sdk/agent-core';
import type { IAIProvider } from '@robota-sdk/agent-core';
import { RuntimeParticipantError } from './errors';

/**
 * A host's declaration that a runtime's model calls can be bounded before dispatch. It is the
 * host's word, proven when the lease opens and repeated at every admission: a bound is only as
 * sound as these numbers.
 */
export interface RuntimeEnforcement {
  /** The most requests the provider client may bill for one call, retries included; no default. */
  providerAttempts: number;
  /** Tokens the provider adds to a request beyond its encoded size; no default. */
  requestOverheadTokens: number;
  /** Tools whose effects spend no model tokens. A tool in no list is refused. */
  freeTools?: readonly string[];
}

/** The selector's one decision tool is free by construction, so only the call bounds are declared. */
export type SelectorEnforcement = Pick<
  RuntimeEnforcement,
  'providerAttempts' | 'requestOverheadTokens'
>;

/** A validated {@link RuntimeEnforcement}. */
export interface CallEnforcement {
  providerAttempts: number;
  requestOverheadTokens: number;
  freeTools: ReadonlySet<string>;
}

function invalid(message: string): never {
  throw new RuntimeParticipantError('invalid-config', message);
}

/** Validate a host's declaration; nothing is defaulted. */
export function normalizeEnforcement(value: RuntimeEnforcement): CallEnforcement {
  if (typeof value !== 'object' || value === null)
    invalid('enforcement must be an object with providerAttempts and requestOverheadTokens');
  const { providerAttempts, requestOverheadTokens, freeTools } = value;
  if (!Number.isSafeInteger(providerAttempts) || providerAttempts < 1)
    invalid('enforcement.providerAttempts must be a positive safe integer');
  if (!Number.isSafeInteger(requestOverheadTokens) || requestOverheadTokens < 0)
    invalid('enforcement.requestOverheadTokens must be a non-negative safe integer');
  const names = new Set<string>();
  if (freeTools !== undefined) {
    if (!Array.isArray(freeTools)) invalid('enforcement.freeTools must be an array of tool names');
    for (const name of freeTools) {
      if (typeof name !== 'string' || name.length === 0)
        invalid('enforcement.freeTools must hold non-empty tool names');
      if (names.has(name)) invalid(`enforcement.freeTools names a tool twice: ${name}`);
      names.add(name);
    }
  }
  return { providerAttempts, requestOverheadTokens, freeTools: names };
}

/** What the adapter can see of a runtime when its lease opens. */
export interface EnforceableSurface {
  providers: readonly IAIProvider[];
  /** The agent-level output cap and the option that sets it, named in the refusal. */
  outputCap: number | undefined;
  outputCapField: string;
  /** Set only for a `Session`: whether it may compact its history on its own. */
  automaticCompaction?: boolean;
  toolNames: readonly string[];
  enforcement: CallEnforcement;
}

function unbounded(message: string): never {
  throw new RuntimeParticipantError('unbounded-call', message);
}

function usesHostedWebTools(provider: IAIProvider): boolean {
  try {
    const { webSearch, webFetch } = getProviderCapabilities(provider).nativeWebTools;
    return webSearch.enabled === true || webFetch.enabled === true;
  } catch {
    // A capability check that fails cannot show the provider is free of hosted tools.
    return true;
  }
}

/** Refuse, before any call, a runtime whose calls cannot each be given a bound. */
export function assertCallsAreBounded(surface: EnforceableSurface): void {
  const cap = surface.outputCap;
  if (typeof cap !== 'number' || !Number.isSafeInteger(cap) || cap <= 0)
    unbounded(
      `An enforced runtime needs a positive output cap (${surface.outputCapField}) so every call has a bound`,
    );
  if (surface.automaticCompaction === true)
    unbounded(
      'An enforced Session must disable automatic compaction: a compaction request carries no output cap',
    );
  if (surface.providers.some(usesHostedWebTools))
    unbounded(
      'An enforced runtime cannot use provider-hosted web tools: their usage is not bounded by the request',
    );
  const undeclared = surface.toolNames.find((name) => !surface.enforcement.freeTools.has(name));
  if (undeclared !== undefined)
    unbounded(`An enforced runtime must declare every tool free or paid: ${undeclared}`);
}
