import { describe, expect, it } from 'vitest';

import { clientDeclaresFormElicitation } from '../mcp-call-prompts.js';
import {
  askAnswer,
  askElicitation,
  permissionDecision,
  permissionElicitation,
} from '../mcp-prompt-forms.js';

import type { IAskRequestEvent } from '@robota-sdk/agent-interface-session';

type TAsk = IAskRequestEvent['request'];
const ask = (fields: Omit<TAsk, 'id'>): TAsk => ({ id: 'a1', ...fields });
const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'B', description: 'the second' },
  { value: 'c', label: 'c' },
];

describe('permission form', () => {
  it('offers allow once and deny only, and names who asks, the call and its directory', () => {
    const form = permissionElicitation({
      id: 'p1',
      toolName: 'Bash',
      toolArgs: { command: 'make test' },
      requester: { kind: 'background-agent', label: 'reviewer', taskId: 't1' },
      cwd: '/work/sub',
      canPersistProjectPermission: true,
    });
    expect(form.requestedSchema.properties.decision).toMatchObject({
      enum: ['allow_once', 'deny'],
    });
    expect(form.requestedSchema.required).toEqual(['decision']);
    expect(form.message).toContain('reviewer asks: Allow Bash: make test?');
    expect(form.message).toContain('Working directory: /work/sub');
  });

  it('titles a file tool by its file path', () => {
    const form = permissionElicitation({
      id: 'p1',
      toolName: 'Write',
      toolArgs: { filePath: '/work/notes.txt', content: 'x' },
    });
    expect(form.message.split('\n')[0]).toBe('Allow Write: /work/notes.txt?');
  });

  it('bounds long arguments in the message', () => {
    const form = permissionElicitation({
      id: 'p1',
      toolName: 'Write',
      toolArgs: { file_path: 'a.txt', content: 'x'.repeat(10_000) },
    });
    expect(form.message.length).toBeLessThan(2_200);
  });

  it('allows only an accepted allow-once', () => {
    expect(permissionDecision({ action: 'accept', content: { decision: 'allow_once' } })).toBe(true);
    for (const result of [
      { action: 'accept' as const, content: { decision: 'deny' } },
      { action: 'accept' as const, content: { decision: 'allow-session' } },
      { action: 'accept' as const },
      { action: 'decline' as const, content: { decision: 'allow_once' } },
      { action: 'cancel' as const },
    ]) {
      expect(permissionDecision(result)).toBe(false);
    }
  });
});

describe('ask form', () => {
  it('is not built for a masked ask or one with nothing to answer with', () => {
    expect(askElicitation(ask({ title: 'Key', allowFreeText: true, masked: true }))).toBeUndefined();
    expect(askElicitation(ask({ title: 'Nothing' }))).toBeUndefined();
  });

  it('maps a single choice to a titled enum with its default', () => {
    const form = askElicitation(ask({ title: 'Pick', description: 'one', options, default: { values: ['b'] } }));
    expect(form?.message).toBe('Pick\none');
    expect(form?.requestedSchema).toEqual({
      type: 'object',
      properties: {
        answer: {
          type: 'string',
          title: 'Answer',
          description: 'a: Alpha\nb: B — the second',
          enum: ['a', 'b', 'c'],
          enumNames: ['Alpha', 'B', 'c'],
          default: 'b',
        },
      },
      required: ['answer'],
    });
  });

  it('maps a multiple choice to an array within the selection bounds', () => {
    const form = askElicitation(ask({ title: 'Pick', options, minSelect: 0, maxSelect: 2 }));
    expect(form?.requestedSchema.properties.answer).toMatchObject({
      type: 'array',
      minItems: 0,
      maxItems: 2,
      items: { type: 'string', enum: ['a', 'b', 'c'] },
    });
    expect(form?.requestedSchema.required).toBeUndefined();
  });

  it('adds a text field where typing is allowed', () => {
    const typed = askElicitation(ask({ title: 'Name', allowFreeText: true, placeholder: 'a name' }));
    expect(typed?.requestedSchema).toEqual({
      type: 'object',
      properties: { text: { type: 'string', title: 'Answer', description: 'a name', minLength: 1 } },
      required: ['text'],
    });
    const either = askElicitation(ask({ title: 'Pick', options, allowFreeText: true }));
    expect(Object.keys(either?.requestedSchema.properties ?? {})).toEqual(['answer', 'text']);
    expect(either?.requestedSchema.required).toBeUndefined();
  });
});

describe('ask answer', () => {
  const single = ask({ title: 'Pick', options });
  const multi = ask({ title: 'Pick', options, minSelect: 1, maxSelect: 2 });
  const typed = ask({ title: 'Name', allowFreeText: true });

  it('takes offered values within the bounds, and text where typing is allowed', () => {
    expect(askAnswer(single, { action: 'accept', content: { answer: 'b' } })).toEqual({
      type: 'answer',
      values: ['b'],
    });
    expect(askAnswer(multi, { action: 'accept', content: { answer: ['a', 'c'] } })).toEqual({
      type: 'answer',
      values: ['a', 'c'],
    });
    expect(askAnswer(typed, { action: 'accept', content: { text: 'robota' } })).toEqual({
      type: 'answer',
      values: [],
      text: 'robota',
    });
  });

  it.each<[string, TAsk, Record<string, string | string[]> | undefined]>([
    ['a value that was not offered', single, { answer: 'z' }],
    ['a repeated value', multi, { answer: ['a', 'a'] }],
    ['more values than allowed', multi, { answer: ['a', 'b', 'c'] }],
    ['fewer values than required', multi, { answer: [] }],
    ['text where typing is not allowed', single, { answer: 'a', text: 'x' }],
    ['no answer at all', typed, {}],
    ['an empty text that is not allowed', typed, { text: '' }],
  ])('cancels on %s', (_label, request, content) => {
    expect(askAnswer(request, { action: 'accept', ...(content ? { content } : {}) })).toEqual({
      type: 'cancelled',
    });
  });

  it('cancels when the form is declined or cancelled', () => {
    expect(askAnswer(single, { action: 'decline' })).toEqual({ type: 'cancelled' });
    expect(askAnswer(single, { action: 'cancel', content: { answer: 'a' } })).toEqual({
      type: 'cancelled',
    });
  });
});

describe('client capability', () => {
  it('counts form mode and the bare pre-mode declaration, not URL mode alone', () => {
    expect(clientDeclaresFormElicitation({ elicitation: { form: {} } })).toBe(true);
    expect(clientDeclaresFormElicitation({ elicitation: {} })).toBe(true);
    expect(clientDeclaresFormElicitation({ elicitation: { form: {}, url: {} } })).toBe(true);
    expect(clientDeclaresFormElicitation({ elicitation: { url: {} } })).toBe(false);
    expect(clientDeclaresFormElicitation({})).toBe(false);
    expect(clientDeclaresFormElicitation(undefined)).toBe(false);
  });
});
