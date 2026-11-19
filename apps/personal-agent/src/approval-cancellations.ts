/** Durable cancellation intents survive a feed lock or an interrupted shutdown. */
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { createFileGoalStore } from '@robota-sdk/agent-product/personal';

import { createSharedLock } from './shared-lock.js';

export interface IApprovalIdentity {
  readonly id: string;
  readonly goalId: string | undefined;
  readonly runId: string | undefined;
  readonly tool: string;
  readonly detail: string;
}

export interface IApprovalCancellations {
  mark(expected: IApprovalIdentity): void;
  authorize(
    expected: IApprovalIdentity,
    state: 'approved' | 'denied',
    stillWaiting: () => boolean,
    handoff: () => void,
  ): Promise<void>;
  list(): readonly IApprovalIntent[];
  finish(expected: IApprovalIdentity): Promise<void>;
}

export interface IApprovalIntent extends IApprovalIdentity {
  readonly phase: 'pending' | 'authorized';
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

function parse(value: unknown): IApprovalIntent {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Invalid cancellation');
  const item = value as Record<string, unknown>;
  if (
    typeof item['id'] !== 'string' ||
    !FEED_ID.test(item['id']) ||
    (item['goalId'] !== undefined && typeof item['goalId'] !== 'string') ||
    (item['runId'] !== undefined && typeof item['runId'] !== 'string') ||
    typeof item['tool'] !== 'string' ||
    typeof item['detail'] !== 'string' ||
    (item['phase'] !== undefined && item['phase'] !== 'pending' && item['phase'] !== 'authorized')
  )
    throw new Error('Invalid cancellation');
  return {
    id: item['id'],
    goalId: item['goalId'],
    runId: item['runId'],
    tool: item['tool'],
    detail: item['detail'],
    phase: item['phase'] ?? 'pending',
  };
}

export function createApprovalCancellations(stateDir: string): IApprovalCancellations {
  const directory = join(stateDir, 'approval-cancellations');
  const withFeedLock = createSharedLock(
    join(realpathSync(stateDir), '.feed-write.lock'),
    'The feed',
  );
  const feed = createFileGoalStore(join(stateDir, 'goals'));
  if (feed.durableFeedWrites !== true)
    throw new Error('The product SDK cannot safely store approvals');
  const pathOf = (id: string): string => {
    if (!FEED_ID.test(id)) throw new Error('Invalid approval id');
    return join(directory, `${id}.json`);
  };
  const read = (path: string): IApprovalIntent | undefined => {
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
  const write = (expected: IApprovalIdentity, phase: IApprovalIntent['phase']): void => {
    const path = pathOf(expected.id);
    const temporary = join(directory, `${randomUUID()}.tmp`);
    let created = false;
    try {
      const fd = openSync(temporary, 'wx', 0o600);
      created = true;
      try {
        writeFileSync(fd, `${JSON.stringify({ ...expected, phase })}\n`);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temporary, path);
      syncDirectory(directory);
    } finally {
      if (created) rmSync(temporary, { force: true });
    }
  };
  const syncFeed = (): void => {
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
  };
  return {
    mark(expected) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      syncDirectory(dirname(directory));
      const existing = read(pathOf(expected.id));
      if (existing !== undefined && !same(existing, expected))
        throw new Error('The approval cancellation changed');
      if (existing?.phase !== 'pending') write(expected, 'pending');
    },
    async authorize(expected, state, stillWaiting, handoff) {
      await withFeedLock(async () => {
        const existing = read(pathOf(expected.id));
        if (!stillWaiting()) throw new Error('The approval was cancelled');
        if (existing === undefined || !same(existing, expected) || existing.phase !== 'pending')
          throw new Error('The approval intent changed');
        const item = await feed.getFeedItem(expected.id);
        if (!stillWaiting()) throw new Error('The approval was cancelled');
        if (item === undefined) throw new Error('The recorded approval is no longer in the feed');
        if (
          item?.id !== expected.id ||
          item.goalId !== expected.goalId ||
          item.runId !== expected.runId ||
          item.approval?.tool !== expected.tool ||
          item.approval.detail !== expected.detail ||
          item.approval.state !== state
        )
          throw new Error('The recorded approval changed');
        syncFeed();
        write(expected, 'authorized');
        handoff();
      });
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
    async finish(expected) {
      await withFeedLock(async () => {
        const path = pathOf(expected.id);
        const existing = read(path);
        if (existing === undefined) return;
        if (!same(existing, expected)) throw new Error('The approval cancellation changed');
        await feed.listFeed(0);
        syncFeed();
        rmSync(path);
        syncDirectory(directory);
      });
    },
  };
}
