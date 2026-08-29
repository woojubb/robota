import { describe, expect, it } from 'vitest';

import { decodeSkillAgentFrontmatter } from './frontmatter-decoder.js';

describe('decodeSkillAgentFrontmatter', () => {
  it('decodes a minimal skill using the explicit dialect', () => {
    expect(
      decodeSkillAgentFrontmatter('---\nname: review\ndescription: Review changes\n---\nbody', {
        kind: 'skill',
        source: '/workspace/.agents/skills/review/SKILL.md',
      }),
    ).toEqual({
      status: 'valid',
      value: {
        kind: 'skill',
        name: 'review',
        description: 'Review changes',
      },
    });
  });

  it('rejects a misspelled boolean instead of coercing it to false', () => {
    const result = decodeSkillAgentFrontmatter(
      '---\nname: review\ndescription: Review changes\ndisable-model-invocation: treu\n---',
      { kind: 'skill', source: '/workspace/SKILL.md' },
    );

    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.value).toBeUndefined();
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          source: '/workspace/SKILL.md',
          line: 4,
          field: 'disable-model-invocation',
        }),
      ]);
    }
  });

  it('decodes a complete agent variant with typed shared fields', () => {
    expect(
      decodeSkillAgentFrontmatter(
        '---\nname: explorer\ndescription: Explore\nmodel: sonnet\nmaxTurns: 3\ntools: Read, Grep\ndisallowedTools: Bash\n---',
        { kind: 'agent', source: '/workspace/agent.md' },
      ),
    ).toEqual({
      status: 'valid',
      value: {
        kind: 'agent',
        name: 'explorer',
        description: 'Explore',
        model: 'sonnet',
        maxTurns: 3,
        tools: ['Read', 'Grep'],
        disallowedTools: ['Bash'],
      },
    });
  });

  it.each([
    ['context', 'wat', 'invalid-context'],
    ['effort', 'turbo', 'invalid-effort'],
    ['allowed-tools', '[]', 'wrong-value-shape'],
  ])('rejects invalid skill field %s', (field, value, code) => {
    const result = decodeSkillAgentFrontmatter(
      `---\nname: review\ndescription: Review\n${field}: ${value}\n---`,
      { kind: 'skill', source: '/workspace/SKILL.md' },
    );

    expect(result).toMatchObject({
      status: 'invalid',
      diagnostics: [expect.objectContaining({ code, field })],
    });
  });

  it.each(['0', '-1', '1.5', '12x', 'abc'])('rejects invalid maxTurns %s', (value) => {
    const result = decodeSkillAgentFrontmatter(
      `---\nname: explorer\ndescription: Explore\nmaxTurns: ${value}\n---`,
      { kind: 'agent', source: '/workspace/agent.md' },
    );

    expect(result).toMatchObject({
      status: 'invalid',
      diagnostics: [
        expect.objectContaining({ code: 'invalid-positive-integer', field: 'maxTurns' }),
      ],
    });
  });

  it('rejects unknown and duplicate keys while accumulating diagnostics', () => {
    const result = decodeSkillAgentFrontmatter(
      '---\nname: review\nname: again\ndescription: Review\npermission: admin\n---',
      { kind: 'skill', source: '/workspace/SKILL.md' },
    );

    expect(result).toMatchObject({
      status: 'invalid',
      diagnostics: [
        expect.objectContaining({ code: 'duplicate-key', field: 'name', line: 3 }),
        expect.objectContaining({ code: 'unknown-key', field: 'permission', line: 5 }),
      ],
    });
  });

  it('rejects malformed lines with source and line diagnostics', () => {
    const result = decodeSkillAgentFrontmatter('---\nname: review\ndescription Review\n---', {
      kind: 'skill',
      source: '/workspace/SKILL.md',
    });

    expect(result).toMatchObject({
      status: 'invalid',
      diagnostics: [
        expect.objectContaining({
          code: 'malformed-line',
          source: '/workspace/SKILL.md',
          line: 3,
        }),
        expect.objectContaining({ code: 'missing-required-field', field: 'description' }),
      ],
    });
  });

  it('rejects structured-looking values where scalar strings are required', () => {
    const result = decodeSkillAgentFrontmatter(
      '---\nname: []\ndescription: Review\nmodel: [sonnet]\n---',
      { kind: 'skill', source: '/workspace/SKILL.md' },
    );

    expect(result).toMatchObject({
      status: 'invalid',
      diagnostics: [
        expect.objectContaining({ code: 'wrong-value-shape', field: 'name', line: 2 }),
        expect.objectContaining({ code: 'wrong-value-shape', field: 'model', line: 4 }),
      ],
    });
  });

  it.each([
    ['', 'missing-opening-marker'],
    ['---\nname: review', 'missing-closing-marker'],
    ['---\n---', 'empty-block'],
  ])('rejects frontmatter boundary %s', (content, code) => {
    const result = decodeSkillAgentFrontmatter(content, {
      kind: 'skill',
      source: '/workspace/SKILL.md',
    });
    expect(result).toMatchObject({
      status: 'invalid',
      diagnostics: [expect.objectContaining({ code })],
    });
  });
});
