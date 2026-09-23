/** Host-owned admission for the official SDK stdio transport. */
import { snapshotFor, revalidateSnapshot } from './stdio-authority.js';
import { MCPStdioTransport } from './stdio-transport.js';
import { definitionFingerprint, securityIdentity } from '../definition/identity.js';

import type { IMCPTransportAdapter, TMCPTransportAdmission } from './transport.js';
import type { IMCPActivationRequest } from '../mcp-activation.js';
import type {
  IMCPAdmittedStdioEndpoint,
  IMCPStdioAdapterOptions,
  IMCPStdioInput,
  IMCPStdioSnapshot,
} from './stdio-types.js';

// Re-exported so every existing import of these names keeps working: the split moved where they
// are DECLARED (`stdio-types.ts`), and moving where they are imported from would be a migration
// this change is not.
export type {
  IMCPAdmittedStdioEndpoint,
  IMCPStdioAdapterOptions,
  IMCPStdioAuthority,
  IMCPStdioExecutable,
  IMCPStdioInput,
  IMCPStdioSnapshot,
} from './stdio-types.js';

function identityMatches({ definition, activation }: IMCPStdioInput): boolean {
  const fingerprint = definitionFingerprint(definition);
  const identity = securityIdentity({
    name: definition.name,
    source: definition.source,
    origin: definition.origin,
    status: 'resolved',
    definition,
    shadowed: [],
  });
  return (
    activation.serverId === definition.name &&
    activation.source === definition.source &&
    activation.provenance.kind === definition.source &&
    activation.provenance.id === definition.origin &&
    activation.provenance.version === fingerprint &&
    activation.definitionFingerprint === fingerprint &&
    activation.securityIdentity === identity &&
    activation.endpoint === [definition.command ?? '', ...(definition.args ?? [])].join(' ').trim()
  );
}

function refused(reason: string): TMCPTransportAdmission<IMCPAdmittedStdioEndpoint> {
  return { ok: false, reason, message: `Stdio transport refused: ${reason}` };
}

function copyActivation(request: IMCPActivationRequest): IMCPActivationRequest {
  return Object.freeze({
    ...request,
    provenance: Object.freeze({ ...request.provenance }),
    ...(request.workspace === undefined
      ? {}
      : { workspace: Object.freeze({ ...request.workspace }) }),
  });
}

/** Activation is consumed before touching host env or constructing a transport. */
export function createStdioAdapter(
  options: IMCPStdioAdapterOptions,
): IMCPTransportAdapter<IMCPStdioInput, IMCPAdmittedStdioEndpoint> {
  const admittedSnapshots = new WeakMap<IMCPAdmittedStdioEndpoint, IMCPStdioSnapshot>();
  return {
    kind: 'stdio',
    async admit(input) {
      try {
        const boundInput = {
          definition: input.definition,
          activation: copyActivation(input.activation),
        };
        if (!identityMatches(boundInput)) return refused('definition-identity');
        const result = options.admission.admit(boundInput.activation);
        if (
          !result.allowed ||
          result.status !== 'approved' ||
          result.definitionFingerprint !== boundInput.activation.definitionFingerprint ||
          result.securityIdentity !== boundInput.activation.securityIdentity
        )
          return refused('activation');
        const snapshot = await snapshotFor(boundInput, options.authority);
        if (snapshot === undefined || !identityMatches(boundInput)) return refused('authority');
        const admitted: IMCPAdmittedStdioEndpoint = Object.freeze({ kind: 'stdio' });
        admittedSnapshots.set(admitted, snapshot);
        return { ok: true, admitted };
      } catch {
        return refused('invalid-input');
      }
    },
    construct(admitted) {
      const snapshot = admittedSnapshots.get(admitted);
      if (snapshot === undefined) throw new Error('Stdio transport refused: invalid admission');
      return new MCPStdioTransport(snapshot, () => revalidateSnapshot(snapshot, options));
    },
  };
}
