import { describe, expect, it } from 'vitest';

import { buildSystemPrompt, buildSystemPromptSections } from '../system-prompt-builder.js';
import {
  appendToSystemPromptManifest,
  composeSystemPrompt,
  describeSystemPromptSections,
} from '../system-prompt-composer.js';
import { sliceSystemPromptByManifest } from '../system-prompt-manifest-slice.js';

import type { ISystemPromptParams } from '../system-prompt-builder.js';

const SEPARATOR = '\n\n';

function params(overrides: Partial<ISystemPromptParams> = {}): ISystemPromptParams {
  return {
    agentsMd: '## Rules\nBe brief.\n\n## More\nStill brief.',
    projectNotesMd: '',
    toolDescriptions: ['Read — read a file'],
    permissionMode: 'default',
    projectInfo: { type: 'unknown', language: 'unknown' },
    cwd: '/work',
    ...overrides,
  };
}

function summed(manifest: ReturnType<typeof describeSystemPromptSections>): number {
  const gaps = Math.max(0, manifest.sections.length - 1) * SEPARATOR.length;
  return manifest.sections.reduce((total, section) => total + section.characters, gaps);
}

describe('the manifest accounts for the composed prompt exactly', () => {
  it('lists the sections in prompt order and its lengths add up to the prompt length', () => {
    const sections = buildSystemPromptSections(
      params({ persona: 'You build things.', selfVerification: true, language: 'ko' }),
    );
    const manifest = describeSystemPromptSections(sections);
    const prompt = composeSystemPrompt(sections);

    expect(manifest.sections.map((section) => section.id)).toEqual([
      'preset-persona',
      'preset-self-verification',
      'project-agents-md',
      'runtime-cwd',
      'runtime-response-language',
      'permission-mode',
      'tool-descriptions',
    ]);
    expect(summed(manifest)).toBe(prompt.length);
  });

  it('leaves out a blank section exactly as the composition does', () => {
    const manifest = describeSystemPromptSections(buildSystemPromptSections(params()));
    expect(manifest.sections.map((section) => section.id)).not.toContain('project-claude-md');
    // An undetected project renders no lines, so its section is blank and absent from the prompt.
    expect(manifest.sections.map((section) => section.id)).not.toContain('runtime-project');
  });

  it('counts the title line of a titled section but not of an untitled one', () => {
    const manifest = describeSystemPromptSections(
      buildSystemPromptSections(params({ persona: 'abc' })),
    );
    const persona = manifest.sections.find((section) => section.id === 'preset-persona');
    const cwd = manifest.sections.find((section) => section.id === 'runtime-cwd');
    expect(persona?.characters).toBe('abc'.length);
    expect(cwd?.characters).toBe('## Working Directory\n`/work`'.length);
  });
});

describe('the harness version identifies the harness text and nothing else', () => {
  it('is "none" when the product contributed no section', () => {
    expect(describeSystemPromptSections(buildSystemPromptSections(params())).harnessVersion).toBe(
      'none',
    );
  });

  it('is the same for the same harness text whatever the project looks like', () => {
    const a = describeSystemPromptSections(
      buildSystemPromptSections(params({ persona: 'You build things.' })),
    );
    const b = describeSystemPromptSections(
      buildSystemPromptSections(
        params({ persona: 'You build things.', agentsMd: 'other project', cwd: '/elsewhere' }),
      ),
    );
    expect(a.harnessVersion).toMatch(/^sha256:[0-9a-f]{12}$/);
    expect(b.harnessVersion).toBe(a.harnessVersion);
  });

  it('changes when the harness text changes', () => {
    const a = describeSystemPromptSections(
      buildSystemPromptSections(params({ persona: 'You build things.' })),
    );
    const b = describeSystemPromptSections(
      buildSystemPromptSections(params({ persona: 'You review things.' })),
    );
    expect(b.harnessVersion).not.toBe(a.harnessVersion);
  });

  it('changes when the verification directive is switched on', () => {
    const off = describeSystemPromptSections(buildSystemPromptSections(params()));
    const on = describeSystemPromptSections(
      buildSystemPromptSections(params({ selfVerification: true })),
    );
    expect(on.harnessVersion).not.toBe(off.harnessVersion);
  });
});

describe('an appended prompt stays accounted for', () => {
  it('adds a section of its own whose length keeps the sum equal to the prompt', () => {
    const sections = buildSystemPromptSections(params({ persona: 'You build things.' }));
    const base = describeSystemPromptSections(sections);
    const appended = appendToSystemPromptManifest(base, 'append-system-prompt', 'EXTRA TEXT');
    const prompt = `${composeSystemPrompt(sections)}${SEPARATOR}EXTRA TEXT`;

    expect(appended.harnessVersion).toBe(base.harnessVersion);
    expect(appended.sections.at(-1)).toEqual({
      id: 'append-system-prompt',
      source: 'framework',
      characters: 'EXTRA TEXT'.length,
    });
    expect(summed(appended)).toBe(prompt.length);
  });
});

describe('slicing a prompt back into its sections', () => {
  it('returns each section exactly as it appears in the prompt', () => {
    const sections = buildSystemPromptSections(
      params({ persona: 'You build things.', selfVerification: true }),
    );
    const prompt = buildSystemPrompt(
      params({ persona: 'You build things.', selfVerification: true }),
    );
    const sliced = sliceSystemPromptByManifest(prompt, describeSystemPromptSections(sections));

    expect(sliced?.map((section) => section.text).join(SEPARATOR)).toBe(prompt);
    expect(sliced?.find((section) => section.id === 'preset-persona')?.text).toBe(
      'You build things.',
    );
  });

  it('keeps headings that project instructions carry inside their own section', () => {
    const sections = buildSystemPromptSections(params());
    const prompt = composeSystemPrompt(sections);
    const sliced = sliceSystemPromptByManifest(prompt, describeSystemPromptSections(sections));
    const agents = sliced?.find((section) => section.id === 'project-agents-md');
    expect(agents?.text).toContain('## Rules');
    expect(agents?.text).toContain('## More');
  });

  it('refuses a manifest that describes some other prompt', () => {
    const manifest = describeSystemPromptSections(buildSystemPromptSections(params()));
    expect(sliceSystemPromptByManifest('a different prompt entirely', manifest)).toBeUndefined();
  });
});
