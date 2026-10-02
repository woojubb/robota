import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import type { IAIProvider } from '@robota-sdk/agent-core';

import { createQuery } from '../index.js';

const roots: string[] = [];

function tempCwd(): string {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'agent-query-options-')));
  roots.push(cwd);
  return cwd;
}

/** A provider whose first call answers only when aborted, and says when that call has started. */
function hangingProvider(): { provider: IAIProvider; started: Promise<void> } {
  let markStarted = (): void => undefined;
  const started = new Promise<void>((resolve) => (markStarted = resolve));
  const provider: IAIProvider = {
    name: 'hanging-test-provider',
    version: 'test',
    chat: (_messages, options) =>
      new Promise((_resolve, reject) => {
        markStarted();
        options?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      }),
    generateResponse: () => Promise.reject(new Error('not used')),
    supportsTools: () => true,
    validateConfig: () => true,
  };
  return { provider, started };
}

function offeredTools(options: { tools?: ReadonlyArray<{ name: string }> } | undefined): string[] {
  return (options?.tools ?? []).map((tool) => tool.name);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('createQuery options', () => {
  it('sends the model it was given instead of the Anthropic default', async () => {
    const scripted = createScriptedProvider([{ text: 'ok' }]);
    const query = createQuery({ cwd: tempCwd(), provider: scripted.provider, model: 'gpt-5.2' });

    await query('hello');

    expect(scripted.chatOptions[0]?.model).toBe('gpt-5.2');
  });

  it('answers each of several concurrent calls with its own turn', async () => {
    const scripted = createScriptedProvider([
      { text: 'first' },
      { text: 'second' },
      { text: 'third' },
    ]);
    const query = createQuery({ cwd: tempCwd(), provider: scripted.provider });

    const answers = await Promise.all([query('one'), query('two'), query('three')]);

    expect(answers).toEqual(['first', 'second', 'third']);
  });

  it('does not offer denied tools to the model', async () => {
    const scripted = createScriptedProvider([{ text: 'ok' }]);
    const query = createQuery({
      cwd: tempCwd(),
      provider: scripted.provider,
      deniedTools: ['Bash', 'Write'],
    });

    await query('hello');

    expect(offeredTools(scripted.chatOptions[0])).toContain('Read');
    expect(offeredTools(scripted.chatOptions[0])).not.toContain('Bash');
    expect(offeredTools(scripted.chatOptions[0])).not.toContain('Write');
  });

  it('runs an allowed tool in the default mode without a permission handler', async () => {
    const cwd = tempCwd();
    const scripted = createScriptedProvider([
      { toolCalls: [{ name: 'Bash', args: { command: 'printf ran > ran.txt' } }] },
      { text: 'done' },
    ]);
    const query = createQuery({ cwd, provider: scripted.provider, allowedTools: ['Bash'] });

    await expect(query('run it')).resolves.toBe('done');
    expect(existsSync(join(cwd, 'ran.txt'))).toBe(true);
  });

  it('shuts its session down, after which a call is refused', async () => {
    const scripted = createScriptedProvider([{ text: 'ok' }]);
    const query = createQuery({ cwd: tempCwd(), provider: scripted.provider });

    await expect(query('hello')).resolves.toBe('ok');
    await query.shutdown();

    await expect(query('again')).rejects.toThrow('shut down');
    expect(scripted.chatOptions).toHaveLength(1);
  });

  it('rejects the running call and the waiting ones when shut down, instead of answering them', async () => {
    const { provider, started } = hangingProvider();
    const query = createQuery({ cwd: tempCwd(), provider });

    const running = query('first');
    const waiting = query('second');
    await started;
    await query.shutdown();

    await expect(running).rejects.toThrow('shut down');
    await expect(waiting).rejects.toThrow('shut down');
  });
});
