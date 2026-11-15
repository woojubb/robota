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

describe('product sections are static for the session', () => {
  const PRODUCT = [{ id: 'product-core', content: 'PRODUCT CORE TEXT' }];

  it('composes them at the start and lists them with the product source', () => {
    const result = build({ productSections: PRODUCT, presetSystemPrompt: 'PRESET ONE' });
    expect(ids(result.systemPromptManifest).slice(0, 2)).toEqual([
      'product-core',
      'preset-system-prompt',
    ]);
    expect(result.systemPromptManifest?.sections[0]?.source).toBe('product');
    expect(result.finalSystemMessage.indexOf('PRODUCT CORE TEXT')).toBeLessThan(
      result.finalSystemMessage.indexOf('PRESET ONE'),
    );
  });

  it('survive every live override, each of which rebuilds the whole prompt', () => {
    const result = build({
      productSections: PRODUCT,
      presetSystemPrompt: 'PRESET ONE',
      persona: 'PERSONA ONE',
      selfVerification: true,
    });
    const overrides = [
      { presetSystemPrompt: 'PRESET TWO' },
      { persona: 'PERSONA TWO' },
      { selfVerification: 'VERIFY TWO' },
      { language: 'ko' },
      { memoryMd: 'MEMORY TWO' },
      {
        outputStyle: {
          id: 'terse',
          name: 'Terse',
          instructions: 'Answer briefly.',
          keepCodingInstructions: true,
        },
      },
    ];
    for (const override of overrides) {
      const rebuilt = result.rebuildSystemMessage('A1', 'C1', override);
      expect(rebuilt.message).toContain('PRODUCT CORE TEXT');
      expect(ids(rebuilt.manifest)).toContain('product-core');
    }
    expect(result.rebuildSystemMessage('A2', 'C2').message).toContain('PRODUCT CORE TEXT');
  });

  it('stay while a preset prompt is replaced, and the replaced text goes', () => {
    const result = build({ productSections: PRODUCT, presetSystemPrompt: 'PRESET ONE' });
    const switched = result.rebuildSystemMessage('A1', 'C1', { presetSystemPrompt: 'PRESET TWO' });
    expect(switched.message).toContain('PRODUCT CORE TEXT');
    expect(switched.message).toContain('PRESET TWO');
    expect(switched.message).not.toContain('PRESET ONE');
    expect(switched.message.indexOf('PRODUCT CORE TEXT')).toBeLessThan(
      switched.message.indexOf('PRESET TWO'),
    );
  });

  it('are not applied when the caller supplies the whole prompt', () => {
    const result = build({
      productSections: PRODUCT,
      systemPromptBuilder: () => 'SUPPLIED WHOLE',
    });
    expect(result.finalSystemMessage).toBe('SUPPLIED WHOLE');
    expect(result.systemPromptManifest).toBeUndefined();
  });

  it('refuse a duplicate id when the session prompt is first composed', () => {
    expect(() =>
      build({
        productSections: [
          { id: 'product-core', content: 'ONE' },
          { id: 'product-core', content: 'TWO' },
        ],
      }),
    ).toThrow(/Duplicate product prompt section id/);
  });
});
