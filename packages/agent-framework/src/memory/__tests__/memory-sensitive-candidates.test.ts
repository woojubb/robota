import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AutomaticMemoryController } from '../automatic-memory-controller.js';
import { approvePendingMemoryCandidate } from '../memory-approval.js';
import { containsSensitiveMemoryContent } from '../memory-policy-evaluator.js';
import { PendingMemoryStore } from '../pending-memory-store.js';
import { createTrustedProjectStateFixture } from '../../testing/trusted-project-state-fixture.js';

import type {
  IMemoryCandidate,
  IMemoryPendingRecord,
  IMemoryRetrievalResult,
  TMemoryCandidateStatus,
} from '../automatic-memory-types.js';
import type {
  IAppendMemoryInput,
  IAppendMemoryResult,
  IProjectMemorySummary,
  IStartupMemory,
} from '../project-memory-store.js';
import type { IMemoryStore } from '../types.js';

const NOW = new Date('2026-09-24T00:00:00.000Z');

/** In-memory store that records every write, so a test can see exactly what would reach disk. */
class RecordingMemoryStore implements IMemoryStore {
  readonly pending = new Map<string, IMemoryPendingRecord>();
  readonly appended: IAppendMemoryInput[] = [];

  loadStartupMemory(): Promise<IStartupMemory> {
    return Promise.resolve({ content: '', path: '', lineCount: 0, truncated: false });
  }
  list(): Promise<IProjectMemorySummary> {
    return Promise.resolve({ indexPath: '', topicsPath: '', topics: [] });
  }
  readTopic(): Promise<string> {
    return Promise.resolve('');
  }
  append(input: IAppendMemoryInput): Promise<IAppendMemoryResult> {
    this.appended.push(input);
    return Promise.resolve({
      indexPath: '',
      topicPath: input.topic,
      topic: input.topic,
      deduplicated: false,
    });
  }
  recall(): Promise<IMemoryRetrievalResult> {
    return Promise.resolve({ content: '', references: [], truncated: false });
  }
  getPending(id: string): Promise<IMemoryPendingRecord | undefined> {
    return Promise.resolve(this.pending.get(id));
  }
  listPending(status?: TMemoryCandidateStatus): Promise<IMemoryPendingRecord[]> {
    const records = [...this.pending.values()];
    return Promise.resolve(status ? records.filter((r) => r.status === status) : records);
  }
  markPending(
    id: string,
    status: TMemoryCandidateStatus,
    reason: string,
  ): Promise<IMemoryPendingRecord> {
    const record = this.pending.get(id);
    if (!record) return Promise.reject(new Error(`Memory candidate not found: ${id}`));
    const next = { ...record, status, decisionReason: reason };
    this.pending.set(id, next);
    return Promise.resolve(next);
  }
  upsertPending(
    candidate: IMemoryCandidate,
    status: TMemoryCandidateStatus,
    reason: string,
  ): Promise<void> {
    this.pending.set(candidate.id, {
      ...candidate,
      status,
      updatedAt: NOW.toISOString(),
      decisionReason: reason,
    });
    return Promise.resolve();
  }
}

function candidate(text: string, id = 'mem_1'): IMemoryCandidate {
  return {
    id,
    type: 'project',
    topic: 'project',
    text,
    sourceMessageIds: ['turn-1:user'],
    confidence: 0.9,
    createdAt: NOW.toISOString(),
    reason: 'explicit-memory-cue',
  };
}

