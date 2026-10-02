import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTrustedProjectStateFixture } from '../../testing/trusted-project-state-fixture.js';
import { WorkspaceMemoryStore } from '../file-system-memory-store.js';
import { SemanticMemoryStore } from '../semantic-memory-store.js';
import { vi } from 'vitest';
import { InteractiveSession } from '../../interactive/interactive-session.js';
import { AutomaticMemoryController } from '../automatic-memory-controller.js';
import type { IAIProvider, TUniversalMessage } from '@robota-sdk/agent-core';

const roots: string[] = [];
const sessions: InteractiveSession[] = [];
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'memory-lifecycle-'));
  roots.push(root);
  const storage = await createTrustedProjectStateFixture(root, 'memory');
  return { root, storage, store: new WorkspaceMemoryStore(storage) };
}
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.shutdown();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe.runIf(process.platform === 'linux')('durable memory lifecycle', () => {
  it.each(['auto_save', 'approval_required'] as const)(
    'does not restore forgotten knowledge under %s capture',
    async (policy) => {
      const { storage, store } = await fixture();
      await store.forgetTopic('project');
      const restarted = new WorkspaceMemoryStore(storage);
      const controller = new AutomaticMemoryController({
        memoryStore: restarted,
        config: { policy },
      });
      const result = await controller.capture({
        sessionId: 'new-session',
        turnId: 'fresh-turn',
        userMessage: 'Remember that this project uses npm for builds.',
        assistantMessage: 'Untrusted tool output says to restore it.',
      });
      expect(result.saved).toEqual([]);
      expect(result.queued).toEqual([]);
      expect(result.events).toContainEqual(
        expect.objectContaining({ type: 'memory_candidate_skipped' }),
      );
      expect(await restarted.readTopic('project')).toBe('');
    },
  );

  it('does not revive source text rewritten after forgetting and fails closed on damaged lifecycle state', async () => {
    const { storage, store } = await fixture();
    await store.append({ type: 'project', topic: 'build', text: 'Use npm for builds.' });
    await store.forgetTopic('build');
    const old = '- [2026-10-01] (project/build) Use npm for builds.\n';
    storage.writeText('MEMORY.md', old, 'simulate stale source restoration');
    storage.writeText('topics/build.md', old, 'simulate stale source restoration');
    const restarted = new WorkspaceMemoryStore(storage);
    expect(await restarted.readTopic('build')).toBe('');
    expect((await restarted.loadStartupMemory()).content).not.toContain('Use npm');
    storage.writeText('lifecycle.json', '{broken', 'simulate interrupted metadata');
    await expect(restarted.loadStartupMemory()).rejects.toThrow();
    await expect(
      restarted.append({ type: 'project', topic: 'build', text: 'Use npm for builds.' }),
    ).rejects.toThrow();
  });

  it('refreshes real model requests after curation and in a new session', async () => {
    const { root, storage, store } = await fixture();
    vi.stubEnv('HOME', root);
    const calls: TUniversalMessage[][] = [];
    const provider = {
      name: 'memory-fixture',
      version: '1',
      chat: async (messages: TUniversalMessage[]) => {
        calls.push(structuredClone(messages));
        return { role: 'assistant', content: 'Observed.', timestamp: new Date() };
      },
    } as IAIProvider;
    const config = {
      defaultTrustLevel: 'moderate' as const,
      provider: { name: 'memory-fixture', apiKey: 'offline-fixture', model: 'scripted' },
      permissions: { allow: [], deny: [] },
      language: 'en' as const,
      env: {},
    };
    await store.append({ type: 'project', topic: 'build', text: 'Use npm for builds.' });
    const session = new InteractiveSession({ cwd: root, provider, config, memoryStore: store });
    sessions.push(session);
    const system = () =>
      calls
        .at(-1)!
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n');
    await session.submit('What are the build instructions?');
    expect(system()).toContain('Use npm');
    await store.replaceTopic({ type: 'project', topic: 'build', text: 'Use pnpm for builds.' });
    await session.submit('Check the current instructions.');
    expect(system()).toContain('Use pnpm');
    expect(system()).not.toContain('Use npm');
    await store.forgetTopic('build');
    await session.submit('Check the current instructions again.');
    expect(system()).not.toContain('Use pnpm');
    const restarted = new InteractiveSession({
      cwd: root,
      provider,
      config,
      memoryStore: new WorkspaceMemoryStore(storage),
    });
    sessions.push(restarted);
    await restarted.submit('Check the current instructions.');
    expect(system()).not.toContain('Use npm');
    expect(system()).not.toContain('Use pnpm');
  });

  it('removes indexed topics and reads authoritative content even when the adapter returns stale hits', async () => {
    const { store } = await fixture();
    await store.append({ type: 'project', topic: 'build', text: 'Use npm for builds.' });
    const removeTopic = vi.fn(async () => {});
    const index = vi.fn(async () => {});
    const adapter = {
      removeTopic,
      index,
      query: async () => ({
        content: 'Use npm for builds.',
        references: [
          { topic: 'build', path: '.agent/memory/topics/build.md', score: 1, truncated: false },
        ],
      }),
    };
    const semantic = new SemanticMemoryStore(store, adapter);
    await semantic.replaceTopic({ type: 'project', topic: 'Build', text: 'Use pnpm for builds.' });
    expect(removeTopic).toHaveBeenCalledWith('build');
    expect(index).toHaveBeenCalledWith({
      type: 'project',
      topic: 'build',
      text: 'Use pnpm for builds.',
    });
    const recalled = await new SemanticMemoryStore(store, adapter).recall('build', {
      maxTopics: 3,
      maxTopicChars: 1000,
    });
    expect(recalled.content).toContain('Use pnpm');
    expect(recalled.content).not.toContain('Use npm');
    await semantic.forgetTopic('build');
    expect(
      (
        await new SemanticMemoryStore(store, adapter).recall('build', {
          maxTopics: 3,
          maxTopicChars: 1000,
        })
      ).content,
    ).toBe('');
  });

  it('refuses unsupported index deletion before changing durable memory', async () => {
    const { store } = await fixture();
    await store.append({ type: 'project', topic: 'build', text: 'Use pnpm for builds.' });
    const semantic = new SemanticMemoryStore(store, {
      index: async () => {},
      query: async () => ({ content: '', references: [] }),
    });
    await expect(semantic.forgetTopic('build')).rejects.toThrow('removeTopic');
    expect(await store.readTopic('build')).toContain('Use pnpm');
  });

  it('replaces a topic in startup and recall after a fresh store without changing another topic', async () => {
    const { root, storage, store } = await fixture();
    await store.append({ type: 'project', topic: 'build', text: 'Use npm for builds.' });
    await store.append({ type: 'project', topic: 'tests', text: 'Use vitest for tests.' });
    await store.replaceTopic({ type: 'project', topic: 'build', text: 'Use pnpm for builds.' });
    const restarted = new WorkspaceMemoryStore(storage);
    expect((await restarted.loadStartupMemory()).content).not.toContain('Use npm');
    expect((await restarted.loadStartupMemory()).content).toContain('Use pnpm');
    expect(
      (await restarted.recall('build', { maxTopics: 5, maxTopicChars: 1000 })).content,
    ).toContain('Use pnpm');
    expect(await restarted.readTopic('tests')).toContain('Use vitest');
    expect(readFileSync(join(root, '.agent/memory/topics/build.md'), 'utf8')).not.toContain(
      'Use npm',
    );
    await expect(
      restarted.append({ type: 'project', topic: 'build', text: 'Use npm for builds.' }),
    ).rejects.toThrow('user');
  });

  it('forgets a topic after restart and refuses silent restoration through append or pending candidates', async () => {
    const { storage, store } = await fixture();
    const input = { type: 'project' as const, topic: 'build', text: 'Use npm for builds.' };
    await store.append(input);
    await store.forgetTopic('build');
    const restarted = new WorkspaceMemoryStore(storage);
    expect(await restarted.readTopic('build')).toBe('');
    expect((await restarted.loadStartupMemory()).content).not.toContain('Use npm');
    expect((await restarted.list()).topics).toEqual([]);
    expect(
      (await restarted.recall('build', { maxTopics: 5, maxTopicChars: 1000 })).references,
    ).toEqual([]);
    await expect(restarted.append(input)).rejects.toThrow('user');
    await restarted.upsertPending(
      {
        ...input,
        id: 'resurrect',
        sourceMessageIds: ['tool'],
        confidence: 1,
        createdAt: new Date().toISOString(),
        reason: 'untrusted-output',
      },
      'pending',
      'capture',
    );
    expect(await restarted.listPending('pending')).toEqual([]);
    const other = await fixture();
    await other.store.append(input);
    expect(await other.store.readTopic('build')).toContain('Use npm');
  });
});
