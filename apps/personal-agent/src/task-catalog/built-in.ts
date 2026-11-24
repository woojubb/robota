/**
 * The task definitions the product ships. They are reviewed with the product, written for the person
 * who reads the card, and promise only what the check beside each one can confirm. Every operation
 * they name is a capability the host must verify before the task can be started, so a card says
 * nothing about a service until the host has.
 */
import type { ITaskDefinition } from './types.js';

/** Raise it whenever the list changes, so a reviewer of the wording sees that the catalog changed. */
export const BUILT_IN_DEFINITIONS_VERSION = 1;

export const BUILT_IN_DEFINITIONS: readonly ITaskDefinition[] = [
  {
    id: 'catch-up-on-mailbox',
    revision: 1,
    title: 'Catch up on a connected mailbox',
    category: 'Mail',
    expectedResult:
      'A short summary of the recent mail that needs your attention, naming the messages it came from.',
    inputs: [
      {
        name: 'period',
        label: 'How far back to look',
        kind: 'choice',
        required: true,
        choices: ['Last day', 'Last 3 days', 'Last week'],
        default: 'Last 3 days',
      },
      { name: 'focus', label: 'Anything in particular to look for', kind: 'text', required: false },
    ],
    capabilities: ['mail.search'],
    effectCeiling: 'read-only',
    completionEvidence: {
      kind: 'source-readback',
      description: 'Each message named in the summary is read back from the mailbox first.',
    },
    execution: 'one-shot',
  },
  {
    id: 'prepare-my-week',
    revision: 1,
    title: 'Prepare my week',
    category: 'Planning',
    expectedResult:
      'A plan for the coming days built from your calendar and your goals, showing what is fixed and what still needs time.',
    inputs: [
      {
        name: 'days',
        label: 'How many days to plan',
        kind: 'number',
        required: true,
        default: 7,
      },
    ],
    capabilities: ['calendar.read', 'goals.read'],
    effectCeiling: 'read-only',
    completionEvidence: {
      kind: 'owner-confirmation',
      description: 'You confirm the plan matches what you meant. Nothing in your calendar changes.',
    },
    execution: 'one-shot',
  },
  {
    id: 'draft-reply-to-message',
    revision: 1,
    title: 'Draft a reply to a message I choose',
    category: 'Mail',
    expectedResult:
      'A reply drafted for the message you pick and kept as a draft for you to review. Nothing is sent.',
    inputs: [
      { name: 'message', label: 'Which message to reply to', kind: 'text', required: true },
      {
        name: 'tone',
        label: 'Tone',
        kind: 'choice',
        required: false,
        choices: ['Friendly', 'Neutral', 'Formal'],
        default: 'Neutral',
      },
    ],
    capabilities: ['mail.read', 'mail.draft'],
    effectCeiling: 'draft',
    completionEvidence: {
      kind: 'owner-confirmation',
      description: 'You read the draft and confirm it before anything leaves your mailbox.',
    },
    execution: 'one-shot',
  },
  {
    id: 'check-fact-on-page',
    revision: 1,
    title: 'Check a fact on a page I give you',
    category: 'Research',
    expectedResult:
      'A yes, no or not-stated answer to your question, with the passage on the page that supports it.',
    inputs: [
      { name: 'page', label: 'Page address', kind: 'text', required: true },
      { name: 'question', label: 'What to check', kind: 'text', required: true },
    ],
    capabilities: ['web.read'],
    effectCeiling: 'read-only',
    completionEvidence: {
      kind: 'source-readback',
      description: 'The quoted passage is read back from the page before it is reported.',
    },
    execution: 'one-shot',
  },
];
