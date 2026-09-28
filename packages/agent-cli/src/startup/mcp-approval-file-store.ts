import { existsSync, readFileSync } from 'node:fs';

import { tightenExistingFile, writeOwnerOnlyFile } from '@robota-sdk/agent-core/node';

import { userPaths } from '../product/user-paths.js';

import type {
  IMCPActivationApprovalRecord,
  IMCPActivationApprovalStore,
  IMCPActivationAuditEvent,
} from '@robota-sdk/agent-mcp';

const STORE_VERSION = 1;
/** The audit trail keeps the most recent decisions; older ones fall off rather than grow the file. */
const MAX_AUDIT_EVENTS = 500;
const DECISIONS = new Set(['approved', 'rejected', 'revoked']);
const SOURCES = new Set(['managed', 'user', 'project', 'plugin', 'local']);

interface IPersistedApprovals {
  readonly version: typeof STORE_VERSION;
  readonly records: IMCPActivationApprovalRecord[];
  readonly audit: IMCPActivationAuditEvent[];
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isApprovalRecord(value: unknown): value is IMCPActivationApprovalRecord {
  if (!isRecordObject(value)) return false;
  const provenance = value['provenance'];
  return (
    typeof value['serverId'] === 'string' &&
    typeof value['source'] === 'string' &&
    SOURCES.has(value['source']) &&
    isRecordObject(provenance) &&
    typeof provenance['kind'] === 'string' &&
    typeof provenance['id'] === 'string' &&
    typeof value['definitionFingerprint'] === 'string' &&
    typeof value['securityIdentity'] === 'string' &&
    typeof value['approvalAuthority'] === 'string' &&
    SOURCES.has(value['approvalAuthority']) &&
    typeof value['decision'] === 'string' &&
    DECISIONS.has(value['decision']) &&
    typeof value['decidedAt'] === 'string' &&
    (value['repositoryKey'] === undefined || typeof value['repositoryKey'] === 'string') &&
    (value['workspaceGeneration'] === undefined || typeof value['workspaceGeneration'] === 'number')
  );
}

function isAuditEvent(value: unknown): value is IMCPActivationAuditEvent {
  return (
    isRecordObject(value) &&
    typeof value['action'] === 'string' &&
    typeof value['serverId'] === 'string' &&
    typeof value['decision'] === 'string' &&
    typeof value['at'] === 'string'
  );
}

/** Two records for one server, decided by one authority, in one repository, are the same slot. */
function sameSlot(a: IMCPActivationApprovalRecord, b: IMCPActivationApprovalRecord): boolean {
  return (
    a.serverId === b.serverId &&
    a.approvalAuthority === b.approvalAuthority &&
    (a.repositoryKey ?? '') === (b.repositoryKey ?? '')
  );
}

/**
 * MCP approvals kept in one owner-only JSON file, so an approval outlives the process that made it.
 *
 * Every call reads the file again, so two sessions see each other's decisions and a write never
 * drops one made elsewhere since. A file that is missing, unreadable or not this shape reads as no
 * decisions: that only withholds approval, and the next decision writes a valid file. Records that
 * do not match the shape are dropped for the same reason.
 */
export function createFileMcpApprovalStore(filePath: string): IMCPActivationApprovalStore {
  function read(): IPersistedApprovals {
    if (!existsSync(filePath)) return { version: STORE_VERSION, records: [], audit: [] };
    try {
      tightenExistingFile(filePath);
      const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
      if (!isRecordObject(parsed) || parsed['version'] !== STORE_VERSION) {
        return { version: STORE_VERSION, records: [], audit: [] };
      }
      const records = Array.isArray(parsed['records']) ? parsed['records'] : [];
      const audit = Array.isArray(parsed['audit']) ? parsed['audit'] : [];
      return {
        version: STORE_VERSION,
        records: records.filter(isApprovalRecord),
        audit: audit.filter(isAuditEvent),
      };
    } catch {
      // allow-fallback: an unreadable store withholds approval; see the doc comment above.
      return { version: STORE_VERSION, records: [], audit: [] };
    }
  }

  function write(store: IPersistedApprovals): void {
    writeOwnerOnlyFile(filePath, `${JSON.stringify(store, null, 2)}\n`);
  }

  return {
    list: () => read().records,
    put(record) {
      const store = read();
      write({
        ...store,
        records: [...store.records.filter((existing) => !sameSlot(existing, record)), record],
      });
    },
    listAudit: () => read().audit,
    appendAudit(event) {
      const store = read();
      write({ ...store, audit: [...store.audit, event].slice(-MAX_AUDIT_EVENTS) });
    },
  };
}

/**
 * The approval store a CLI session uses: the host's own when it supplies one, otherwise the user's
 * `mcp-approvals.json`, so an approval outlives the process that made it.
 */
export function resolveMcpApprovalStore(
  supplied: IMCPActivationApprovalStore | undefined,
  home?: string,
): IMCPActivationApprovalStore {
  return supplied ?? createFileMcpApprovalStore(userPaths(home).mcpApprovals);
}
