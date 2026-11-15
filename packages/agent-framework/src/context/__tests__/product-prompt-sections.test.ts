/**
 * A product contributes sections to the prompt it composes.
 *
 * The seam exists because a preset's own system prompt is REPLACED by a live preset switch, so
 * anything a product folded into that text vanished with it. A product section is its own source with
 * its own priority, composed beside the preset prompt rather than inside it.
 */

import { ConfigurationError } from '@robota-sdk/agent-core';
import { describe, expect, it } from 'vitest';

import { buildSystemPrompt, buildSystemPromptSections } from '../system-prompt-builder.js';
import { composeSystemPrompt, describeSystemPromptSections } from '../system-prompt-composer.js';
import { createProductSections } from '../system-prompt-section-providers.js';

import type { ISystemPromptParams } from '../system-prompt-builder.js';

const SEPARATOR = '\n\n';

function params(overrides: Partial<ISystemPromptParams> = {}): ISystemPromptParams {
  return {
    agentsMd: 'PROJECT-INSTRUCTIONS',
    projectNotesMd: '',
    toolDescriptions: [],
    permissionMode: 'default',
    projectInfo: { type: 'unknown', language: 'unknown' },
    cwd: '/work',
    ...overrides,
  };
}

function ids(overrides: Partial<ISystemPromptParams>): string[] {
  return describeSystemPromptSections(buildSystemPromptSections(params(overrides))).sections.map(
    (section) => section.id,
  );
}

function harnessVersion(overrides: Partial<ISystemPromptParams>): string {
  return describeSystemPromptSections(buildSystemPromptSections(params(overrides))).harnessVersion;
}

describe('where a product section sits in the prompt', () => {
  it('is above the preset prompt, the persona and the project instructions', () => {
    const order = ids({
      productSections: [{ id: 'product-core', content: 'CORE' }],
      presetSystemPrompt: 'PRESET',
      persona: 'PERSONA',
    });
    expect(order.slice(0, 4)).toEqual([
      'product-core',
      'preset-system-prompt',
      'preset-persona',
      'project-agents-md',
    ]);
  });

  it('is below an output style', () => {
    const order = ids({
      productSections: [{ id: 'product-core', content: 'CORE' }],
      presetSystemPrompt: 'PRESET',
      outputStyle: {
        id: 'terse',
        name: 'Terse',
        instructions: 'Answer briefly.',
        keepCodingInstructions: true,
      },
    });
    expect(order.slice(0, 3)).toEqual(['output-style', 'product-core', 'preset-system-prompt']);
  });

  it('keeps the list order, whatever the ids would sort to', () => {
    const prompt = composeSystemPrompt(
      createProductSections([
        { id: 'zebra', content: 'FIRST' },
        { id: 'apple', content: 'SECOND' },
        { id: 'mango', content: 'THIRD' },
      ]),
    );
    expect(prompt).toBe(['FIRST', 'SECOND', 'THIRD'].join(SEPARATOR));
  });
});

describe('how a product section renders', () => {
  it('renders an untitled section as its bare content', () => {
    expect(composeSystemPrompt(createProductSections([{ id: 'core', content: 'CORE TEXT' }]))).toBe(
      'CORE TEXT',
    );
  });

  it('renders a titled section under a heading, like every other titled section', () => {
    expect(
      composeSystemPrompt(
        createProductSections([{ id: 'core', title: 'Core Rules', content: 'CORE TEXT' }]),
      ),
    ).toBe('## Core Rules\nCORE TEXT');
  });

  it('joins neighbouring sections with the one separator the whole prompt uses', () => {
    const prompt = composeSystemPrompt(
      createProductSections([
        { id: 'a', content: 'ALPHA' },
        { id: 'b', title: 'Beta', content: 'BETA' },
      ]),
    );
    expect(prompt).toBe(`ALPHA${SEPARATOR}## Beta\nBETA`);
  });

  it('adds nothing for blank content', () => {
    const sections = createProductSections([
      { id: 'empty', content: '' },
      { id: 'spaces', content: '  \n\t ' },
      { id: 'real', content: 'REAL' },
    ]);
    expect(sections.map((section) => section.id)).toEqual(['real']);
  });

  it('adds nothing when no list is given or the list is empty', () => {
    expect(ids({})).not.toContain('product-core');
    expect(ids({ productSections: [] })).toEqual(ids({}));
  });
});

