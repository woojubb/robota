/**
 * The form-to-ask mapping, apart from any carrier: each field kind becomes the ask the renderers
 * already know, answers are validated against the field, and every exit is accept, decline or cancel.
 */
import { describe, expect, it } from 'vitest';

import { bridgeElicitation, MCPElicitationCalls } from '../client/elicitation.js';

import type { ElicitRequestFormParams } from '@modelcontextprotocol/client';
import type { IActionRequest, TActionResponse } from '@robota-sdk/agent-core';

type TScript = readonly (TActionResponse | ((request: IActionRequest) => TActionResponse))[];

function scripted(script: TScript) {
  const seen: IActionRequest[] = [];
  const queue = [...script];
  const ask = async (request: IActionRequest): Promise<TActionResponse> => {
    seen.push(request);
    const next = queue.shift();
    if (next === undefined) throw new Error(`No scripted answer for "${request.title}"`);
    return typeof next === 'function' ? next(request) : next;
  };
  return { ask, seen };
}

const pick = (value: string): TActionResponse => ({ type: 'answer', values: [value] });
const picks = (values: string[]): TActionResponse => ({ type: 'answer', values });
const typed = (text: string): TActionResponse => ({ type: 'answer', values: [], text });
const respond = pick('respond');

function form(
  properties: ElicitRequestFormParams['requestedSchema']['properties'],
  required?: string[],
): ElicitRequestFormParams {
  return {
    message: 'Server message',
    requestedSchema: { type: 'object', properties, ...(required ? { required } : {}) },
  };
}

async function bridge(params: ElicitRequestFormParams, script: TScript) {
  const { ask, seen } = scripted(script);
  const result = await bridgeElicitation({ serverName: 'srv', params, ask });
  return { result, seen };
}

