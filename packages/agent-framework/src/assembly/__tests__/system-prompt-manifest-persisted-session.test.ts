/**
 * The whole path with nothing faked between the assembly and the disk: the prompt a real session is
 * built with, a live preset change that rebuilds it, the real store that saves it, and the decoder
 * that reads it back. What comes back must still account for the prompt exactly, because that is
 * what lets a person read a stored session and know which of its sections were the product's own.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AbstractAIProvider } from '@robota-sdk/agent-core';
import { Session } from '@robota-sdk/agent-session';
import { NodeSessionStore } from '@robota-sdk/agent-session/node';
import { afterEach, describe, expect, it } from 'vitest';

import { buildSessionSystemPrompt } from '../create-session-runtime.js';
import { sliceSystemPromptByManifest } from '../../context/system-prompt-manifest-slice.js';
import { createTestFrameworkHost } from '../../testing/framework-host.js';

import type { ICreateSessionOptions } from '../create-session-types.js';
import type { TUniversalMessage } from '@robota-sdk/agent-core';
import type { ITerminalOutput } from '@robota-sdk/agent-session';

class QuietProvider extends AbstractAIProvider {
  readonly name = 'quiet-provider';
  readonly version = '1.0.0';

  override async chat(): Promise<TUniversalMessage> {
    return {
      id: 'msg-1',
      role: 'assistant',
      content: 'ok',
      state: 'complete',
      timestamp: new Date(),
    };
  }
}

const TERMINAL: ITerminalOutput = {
  write: () => undefined,
  writeLine: () => undefined,
  writeMarkdown: () => undefined,
  writeError: () => undefined,
  prompt: async () => '',
  select: async () => 0,
  spinner: () => ({ stop: () => undefined, update: () => undefined }),
};

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function options(overrides: Partial<ICreateSessionOptions> = {}): ICreateSessionOptions {
  return {
    host: createTestFrameworkHost(),
    cwd: '/workspace',
    config: {
      defaultTrustLevel: 'safe',
      provider: { name: 'test', model: 'test-model', apiKey: undefined },
      permissions: { allow: [], deny: [] },
      env: {},
    },
    context: { agentsMd: '## Rules\nBe brief.', projectNotesMd: '' },
    terminal: TERMINAL,
    ...overrides,
  };
}

describe('a stored session names the sections of the prompt it was saved with', () => {
  it('survives assembly, a live persona change, the store and the decoder', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'prompt-manifest-')));
    roots.push(root);
    const store = new NodeSessionStore(join(root, 'sessions'), { sealing: 'plain' });
    const built = buildSessionSystemPrompt(
      options({ selfVerification: true }),
      '/workspace',
      [],
      undefined,
      undefined,
      [],
      [],
    );
    const session = new Session({
      hookTypeExecutors: [],
      cwd: root,
      tools: [],
      provider: new QuietProvider() as never,
      systemMessage: built.finalSystemMessage,
      ...(built.systemPromptManifest !== undefined
        ? { systemPromptManifest: built.systemPromptManifest }
        : {}),
      terminal: TERMINAL as never,
      sessionStore: store,
      model: 'base-model',
    });

    // A live preset change rebuilds the prompt; the session takes the new text with its sections.
    const rebuilt = built.rebuildSystemMessage('## Rules\nBe brief.', '', {
      persona: 'You build things.',
    });
    session.updateSystemMessage(rebuilt.message, rebuilt.manifest);
    session.checkpoint();

    const outcome = store.load(session.getSessionId());
    if (outcome.status !== 'valid') throw new Error(`expected valid, got ${outcome.status}`);
    const record = outcome.record;

    expect(record.systemPrompt).toBe(rebuilt.message);
    expect(record.systemPromptManifest?.sections.map((section) => section.id)).toEqual([
      'preset-persona',
      'preset-self-verification',
      'project-agents-md',
      'runtime-cwd',
      'permission-mode',
      'tool-descriptions',
    ]);
    expect(record.systemPromptManifest?.harnessVersion).toMatch(/^sha256:[0-9a-f]{12}$/);

    // The stored sections cut the stored prompt back into the pieces it was composed from.
    const sliced = sliceSystemPromptByManifest(
      record.systemPrompt ?? '',
      record.systemPromptManifest!,
    );
    expect(sliced?.map((section) => section.text).join('\n\n')).toBe(record.systemPrompt);
    expect(sliced?.find((section) => section.id === 'preset-persona')?.text).toBe(
      'You build things.',
    );
    expect(sliced?.find((section) => section.id === 'project-agents-md')?.text).toContain(
      '## Rules',
    );
  });

  it('stores no manifest for a prompt a caller supplied whole', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'prompt-manifest-')));
    roots.push(root);
    const store = new NodeSessionStore(join(root, 'sessions'), { sealing: 'plain' });
    const built = buildSessionSystemPrompt(
      options({ systemPromptBuilder: () => 'SUPPLIED WHOLE' }),
      '/workspace',
      [],
      undefined,
      undefined,
      [],
      [],
    );
    const session = new Session({
      hookTypeExecutors: [],
      cwd: root,
      tools: [],
      provider: new QuietProvider() as never,
      systemMessage: built.finalSystemMessage,
      terminal: TERMINAL as never,
      sessionStore: store,
      model: 'base-model',
    });
    session.checkpoint();

    const outcome = store.load(session.getSessionId());
    if (outcome.status !== 'valid') throw new Error(`expected valid, got ${outcome.status}`);
    expect(outcome.record.systemPrompt).toBe('SUPPLIED WHOLE');
    expect(outcome.record).not.toHaveProperty('systemPromptManifest');
  });
});
