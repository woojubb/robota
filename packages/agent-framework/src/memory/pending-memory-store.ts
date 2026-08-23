import { assertWorkspaceProjectStateStorage } from '../workspace-trust/index.js';

import type {
  IMemoryCandidate,
  IMemoryPendingRecord,
  TMemoryCandidateStatus,
} from './automatic-memory-types.js';
import type { IWorkspaceProjectStateStorage } from '../workspace-trust/index.js';

interface IPendingMemoryDocument {
  version: 1;
  records: IMemoryPendingRecord[];
}

const PENDING_FILENAME = 'pending.json';

function emptyDocument(): IPendingMemoryDocument {
  return { version: 1, records: [] };
}

export class PendingMemoryStore {
  private readonly path: string;
  private readonly now: () => Date;

  constructor(
    private readonly storage: IWorkspaceProjectStateStorage,
    now: () => Date = () => new Date(),
  ) {
    assertWorkspaceProjectStateStorage(storage);
    if (storage.namespace !== 'memory') {
      throw new Error('PendingMemoryStore requires the memory state namespace.');
    }
    this.path = storage.projectRelativePath(PENDING_FILENAME);
    this.now = now;
  }

  getPath(): string {
    return this.path;
  }

  list(status?: TMemoryCandidateStatus): IMemoryPendingRecord[] {
    const records = this.read().records;
    return status ? records.filter((record) => record.status === status) : records;
  }

  get(id: string): IMemoryPendingRecord | undefined {
    return this.read().records.find((record) => record.id === id);
  }

  upsert(candidate: IMemoryCandidate, status: TMemoryCandidateStatus, reason: string): void {
    const document = this.read();
    const updatedAt = this.now().toISOString();
    const existingIndex = document.records.findIndex((record) => record.id === candidate.id);
    const record: IMemoryPendingRecord = {
      ...candidate,
      status,
      updatedAt,
      decisionReason: reason,
    };
    if (existingIndex >= 0) {
      document.records[existingIndex] = { ...document.records[existingIndex], ...record };
    } else {
      document.records.push(record);
    }
    this.write(document);
  }

  mark(id: string, status: TMemoryCandidateStatus, reason: string): IMemoryPendingRecord {
    const document = this.read();
    const index = document.records.findIndex((record) => record.id === id);
    if (index < 0) throw new Error(`Memory candidate not found: ${id}`);
    const record = {
      ...document.records[index],
      status,
      updatedAt: this.now().toISOString(),
      decisionReason: reason,
    };
    document.records[index] = record;
    this.write(document);
    return record;
  }

  private read(): IPendingMemoryDocument {
    const raw = this.storage.readText(PENDING_FILENAME, 'load pending memory');
    if (raw === undefined) return emptyDocument();
    try {
      const parsed = JSON.parse(raw) as IPendingMemoryDocument;
      return { version: 1, records: parsed.records ?? [] };
    } catch {
      // allow-fallback: corrupt JSON treated as empty document
      return emptyDocument();
    }
  }

  private write(document: IPendingMemoryDocument): void {
    this.storage.writeText(
      PENDING_FILENAME,
      JSON.stringify(document, null, 2),
      'persist pending memory',
    );
  }
}
