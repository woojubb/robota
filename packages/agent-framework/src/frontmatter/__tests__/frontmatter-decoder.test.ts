import { describe, expect, expectTypeOf, it } from 'vitest';

import { decodeFrontmatter } from '../frontmatter-decoder.js';

import type { TModelEffort } from '@robota-sdk/agent-core';

const SOURCE = '/workspace/definition.md';

function decodeFailure(profile: 'skill' | 'bundle-skill' | 'agent', content: string) {
  const result = decodeFrontmatter({ source: SOURCE, content, profile });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected frontmatter decoding to fail');
  return result.diagnostics;
}

describe('decodeFrontmatter', () => {
  it('preserves a document with no frontmatter byte-for-byte', () => {
    const content = '# Skill\r\n\r\nKeep me.\r\n';
    const result = decodeFrontmatter({ source: SOURCE, content, profile: 'skill' });

    expect(result).toEqual({ ok: true, metadata: {}, body: content });
  });

  it('decodes the complete skill profile with shared typed primitives', () => {
    const content = [
      '---',
      'name: strict-decoder',
      'description: |-',
      '  Strict decoder',
      'argument-hint: "<path>"',
      'disable-model-invocation: true',
      'user-invocable: false',
      'allowed-tools: Read, Write',
      'effort: high',
      'context: fork',
      'agent: specialist',
      'loop: over=finding-set; bound=2 rounds',
      'invocable: true',
      'license: MIT',
      'metadata:',
      '  author: robota',
      '  version: 1',
      '  stable: true',
      '---',
      '# Body',
      '',
    ].join('\n');

    const result = decodeFrontmatter({ source: SOURCE, content, profile: 'skill' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected skill frontmatter to decode');

    expect(result.metadata).toEqual({
      name: 'strict-decoder',
      description: 'Strict decoder',
      argumentHint: '<path>',
      disableModelInvocation: true,
      userInvocable: false,
      allowedTools: ['Read', 'Write'],
      effort: 'high',
      context: 'fork',
      agent: 'specialist',
      loop: 'over=finding-set; bound=2 rounds',
      invocable: true,
      license: 'MIT',
      metadata: { author: 'robota', version: 1, stable: true },
    });
    expectTypeOf(result.metadata.effort).toEqualTypeOf<TModelEffort | undefined>();
    expect(result.body).toBe('# Body\n');
  });

  it('adds tags only in the bundle-skill profile and accepts a YAML sequence', () => {
    const result = decodeFrontmatter({
      source: SOURCE,
      profile: 'bundle-skill',
      content: '---\nname: bundled\ntags: [alpha, beta]\n---\nUse bundle.\n',
    });

    expect(result).toEqual({
      ok: true,
      metadata: { name: 'bundled', tags: ['alpha', 'beta'] },
      body: 'Use bundle.\n',
    });
  });

  it('decodes the complete agent profile and positive safe turn limit', () => {
    const result = decodeFrontmatter({
      source: SOURCE,
      profile: 'agent',
      content: [
        '---',
        'name: reviewer',
        'description: Reviews proposals',
        'model: claude-sonnet',
        'maxTurns: 7',
        'tools: Read Bash',
        'disallowedTools:',
        '  - Write',
        'signal: REVIEW VERDICT',
        '---',
        'System prompt.',
      ].join('\n'),
    });

    expect(result).toEqual({
      ok: true,
      metadata: {
        name: 'reviewer',
        description: 'Reviews proposals',
        model: 'claude-sonnet',
        maxTurns: 7,
        tools: ['Read', 'Bash'],
        disallowedTools: ['Write'],
        signal: 'REVIEW VERDICT',
      },
      body: 'System prompt.',
    });
  });

  it('preserves CRLF in the body and accepts an empty body', () => {
    const crlf = decodeFrontmatter({
      source: SOURCE,
      profile: 'skill',
      content: '---\r\nname: crlf\r\n---\r\n# Body\r\n\r\n',
    });
    const empty = decodeFrontmatter({
      source: SOURCE,
      profile: 'agent',
      content: '---\nname: empty\n---',
    });

    expect(crlf).toEqual({ ok: true, metadata: { name: 'crlf' }, body: '# Body\r\n\r\n' });
    expect(empty).toEqual({ ok: true, metadata: { name: 'empty' }, body: '' });
  });

  it.each([
    {
      name: 'an unterminated block',
      content: '---\nname: missing-close\n',
      expected: { code: 'unterminated', line: 1, column: 1 },
    },
    {
      name: 'malformed YAML',
      content: '---\nname: [\n---\n',
      expected: { code: 'yaml-syntax', line: 2, column: 8 },
    },
    {
      name: 'a duplicate key',
      content: '---\nname: first\nname: second\n---\n',
      expected: { code: 'duplicate-key', line: 3, column: 1, field: 'name' },
    },
    {
      name: 'an alias',
      content: '---\nname: &shared test\ndescription: *shared\n---\n',
      expected: {
        code: 'alias-or-merge-forbidden',
        line: 3,
        column: 14,
        field: 'description',
      },
    },
    {
      name: 'a merge key',
      content: '---\nmetadata:\n  <<: { author: robota }\n---\n',
      expected: {
        code: 'alias-or-merge-forbidden',
        line: 3,
        column: 3,
        field: 'metadata',
      },
    },
    {
      name: 'a sequence root',
      content: '---\n- name\n---\n',
      expected: { code: 'root-type', line: 2, column: 1 },
    },
    {
      name: 'a malformed scalar line',
      content: '---\nname without colon\n---\n',
      expected: { code: 'root-type', line: 2, column: 1 },
    },
  ])('rejects $name with structural coordinates', ({ content, expected }) => {
    const diagnostics = decodeFailure('skill', content);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ source: SOURCE, ...expected });
  });

  it.each([
    {
      name: 'an unknown field',
      profile: 'skill' as const,
      line: 'model: claude',
      expected: { code: 'unknown-field', line: 2, column: 1, field: 'model' },
    },
    {
      name: 'a boolean typo',
      profile: 'skill' as const,
      line: 'disable-model-invocation: treu',
      expected: {
        code: 'invalid-type',
        line: 2,
        column: 27,
        field: 'disable-model-invocation',
      },
    },
    {
      name: 'an invalid context',
      profile: 'skill' as const,
      line: 'context: project',
      expected: { code: 'invalid-value', line: 2, column: 10, field: 'context' },
    },
    {
      name: 'an invalid effort',
      profile: 'skill' as const,
      line: 'effort: turbo',
      expected: { code: 'invalid-value', line: 2, column: 9, field: 'effort' },
    },
    {
      name: 'a list with a non-string member',
      profile: 'skill' as const,
      line: 'allowed-tools: [Read, 3]',
      expected: { code: 'invalid-type', line: 2, column: 23, field: 'allowed-tools' },
    },
    {
      name: 'a scalar list with an empty member',
      profile: 'skill' as const,
      line: 'allowed-tools: Read,,Write',
      expected: { code: 'invalid-value', line: 2, column: 16, field: 'allowed-tools' },
    },
    {
      name: 'an empty required string',
      profile: 'skill' as const,
      line: "name: ''",
      expected: { code: 'invalid-value', line: 2, column: 7, field: 'name' },
    },
    {
      name: 'bundle-only tags on a skill',
      profile: 'skill' as const,
      line: 'tags: [alpha]',
      expected: { code: 'unknown-field', line: 2, column: 1, field: 'tags' },
    },
    {
      name: 'runtime-only effort on an agent',
      profile: 'agent' as const,
      line: 'effort: high',
      expected: { code: 'unknown-field', line: 2, column: 1, field: 'effort' },
    },
  ])('rejects $name without returning a partial value', ({ profile, line, expected }) => {
    const diagnostics = decodeFailure(profile, `---\n${line}\n---\n`);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ source: SOURCE, ...expected });
  });

  it('rejects nested metadata values at the metadata field', () => {
    const diagnostics = decodeFailure(
      'skill',
      '---\nmetadata:\n  author:\n    name: robota\n---\n',
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: 'invalid-type',
      source: SOURCE,
      line: 4,
      column: 5,
      field: 'metadata',
    });
  });

  it('attributes a nested duplicate key to its top-level metadata field', () => {
    const diagnostics = decodeFailure(
      'skill',
      '---\nmetadata:\n  author: first\n  author: second\n---\n',
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: 'duplicate-key',
      source: SOURCE,
      line: 4,
      column: 3,
      field: 'metadata',
    });
  });

  it('reports an omitted YAML value as null at its value coordinate', () => {
    const diagnostics = decodeFailure('skill', '---\nname:\n---\n');

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: 'invalid-type',
      source: SOURCE,
      line: 2,
      column: 6,
      field: 'name',
      received: 'null',
    });
  });

  it.each([
    ['zero', '0', 'invalid-value'],
    ['negative', '-1', 'invalid-value'],
    ['fractional', '1.5', 'invalid-value'],
    ['numeric string', "'12'", 'invalid-type'],
    ['numeric prefix', '12abc', 'invalid-type'],
    ['not-a-number', '.nan', 'invalid-value'],
    ['overflow', '9007199254740992', 'invalid-value'],
  ])('rejects a %s maxTurns value', (_name, value, code) => {
    const diagnostics = decodeFailure('agent', `---\nmaxTurns: ${value}\n---\n`);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code,
      source: SOURCE,
      line: 2,
      column: 11,
      field: 'maxTurns',
    });
  });

  it('accepts agent model while rejecting the same field for skills', () => {
    const agent = decodeFrontmatter({
      source: SOURCE,
      profile: 'agent',
      content: '---\nmodel: owned-agent-model\n---\n',
    });
    const skillDiagnostics = decodeFailure('skill', '---\nmodel: unowned-skill-model\n---\n');

    expect(agent).toEqual({
      ok: true,
      metadata: { model: 'owned-agent-model' },
      body: '',
    });
    expect(skillDiagnostics[0]).toMatchObject({ code: 'unknown-field', field: 'model' });
  });

  it('aggregates independent schema failures in source order', () => {
    const diagnostics = decodeFailure(
      'skill',
      '---\nunknown: value\ncontext: project\neffort: turbo\n---\n',
    );

    expect(diagnostics.map(({ field, line }) => ({ field, line }))).toEqual([
      { field: 'unknown', line: 2 },
      { field: 'context', line: 3 },
      { field: 'effort', line: 4 },
    ]);
  });
});
