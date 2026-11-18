/** Durable cancellation intents survive a feed lock or an interrupted shutdown. */
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

export interface IApprovalIdentity {
  readonly id: string;
  readonly goalId: string | undefined;
  readonly runId: string | undefined;
  readonly tool: string;
  readonly detail: string;
}

export interface IApprovalCancellations {
  mark(expected: IApprovalIdentity): void;
  list(): readonly IApprovalIdentity[];
  finish(expected: IApprovalIdentity): void;
}

const FEED_ID = /^feed-[a-z0-9]{1,40}$/u;

function syncDirectory(path: string): void {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function parse(value: unknown): IApprovalIdentity {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Invalid cancellation');
  const item = value as Record<string, unknown>;
  if (
    typeof item['id'] !== 'string' ||
    !FEED_ID.test(item['id']) ||
    (item['goalId'] !== undefined && typeof item['goalId'] !== 'string') ||
    (item['runId'] !== undefined && typeof item['runId'] !== 'string') ||
    typeof item['tool'] !== 'string' ||
    typeof item['detail'] !== 'string'
  )
    throw new Error('Invalid cancellation');
  return {
    id: item['id'],
    goalId: item['goalId'],
    runId: item['runId'],
    tool: item['tool'],
    detail: item['detail'],
  };
}

export function createApprovalCancellations(stateDir: string): IApprovalCancellations {
  const directory = join(stateDir, 'approval-cancellations');
  const pathOf = (id: string): string => {
    if (!FEED_ID.test(id)) throw new Error('Invalid approval id');
    return join(directory, `${id}.json`);
  };
  const read = (path: string): IApprovalIdentity | undefined => {
    try {
      return parse(JSON.parse(readFileSync(path, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new Error('An approval cancellation cannot be read');
    }
  };
  const same = (a: IApprovalIdentity, b: IApprovalIdentity): boolean =>
    a.id === b.id &&
    a.goalId === b.goalId &&
    a.runId === b.runId &&
    a.tool === b.tool &&
    a.detail === b.detail;
  return {
    mark(expected) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      syncDirectory(dirname(directory));
      const path = pathOf(expected.id);
      const existing = read(path);
      if (existing !== undefined) {
        if (!same(existing, expected)) throw new Error('The approval cancellation changed');
        return;
      }
      const temporary = join(directory, `${randomUUID()}.tmp`);
      let created = false;
      try {
        const fd = openSync(temporary, 'wx', 0o600);
        created = true;
        try {
          writeFileSync(fd, `${JSON.stringify(expected)}\n`);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        renameSync(temporary, path);
        syncDirectory(directory);
      } finally {
        if (created) rmSync(temporary, { force: true });
      }
    },
    list() {
      try {
        return readdirSync(directory)
          .filter((name) => name.endsWith('.json'))
          .map((name) => {
            const item = read(join(directory, name));
            if (item === undefined || name !== `${item.id}.json`)
              throw new Error('Invalid cancellation');
            return item;
          });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw new Error('Approval cancellations cannot be read');
      }
    },
    finish(expected) {
      const path = pathOf(expected.id);
      const existing = read(path);
      if (existing === undefined) return;
      if (!same(existing, expected)) throw new Error('The approval cancellation changed');
      const feed = join(stateDir, 'goals', 'feed.json');
      try {
        const fd = openSync(feed, 'r');
        try {
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      syncDirectory(join(stateDir, 'goals'));
      rmSync(path);
      syncDirectory(directory);
    },
  };
}
