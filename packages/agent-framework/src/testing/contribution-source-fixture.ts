import { createNodeHostContributionSource } from '../contributions/index.js';
import { SkillCommandSource } from '../commands/skill-source.js';

import type { IContributionSource } from '../contributions/index.js';
import type { ISkillRootDescriptor } from '../commands/skill-source.js';

export const TEST_SKILL_ROOTS: readonly ISkillRootDescriptor[] = [
  { root: '.robota/skills', kind: 'skills' },
  { root: '.claude/skills', kind: 'skills' },
  { root: '.claude/commands', kind: 'commands' },
  { root: '.agents/skills', kind: 'skills' },
];

/** Test-only shorthand for explicit host-owned fixture roots. */
export function createNodeHostContributionSourcesFixture(
  ...roots: readonly string[]
): readonly IContributionSource[] {
  return [...new Set(roots)].map(createNodeHostContributionSource);
}

export function createTestSkillCommandSource(
  sources: readonly IContributionSource[],
  roots: readonly ISkillRootDescriptor[] = TEST_SKILL_ROOTS,
): SkillCommandSource {
  return new SkillCommandSource(sources, roots);
}
