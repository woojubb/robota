import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  IMemoryCandidate,
  IMemoryPendingRecord,
  TMemoryCandidateStatus,
} from './automatic-memory-types.js';

interface IPendingMemoryDocument {
  version: 1;
  records: IMemoryPendingRecord[];
}

const PENDING_FILENAME = 'pending.json';

function memoryRoot(cwd: string): string {
  return join(cwd, '.robota', 'memory');
}

function emptyDocument(): IPendingMemoryDocument {
  return { version: 1, records: [] };
}

export class PendingMemoryStore {
  private readonly path: string;
  private readonly now: () => Date;

  constructor(cwd: string, now: () => Date = () => new Date()) {
    this.path = join(memoryRoot(cwd), PENDING_FILENAME);
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
    if (!existsSync(this.path)) return emptyDocument();
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as IPendingMemoryDocument;
      return { version: 1, records: parsed.records ?? [] };
    } catch {
      return emptyDocument();
    }
  }

  private write(document: IPendingMemoryDocument): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(document, null, 2), 'utf8');
  }
}
