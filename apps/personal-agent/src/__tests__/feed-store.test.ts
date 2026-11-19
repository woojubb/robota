import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  it.each([
    ['approval', 'sync-failure'],
    ['question', 'sync-failure'],
    ['approval', 'read-only'],
    ['question', 'read-only'],
    ['approval', 'commit-read-only'],
    ['question', 'commit-read-only'],
  ] as const)(
    'recovers a failed %s post after %s',
    async (kind, failure) => {
      if (process.platform === 'win32') return;
      const root = directory();
      const moduleUrl = new URL('../feed-store.ts', import.meta.url).href;
      const program = `
        import fs from 'node:fs';
        import path from 'node:path';
        import { syncBuiltinESMExports } from 'node:module';
        let armed = false, renamed = false, committing = false;
        const rename = fs.renameSync, sync = fs.fsyncSync;
        fs.renameSync = (source, target) => {
          const result = rename(source, target);
          if (armed && String(target).endsWith('/goals/feed.json')) renamed = true;
          if (armed && String(target).endsWith('/goals/feed-commit-uncertain.json')) committing = true;
          return result;
        };
        fs.fsyncSync = fd => {
          if (armed && (${JSON.stringify(failure)} === 'commit-read-only' ? committing : renamed) && fs.fstatSync(fd).isDirectory()) {
            armed = false;
            if (${JSON.stringify(failure)} !== 'sync-failure') fs.chmodSync(path.join(${JSON.stringify(root)}, 'goals'), 0o500);
            throw Object.assign(new Error('directory sync failed'), { code: 'EIO' });
          }
          return sync(fd);
        };
        syncBuiltinESMExports();
        const { createSharedFeedStore } = await import(${JSON.stringify(moduleUrl)});
        const { GoalBook, CaseBook, createFileCaseStore } = await import('@robota-sdk/agent-product/personal');
        const book = new GoalBook({ store: createSharedFeedStore(${JSON.stringify(root)}) });
        const cases = new CaseBook({ store: createFileCaseStore(path.join(${JSON.stringify(root)}, 'cases')), feed: book });
        const opened = await cases.open({ title: 'Case', noticed: 'A decision.', source: 'fixture' });
        armed = true;
        let failed = false;
        try {
          if (${JSON.stringify(kind)} === 'question') await cases.ask(opened.case.id, { question: 'Continue?' });
          else await book.post({ kind: 'approval', title: 'Action', body: '',
            approval: { tool: 'ConnectorAct', detail: 'Send', state: 'pending' } });
        } catch { failed = true; }
        if (${JSON.stringify(failure)} !== 'sync-failure') fs.chmodSync(path.join(${JSON.stringify(root)}, 'goals'), 0o700);
        fs.writeSync(1, JSON.stringify({ failed, feed: await book.feed(), question: (await cases.get(opened.case.id)).question ?? null }));
      `;
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '-e', program],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let output = '';
      let errors = '';
      child.stdout!.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.stderr!.on('data', (chunk: Buffer) => {
        errors += chunk.toString();
      });
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once('exit', resolve);
        child.once('error', reject);
      });
      expect(code, errors).toBe(0);
      expect(JSON.parse(output)).toEqual({ failed: true, feed: [], question: null });
    },
    15_000,
  );

  it('keeps an uncertain commit closed after a restart', async () => {
    const root = directory();
    const store = createSharedFeedStore(root);
    writeFileSync(join(root, 'goals', 'feed.json'), JSON.stringify({ [approval.id]: approval }));
    writeFileSync(
      join(root, 'goals', 'feed-commit-uncertain.json'),
      JSON.stringify({ id: '12345678-1234-1234-1234-123456789abc', previous: {} }),
    );
    await expect(store.listFeed(10)).rejects.toThrow(/commit outcome is uncertain/u);
  });

  it('does not restore another instance’s committed feed using an older failed record', async () => {
    if (process.platform === 'win32') return;
    const root = directory();
    const moduleUrl = new URL('../feed-store.ts', import.meta.url).href;
    const program = `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const rename = fs.renameSync, sync = fs.fsyncSync, remove = fs.rmSync;
      let phase = 0;
      fs.renameSync = (source, target) => {
        const result = rename(source, target);
        if (phase === 0 && String(target).endsWith('/goals/feed-commit-uncertain.json')) phase = 1;
        return result;
      };
      fs.fsyncSync = fd => {
        if (fs.fstatSync(fd).isDirectory() && phase === 1) { phase = 2; throw new Error('commit sync failed'); }
        if (fs.fstatSync(fd).isDirectory() && phase === 3) { phase = 4; throw new Error('restore sync failed'); }
        return sync(fd);
      };
      fs.rmSync = (path, options) => {
        if (String(path).endsWith('/goals/feed-commit-uncertain.json') && phase === 2) {
          const result = remove(path, options); phase = 3; return result;
        }
        if (String(path).endsWith('/goals/feed-commit-uncertain.json') && phase === 4) {
          phase = 5; throw new Error('cleanup failed');
        }
        return remove(path, options);
      };
      syncBuiltinESMExports();
      const { createSharedFeedStore } = await import(${JSON.stringify(moduleUrl)});
      const first = createSharedFeedStore(${JSON.stringify(root)});
      const second = createSharedFeedStore(${JSON.stringify(root)});
      const item = ${JSON.stringify(approval)};
      let failed = false, blocked = false;
      try { await first.putFeedItem(item); } catch { failed = true; }
      await second.putFeedItem({ ...item, id: 'feed-second' });
      try { await first.listFeed(10); } catch (error) { blocked = String(error).includes('commit outcome is uncertain'); }
      const file = JSON.parse(fs.readFileSync(${JSON.stringify(join(root, 'goals', 'feed.json'))}, 'utf8'));
      fs.writeSync(1, JSON.stringify({ failed, blocked, retained: Boolean(file['feed-second']) }));
    `;
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', program],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    let errors = '';
    child.stdout!.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr!.on('data', (chunk: Buffer) => {
      errors += chunk.toString();
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('exit', resolve);
      child.once('error', reject);
    });
    expect(code, errors).toBe(0);
    expect(JSON.parse(output)).toEqual({ failed: true, blocked: true, retained: true });
  }, 15_000);

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
