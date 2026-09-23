/**
 * Leaf type module for the stdio transport/authority contract.
 *
 * Split out of `stdio.ts` so `stdio-transport.ts` and `stdio-authority.ts` can depend on these
 * types without importing back from `stdio.ts`, which previously created import cycles between
 * `stdio.ts` and each of them.
 */
import type { IMCPActivationRequest } from '../mcp-activation.js';
import type { IMCPServerDefinitionResolved } from '../definition/types.js';
import type { IMCPActivationAdmission } from '../mcp-activation.js';

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
