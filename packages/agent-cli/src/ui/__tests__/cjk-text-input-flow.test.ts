import { describe, expect, it } from 'vitest';
import {
  applyCjkTextInput,
  createCjkTextInputFlowState,
  syncCjkTextInputFlowState,
} from '../flows/cjk-text-input-flow.js';

describe('cjk text input flow', () => {
  it('Given printable input When applied Then value changes at cursor', () => {
    const result = applyCjkTextInput(
      createCjkTextInputFlowState('ab'),
      'c',
      {},
      { canPaste: true },
    );

    expect(result.state).toMatchObject({ value: 'abc', cursor: 3 });
    expect(result.effect).toEqual({ type: 'change', value: 'abc' });
  });

  it('Given cursor in middle When backspace is applied Then previous char is removed', () => {
    const state = { ...createCjkTextInputFlowState('abc'), cursor: 2 };

    const result = applyCjkTextInput(state, '', { backspace: true }, { canPaste: true });

    expect(result.state).toMatchObject({ value: 'ac', cursor: 1 });
    expect(result.effect).toEqual({ type: 'change', value: 'ac' });
  });

  it('Given return key When applied Then submit effect contains current value', () => {
    const result = applyCjkTextInput(
      createCjkTextInputFlowState('hello'),
      '',
      { return: true },
      { canPaste: true },
    );

    expect(result.effect).toEqual({ type: 'submit', value: 'hello' });
  });

  it('Given multiline fallback paste When applied Then paste effect is emitted', () => {
    const result = applyCjkTextInput(
      createCjkTextInputFlowState(''),
      'a\nb',
      {},
      { canPaste: true },
    );

    expect(result.effect).toEqual({ type: 'paste', text: 'a\nb', cursor: 0 });
  });

  it('Given bracketed multiline paste When end marker arrives Then buffered paste is emitted', () => {
    const started = applyCjkTextInput(
      createCjkTextInputFlowState('x'),
      '[200~hello',
      {},
      { canPaste: true },
    ).state;
    const result = applyCjkTextInput(started, '\nworld[201~', {}, { canPaste: true });

    expect(result.effect).toEqual({ type: 'paste', text: 'hello\nworld', cursor: 1 });
    expect(result.state.isPasting).toBe(false);
  });

  it('Given external value update When synced Then cursor hint is honored', () => {
    const state = createCjkTextInputFlowState('abc');

    const result = syncCjkTextInputFlowState(state, 'a[Pasted]bc', 9);

    expect(result).toMatchObject({ value: 'a[Pasted]bc', cursor: 9 });
  });
});
