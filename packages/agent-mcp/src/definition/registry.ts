/**
 * The definition registry the activation controller enumerates (MCP-001).
 *
 * `MCPActivationController` was written against `IMCPActivationDefinitionRegistry.list()` and never
 * had a producer — the fourth symptom in MCP-001's Problem section. This adapter is that producer:
 * it turns resolved definitions into the activation requests the admission service already knows
 * how to judge, using the identity this package now computes.
 *
 * Entries that cannot become an activation subject are left out, and each omission is a decision
 * with a reason rather than a silent drop:
 *
 * - `unresolved` — there is no definition to activate. It stays visible in the management listing,
 *   which is where an operator reads why.
 * - `disabled` — the operator has already said no for now. Offering it for approval would invite
 *   re-enabling it by a different route than the one that disabled it.
 */

import { activationIdentity } from './identity.js';
import { isDisabled } from './overlay.js';

import type { IMCPActivationDefinitionRegistry } from '../mcp-activation-controller.js';
import type {
  IMCPActivationProvenance,
  IMCPActivationRequest,
  IMCPActivationWorkspace,
} from '../mcp-activation.js';
import type { IMCPResolvedEntry } from './types.js';

/**
 * How a definition's origin becomes activation provenance.
 *
 * `version` is the definition fingerprint: MCP-2520 already invalidates an approval when
 * provenance changes, so binding the version to the fingerprint makes a rewritten definition read
 * as a new provenance generation rather than the same one.
 */
function provenanceOf(entry: IMCPResolvedEntry, fingerprint: string): IMCPActivationProvenance {
  return { kind: entry.source, id: entry.origin, version: fingerprint };
}

/**
 * The endpoint an activation request carries.
 *
 * A stdio definition has no URL, and inventing one would put a fabricated address into an audit
 * record. Its command line is the thing being admitted, so that is what is named.
 */
function endpointOf(entry: IMCPResolvedEntry): string {
  const definition = entry.definition;
  if (definition === undefined) return '';
  if (definition.url !== undefined) return definition.url;
  const args = definition.args ?? [];
  return [definition.command ?? '', ...args].join(' ').trim();
}

export interface IMCPDefinitionRegistryOptions {
  /** Workspace trust state, passed through to the admission service unchanged. */
  readonly workspace?: IMCPActivationWorkspace;
}

/** A registry over one resolved set. */
export class MCPDefinitionRegistry implements IMCPActivationDefinitionRegistry {
  constructor(
    private readonly entries: readonly IMCPResolvedEntry[],
    private readonly options: IMCPDefinitionRegistryOptions = {},
  ) {}

  list(): readonly IMCPActivationRequest[] {
    const requests: IMCPActivationRequest[] = [];
    for (const entry of this.entries) {
      if (entry.status !== 'resolved' || isDisabled(entry)) continue;
      const identity = activationIdentity(entry);
      if (identity === null) continue;
      const request: IMCPActivationRequest = {
        serverId: identity.serverId,
        endpoint: endpointOf(entry),
        source: entry.source,
        provenance: provenanceOf(entry, identity.definitionFingerprint),
        definitionFingerprint: identity.definitionFingerprint,
        securityIdentity: identity.securityIdentity,
        ...(this.options.workspace === undefined ? {} : { workspace: this.options.workspace }),
      };
      requests.push(request);
    }
    return requests;
  }

  /** Display names for the controller's summaries — the server name, keyed by id. */
  displayNames(): ReadonlyMap<string, string> {
    return new Map(this.entries.map((entry) => [entry.name, entry.name]));
  }
}
