/** Host-owned admission for the official SDK stdio transport. */
import { snapshotFor, revalidateSnapshot } from './stdio-authority.js';
import { MCPStdioTransport } from './stdio-transport.js';
import { definitionFingerprint, securityIdentity } from '../definition/identity.js';

import type { IMCPTransportAdapter, TMCPTransportAdmission } from './transport.js';
import type { IMCPServerDefinitionResolved } from '../definition/types.js';
import type { IMCPActivationAdmission, IMCPActivationRequest } from '../mcp-activation.js';

export interface IMCPStdioExecutable {
  readonly command: string;
  /** Every vector is one exact command line the host permits. */
  readonly args: readonly (readonly string[])[];
}

export interface IMCPStdioAuthority {
  readonly allowedRoot: string;
  /** Changing this value invalidates every existing admitted snapshot. */
  readonly generation: string;
  readonly executables: readonly IMCPStdioExecutable[];
  /** Only host-selected values are passed to the child. */
  readonly environment?: Readonly<Record<string, string>>;
  /** Definition env keys must be explicitly allowed and their values match host-selected values. */
  readonly allowedEnvironmentKeys?: readonly string[];
  readonly startupMs?: number;
  readonly cleanupMs?: number;
}

export interface IMCPStdioInput {
  readonly definition: IMCPServerDefinitionResolved;
  readonly activation: IMCPActivationRequest;
}

/** An opaque capability; only the creating adapter can construct from it. */
export interface IMCPAdmittedStdioEndpoint {
  readonly kind: 'stdio';
}

export interface IMCPStdioAdapterOptions {
  readonly admission: IMCPActivationAdmission;
  readonly authority: IMCPStdioAuthority;
}

export interface IMCPStdioSnapshot {
  readonly command: string;
  readonly canonicalCommand: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly canonicalRoot: string;
  readonly env: Readonly<Record<string, string>>;
  readonly requestedEnvKeys: readonly string[];
  readonly generation: string;
  readonly startupMs: number;
  readonly cleanupMs: number;
  readonly activation: IMCPActivationRequest;
}

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
