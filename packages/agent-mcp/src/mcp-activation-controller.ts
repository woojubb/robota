import { MCPActivationPolicyError } from './mcp-activation.js';

import type {
  IMCPActivationRequest,
  IMCPActivationStatusResult,
  MCPActivationAdmissionService,
} from './mcp-activation.js';

export interface IMCPActivationDefinitionRegistry {
  list(): readonly IMCPActivationRequest[];
}

/** Secret-free controller adapter for composition roots and command host adapters. */
export interface IMCPActivationSummary extends IMCPActivationStatusResult {
  readonly displayName?: string;
  readonly provenanceId: string;
}

/**
 * Definition lookup stays separate from policy, so status can enumerate candidates without opening
 * a connection and command effects can resolve one exact candidate before mutating its decision.
 */
export class MCPActivationController {
  constructor(
    private readonly definitions: IMCPActivationDefinitionRegistry,
    private readonly admission: MCPActivationAdmissionService,
    private readonly displayNames: ReadonlyMap<string, string> = new Map(),
  ) {}

  list(): readonly IMCPActivationSummary[] {
    return this.definitions
      .list()
      .map((request) => this.toSummary(this.admission.inspect(request)));
  }

  approve(serverId: string): IMCPActivationSummary {
    return this.toSummary(this.decide(serverId, (request) => this.admission.approve(request)));
  }

  reject(serverId: string): IMCPActivationSummary {
    return this.toSummary(this.decide(serverId, (request) => this.admission.reject(request)));
  }

  revoke(serverId: string): IMCPActivationSummary {
    return this.toSummary(this.decide(serverId, (request) => this.admission.revoke(request)));
  }

  private decide(
    serverId: string,
    decision: (request: IMCPActivationRequest) => IMCPActivationStatusResult,
  ): IMCPActivationStatusResult {
    const request = this.definitions.list().find((candidate) => candidate.serverId === serverId);
    if (!request) {
      throw new MCPActivationPolicyError(`Unknown MCP server "${serverId}".`);
    }
    return decision(request);
  }

  private toSummary(result: IMCPActivationStatusResult): IMCPActivationSummary {
    const displayName = this.displayNames.get(result.serverId);
    return {
      ...result,
      provenanceId: result.provenance.id,
      ...(displayName === undefined ? {} : { displayName }),
    };
  }
}