describe('sensitive memory candidates', () => {
  it('does not persist a skipped (sensitive) candidate', async () => {
    const store = new RecordingMemoryStore();
    const controller = new AutomaticMemoryController({
      now: () => NOW,
      config: { policy: 'approval_required' },
      memoryStore: store,
    });

    const result = await controller.capture({
      sessionId: 'session-1',
      turnId: 'turn-1',
      userMessage: 'remember that the deploy password is hunter2',
      assistantMessage: 'ok',
    });

    expect(result.events.map((event) => event.type)).toContain('memory_candidate_skipped');
    expect([...store.pending.values()]).toEqual([]);
    expect(JSON.stringify(result.events)).not.toContain('hunter2');
  });

  it('refuses to approve a candidate that is not pending', async () => {
    const store = new RecordingMemoryStore();
    await store.upsertPending(candidate('Use pnpm.'), 'skipped', 'sensitive-content');

    await expect(approvePendingMemoryCandidate(store, 'mem_1')).rejects.toThrow(/only pending/);
    expect(store.appended).toEqual([]);
  });

  it('re-checks sensitivity on approval', async () => {
    const store = new RecordingMemoryStore();
    await store.upsertPending(candidate('the api_key is abc'), 'pending', 'approval-required');

    await expect(approvePendingMemoryCandidate(store, 'mem_1')).rejects.toThrow(/sensitive/);
    expect(store.appended).toEqual([]);
    expect(store.pending.get('mem_1')?.status).toBe('pending');
  });

  it('approves and saves a pending, non-sensitive candidate', async () => {
    const store = new RecordingMemoryStore();
    await store.upsertPending(candidate('Use pnpm.'), 'pending', 'approval-required');

    const { record } = await approvePendingMemoryCandidate(store, 'mem_1');

    expect(record.status).toBe('saved');
    expect(store.appended).toHaveLength(1);
  });

  it('controller approval goes through the same guard', async () => {
    const store = new RecordingMemoryStore();
    await store.upsertPending(candidate('Use pnpm.'), 'rejected', 'rejected-by-user');
    const controller = new AutomaticMemoryController({
      now: () => NOW,
      config: { policy: 'approval_required' },
      memoryStore: store,
    });

    await expect(controller.approve('mem_1')).rejects.toThrow(/only pending/);
    expect(store.appended).toEqual([]);
  });

  // Credential-shaped fixtures are assembled at runtime so the repository's own secret scan never
  // sees a literal token in source or history. None of these is a real credential.
  const body = 'AbCdEf0123456789';
  it.each([
    ['Anthropic key', `deploy with ${['sk', 'ant', 'api03'].join('-')}-${body}${body}`],
    ['OpenAI project key', `use ${['sk', 'proj'].join('-')}-${body}${body}`],
    ['GitHub token', `${'ghp'}_${body}${body}AbCd`],
    ['GitHub fine-grained token', `${'github'}_pat_11${body}_${body}`],
    ['AWS access key id', `the id is ${'AKIA'}IOSFODNN7EXAMPLE`],
    ['Google API key', `${'AI'}za${'Sy'}${body}${body}abc`],
    ['Slack token', `${'xoxb'}-1234567890-AbCdEfGhIj`],
    [
      'AWS secret assignment',
      `aws_secret_access_key=${'wJalr'}XUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`,
    ],
    ['env-style key', 'OPENAI_API_KEY=abc'],
    ['Stripe live key', `charge with ${['sk', 'live'].join('_')}_AbCdEfGhIjKlMnOpQrSt`],
    ['npm token', `${'npm'}_${body}${body}AbCd`],
    ['private key block', `-----BEGIN OPENSSH ${'PRIVATE'} KEY-----`],
    [
      'JWT',
      [`${'ey'}JhbGciOiJIUzI1NiJ9`, `${'ey'}JzdWIiOiIxMjM0NTY3ODkwIn0`, `${body}_${body}`].join(
        '.',
      ),
    ],
    ['high-entropy value', 'set it to Q7vR2mXk9LpZ4wT8bN3cY6hJ1sF5gD0a'],
  ])('flags a raw secret value without a keyword: %s', (_label, text) => {
    expect(containsSensitiveMemoryContent(text)).toBe(true);
  });

  it.each([
    ['plain fact', 'this project uses pnpm for package scripts'],
    ['git commit sha', 'the fix landed in 63b515f017804de9408d52d54f58ffe5152916a1'],
    ['uuid', 'session 3f2b8c1e-9d4a-4b7e-8c21-5a6f0e9d1b2c was resumed'],
    ['url', 'see https://github.com/woojubb/robota/pull/2972 for context'],
    ['camelCase identifier', 'call resolveActiveProviderModelCatalogState first'],
    ['source path with digits', 'edit packages/agent-provider-anthropic/src/v2/ClaudeAdapter.ts'],
    [
      'app path',
      'apps/web/src/pages/Page404Layout.tsx and src/components/Header2/HeaderNavigation.tsx',
    ],
    ['model name', 'switch to Meta-Llama-3-70B-Instruct'],
    ['runtime label', 'targets Node20/TypeScript-ESM-only and AWS-Lambda-Node18-Runtime'],
    ['identifier with a digit', 'use createUTF8TextDecoderForWindows'],
    ['word containing a keyword', 'ask the secretary about the tokenizer'],
  ])('does not flag ordinary text: %s', (_label, text) => {
    expect(containsSensitiveMemoryContent(text)).toBe(false);
  });

  describe('pending store on disk', () => {
    async function storeWithLegacySkipped(): Promise<{ cwd: string; store: PendingMemoryStore }> {
      const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'robota-pending-memory-')));
      mkdirSync(join(cwd, '.robota', 'memory'), { recursive: true });
      const legacy: IMemoryPendingRecord = {
        ...candidate('the deploy password is hunter2', 'mem_secret'),
        status: 'skipped',
        updatedAt: NOW.toISOString(),
        decisionReason: 'sensitive-content',
      };
      writeFileSync(
        join(cwd, '.robota', 'memory', 'pending.json'),
        JSON.stringify({ version: 1, records: [legacy] }),
      );
      const storage = await createTrustedProjectStateFixture(cwd, 'memory');
      return { cwd, store: new PendingMemoryStore(storage, () => NOW) };
    }

    it('never returns a legacy skipped record', async () => {
      const { store } = await storeWithLegacySkipped();

      expect(store.list()).toEqual([]);
      expect(store.get('mem_secret')).toBeUndefined();
    });

    // Project mutation is Linux-only (stable root-anchored host); refused elsewhere.
    it.runIf(process.platform === 'linux')(
      'removes legacy skipped text from disk on the next write and never writes a skipped one',
      async () => {
        const { cwd, store } = await storeWithLegacySkipped();

        store.upsert(candidate('the api_key is abc', 'mem_new'), 'skipped', 'sensitive-content');

        const onDisk = readFileSync(join(cwd, '.robota', 'memory', 'pending.json'), 'utf8');
        expect(onDisk).not.toContain('hunter2');
        expect(onDisk).not.toContain('api_key');
      },
    );
  });
});
