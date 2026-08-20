/**
 * ARCH-040 Group D — a preset's `systemPrompt` SEEDS the composed prompt, it does not replace it.
 *
 * The session already offers a REPLACE seam (`ICreateSessionOptions.systemPrompt`). Pointing a preset
 * at it would silently drop the AGENTS.md, project-notes, skill and capability sections the framework
 * composes — context the person choosing a preset did not ask to lose. Owner decision 2026-08-20:
 * seed, do not replace.
 *
 * The decisive case is the last one. "The text appears" is true of a replacement too; only "the text
 * appears AND the surrounding sections survive" tells the two apart.
 */

import { describe, expect, it } from 'vitest';

import { buildSystemPrompt } from '../system-prompt-builder.js';

const AGENTS_MD = 'PROJECT-INSTRUCTIONS-MARKER';
const SEED = 'SEED-PROMPT-MARKER';

function build(extra: Record<string, unknown>): string {
  return buildSystemPrompt({
    cwd: '/workspace',
    projectInfo: { type: 'unknown', language: 'unknown' },
    permissionMode: 'default',
    agentsMd: AGENTS_MD,
    projectNotesMd: '',
    toolDescriptions: [],
    ...extra,
  } as never);
}

describe('a preset system prompt seeds the composed prompt (ARCH-040)', () => {
  it('includes the seed text', () => {
    expect(build({ presetSystemPrompt: SEED })).toContain(SEED);
  });

  it('KEEPS the project instructions the framework composes', () => {
    // The half that distinguishes a seed from a replacement. A replacing implementation passes the
    // case above and fails this one, which is why both are here.
    const prompt = build({ presetSystemPrompt: SEED });
    expect(prompt).toContain(AGENTS_MD);
  });

  it('places the seed ABOVE the persona, so it frames what follows', () => {
    // Priority 4 vs persona's 5. Asserted by ORDER rather than by the priority number, because the
    // number is an implementation detail and the order is the behaviour.
    const prompt = build({ presetSystemPrompt: SEED, persona: 'PERSONA-MARKER' });
    expect(prompt.indexOf(SEED)).toBeLessThan(prompt.indexOf('PERSONA-MARKER'));
  });

  it('adds nothing when the preset names no system prompt', () => {
    const prompt = build({});
    expect(prompt).not.toContain(SEED);
    expect(prompt).toContain(AGENTS_MD);
  });

  it('adds nothing for a blank string', () => {
    // Same rule persona follows: an empty value is not a section, it is an absent one.
    expect(build({ presetSystemPrompt: '   ' })).toContain(AGENTS_MD);
  });
});
