import { containsSensitiveMemoryContent } from './memory-policy-evaluator.js';

import type { IMemoryPendingRecord } from './automatic-memory-types.js';
import type { IAppendMemoryResult } from './project-memory-store.js';
import type { IMemoryStore } from './types.js';

export interface IApprovedMemoryCandidate {
  record: IMemoryPendingRecord;
  saved: IAppendMemoryResult;
}

/**
 * The one approval path for a queued memory candidate. Only a `pending` candidate can be approved, and
 * its text is checked for sensitive content again, so a skipped, rejected or already-saved record — or
 * one that a stricter filter now flags — never reaches durable memory.
 */
export async function approvePendingMemoryCandidate(
  store: IMemoryStore,
  id: string,
): Promise<IApprovedMemoryCandidate> {
  const current = await store.getPending(id);
  if (!current) throw new Error(`Memory candidate not found: ${id}`);
  if (current.status !== 'pending') {
    throw new Error(
      `Memory candidate ${id} is ${current.status}; only pending candidates can be approved.`,
    );
  }
  if (containsSensitiveMemoryContent(current.text)) {
    throw new Error(`Memory candidate ${id} looks sensitive and cannot be saved.`);
  }
  const approved = await store.markPending(id, 'approved', 'approved-by-user');
  const saved = await store.append(approved);
  const record = await store.markPending(id, 'saved', 'approved-and-saved');
  return { record, saved };
}
