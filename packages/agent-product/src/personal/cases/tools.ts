/**
 * The case tools: the agent opens a case from something it noticed, notes, asks the person one
 * question and closes it. They change only the agent's own case record and put a question in the
 * person's feed, nothing outside the agent, so they are the kind of tool a run that reads untrusted
 * content may have, and a read-only run may keep a case too.
 */
import { registerToolPermissionProfile } from '@robota-sdk/agent-core';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import { z } from 'zod';

import { CASE_MAX_OPTIONS, CASE_URGENCIES, CaseRefusedError } from './case-book.js';

import type { FunctionTool, TUniversalValue } from '@robota-sdk/agent-core';
import type { CaseBook } from './case-book.js';
import type { ICase } from './types.js';

export const CASE_TOOL_NAMES = {
  open: 'CaseOpen',
  note: 'CaseNote',
  ask: 'CaseAsk',
  close: 'CaseClose',
} as const;

/** Declared on every build: registration merges, and a host that cleared the registry gets them back. */
function registerProfiles(): void {
  // Inspect-class on purpose: plan mode refuses every other class, and a read-only run must still be
  // able to keep a case. Nothing here reaches outside the agent's own state.
  for (const name of Object.values(CASE_TOOL_NAMES)) {
    registerToolPermissionProfile(name, { riskClass: 'inspect' });
  }
}

async function guarded(run: () => Promise<TUniversalValue>): Promise<TUniversalValue> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof CaseRefusedError) return { error: error.message };
    throw error;
  }
}

/**
 * An open case that was never asked: the run that opened it may have been cut short before asking, and
 * nothing else would ask it. A case that was asked and then answered has asked, so it is not this.
 */
function neverAsked(found: ICase): boolean {
  return (
    found.state === 'open' &&
    found.question === undefined &&
    !found.history.some((event) => event.kind === 'asked')
  );
}

export function createCaseTools(
  book: CaseBook,
  scope?: { readonly caseId: string; readonly answerId: string },
): FunctionTool[] {
  registerProfiles();
  const forCase = (id: string): { readonly answerId: string } | undefined => {
    if (scope === undefined) return undefined;
    if (id !== scope.caseId) throw new CaseRefusedError('This turn can only change its own case');
    return { answerId: scope.answerId };
  };
  return [
    createZodFunctionTool(
      CASE_TOOL_NAMES.open,
      'Open a case when you notice something the person may need to decide or confirm: a sign-in notice, a bill due, an unexpected change. Say what you saw and why it matters, quoting where it came from. `source` is your own stable reference to the item (for example a message id), so the same item never opens two cases: if one exists you get it back, with how it ended. An open case that nobody has asked yet comes back with `notAskedYet: true`: the person was never asked (a run may have been cut short before asking), so ask now with `CaseAsk`.',
      z.object({
        title: z.string().min(1),
        noticed: z.string().min(1),
        source: z.string().min(1),
        connector: z.string().optional(),
      }),
      async ({ title, noticed, source, connector }) =>
        guarded(async () => {
          if (scope !== undefined) throw new CaseRefusedError('This turn cannot open another case');
          const { case: found, existing } = await book.open({
            title,
            noticed,
            source,
            ...(connector !== undefined && { connectorId: connector }),
          });
          if (!existing) return { opened: found.id };
          const closing = found.history.findLast((event) => event.kind === 'closed');
          return {
            existing: found.id,
            state: found.state,
            ...(closing !== undefined && { resolution: closing.text }),
            ...(found.question !== undefined && { waitingForThePerson: found.question.text }),
            ...(neverAsked(found) && { notAskedYet: true }),
          };
        }),
    ),
    createZodFunctionTool(
      CASE_TOOL_NAMES.note,
      'Add a short note to an open case: what you found out, or what you checked.',
      z.object({ id: z.string().min(1), text: z.string().min(1) }),
      async ({ id, text }) =>
        guarded(async () => ({ noted: (await book.note(id, text, forCase(id))).id })),
    ),
    createZodFunctionTool(
      CASE_TOOL_NAMES.ask,
      `Ask the person the one question an open case is waiting on. It shows in their feed with your notes as the evidence. Offer up to ${CASE_MAX_OPTIONS} short choices, and allow a reply in their own words when the choices may not fit (a reply is allowed by default when there are no choices). A case has one question at a time. \`urgency\` is your suggestion of how soon the person needs it (${CASE_URGENCIES.join(', ')}): \`now\` only for something that needs them soon, such as a security risk or a deadline within about a day; \`digest\` for what can wait for a daily summary; \`feed\` for the rest, and the default. It is only a suggestion: the person's own limits decide what actually reaches them, and you cannot change them.`,
      z.object({
        id: z.string().min(1),
        question: z.string().min(1),
        options: z.array(z.string()).max(CASE_MAX_OPTIONS).optional(),
        allowReply: z.boolean().optional(),
        urgency: z.string().optional(),
      }),
      async ({ id, question, options, allowReply, urgency }) =>
        guarded(async () => {
          const { case: found, item } = await book.ask(
            id,
            {
              question,
              ...(options !== undefined && { options }),
              ...(allowReply !== undefined && { allowsReply: allowReply }),
              ...(urgency !== undefined && { urgency }),
            },
            forCase(id),
          );
          return { asked: found.id, feedItem: item.id };
        }),
    ),
    createZodFunctionTool(
      CASE_TOOL_NAMES.close,
      'Close a case that is settled, with a one-line resolution. A question still waiting is withdrawn.',
      z.object({ id: z.string().min(1), resolution: z.string().min(1) }),
      async ({ id, resolution }) =>
        guarded(async () => ({ closed: (await book.close(id, resolution, forCase(id))).id })),
    ),
  ];
}

export const CASE_INSTRUCTIONS = [
  'When you notice something the person should decide or confirm, keep a case on it (CaseOpen) and ask them one question (CaseAsk) that carries what you saw. Keep notes with CaseNote, and close the case (CaseClose) once it is settled.',
  'A case has one question at a time. The question shows in their feed and their answer is recorded on the case. Anything you do about it that acts outside your own notes still needs their approval.',
].join('\n');
