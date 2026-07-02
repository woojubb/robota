/**
 * CMD-005 TC-01/TC-04(unit): AskUserQuestion tool — schema → IActionRequest mapping, 1–4 batching,
 * cancellation semantics, and the headless `unavailable` result, over a stubbed `context.ask`.
 */
import { describe, expect, it } from 'vitest';

import { createAskUserQuestionTool } from '../builtins/ask-user-question-tool';

import type { TAskUserQuestionOutput } from '../builtins/ask-user-question-tool';
import type { IToolInvocationResult } from '../types/tool-result.js';
import type {
  IActionRequest,
  IToolExecutionContext,
  TActionResponse,
  TToolParameters,
} from '@robota-sdk/agent-core';

function contextWithAsk(
  respond: (request: IActionRequest) => TActionResponse,
  asked: IActionRequest[] = [],
): { context: IToolExecutionContext; asked: IActionRequest[] } {
  const context = {
    toolName: 'AskUserQuestion',
    parameters: {},
    ask: (request: IActionRequest): Promise<TActionResponse> => {
      asked.push(request);
      return Promise.resolve(respond(request));
    },
  } as IToolExecutionContext;
  return { context, asked };
}

async function run(
  params: TToolParameters,
  context?: IToolExecutionContext,
): Promise<TAskUserQuestionOutput> {
  const raw = await createAskUserQuestionTool().execute(params, context);
  const result = JSON.parse(raw.data as string) as IToolInvocationResult;
  expect(result.success).toBe(true);
  return JSON.parse(result.output) as TAskUserQuestionOutput;
}

describe('AskUserQuestion tool (CMD-005)', () => {
  it('registers under the AskUserQuestion name', () => {
    expect(createAskUserQuestionTool().getName()).toBe('AskUserQuestion');
  });

  it('maps a single-select question onto IActionRequest and returns the answer', async () => {
    const { context, asked } = contextWithAsk(() => ({ type: 'answer', values: ['React'] }));
    const output = await run(
      {
        questions: [
          {
            question: 'Which framework?',
            header: 'Framework',
            options: [{ label: 'React', description: 'the default' }, { label: 'Vue' }],
          },
        ],
      },
      context,
    );

    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      title: 'Which framework?',
      description: 'Framework',
      minSelect: 1,
      maxSelect: 1,
      allowFreeText: true,
    });
    expect(asked[0].id).toMatch(/^ask_/);
    expect(asked[0].options).toEqual([
      { value: 'React', label: 'React', description: 'the default' },
      { value: 'Vue', label: 'Vue' },
    ]);
    expect(output).toEqual({ answers: [{ question: 'Which framework?', values: ['React'] }] });
  });

  it('accepts bare-string options (observed live: models write ["A","B"] first)', async () => {
    const { context, asked } = contextWithAsk(() => ({ type: 'answer', values: ['Crimson'] }));
    const output = await run(
      { questions: [{ question: 'Which color?', options: ['Crimson', 'Teal'] }] },
      context,
    );
    expect(asked[0].options).toEqual([
      { value: 'Crimson', label: 'Crimson' },
      { value: 'Teal', label: 'Teal' },
    ]);
    expect(output).toEqual({ answers: [{ question: 'Which color?', values: ['Crimson'] }] });
  });

  it('multiSelect widens maxSelect to the option count', async () => {
    const { context, asked } = contextWithAsk(() => ({
      type: 'answer',
      values: ['a', 'c'],
    }));
    const output = await run(
      {
        questions: [
          {
            question: 'Pick features',
            multiSelect: true,
            options: [{ label: 'a' }, { label: 'b' }, { label: 'c' }],
          },
        ],
      },
      context,
    );
    expect(asked[0]).toMatchObject({ minSelect: 1, maxSelect: 3 });
    expect(output).toEqual({ answers: [{ question: 'Pick features', values: ['a', 'c'] }] });
  });

  it('a question without options is pure free text (allowFreeText forced, minSelect 0)', async () => {
    const { context, asked } = contextWithAsk(() => ({
      type: 'answer',
      values: [],
      text: 'my project',
    }));
    const output = await run(
      { questions: [{ question: 'Project name?', allowFreeText: false }] },
      context,
    );
    expect(asked[0]).toMatchObject({ minSelect: 0, maxSelect: 1, allowFreeText: true });
    expect(asked[0].options).toBeUndefined();
    expect(output).toEqual({
      answers: [{ question: 'Project name?', values: [], text: 'my project' }],
    });
  });

  it('asks a batch sequentially in declaration order', async () => {
    const { context, asked } = contextWithAsk((request) => ({
      type: 'answer',
      values: [request.title],
    }));
    const output = await run(
      {
        questions: [
          { question: 'q1', options: [{ label: 'x' }] },
          { question: 'q2', options: [{ label: 'y' }] },
          { question: 'q3', options: [{ label: 'z' }] },
        ],
      },
      context,
    );
    expect(asked.map((r) => r.title)).toEqual(['q1', 'q2', 'q3']);
    expect(output).toEqual({
      answers: [
        { question: 'q1', values: ['q1'] },
        { question: 'q2', values: ['q2'] },
        { question: 'q3', values: ['q3'] },
      ],
    });
  });

  it('a dismissed question cancels the remaining unasked questions of the call', async () => {
    let calls = 0;
    const { context, asked } = contextWithAsk(() => {
      calls += 1;
      return calls === 2 ? { type: 'cancelled' } : { type: 'answer', values: ['ok'] };
    });
    const output = await run(
      {
        questions: [
          { question: 'q1', options: [{ label: 'ok' }] },
          { question: 'q2', options: [{ label: 'ok' }] },
          { question: 'q3', options: [{ label: 'ok' }] },
        ],
      },
      context,
    );
    // q3 is never rendered — the user already dismissed the interaction at q2.
    expect(asked.map((r) => r.title)).toEqual(['q1', 'q2']);
    expect(output).toEqual({
      answers: [
        { question: 'q1', values: ['ok'] },
        { question: 'q2', cancelled: true },
        { question: 'q3', cancelled: true },
      ],
    });
  });

  it('returns a structured unavailable result when no ask port is attached (headless)', async () => {
    const output = await run({
      questions: [{ question: 'anyone there?', options: [{ label: 'yes' }] }],
    });
    expect(output).toEqual({ unavailable: true, reason: 'no interactive user attached' });
  });

  it('rejects an empty or oversized questions batch (standard builtin validation throw)', async () => {
    const tool = createAskUserQuestionTool();
    await expect(tool.execute({ questions: [] })).rejects.toThrow(/too_small|Zod validation/i);
    await expect(
      tool.execute({
        questions: Array.from({ length: 5 }, (_, i) => ({
          question: `q${i}`,
          options: [{ label: 'a' }],
        })),
      }),
    ).rejects.toThrow(/too_big|Zod validation/i);
  });
});
