/** The idea tools: the agent keeps the person's thoughts, and may suggest some of its own, marked as such. */
import { registerToolPermissionProfile } from '@robota-sdk/agent-core';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import { z } from 'zod';

import { IdeaRefusedError } from './ideas.js';

import type { FunctionTool, TUniversalValue } from '@robota-sdk/agent-core';
import type { IIdea, IdeaBook } from './ideas.js';

export const IDEA_TOOL_NAMES = { add: 'IdeaAdd', list: 'IdeaList' } as const;

function registerProfiles(): void {
  registerToolPermissionProfile(IDEA_TOOL_NAMES.list, { riskClass: 'inspect' });
  registerToolPermissionProfile(IDEA_TOOL_NAMES.add, { riskClass: 'modify' });
}

function render(idea: IIdea): string {
  const tags = idea.tags.length === 0 ? '' : ` #${idea.tags.join(' #')}`;
  const who = idea.origin === 'agent' ? ' (your suggestion)' : '';
  return `- [${idea.id}] ${idea.text}${tags}${who} (${idea.status})`;
}

export function createIdeaTools(book: IdeaBook): FunctionTool[] {
  registerProfiles();
  return [
    createZodFunctionTool(
      IDEA_TOOL_NAMES.add,
      'Keep an idea for later. Use origin "owner" for a thought the person asked you to keep, and "agent" only for your own suggestion, which stays a suggestion until the person takes it up.',
      z.object({
        text: z.string().min(1),
        tags: z.array(z.string()).optional(),
        origin: z.enum(['owner', 'agent']),
      }),
      async ({ text, tags, origin }): Promise<TUniversalValue> => {
        try {
          const idea = await book.add({ text, origin, ...(tags !== undefined && { tags }) });
          return { kept: idea.id };
        } catch (error) {
          if (error instanceof IdeaRefusedError) return { error: error.message };
          throw error;
        }
      },
    ),
    createZodFunctionTool(
      IDEA_TOOL_NAMES.list,
      'List the ideas you keep for the person, optionally by tag.',
      z.object({ tag: z.string().optional() }),
      async ({ tag }): Promise<TUniversalValue> => {
        const ideas = await book.list(tag === undefined ? {} : { tag });
        return ideas.length === 0 ? 'No ideas.' : ideas.map(render).join('\n');
      },
    ),
  ];
}

export const IDEA_INSTRUCTIONS =
  'When the person mentions something to come back to later, keep it with IdeaAdd. You may suggest ideas of your own, marked as yours; never act on an idea until the person takes it up.';
