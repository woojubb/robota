import { describe, expect, it } from 'vitest';

import {
  createOutputStyleRegistry,
  loadOutputStylesFromSources,
  parseOutputStyleFile,
} from '../output-style-registry.js';

describe('output style registry', () => {
  it('lists the five built-in styles and exposes concise guidance', () => {
    const registry = createOutputStyleRegistry();

    expect(registry.listOutputStyles().map((style) => style.id)).toEqual([
      'default',
      'concise',
      'proactive',
      'explanatory',
      'learning',
    ]);
    expect(registry.getOutputStyle('concise')).toMatchObject({
      name: 'Concise',
      source: 'built-in',
      tokenCost: 'low',
    });
    expect(registry.getOutputStyle('concise')?.instructions).toContain(
      'security warnings and destructive-action confirmations',
    );
    expect(registry.getOutputStyle('default')?.description).not.toMatch(/Robota/i);
  });

  it('loads Markdown styles with defaults and lets a higher-precedence source replace an id', () => {
    const registry = createOutputStyleRegistry([
      {
        scope: 'user',
        displayName: 'user',
        precedence: 10,
        files: [
          {
            fileName: 'brief.md',
            content: ['---', 'description: User brief', '---', 'Use a short numbered answer.'].join(
              '\n',
            ),
          },
        ],
      },
      {
        scope: 'project',
        displayName: 'project',
        precedence: 20,
        files: [
          {
            fileName: 'brief.md',
            content: [
              '---',
              'name: Project Brief',
              'keep-coding-instructions: true',
              'token-cost: medium',
              '---',
              'Use a short answer with a concrete example.',
            ].join('\n'),
          },
        ],
      },
    ]);

    expect(registry.getOutputStyle('brief')).toMatchObject({
      name: 'Project Brief',
      description: 'Custom output style: Project Brief',
      keepCodingInstructions: true,
      tokenCost: 'medium',
      source: 'project',
    });
  });

  it('isolates malformed files and reports the field-level reason', () => {
    const result = loadOutputStylesFromSources([
      {
        scope: 'user',
        displayName: 'user',
        precedence: 10,
        files: [{ fileName: 'broken.md', content: 'not markdown frontmatter' }],
      },
    ]);

    expect(result.loaded).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({
        file: 'user/broken.md',
        error: 'frontmatter: expected an opening --- marker',
      }),
    ]);
  });

  it('reads each frontmatter value after the space that follows its colon', () => {
    const style = parseOutputStyleFile(
      {
        fileName: 'spaced.md',
        content: ['---', 'name:', 'description: \t  A spaced value  ', '---', 'Body.'].join('\n'),
      },
      'user',
    );

    expect(style).toMatchObject({ name: 'spaced', description: 'A spaced value' });
    expect(() =>
      parseOutputStyleFile(
        { fileName: 'split.md', content: ['---', 'name: a\rb', '---', 'Body.'].join('\n') },
        'user',
      ),
    ).toThrow('frontmatter: invalid entry at line 2');
  });

  it('rejects a pumped frontmatter line in linear time', () => {
    // `\s*(.*)$` split the run of spaces two ways, so a line `.` cannot finish was rejected in
    // O(n^2): about 4s for this input before the fix, well under a millisecond after it.
    const hostile = `name:${'\t'.repeat(100_000)}\rx\ry`;
    const started = performance.now();

    const result = loadOutputStylesFromSources([
      {
        scope: 'user',
        displayName: 'user',
        precedence: 10,
        files: [{ fileName: 'pumped.md', content: ['---', hostile, '---', 'Body.'].join('\n') }],
      },
    ]);

    expect(performance.now() - started).toBeLessThan(250);
    expect(result.errors).toEqual([
      expect.objectContaining({ error: 'frontmatter: invalid entry at line 2' }),
    ]);
  });
});
