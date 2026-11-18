import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createSharedFeedStore } from '../feed-store.js';
import type { IFeedItem } from '@robota-sdk/agent-product/personal';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function directory(): string {
  const path = mkdtempSync(join(tmpdir(), 'personal-feed-'));
  directories.push(path);
  return path;
}

const approval: IFeedItem = {
  id: 'feed-approval',
  at: '2026-01-01T00:00:00.000Z',
  kind: 'approval',
  title: 'Case',
  body: 'Approve this action',
  dismissed: false,
  approval: { tool: 'ConnectorAct', detail: 'send to alice', state: 'pending' },
};

describe('the shared feed', () => {
  it('does not let a stale item change an approved call or restore pending', async () => {
    const store = createSharedFeedStore(directory());
    await store.putFeedItem(approval);
    const approved: IFeedItem = {
      ...approval,
      approval: { ...approval.approval!, state: 'approved' },
    };
    await store.putFeedItem(approved);
    await expect(store.putFeedItem(approval)).rejects.toThrow(/approval changed/u);
    await expect(
      store.putFeedItem({
        ...approved,
        approval: { ...approved.approval!, detail: 'send to bob' },
      }),
    ).rejects.toThrow(/approval changed/u);
    await expect(
      store.putFeedItem(
        {
          ...approved,
          approval: { ...approved.approval!, detail: 'send to bob', state: 'expired' },
        },
        { cancelApproved: true },
      ),
    ).rejects.toThrow(/approval changed/u);
    expect(await store.getFeedItem(approval.id)).toEqual(approved);
    const expired: IFeedItem = {
      ...approved,
      approval: { ...approved.approval!, state: 'expired' },
    };
    await store.putFeedItem(expired, { cancelApproved: true });
    expect((await store.getFeedItem(approval.id))?.approval?.state).toBe('expired');
  });

  it('retains an approval posted while another process is rewriting the feed', async () => {
    if (process.platform === 'win32') return;
    const root = directory();
    const store = createSharedFeedStore(root);
    const moduleUrl = new URL('../feed-store.ts', import.meta.url).href;
    const program = `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const rename = fs.renameSync;
      fs.renameSync = (source, target) => {
        if (String(target).endsWith('/goals/feed.json')) {
          fs.writeSync(1, 'ready\\n');
          process.kill(process.pid, 'SIGSTOP');
        }
        return rename(source, target);
      };
      syncBuiltinESMExports();
      const { createSharedFeedStore } = await import(${JSON.stringify(moduleUrl)});
      const store = createSharedFeedStore(${JSON.stringify(root)});
      await store.putFeedItem({ id: 'feed-notice', at: '2026-01-01T00:00:00.000Z',
        kind: 'notice', title: 'Notice', body: '', dismissed: false });
    `;
    const child = spawn(
      process.execPath,
      ['--conditions=source', '--import', 'tsx', '--input-type=module', '-e', program],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    const exited = new Promise<void>((resolve, reject) => {
      child.once('exit', (code) =>
        code === 0 ? resolve() : reject(new Error(`writer exited: ${code}`)),
      );
      child.once('error', reject);
    });
    let pending: Promise<void> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout!.once('data', () => resolve());
        child.once('error', reject);
        child.once('exit', () => reject(new Error('writer exited before the test')));
      });
      let completed = false;
      pending = store.putFeedItem(approval).then(() => {
        completed = true;
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
      expect(completed).toBe(false);
      child.kill('SIGCONT');
      await Promise.all([exited, pending]);
      expect((await store.listFeed(10)).map((item) => item.id).sort()).toEqual([
        'feed-approval',
        'feed-notice',
      ]);
    } finally {
      child.kill('SIGCONT');
      child.kill('SIGKILL');
      await Promise.allSettled([exited, ...(pending === undefined ? [] : [pending])]);
    }
  }, 15_000);
});
