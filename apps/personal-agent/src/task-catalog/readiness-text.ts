/**
 * Every reason a task is unavailable, in the words the person reads. They are fixed here, apart from
 * the logic that picks one, so the page and the tests pin the words in one place. A reason names a
 * capability, the person's own title for a connector or a tool the host reviewed; it never repeats
 * text a service or a definition supplied.
 */
import type { TEffectCeiling } from './types.js';

const EFFECT_PHRASE: Readonly<Record<TEffectCeiling, string>> = {
  'read-only': 'only reads',
  draft: 'prepares drafts',
  'approval-required-write': 'makes changes after approval',
};

export const READINESS_TEXT = {
  noBinding: (capability: string): string => `no verified binding for ${capability} yet`,
  aboveCeiling: (capability: string, effect: TEffectCeiling, ceiling: TEffectCeiling): string =>
    `the verified binding for ${capability} ${EFFECT_PHRASE[effect]}, but this task ${EFFECT_PHRASE[ceiling]}`,
  localBrowserUnavailable: 'the local browser is not available on this machine',
  toolMissing: (connectorTitle: string, tool: string): string =>
    `${connectorTitle} does not offer the tool ${tool}`,
  connectorsUnreadable: 'your connected services could not be read right now',
} as const;
