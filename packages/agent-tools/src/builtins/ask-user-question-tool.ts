/**
 * AskUserQuestionTool — let the model ask the user structured questions mid-turn (CMD-005).
 *
 * Built on the CMD-004 ask seam: each question maps onto the `IActionRequest` SSOT and is issued
 * through the injected `IToolExecutionContext.ask` port; the attached environment renders it (Ink
 * dialog, web modal, programmatic pre-answer) and the answers return as the tool result.
 *
 * Contract points (spec CMD-005):
 * - 1–4 questions per call, asked sequentially (the channel's ask queue renders one at a time).
 * - Cancellation is data, not an exception: a dismissed question yields `{ cancelled: true }` and the
 *   remaining unasked questions of the same call are marked cancelled too (no per-item re-prompt).
 * - No `context.ask` (headless/automation): returns `{ unavailable: true, reason }` — never a silent
 *   guess, never a thrown error, so the model can continue autonomously.
 */

import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { createZodFunctionTool } from '../implementations/function-tool';

import type { IBuiltinToolDescriptionOptions } from './tool-options.js';
import type { IToolInvocationResult } from '../types/tool-result.js';
import type { FunctionTool, IActionRequest, IToolExecutionContext } from '@robota-sdk/agent-core';

const MAX_QUESTIONS = 4;

const QuestionSchema = z.object({
  question: z.string().min(1).describe('The complete question to ask the user.'),
  header: z
    .string()
    .optional()
    .describe('Very short topic label for the question (e.g. "Auth method").'),
  options: z
    .array(
      // Models often write bare strings first (observed live) — accept both shapes, no retry needed.
      z.union([
        z.string().min(1).describe('Display text of this choice.'),
        z.object({
          label: z.string().min(1).describe('Display text of this choice.'),
          description: z.string().optional().describe('What choosing this option means.'),
        }),
      ]),
    )
    .optional()
    .describe('Predefined choices (strings or {label, description}). Omit for pure free text.'),
  multiSelect: z
    .boolean()
    .optional()
    .describe('Allow selecting multiple options (default: single select).'),
  allowFreeText: z
    .boolean()
    .optional()
    .describe('Allow a typed custom answer besides the options (default: true).'),
});

const AskUserQuestionSchema = z.object({
  questions: z
    .array(QuestionSchema)
    .min(1)
    .max(MAX_QUESTIONS)
    .describe(`Questions to ask the user (1-${MAX_QUESTIONS}), rendered one at a time.`),
});

type TQuestion = z.infer<typeof QuestionSchema>;
type TAskUserQuestionArgs = z.infer<typeof AskUserQuestionSchema>;

const ASK_USER_QUESTION_DESCRIPTION = [
  'Ask the user one or more structured questions and wait for their answers.',
  '',
  'Use this when you are blocked on a decision only the user can make — ambiguous requirements,',
  'mutually exclusive approaches, or choices with real trade-offs. Do not use it for decisions with',
  'a conventional default or facts you can verify yourself.',
  '',
  `Provide 1-${MAX_QUESTIONS} questions. Each question offers predefined options and/or free text:`,
  ' - options + default: user picks one option (or types a custom answer unless allowFreeText: false)',
  ' - multiSelect: true: user may pick several options',
  ' - no options: pure free-text entry',
  '',
  'The result is a JSON array with one entry per question: the selected option labels in `values`',
  'and/or the typed answer in `text`, or `cancelled: true` if the user dismissed the question.',
  'If no interactive user is attached (headless run), the result is `{ unavailable: true }` —',
  'continue autonomously with your best judgment and say what you assumed.',
].join('\n');

/** Per-question outcome in the tool result. */
export type TAskUserQuestionAnswer =
  { question: string; values: string[]; text?: string } | { question: string; cancelled: true };

/** The tool result payload (inside IToolInvocationResult.output). */
export type TAskUserQuestionOutput =
  { answers: TAskUserQuestionAnswer[] } | { unavailable: true; reason: string };

function toActionRequest(question: TQuestion): IActionRequest {
  // Normalize both accepted option shapes (bare string | {label, description}) to one form.
  const options = (question.options ?? []).map((option) =>
    typeof option === 'string' ? { label: option } : option,
  );
  const multi = question.multiSelect === true && options.length > 1;
  return {
    id: `ask_${randomUUID()}`,
    title: question.question,
    ...(question.header !== undefined ? { description: question.header } : {}),
    ...(options.length > 0
      ? {
          options: options.map((o) => ({
            value: o.label,
            label: o.label,
            ...(o.description !== undefined ? { description: o.description } : {}),
          })),
        }
      : {}),
    minSelect: options.length > 0 ? 1 : 0,
    maxSelect: multi ? options.length : 1,
    // Free text is the reference-UX "Other" escape hatch; a question without options is free text.
    allowFreeText: question.allowFreeText !== false || options.length === 0,
  };
}

async function askQuestions(
  args: TAskUserQuestionArgs,
  ask: NonNullable<IToolExecutionContext['ask']>,
): Promise<TAskUserQuestionOutput> {
  const answers: TAskUserQuestionAnswer[] = [];
  let dismissed = false;
  for (const question of args.questions) {
    if (dismissed) {
      answers.push({ question: question.question, cancelled: true });
      continue;
    }
    const response = await ask(toActionRequest(question));
    if (response.type === 'cancelled') {
      dismissed = true;
      answers.push({ question: question.question, cancelled: true });
      continue;
    }
    answers.push({
      question: question.question,
      values: [...response.values],
      ...(response.text !== undefined ? { text: response.text } : {}),
    });
  }
  return { answers };
}

/**
 * Create an `AskUserQuestion` tool instance — register with the Robota agent tools registry.
 */
export function createAskUserQuestionTool(
  options: IBuiltinToolDescriptionOptions = {},
): FunctionTool {
  return createZodFunctionTool(
    'AskUserQuestion',
    options.description ?? ASK_USER_QUESTION_DESCRIPTION,
    AskUserQuestionSchema,
    async (params, context) => {
      const args = params;
      const ask = context?.ask;
      const output: TAskUserQuestionOutput = ask
        ? await askQuestions(args, ask)
        : { unavailable: true, reason: 'no interactive user attached' };
      const result: IToolInvocationResult = { success: true, output: JSON.stringify(output) };
      return JSON.stringify(result);
    },
  );
}

/** `AskUserQuestion` tool instance — register with the Robota agent tools registry. */
export const askUserQuestionTool = createAskUserQuestionTool();
