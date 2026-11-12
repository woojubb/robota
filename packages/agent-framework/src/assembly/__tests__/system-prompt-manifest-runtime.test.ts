import { describe, expect, it } from 'vitest';

import { buildSessionSystemPrompt } from '../create-session-runtime.js';
import { createTestFrameworkHost } from '../../testing/framework-host.js';

import type { ICreateSessionOptions } from '../create-session-types.js';
import type { ITerminalOutput } from '@robota-sdk/agent-session';

const testHost = createTestFrameworkHost();

const NOOP_TERMINAL: ITerminalOutput = {
  write: () => undefined,
  writeLine: () => undefined,
  writeMarkdown: () => undefined,
  writeError: () => undefined,
  prompt: async () => '',
  select: async () => 0,
  spinner: () => ({ stop: () => undefined, update: () => undefined }),
};

function options(overrides: Partial<ICreateSessionOptions> = {}): ICreateSessionOptions {
  return {
    host: testHost,
    cwd: '/workspace',
    config: {
      defaultTrustLevel: 'safe',
      provider: { name: 'test', model: 'test-model', apiKey: undefined },
      permissions: { allow: [], deny: [] },
      env: {},
    },
    context: { agentsMd: 'A0', projectNotesMd: 'C0' },
    terminal: NOOP_TERMINAL,
    ...overrides,
  };
}

function build(
  overrides: Partial<ICreateSessionOptions> = {},
): ReturnType<typeof buildSessionSystemPrompt> {
  return buildSessionSystemPrompt(
    options(overrides),
    '/workspace',
    [],
    undefined,
    undefined,
    [],
    [],
  );
}

function ids(manifest: { sections: readonly { id: string }[] } | undefined): string[] {
  return manifest?.sections.map((section) => section.id) ?? [];
}

describe('the prompt a session starts with carries its composition', () => {
  it('names the sections that the prompt text is made of', () => {
    const result = build({ persona: 'You build things.' });
    expect(ids(result.systemPromptManifest)).toContain('preset-persona');
    expect(result.systemPromptManifest?.harnessVersion).toMatch(/^sha256:/);
    expect(result.finalSystemMessage).toContain('You build things.');
  });

  it('reports no harness when no preset contributed one', () => {
    expect(build().systemPromptManifest?.harnessVersion).toBe('none');
  });

  it('adds the operator-appended text as a section of its own', () => {
    const result = build({ appendSystemPrompt: 'OPERATOR NOTE' });
    expect(ids(result.systemPromptManifest).at(-1)).toBe('append-system-prompt');
    expect(result.finalSystemMessage.endsWith('\n\nOPERATOR NOTE')).toBe(true);
  });

  it('does not claim a composition for a prompt a caller supplied whole', () => {
    const result = build({ systemPromptBuilder: () => 'SUPPLIED WHOLE', appendSystemPrompt: 'X' });
    expect(result.finalSystemMessage).toBe('SUPPLIED WHOLE\n\nX');
    expect(result.systemPromptManifest).toBeUndefined();
  });
});

describe('a rebuilt prompt carries the composition of the rebuilt text', () => {
  it('reflects a persona applied mid-session, and keeps it on later rebuilds', () => {
    const result = build();
    expect(ids(result.systemPromptManifest)).not.toContain('preset-persona');

    const applied = result.rebuildSystemMessage('A1', 'C1', { persona: 'NEW PERSONA' });
    expect(ids(applied.manifest)).toContain('preset-persona');
    expect(applied.message).toContain('NEW PERSONA');
    expect(applied.manifest?.harnessVersion).not.toBe(result.systemPromptManifest?.harnessVersion);

    const later = result.rebuildSystemMessage('A2', 'C2');
    expect(ids(later.manifest)).toContain('preset-persona');
  });

  it('keeps the appended text accounted for after a rebuild', () => {
    const result = build({ appendSystemPrompt: 'OPERATOR NOTE' });
    const rebuilt = result.rebuildSystemMessage('A1', 'C1');
    expect(ids(rebuilt.manifest).at(-1)).toBe('append-system-prompt');
  });
});