describe('a product section list is validated as a whole', () => {
  it('refuses a duplicate id and names it', () => {
    expect(() =>
      buildSystemPromptSections(
        params({
          productSections: [
            { id: 'product-core', content: 'ONE' },
            { id: 'product-core', content: 'TWO' },
          ],
        }),
      ),
    ).toThrow(ConfigurationError);
    expect(() =>
      createProductSections([
        { id: 'product-core', content: 'ONE' },
        { id: 'product-core', content: 'TWO' },
      ]),
    ).toThrow(/Duplicate product prompt section id: "product-core"/);
  });

  it('refuses a duplicate id even when one of the two is blank', () => {
    expect(() =>
      createProductSections([
        { id: 'product-core', content: '' },
        { id: 'product-core', content: 'TWO' },
      ]),
    ).toThrow(/Duplicate product prompt section id/);
  });
});

describe('the manifest and the harness version cover a product section', () => {
  it('lists the section with its id and the product source', () => {
    const manifest = describeSystemPromptSections(
      buildSystemPromptSections(
        params({
          productSections: [{ id: 'product-core', title: 'Core', content: 'CORE' }],
          presetSystemPrompt: 'PRESET',
        }),
      ),
    );
    const section = manifest.sections.find((entry) => entry.id === 'product-core');
    expect(section).toEqual({
      id: 'product-core',
      source: 'product',
      characters: '## Core\nCORE'.length,
    });
    expect(manifest.sections.map((entry) => entry.id)).toContain('preset-system-prompt');
  });

  it('keeps the lengths adding up to the prompt length', () => {
    const sections = buildSystemPromptSections(
      params({
        productSections: [
          { id: 'one', content: 'ONE' },
          { id: 'two', title: 'Two', content: 'TWO' },
        ],
        presetSystemPrompt: 'PRESET',
      }),
    );
    const manifest = describeSystemPromptSections(sections);
    const separators = (manifest.sections.length - 1) * SEPARATOR.length;
    const total = manifest.sections.reduce((sum, entry) => sum + entry.characters, separators);
    expect(total).toBe(composeSystemPrompt(sections).length);
  });

  it('is "none" only when no harness section is present at all', () => {
    expect(harnessVersion({})).toBe('none');
    expect(harnessVersion({ productSections: [{ id: 'blank', content: '  ' }] })).toBe('none');
    expect(harnessVersion({ productSections: [{ id: 'core', content: 'CORE' }] })).toMatch(
      /^sha256:[0-9a-f]{12}$/,
    );
  });

  it('changes when the content of a product section changes', () => {
    const before = harnessVersion({ productSections: [{ id: 'core', content: 'CORE ONE' }] });
    const after = harnessVersion({ productSections: [{ id: 'core', content: 'CORE TWO' }] });
    expect(before).not.toBe(after);
  });

  it('does not change with the project the prompt is composed for', () => {
    const product = [{ id: 'core', content: 'CORE' }];
    expect(harnessVersion({ productSections: product, agentsMd: 'ONE' })).toBe(
      harnessVersion({ productSections: product, agentsMd: 'TWO', cwd: '/elsewhere' }),
    );
  });
});

describe('a product section followed by a preset prompt', () => {
  const CORE = 'CORE HARNESS TEXT\nsecond line';
  const PRESET = 'PRESET OWN PROMPT';

  /** The text a product used to fold into the one preset section it had. */
  function folded(presetSystemPrompt: string): string {
    return buildSystemPrompt(params({ presetSystemPrompt }));
  }

  it('renders byte for byte what one folded preset section rendered', () => {
    const separate = buildSystemPrompt(
      params({ productSections: [{ id: 'core', content: CORE }], presetSystemPrompt: PRESET }),
    );
    expect(separate).toBe(folded(`${CORE}${SEPARATOR}${PRESET}`));
  });

  it('renders the core alone, as the folded text did, when the preset names no prompt', () => {
    const separate = buildSystemPrompt(
      params({ productSections: [{ id: 'core', content: CORE }], presetSystemPrompt: '  ' }),
    );
    expect(separate).toBe(folded(CORE));
  });
});
