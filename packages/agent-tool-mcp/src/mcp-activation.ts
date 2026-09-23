/**
 * MCP activation is a policy boundary, not a transport concern.
 *
 * The request deliberately contains only public identity material. Connection secrets such as
 * API keys and arbitrary headers stay in IMCPConfig and are never persisted in this ledger.
 */

export type TMCPActivationSource = 'managed' | 'user' | 'project' | 'plugin' | 'local';

export type TMCPWorkspaceTrustState =
  | 'trusted'
  | 'untrusted'
  | 'revoked'
  | 'stale/replaced'
  | 'identity-unavailable'
  | 'store-unavailable';

export interface IMCPActivationProvenance {
  readonly kind: TMCPActivationSource;
  readonly id: string;
  readonly version?: string;
}

export interface IMCPActivationWorkspace {
  readonly repositoryKey: string;
  readonly trustState: TMCPWorkspaceTrustState;
  readonly generation: number;
}

/**
 * Exact, secret-free identity of one resolved MCP definition.
 * `endpoint` is used only by the live client and must not be copied into approval/audit records.
 */
export interface IMCPActivationRequest {
  readonly serverId: string;
  readonly endpoint: string;
  readonly source: TMCPActivationSource;
  readonly provenance: IMCPActivationProvenance;
  readonly definitionFingerprint: string;
  readonly securityIdentity: string;
  readonly workspace?: IMCPActivationWorkspace;
}

export type TMCPActivationStatus =
  'approved' | 'pending' | 'rejected' | 'revoked' | 'stale' | 'untrusted';

export type TMCPApprovalAuthority = 'managed' | 'user' | 'local' | 'project' | 'plugin';

export interface IMCPActivationApprovalRecord {
  readonly serverId: string;
  readonly source: TMCPActivationSource;
  readonly provenance: IMCPActivationProvenance;
  readonly definitionFingerprint: string;
  readonly securityIdentity: string;
  readonly approvalAuthority: TMCPApprovalAuthority;
  readonly decision: Extract<TMCPActivationStatus, 'approved' | 'rejected' | 'revoked'>;
  readonly repositoryKey?: string;
  readonly workspaceGeneration?: number;
  readonly decidedAt: string;
}

/** Public audit data. It intentionally has no endpoint, API key, or arbitrary request headers. */
export interface IMCPActivationAuditEvent {
  readonly action: 'approve' | 'reject' | 'revoke';
  readonly serverId: string;
  readonly source: TMCPActivationSource;
  readonly provenanceId: string;
  readonly definitionFingerprint: string;
  readonly securityIdentity: string;
  readonly decision: Extract<TMCPActivationStatus, 'approved' | 'rejected' | 'revoked'>;
  readonly at: string;
}

export interface IMCPActivationApprovalStore {
  list(): readonly IMCPActivationApprovalRecord[];
  put(record: IMCPActivationApprovalRecord): void;
  listAudit(): readonly IMCPActivationAuditEvent[];
  appendAudit(event: IMCPActivationAuditEvent): void;
}

export interface IMCPActivationStatusResult {
  readonly serverId: string;
  readonly source: TMCPActivationSource;
  readonly status: TMCPActivationStatus;
  readonly allowed: boolean;
  readonly reason: string;
  readonly provenance: IMCPActivationProvenance;
  readonly definitionFingerprint: string;
  readonly securityIdentity: string;
  readonly approval?: IMCPActivationApprovalRecord;
}

/** The single admission port every MCP transport/client must consume. */
export interface IMCPActivationAdmission {
  inspect(request: IMCPActivationRequest): IMCPActivationStatusResult;
  admit(request: IMCPActivationRequest): IMCPActivationStatusResult;
}

const AUTHORITY_PRIORITY: Record<TMCPApprovalAuthority, number> = {
  managed: 3,
  user: 2,
  local: 1,
  project: 0,
  plugin: 0,
};

export class InMemoryMCPActivationApprovalStore implements IMCPActivationApprovalStore {
  private readonly records: IMCPActivationApprovalRecord[] = [];
  private readonly audit: IMCPActivationAuditEvent[] = [];

  list(): readonly IMCPActivationApprovalRecord[] {
    return this.records.slice();
  }

  put(record: IMCPActivationApprovalRecord): void {
    const index = this.records.findIndex(
      (candidate) =>
        candidate.serverId === record.serverId &&
        candidate.approvalAuthority === record.approvalAuthority,
    );
    if (index === -1) {
      this.records.push(record);
    } else {
      this.records[index] = record;
    }
  }

  listAudit(): readonly IMCPActivationAuditEvent[] {
    return this.audit.slice();
  }

  appendAudit(event: IMCPActivationAuditEvent): void {
    this.audit.push(event);
  }
}

function requiresTrustedWorkspace(source: TMCPActivationSource): boolean {
  return source === 'project' || source === 'plugin' || source === 'local';
}

function isExactMatch(
  request: IMCPActivationRequest,
  record: IMCPActivationApprovalRecord,
): boolean {
  const workspaceMatches = requiresTrustedWorkspace(request.source)
    ? record.repositoryKey === request.workspace?.repositoryKey &&
      record.workspaceGeneration === request.workspace?.generation
    : record.repositoryKey === undefined && record.workspaceGeneration === undefined;

  return (
    record.serverId === request.serverId &&
    record.source === request.source &&
    record.provenance.kind === request.provenance.kind &&
    record.provenance.id === request.provenance.id &&
    record.provenance.version === request.provenance.version &&
    record.definitionFingerprint === request.definitionFingerprint &&
    record.securityIdentity === request.securityIdentity &&
    workspaceMatches
  );
}

