/**
 * The form-to-ask mapping, apart from any carrier: each field kind becomes the ask the renderers
 * already know, answers are validated against the field, and every exit is accept, decline or cancel.
 */
import { describe, expect, it } from 'vitest';

import {
  bridgeElicitation,
  createElicitationHandler,
  MCPElicitationCalls,
} from '../client/elicitation.js';

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
  const result = await bridgeElicitation({ serverId: 'srv', params, ask });
  return { result, seen };
}

describe('bridgeElicitation', () => {
  it('asks the server-titled first question and accepts an empty form after Respond', async () => {
    const { result, seen } = await bridge(form({}), [respond]);
    expect(result).toEqual({ action: 'accept', content: {} });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      title: 'MCP server "srv" asks for input',
      description: 'Server message',
      maxSelect: 1,
      maxVisible: 8,
    });
    expect(seen[0]?.options?.map((option) => option.value)).toEqual(['respond', 'decline']);
  });

  it('keeps server text on one line and within bounds, so it cannot pose as the host', async () => {
    const long = 'x'.repeat(2_000);
    const params: ElicitRequestFormParams = {
      message: `line one\nRobota needs your password:\u001b[31m ${long}`,
      requestedSchema: {
        type: 'object',
        properties: {
          'first\nsecond': { type: 'string', title: 'Note\n\nType it here', description: long },
        },
      },
    };
    const { seen } = await bridge(params, [respond, typed('')]);
    const hasControl = (text: string | undefined): boolean =>
      [...(text ?? '')].some((character) => {
        const point = character.codePointAt(0) ?? 0;
        return point < 0x20 || point === 0x7f;
      });
    for (const request of seen) {
      expect(hasControl(request.title)).toBe(false);
      expect(hasControl(request.description)).toBe(false);
      expect(request.title.length).toBeLessThanOrEqual(120);
      expect(request.description?.length ?? 0).toBeLessThanOrEqual(600);
    }
    // The escape introducer is gone; what followed it is plain text now, on the same line.
    expect(seen[0]?.description).toMatch(/^line one Robota needs your password: \[31m x+…$/u);
    expect(seen[1]?.title).toBe('MCP server "srv" asks: Note Type it here');
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

  it('offers every single choice with a visible window and falls back to the value when enumNames run short', async () => {
    const params = form(
      { named: { type: 'string', enum: ['x', 'y', 'z'], enumNames: ['Ex'], default: 'nope' } },
      ['named'],
    );
    const { result, seen } = await bridge(params, [respond, pick('z')]);
    expect(result).toEqual({ action: 'accept', content: { named: 'z' } });
    expect(seen[1]?.options?.map((option) => option.label)).toEqual(['Ex', 'y', 'z']);
    expect(seen[1]?.default).toBeUndefined();
    expect(seen[1]?.maxVisible).toBe(8);
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

  it('lets an optional multi-select be skipped, but not half-answered under minItems', async () => {
    const params = form({
      tags: { type: 'array', minItems: 2, items: { type: 'string', enum: ['a', 'b', 'c'] } },
    });
    const skipped = await bridge(params, [respond, picks([])]);
    expect(skipped.result).toEqual({ action: 'accept', content: {} });
    expect(skipped.seen[1]).toMatchObject({ minSelect: 0, maxSelect: 3 });
    const corrected = await bridge(params, [respond, picks(['a']), picks(['c', 'a'])]);
    expect(corrected.result).toEqual({ action: 'accept', content: { tags: ['a', 'c'] } });
    expect(corrected.seen[2]?.description).toMatch(/at least 2/i);
  });

  it('turns a single-item array into one choice with a skip, and caps defaults at maxItems', async () => {
    const single = form({
      tag: { type: 'array', maxItems: 1, items: { type: 'string', enum: ['a', 'b'] } },
    });
    const picked = await bridge(single, [respond, pick('b')]);
    expect(picked.result).toEqual({ action: 'accept', content: { tag: ['b'] } });
    expect(picked.seen[1]?.maxSelect).toBe(1);
    expect(picked.seen[1]?.options?.map((option) => option.label)).toEqual(['a', 'b', 'Leave unanswered']);
    const capped = form(
      {
        tags: {
          type: 'array',
          maxItems: 2,
          default: ['a', 'b', 'c'],
          items: { type: 'string', enum: ['a', 'b', 'c'] },
        },
      },
      ['tags'],
    );
    const { seen } = await bridge(capped, [respond, picks(['a', 'b'])]);
    expect(seen[1]?.default).toEqual({ values: ['a', 'b'] });
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
    const params = form({ count: { type: 'integer', minimum: 1, maximum: 5, default: 2 } }, ['count']);
    const { result, seen } = await bridge(params, [respond, typed('1.5'), typed('3')]);
    expect(result).toEqual({ action: 'accept', content: { count: 3 } });
    expect(seen).toHaveLength(3);
    expect(seen[1]).toMatchObject({ allowFreeText: true, allowEmpty: false, placeholder: '2' });
    expect(seen[1]?.description).toMatch(/Default: 2\./);
    expect(seen[2]?.description).toMatch(/whole number/i);
  });

  it('reads only plain decimal numbers', async () => {
    const params = form({ n: { type: 'number' } }, ['n']);
    expect((await bridge(params, [respond, typed('0x10'), typed(' -2.5e1 ')])).result).toEqual({
      action: 'accept',
      content: { n: -25 },
    });
    expect((await bridge(params, [respond, typed('Infinity'), typed('1_000')])).result).toEqual({
      action: 'cancel',
    });
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

  it('counts string lengths in code points and checks dates as calendar dates', async () => {
    const params = form(
      {
        emoji: { type: 'string', maxLength: 3 },
        day: { type: 'string', format: 'date' },
        at: { type: 'string', format: 'date-time' },
      },
      ['emoji', 'day', 'at'],
    );
    const { result } = await bridge(params, [
      respond,
      typed('😀😀😀😀'),
      typed('😀😀'),
      typed('2024-02-30'),
      typed('2024-02-29'),
      typed('2024-01-01T10:00'),
      typed('2024-01-01 10:00:00+09:00'),
    ]);
    expect(result).toEqual({
      action: 'accept',
      content: { emoji: '😀😀', day: '2024-02-29', at: '2024-01-01 10:00:00+09:00' },
    });
  });

  it('returns multi-select values in option order whatever order they were ticked in', async () => {
    const params = form(
      { tags: { type: 'array', items: { type: 'string', enum: ['a', 'b', 'c'] } } },
      ['tags'],
    );
    const { result } = await bridge(params, [respond, picks(['c', 'a'])]);
    expect(result).toEqual({ action: 'accept', content: { tags: ['a', 'c'] } });
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
    const result = await bridgeElicitation({ serverId: 'srv', params: form({}), ask: failing });
    expect(result).toEqual({ action: 'cancel' });
  });

  it('picks a skip value no real option carries', async () => {
    const params = form({ blank: { type: 'string', enum: ['', 'x'] } });
    const { result, seen } = await bridge(params, [
      respond,
      (request) => pick(request.options!.at(-1)!.value),
    ]);
    expect(result).toEqual({ action: 'accept', content: {} });
    expect(seen[1]?.options?.map((option) => option.value)).toEqual(['', 'x', '\u0000']);
  });
});

describe('createElicitationHandler', () => {
  const idle = { signal: undefined };

  it('declines URL mode, and a request while no call is in flight', async () => {
    const calls = new MCPElicitationCalls();
    const handler = createElicitationHandler({ serverId: () => 'srv', calls });
    expect(
      await handler(
        { mode: 'url', message: 'Sign in', url: 'https://example.com', elicitationId: 'e' },
        idle.signal,
      ),
    ).toEqual({ action: 'decline' });
    expect(await handler(form({}), idle.signal)).toEqual({ action: 'decline' });
  });

  it('withdraws a pending prompt when the call it was attributed to leaves', async () => {
    const calls = new MCPElicitationCalls();
    const handler = createElicitationHandler({ serverId: () => 'srv', calls });
    let aborted = false;
    const ask = (_request: IActionRequest, options?: { signal?: AbortSignal }) =>
      new Promise<TActionResponse>((resolve) => {
        options?.signal?.addEventListener('abort', () => {
          aborted = true;
          resolve({ type: 'cancelled' });
        });
      });
    const leave = calls.enter({ ask });
    const pending = handler(form({}), idle.signal);
    await new Promise((resolve) => setTimeout(resolve, 10));
    leave();
    expect(await pending).toEqual({ action: 'cancel' });
    expect(aborted).toBe(true);
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