describe('bridgeElicitation', () => {
  it('asks the server-titled first question and accepts an empty form after Respond', async () => {
    const { result, seen } = await bridge(form({}), [respond]);
    expect(result).toEqual({ action: 'accept', content: {} });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      title: expect.stringContaining('"srv"'),
      description: 'Server message',
      maxSelect: 1,
    });
    expect(seen[0]?.options?.map((option) => option.value)).toEqual(['respond', 'decline']);
  });

  it('maps Decline and a dismissal of the first question', async () => {
    expect((await bridge(form({}), [pick('decline')])).result).toEqual({ action: 'decline' });
    expect((await bridge(form({}), [{ type: 'cancelled' }])).result).toEqual({ action: 'cancel' });
  });

  it('turns a boolean into yes/no with its default pre-selected', async () => {
    const params = form({ ok: { type: 'boolean', title: 'Proceed', default: true } }, ['ok']);
    const { result, seen } = await bridge(params, [respond, pick('no')]);
    expect(result).toEqual({ action: 'accept', content: { ok: false } });
    expect(seen[1]).toMatchObject({
      title: expect.stringContaining('Proceed'),
      default: { values: ['yes'] },
    });
    expect(seen[1]?.options?.map((option) => option.value)).toEqual(['yes', 'no']);
  });

  it('turns enum, enumNames and oneOf into labelled options', async () => {
    const params = form(
      {
        plain: { type: 'string', enum: ['a', 'b'] },
        named: { type: 'string', enum: ['x', 'y'], enumNames: ['Ex', 'Why'] },
        titled: { type: 'string', oneOf: [{ const: 'p', title: 'Pee' }] },
      },
      ['plain', 'named', 'titled'],
    );
    const { result, seen } = await bridge(params, [respond, pick('b'), pick('y'), pick('p')]);
    expect(result).toEqual({ action: 'accept', content: { plain: 'b', named: 'y', titled: 'p' } });
    expect(seen[1]?.options).toEqual([
      { value: 'a', label: 'a' },
      { value: 'b', label: 'b' },
    ]);
    expect(seen[2]?.options?.map((option) => option.label)).toEqual(['Ex', 'Why']);
    expect(seen[3]?.options).toEqual([{ value: 'p', label: 'Pee' }]);
  });

  it('lets an optional choice be skipped and omits it from the content', async () => {
    const params = form({ color: { type: 'string', enum: ['red', 'green'] } });
    const { result, seen } = await bridge(params, [
      respond,
      (request) => pick(request.options!.at(-1)!.value),
    ]);
    expect(result).toEqual({ action: 'accept', content: {} });
    const values = seen[1]!.options!.map((option) => option.value);
    expect(values.slice(0, 2)).toEqual(['red', 'green']);
    expect(values).toHaveLength(3);
  });

  it('turns an array of enum into a multi-select bounded by minItems and maxItems', async () => {
    const params = form(
      {
        tags: {
          type: 'array',
          title: 'Tags',
          minItems: 1,
          maxItems: 2,
          items: { anyOf: [{ const: 't1', title: 'One' }, { const: 't2', title: 'Two' }, { const: 't3', title: 'Three' }] },
        },
      },
      ['tags'],
    );
    const { result, seen } = await bridge(params, [respond, picks(['t1', 't3'])]);
    expect(result).toEqual({ action: 'accept', content: { tags: ['t1', 't3'] } });
    expect(seen[1]).toMatchObject({ minSelect: 1, maxSelect: 2 });
    expect(seen[1]?.options?.map((option) => option.label)).toEqual(['One', 'Two', 'Three']);
  });

  it('re-asks once for a number that violates the field, then sends the corrected value', async () => {
    const params = form({ count: { type: 'integer', minimum: 1, maximum: 5 } }, ['count']);
    const { result, seen } = await bridge(params, [respond, typed('1.5'), typed('3')]);
    expect(result).toEqual({ action: 'accept', content: { count: 3 } });
    expect(seen).toHaveLength(3);
    expect(seen[1]).toMatchObject({ allowFreeText: true, allowEmpty: false });
    expect(seen[2]?.description).toMatch(/whole number/i);
  });

  it('cancels instead of sending a value the field rejects twice', async () => {
    const params = form({ count: { type: 'number', maximum: 5 } }, ['count']);
    const { result } = await bridge(params, [respond, typed('9'), typed('ten')]);
    expect(result).toEqual({ action: 'cancel' });
  });

  it('checks string bounds and formats, and keeps an optional empty string out of the content', async () => {
    const params = form(
      {
        mail: { type: 'string', format: 'email' },
        name: { type: 'string', minLength: 2, maxLength: 4 },
        memo: { type: 'string' },
      },
      ['mail', 'name'],
    );
    const { result, seen } = await bridge(params, [
      respond,
      typed('not-an-address'),
      typed('a@b.co'),
      typed('abcde'),
      typed('abc'),
      typed(''),
    ]);
    expect(result).toEqual({ action: 'accept', content: { mail: 'a@b.co', name: 'abc' } });
    expect(seen[2]?.description).toMatch(/email/i);
    expect(seen[4]?.description).toMatch(/between 2 and 4/i);
    expect(seen[5]).toMatchObject({ allowEmpty: true });
  });

  it('never masks a field and warns when its name looks like a credential', async () => {
    const params = form({ api_token: { type: 'string', title: 'API token' } }, ['api_token']);
    const { result, seen } = await bridge(params, [respond, typed('visible')]);
    expect(result).toEqual({ action: 'accept', content: { api_token: 'visible' } });
    expect(seen[1]?.masked).toBeUndefined();
    expect(seen[1]?.description).toMatch(/credential/i);
  });

  it('cancels when the ask port fails instead of leaving the server waiting', async () => {
    const failing = async (): Promise<TActionResponse> => {
      throw new Error('surface gone');
    };
    const result = await bridgeElicitation({ serverName: 'srv', params: form({}), ask: failing });
    expect(result).toEqual({ action: 'cancel' });
  });
});

describe('MCPElicitationCalls', () => {
  it('answers through the oldest in-flight call that has a port and nothing once released', () => {
    const calls = new MCPElicitationCalls();
    const first = async (): Promise<TActionResponse> => ({ type: 'cancelled' });
    const second = async (): Promise<TActionResponse> => ({ type: 'cancelled' });
    expect(calls.answerable()).toBeUndefined();
    const releaseNoPort = calls.enter({});
    expect(calls.answerable()).toBeUndefined();
    const releaseFirst = calls.enter({ ask: first });
    const releaseSecond = calls.enter({ ask: second });
    expect(calls.answerable()?.ask).toBe(first);
    releaseFirst();
    expect(calls.answerable()?.ask).toBe(second);
    releaseSecond();
    releaseNoPort();
    expect(calls.answerable()).toBeUndefined();
  });
});