function statusResult(
  request: IMCPActivationRequest,
  status: TMCPActivationStatus,
  reason: string,
  approval?: IMCPActivationApprovalRecord,
): IMCPActivationStatusResult {
  return {
    serverId: request.serverId,
    source: request.source,
    status,
    allowed: status === 'approved',
    reason,
    provenance: request.provenance,
    definitionFingerprint: request.definitionFingerprint,
    securityIdentity: request.securityIdentity,
    ...(approval === undefined ? {} : { approval }),
  };
}

export class MCPActivationPolicyError extends Error {
  readonly code = 'MCP_ACTIVATION_POLICY_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'MCPActivationPolicyError';
  }
}

/**
 * Default policy implementation. It is synchronous by design so status inspection cannot perform
 * I/O or accidentally activate a server; durable hosts inject an equivalent store adapter.
 */
export class MCPActivationAdmissionService implements IMCPActivationAdmission {
  constructor(
    private readonly store: IMCPActivationApprovalStore = new InMemoryMCPActivationApprovalStore(),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  inspect(request: IMCPActivationRequest): IMCPActivationStatusResult {
    if (requiresTrustedWorkspace(request.source) && request.workspace?.trustState !== 'trusted') {
      return statusResult(
        request,
        'untrusted',
        'MCP activation requires a trusted workspace for project, plugin, and local definitions.',
      );
    }

    const records = this.store
      .list()
      .filter((record) => record.serverId === request.serverId)
      .sort((left, right) => {
        const priority =
          AUTHORITY_PRIORITY[right.approvalAuthority] - AUTHORITY_PRIORITY[left.approvalAuthority];
        return priority || right.decidedAt.localeCompare(left.decidedAt);
      });
    if (records.length === 0) {
      return statusResult(
        request,
        'pending',
        'No explicit trust approval exists for this MCP definition.',
      );
    }

    const approval = records.find((record) => isExactMatch(request, record));
    if (approval) {
      return statusResult(
        request,
        approval.decision,
        approval.decision === 'approved'
          ? 'MCP definition is explicitly approved.'
          : `MCP definition is ${approval.decision}.`,
        approval,
      );
    }

    return statusResult(
      request,
      'stale',
      'The MCP definition, provenance, security identity, or workspace generation changed after approval.',
    );
  }

  admit(request: IMCPActivationRequest): IMCPActivationStatusResult {
    return this.inspect(request);
  }

  approve(
    request: IMCPActivationRequest,
    authority: TMCPApprovalAuthority = 'user',
  ): IMCPActivationStatusResult {
    if (authority === 'project' || authority === 'plugin') {
      throw new MCPActivationPolicyError(
        'Project and plugin definitions may request approval but cannot approve themselves.',
      );
    }
    if (requiresTrustedWorkspace(request.source) && request.workspace?.trustState !== 'trusted') {
      return this.inspect(request);
    }

    const record = this.createRecord(request, authority, 'approved');
    this.store.put(record);
    this.audit(request, record);
    return this.inspect(request);
  }

  reject(
    request: IMCPActivationRequest,
    authority: TMCPApprovalAuthority = 'user',
  ): IMCPActivationStatusResult {
    if (authority === 'project' || authority === 'plugin') {
      throw new MCPActivationPolicyError(
        'Project and plugin definitions may request approval but cannot reject on behalf of the operator.',
      );
    }
    const record = this.createRecord(request, authority, 'rejected');
    this.store.put(record);
    this.audit(request, record);
    return this.inspect(request);
  }

  revoke(
    request: IMCPActivationRequest,
    authority: TMCPApprovalAuthority = 'user',
  ): IMCPActivationStatusResult {
    if (authority === 'project' || authority === 'plugin') {
      throw new MCPActivationPolicyError(
        'Project and plugin definitions may request approval but cannot revoke operator approval.',
      );
    }
    const record = this.createRecord(request, authority, 'revoked');
    this.store.put(record);
    this.audit(request, record);
    return this.inspect(request);
  }

  getApprovalStore(): IMCPActivationApprovalStore {
    return this.store;
  }

  listAudit(): readonly IMCPActivationAuditEvent[] {
    return this.store.listAudit();
  }

  private createRecord(
    request: IMCPActivationRequest,
    authority: TMCPApprovalAuthority,
    decision: Extract<TMCPActivationStatus, 'approved' | 'rejected' | 'revoked'>,
  ): IMCPActivationApprovalRecord {
    return {
      serverId: request.serverId,
      source: request.source,
      provenance: request.provenance,
      definitionFingerprint: request.definitionFingerprint,
      securityIdentity: request.securityIdentity,
      approvalAuthority: authority,
      decision,
      ...(requiresTrustedWorkspace(request.source)
        ? {
            repositoryKey: request.workspace?.repositoryKey,
            workspaceGeneration: request.workspace?.generation,
          }
        : {}),
      decidedAt: this.now(),
    };
  }

  private audit(request: IMCPActivationRequest, record: IMCPActivationApprovalRecord): void {
    this.store.appendAudit({
      action:
        record.decision === 'approved'
          ? 'approve'
          : record.decision === 'rejected'
            ? 'reject'
            : 'revoke',
      serverId: request.serverId,
      source: request.source,
      provenanceId: request.provenance.id,
      definitionFingerprint: request.definitionFingerprint,
      securityIdentity: request.securityIdentity,
      decision: record.decision,
      at: record.decidedAt,
    });
  }
}

export function createFailClosedMCPActivationAdmission(
  reason = 'MCP activation requires an explicit trust admission.',
): IMCPActivationAdmission {
  return {
    inspect: (request) => statusResult(request, 'pending', reason),
    admit: (request) => statusResult(request, 'pending', reason),
  };
}
