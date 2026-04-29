import { describe, expect, it } from 'vitest';
import {
  applyTextPromptInput,
  createTextPromptFlowState,
  getTextPromptInputAction,
  type ITextPromptFlowState,
} from '../flows/text-prompt-flow.js';

describe('text prompt flow', () => {
  it('Given typed text When submit is applied Then it emits trimmed submit value', () => {
    const typed = applyTextPromptInput(
      createTextPromptFlowState(),
      { type: 'insert', value: '  hello  ' },
      { allowEmpty: false },
    ).state;

    const result = applyTextPromptInput(typed, { type: 'submit' }, { allowEmpty: false });

    expect(result.effect).toEqual({ type: 'submit', value: 'hello' });
    expect(result.state.resolved).toBe(true);
  });

  it('Given empty required text When submit is applied Then validation error stays in state', () => {
    const result = applyTextPromptInput(
      createTextPromptFlowState(),
      { type: 'submit' },
      { allowEmpty: false, validate: (value) => (value.length === 0 ? 'Required' : undefined) },
    );

    expect(result.effect).toEqual({ type: 'none' });
    expect(result.state.error).toBe('Required');
    expect(result.state.resolved).toBe(false);
  });

  it('Given defaultable empty text When submit is applied Then empty submit is allowed', () => {
    const result = applyTextPromptInput(
      createTextPromptFlowState(),
      { type: 'submit' },
      { allowEmpty: true },
    );

    expect(result.effect).toEqual({ type: 'submit', value: '' });
  });

  it('Given text with an error When delete or insert is applied Then the error is cleared', () => {
    const state: ITextPromptFlowState = { value: 'ab', error: 'Invalid', resolved: false };

    const deleted = applyTextPromptInput(state, { type: 'delete' }, { allowEmpty: false });
    const inserted = applyTextPromptInput(
      state,
      { type: 'insert', value: 'c' },
      { allowEmpty: false },
    );

    expect(deleted.state).toMatchObject({ value: 'a', error: undefined });
    expect(inserted.state).toMatchObject({ value: 'abc', error: undefined });
  });

  it('Given prompt is already resolved When input is applied Then no second effect is emitted', () => {
    const state: ITextPromptFlowState = { value: 'done', resolved: true };

    const result = applyTextPromptInput(state, { type: 'submit' }, { allowEmpty: false });

    expect(result.effect).toEqual({ type: 'none' });
    expect(result.state).toBe(state);
  });

  it('Given raw Ink key info When mapped Then terminal details become prompt actions', () => {
    expect(getTextPromptInputAction('', { escape: true })).toEqual({ type: 'cancel' });
    expect(getTextPromptInputAction('', { return: true })).toEqual({ type: 'submit' });
    expect(getTextPromptInputAction('', { backspace: true })).toEqual({ type: 'delete' });
    expect(getTextPromptInputAction('x', { ctrl: false, meta: false })).toEqual({
      type: 'insert',
      value: 'x',
    });
  });
});
