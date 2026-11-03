/**
 * `agent-core` runs hooks only through the executors it is handed, and a platform-neutral session
 * has no host executors of its own. A session given the Node executors runs a configured command
 * hook — for every event, not only the fail-closed `PreToolUse` — and one given an empty list runs
 * none; a session given no list at all is refused rather than left to run nothing silently.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { CommandExecutor, HttpExecutor } from '@robota-sdk/agent-core/node';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Session } from '../session.js';

import type { ISessionOptions } from '../session-types.js';

const dirs: string[] = [];
const sessions: Session[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.shutdown()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function promptHookFixture(options: Partial<ISessionOptions>): { session: Session; marker: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'command-hook-'));
  dirs.push(dir);
  const script = path.join(dir, 'hook.cjs');
  const marker = path.join(dir, 'ran');
  writeFileSync(script, "require('node:fs').writeFileSync(process.argv[2], 'ran');\n");
  const hook = { type: 'command', command: `node "${script}" "${marker}"` };
  const session = new Session({
    hookTypeExecutors: [new CommandExecutor(), new HttpExecutor()],
    cwd: dir,
    systemMessage: 'Fixture',
    model: 'test-model',
    provider: createScriptedProvider([{ text: 'done' }]).provider,
    autoCompactThreshold: false,
    terminal: {
      write: vi.fn(),
      writeLine: vi.fn(),
      writeMarkdown: vi.fn(),
      writeError: vi.fn(),
      prompt: vi.fn(async () => ''),
      select: vi.fn(async () => 0),
      spinner: vi.fn(() => ({ stop: vi.fn(), update: vi.fn() })),
    },
    tools: [],
    hooks: { UserPromptSubmit: [{ matcher: '', hooks: [hook] }] },
    ...options,
  });
  sessions.push(session);
  return { session, marker };
}

describe('command hooks on a session', () => {
  it('runs a UserPromptSubmit command hook through the Node executors it is given', async () => {
    const { session, marker } = promptHookFixture({});

    await expect(session.run('hello')).resolves.toBe('done');

    expect(existsSync(marker)).toBe(true);
  });

  it('runs no command hook when the executor list is empty', async () => {
    const { session, marker } = promptHookFixture({ hookTypeExecutors: [] });

    await expect(session.run('hello')).resolves.toBe('done');

    expect(existsSync(marker)).toBe(false);
  });

  it('refuses to be built without an executor list, whatever the type system was told', () => {
    expect(() =>
      promptHookFixture({ hookTypeExecutors: undefined as unknown as ISessionOptions['hookTypeExecutors'] }),
    ).toThrow(/Session requires `hookTypeExecutors`/);
  });
});
