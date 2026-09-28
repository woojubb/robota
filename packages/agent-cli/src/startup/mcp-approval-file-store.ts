import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

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
 * Owner-only decisions shared across CLI starts. Reads withhold all approvals on an invalid file;
 * writes refuse it intact so a different version's decisions and audit history are never erased.
 * A write locks before reading, so concurrent writers cannot restore an earlier approval over a
 * rejection. A busy lock refuses the write rather than blocking the CLI.
 */
export function createFileMcpApprovalStore(filePath: string): IMCPActivationApprovalStore {
  function read(strict = false): IPersistedApprovals {
    try {
      tightenExistingFile(filePath);
      const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
      if (
        !isRecordObject(parsed) ||
        parsed['version'] !== STORE_VERSION ||
        !Array.isArray(parsed['records']) ||
        !parsed['records'].every(isApprovalRecord) ||
        !Array.isArray(parsed['audit']) ||
        !parsed['audit'].every(isAuditEvent)
      ) {
        throw new Error('Unrecognised approval store');
      }
      return { version: STORE_VERSION, records: parsed['records'], audit: parsed['audit'] };
    } catch (error) {
      if (isRecordObject(error) && error['code'] === 'ENOENT') {
        return { version: STORE_VERSION, records: [], audit: [] };
      }
      if (strict)
        throw new Error(
          `Refusing to write unreadable or unrecognised MCP approval store ${filePath}; repair or move it aside first.`,
        );
      return { version: STORE_VERSION, records: [], audit: [] };
    }
  }

  function update(change: (store: IPersistedApprovals) => IPersistedApprovals): void {
    mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
    const lockPath = `${filePath}.lock`;
    let lock: number;
    try {
      lock = openSync(lockPath, 'wx', 0o600);
    } catch {
      throw new Error(
        `Refusing to write MCP approval store ${filePath}: another writer holds ${lockPath}. Retry after it finishes; remove a stale lock only after that process has stopped.`,
      );
    }
    try {
      writeOwnerOnlyFile(filePath, `${JSON.stringify(change(read(true)), null, 2)}\n`);
    } finally {
      closeSync(lock);
      unlinkSync(lockPath);
    }
  }

  return {
    list: () => read().records,
    put(record) {
      update((store) => ({
        ...store,
        records: [...store.records.filter((existing) => !sameSlot(existing, record)), record],
      }));
    },
    putWithAudit(record, event) {
      update((store) => ({
        ...store,
        records: [...store.records.filter((existing) => !sameSlot(existing, record)), record],
        audit: [...store.audit, event].slice(-MAX_AUDIT_EVENTS),
      }));
    },
    listAudit: () => read().audit,
    appendAudit(event) {
      update((store) => ({ ...store, audit: [...store.audit, event].slice(-MAX_AUDIT_EVENTS) }));
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
