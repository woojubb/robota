import { join } from 'node:path';

import type { ISkillRootDescriptor } from '@robota-sdk/agent-framework';

/** Product-owned discovery precedence for project and user skill/command sources. */
export const ROBOTA_SKILL_ROOTS: readonly ISkillRootDescriptor[] = [
  { root: join('.robota', 'skills'), kind: 'skills' },
  { root: join('.claude', 'skills'), kind: 'skills' },
  { root: join('.claude', 'commands'), kind: 'commands' },
  { root: join('.agents', 'skills'), kind: 'skills' },
];
