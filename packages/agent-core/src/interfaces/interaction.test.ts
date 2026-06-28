import { describe, expect, it } from 'vitest';

import {
  CONFIRM_NO,
  CONFIRM_YES,
  confirmAction,
  isConfirmed,
  multiSelectAction,
  selectAction,
  textAction,
} from '../index.js';

import type { IActionRequest, IUserInteraction, TActionResponse } from '../index.js';

// TC-01 (CMD-004): the unified action contract + ask port are exported from agent-core's public
// surface and carry the full field set. Importing the symbols above from '../index.js' is itself the
// "exported from agent-core" assertion (the module fails to load otherwise).

describe('CMD-004 interaction contract (agent-core SSOT)', () => {
  it('IActionRequest carries the full field set (compile + shape)', () => {
    // Type-level coverage: every documented field is assignable. A dropped field would fail to compile.
    const request: IActionRequest = {
      id: 'demo',
      title: 'Pick',
      description: 'desc',
      options: [{ value: 'a', label: 'A', description: 'opt a' }],
      minSelect: 1,
      maxSelect: 2,
      allowFreeText: true,
      masked: true,
      allowEmpty: true,
      placeholder: 'type…',
      maxVisible: 6,
      default: { values: ['a'], text: 'x' },
    };
    expect(request.options).toHaveLength(1);
    expect(request.masked).toBe(true);
    expect(request.allowEmpty).toBe(true);
  });

  it('confirmAction → two options, single-select; isConfirmed reads the answer', () => {
    const req = confirmAction('exit', 'Exit the session?');
    expect(req.options?.map((o) => o.value)).toEqual([CONFIRM_YES, CONFIRM_NO]);
    expect(req.maxSelect).toBe(1);

    const yes: TActionResponse = { type: 'answer', values: [CONFIRM_YES] };
    const no: TActionResponse = { type: 'answer', values: [CONFIRM_NO] };
    const cancelled: TActionResponse = { type: 'cancelled' };
    expect(isConfirmed(yes)).toBe(true);
    expect(isConfirmed(no)).toBe(false);
    expect(isConfirmed(cancelled)).toBe(false);
  });

  it('selectAction → single-select with optional free text', () => {
    const req = selectAction('mode', 'Select mode', [{ value: 'm', label: 'M' }], {
      allowFreeText: true,
    });
    expect(req.maxSelect).toBe(1);
    expect(req.allowFreeText).toBe(true);
  });

  it('multiSelectAction → defaults min 1 / max = option count', () => {
    const options = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
      { value: 'c', label: 'C' },
    ];
    const req = multiSelectAction('tags', 'Pick tags', options);
    expect(req.minSelect).toBe(1);
    expect(req.maxSelect).toBe(3);
  });

  it('textAction → free-text, optionally masked (secret entry)', () => {
    const req = textAction('apiKey', 'Enter API key', { masked: true, placeholder: 'sk-…' });
    expect(req.allowFreeText).toBe(true);
    expect(req.masked).toBe(true);
    expect(req.options).toBeUndefined();
  });

  it('IUserInteraction.ask resolves to a TActionResponse (port shape)', async () => {
    const port: IUserInteraction = {
      ask: (request) => Promise.resolve({ type: 'answer', values: [request.id] }),
    };
    const res = await port.ask(confirmAction('ok', 'OK?'));
    expect(res.type).toBe('answer');
    if (res.type === 'answer') expect(res.values).toEqual(['ok']);
  });
});
