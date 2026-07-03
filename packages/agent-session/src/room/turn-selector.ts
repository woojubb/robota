/**
 * Built-in turn-selection policies (ROOM-001).
 *
 * The Director selector uses schema-enforced structured output (CORE-015) rather than the
 * tool-call decision workaround — the ROOM-001 backlog's CORE-011 reference predates
 * CORE-015, whose own spec supersedes the tool technique for fixed-schema answers.
 */

import type { IRoomView, ITurnSelector } from './types.js';
import type { Robota } from '@robota-sdk/agent-core';

/**
 * Every member speaks once per round, in join order, for `rounds` rounds. Counts only the
 * turns it schedules itself — externally-appended turns (`room.say`) do not consume rounds.
 */
export function createRoundRobinSelector(rounds: number): ITurnSelector {
  let scheduled = 0;
  return {
    async next(view: IRoomView): Promise<string | null> {
      if (view.members.length === 0) return null;
      if (scheduled >= rounds * view.members.length) return null;
      const speaker = view.members[scheduled % view.members.length];
      scheduled += 1;
      return speaker;
    },
  };
}

/** App-owned policy: return a member name, or `null` to end. */
export function createCallbackSelector(
  fn: (view: IRoomView) => Promise<string | null> | string | null,
): ITurnSelector {
  return {
    async next(view: IRoomView): Promise<string | null> {
      return fn(view);
    },
  };
}

const DIRECTOR_END = 'END';

export interface IDirectorSelectorOptions {
  /** Extra instruction line for the director (e.g. moderation style). */
  instructions?: string;
}

/**
 * A Director agent reads the transcript and picks the next speaker (the speech-project
 * reference pattern). The decision is a schema-enforced structured answer constrained to
 * the member names plus `"END"`. Pair the director with `retainHistory: false` — the full
 * transcript is re-rendered into every decision prompt.
 */
export function createDirectorSelector(
  director: Robota,
  options: IDirectorSelectorOptions = {},
): ITurnSelector {
  return {
    async next(view: IRoomView): Promise<string | null> {
      if (view.members.length === 0) return null;
      const prompt = renderDirectorPrompt(view, options.instructions);
      const decision = (await director.run(prompt, {
        output: {
          name: 'turn_decision',
          jsonSchema: {
            type: 'object',
            properties: {
              next: {
                type: 'string',
                enum: [...view.members, DIRECTOR_END],
                description: 'The member who should speak next, or END to finish.',
              },
            },
            required: ['next'],
          },
        },
      })) as { next: string };
      return decision.next === DIRECTOR_END ? null : decision.next;
    },
  };
}

function renderDirectorPrompt(view: IRoomView, instructions?: string): string {
  const lines: string[] = [];
  lines.push('You direct a multi-party conversation. Decide who should speak next.');
  if (instructions) lines.push(instructions);
  lines.push(`Members: ${view.members.join(', ')}`);
  lines.push('');
  if (view.transcript.length === 0) {
    lines.push('The conversation has not started yet.');
  } else {
    lines.push('Conversation so far:');
    for (const entry of view.transcript) {
      lines.push(`${entry.speaker}: ${entry.content}`);
    }
  }
  lines.push('');
  lines.push(`Pick the next speaker from the members, or "${DIRECTOR_END}" to finish.`);
  return lines.join('\n');
}
