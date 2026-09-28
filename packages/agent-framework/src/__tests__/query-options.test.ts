import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { createQuery } from '../index.js';

const roots: string[] = [];

function tempCwd(): string {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'robota-query-options-')));
  roots.push(cwd);
  return cwd;
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

    await expect(query('again')).rejects.toThrow();
    expect(scripted.chatOptions).toHaveLength(1);
  });
});
