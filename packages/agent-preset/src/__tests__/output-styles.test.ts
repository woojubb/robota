import { describe, expect, it } from 'vitest';

import {
  createOutputStyleRegistry,
  loadOutputStylesFromSources,
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
});
