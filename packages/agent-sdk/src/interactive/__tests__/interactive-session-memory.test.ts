import { describe, expect, it, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IAIProvider, TUniversalMessage } from '@robota-sdk/agent-core';
import { SessionStore } from '@robota-sdk/agent-sessions';
import { InteractiveSession } from '../interactive-session.js';
import { ProjectMemoryStore } from '../../memory/project-memory-store.js';

const TMP_BASE = join(tmpdir(), `robota-interactive-memory-${process.pid}`);

function makeProject(): string {
  const dir = join(TMP_BASE, Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createProvider(response = 'ok'): IAIProvider {
  return {
    name: 'mock',
    version: 'test',
    chat: vi.fn().mockResolvedValue({
      role: 'assistant',
      content: response,
      timestamp: new Date('2026-05-02T00:00:00.000Z'),
    }),
    generateResponse: vi.fn(),
  } as unknown as IAIProvider;
}

function latestUserMessage(provider: IAIProvider): TUniversalMessage | undefined {
  const chat = provider.chat as ReturnType<typeof vi.fn>;
  const [messages] = chat.mock.calls.at(-1) ?? [];
  if (!Array.isArray(messages)) return undefined;
  return [...messages].reverse().find((message) => message.role === 'user');
}

afterEach(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

describe('InteractiveSession memory command integration', () => {
  it('Given a memory cue When a turn completes Then no hidden pending memory is created', async () => {
    const cwd = makeProject();
    const provider = createProvider('noted');
    const sessionStore = new SessionStore(join(cwd, '.robota', 'sessions'));
    const session = new InteractiveSession({
      cwd,
      provider,
      bare: true,
      sessionStore,
    });

    await session.submit('remember that this project uses pnpm for package scripts');

    expect(existsSync(join(cwd, '.robota', 'memory', 'pending.json'))).toBe(false);
    const saved = sessionStore.load(session.getSession().getSessionId());
    expect(saved?.memoryEvents).toEqual([]);
  });

  it('Given relevant project memory When submitting a prompt Then topic memory is not injected automatically', async () => {
    const cwd = makeProject();
    const provider = createProvider('use pnpm');
    new ProjectMemoryStore(cwd, () => new Date('2026-05-02T00:00:00.000Z')).append({
      type: 'project',
      topic: 'build',
      text: 'Use pnpm for package scripts.',
    });
    const session = new InteractiveSession({
      cwd,
      provider,
      bare: true,
    });

    await session.submit('How should I run package scripts?');

    expect(latestUserMessage(provider)?.content).toBe('How should I run package scripts?');
    expect(latestUserMessage(provider)?.content).not.toContain('<project-memory>');
    expect(latestUserMessage(provider)?.content).not.toContain('Use pnpm for package scripts.');
    expect(session.getUsedMemoryReferences()).toEqual([]);
  });

  it('Given model invocation When /memory add is executed Then memory is persisted through the command bridge', async () => {
    const cwd = makeProject();
    const session = new InteractiveSession({
      cwd,
      provider: createProvider('ok'),
      bare: true,
    });

    const result = await session.executeModelCommand(
      'memory',
      'add project build Use pnpm for package scripts.',
    );

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
      }),
    );
    expect(readFileSync(join(cwd, '.robota', 'memory', 'MEMORY.md'), 'utf8')).toContain(
      '(project/build) Use pnpm for package scripts.',
    );
  });
});
