import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tightenExistingFile, writeOwnerOnlyFile } from '@robota-sdk/agent-core/node';
import type { ICliRuntimeContext } from '../product/runtime-context.js';
import type { IMcpSkillApproval, IMcpSkillApprovalStore } from './mcp-skill-registry.js';

function record(value: unknown): value is IMcpSkillApproval {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    ['scope', 'namespace', 'serverId', 'uri'].every((key) => typeof candidate[key] === 'string') &&
    typeof candidate['fingerprint'] === 'string' &&
    /^[a-f0-9]{64}$/.test(candidate['fingerprint'])
  );
}

/** Persistent content consent, separate from server trust; invalid stores withhold consent and are preserved. */
export function createFileMcpSkillApprovalStore(filePath: string): IMcpSkillApprovalStore {
  function read(strict = false): IMcpSkillApproval[] {
    try {
      tightenExistingFile(filePath);
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
      if (
        !parsed ||
        parsed['version'] !== 1 ||
        !Array.isArray(parsed['records']) ||
        !parsed['records'].every(record) ||
        new Set(parsed['records'].map((entry) => entry.namespace)).size !== parsed['records'].length
      )
        throw new Error('Unrecognised store');
      return parsed['records'];
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
        return [];
      if (strict)
        throw new Error('Refusing to write unreadable or unrecognised MCP skill approval store.');
      return [];
    }
  }
  function update(change: (records: IMcpSkillApproval[]) => IMcpSkillApproval[]): void {
    mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
    const lockPath = `${filePath}.lock`;
    let lock: number;
    try {
      lock = openSync(lockPath, 'wx', 0o600);
    } catch {
      throw new Error('Refusing to write MCP skill approval store: another writer holds its lock.');
    }
    try {
      writeOwnerOnlyFile(
        filePath,
        `${JSON.stringify({ version: 1, records: change(read(true)) }, null, 2)}\n`,
      );
    } finally {
      closeSync(lock);
      unlinkSync(lockPath);
    }
  }
  return {
    list: () => read(),
    put: (approval) => {
      if (!record(approval)) throw new Error('Invalid MCP skill approval.');
      update((records) => [
        ...records.filter((entry) => entry.namespace !== approval.namespace),
        approval,
      ]);
    },
    remove: (namespace) =>
      update((records) => records.filter((entry) => entry.namespace !== namespace)),
  };
}

export function resolveMcpSkillApprovalStore(runtime: ICliRuntimeContext): IMcpSkillApprovalStore {
  return createFileMcpSkillApprovalStore(join(runtime.layout.userRoot, 'mcp-skill-approvals.json'));
}
