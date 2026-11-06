/**
 * The project store gives a session one writer across store instances and processes, as the user's
 * store does: its claims hold the id's writer marker in `claims/` beside the project's records.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTrustedProjectSessionStoreFixture } from '../testing/trusted-project-state-fixture.js';

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'project-writer-marker-')));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function thrownBy(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

describe('a project session claimed by one store instance', () => {
  it.runIf(process.platform === 'linux')(
    'commits restore state only under a live project claim',
    async () => {
      const store = await createTrustedProjectSessionStoreFixture(root);
      const value = {
        id: 'sess_project',
        cwd: root,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        messages: [],
      };
      store.save(value);
      const claim = store.claim(value.id);
      try {
        expect(
          store.saveRestoreTransaction?.(
            { ...value, updatedAt: '2026-01-02T00:00:00.000Z' },
            { claim },
          ),
        ).toEqual({ status: 'committed' });
      } finally {
        claim.release();
      }
      expect(store.load(value.id)).toMatchObject({
        status: 'valid',
        record: { updatedAt: '2026-01-02T00:00:00.000Z' },
      });
      expect(store.saveRestoreTransaction?.(value, { claim })).toMatchObject({ status: 'unknown' });
    },
  );

  it('is refused to a second instance over the same project, and free once released', async () => {
    const first = await createTrustedProjectSessionStoreFixture(root);
    const second = await createTrustedProjectSessionStoreFixture(root);
    const claim = first.claim('sess_project', { fresh: true });

    expect(thrownBy(() => second.claim('sess_project'))).toMatchObject({
      code: 'SESSION_CLAIMED',
      reason: 'has_writer',
      holder: { pid: process.pid, self: true },
    });
    expect(second.hasWriter('sess_project')).toBe(true);
    expect(readdirSync(join(root, '.agent', 'sessions', 'claims'))).toEqual(['sess_project.owner']);

    claim.release();
    expect(second.hasWriter('sess_project')).toBe(false);
    second.claim('sess_project').release();
  });

  it('refuses a claims directory reached through a link, which could lie outside the project', async () => {
    mkdirSync(join(root, '.agent'), { recursive: true });
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'project-writer-elsewhere-')));
    try {
      symlinkSync(elsewhere, join(root, '.agent', 'sessions'), 'dir');
      await expect(createTrustedProjectSessionStoreFixture(root)).rejects.toThrow(/link/);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});

describe('two real processes on one project session', () => {
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
  const fixtureUrl = pathToFileURL(
    fileURLToPath(new URL('../testing/trusted-project-state-fixture.ts', import.meta.url)),
  ).href;
  const children: ChildProcess[] = [];

  afterEach(() => {
    for (const child of children.splice(0)) child.kill('SIGKILL');
  });

  async function claimIn(
    id: string,
  ): Promise<{ child: ChildProcess; report: Record<string, unknown> }> {
    const script = [
      `import { createTrustedProjectSessionStoreFixture } from ${JSON.stringify(fixtureUrl)};`,
      'const store = await createTrustedProjectSessionStoreFixture(process.argv[1]);',
      'try {',
      `  store.claim(${JSON.stringify(id)}, { fresh: true });`,
      "  process.stdout.write(JSON.stringify({ claimed: true }) + '\\n');",
      '  setInterval(() => {}, 1000);',
      '} catch (error) {',
      "  process.stdout.write(JSON.stringify({ claimed: false, reason: error.reason, holder: error.holder }) + '\\n');",
      '  process.exit(0);',
      '}',
    ].join('\n');
    const child = spawn(
      process.execPath,
      ['--import', tsx, '--conditions=source', '--input-type=module', '-e', script, root],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    children.push(child);
    const line = await new Promise<string>((resolve, reject) => {
      let out = '';
      child.stdout!.on('data', (chunk: Buffer) => {
        out += chunk.toString('utf8');
        if (out.includes('\n')) resolve(out.trim());
      });
      child.once('exit', (code, signal) => {
        if (!out.includes('\n')) reject(new Error(`child ended (${code}, ${signal})`));
      });
    });
    return { child, report: JSON.parse(line) as Record<string, unknown> };
  }

  it('refuses the second process, naming the first, and takes it once the first has exited', async () => {
    const holder = await claimIn('sess_project');
    expect(holder.report).toEqual({ claimed: true });
    const store = await createTrustedProjectSessionStoreFixture(root);

    expect(thrownBy(() => store.claim('sess_project'))).toMatchObject({
      reason: 'has_writer',
      holder: { pid: holder.child.pid, self: false },
    });

    const ended = new Promise((resolve) => holder.child.once('exit', resolve));
    holder.child.kill('SIGKILL');
    await ended;

    store.claim('sess_project').release();
  }, 60_000);

  it('refuses a second process while this one holds the claim', async () => {
    const claim = (await createTrustedProjectSessionStoreFixture(root)).claim('sess_project', {
      fresh: true,
    });
    try {
      const { report } = await claimIn('sess_project');
      expect(report).toMatchObject({
        claimed: false,
        reason: 'has_writer',
        holder: { pid: process.pid, self: false },
      });
    } finally {
      claim.release();
    }
  }, 60_000);
});
