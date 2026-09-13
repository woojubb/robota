import { describe, expect, it } from 'vitest';
import {
  applyCjkTextInput,
  applyCjkTextPaste,
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

  it('Given Ink usePaste single-line text When applied Then text is inserted at cursor', () => {
    const state = { ...createCjkTextInputFlowState('ab'), cursor: 1 };

    const result = applyCjkTextPaste(state, '한글', { canPaste: true });

    expect(result.state).toMatchObject({ value: 'a한글b', cursor: 3 });
    expect(result.effect).toEqual({ type: 'change', value: 'a한글b' });
  });

  it('Given Ink usePaste multiline text When applied Then normalized paste effect is emitted', () => {
    const state = { ...createCjkTextInputFlowState('ab'), cursor: 1 };

    const result = applyCjkTextPaste(state, 'x\r\ny\rz', { canPaste: true });

    expect(result.state).toBe(state);
    expect(result.effect).toEqual({ type: 'paste', text: 'x\ny\nz', cursor: 1 });
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

  it('Given vertical navigation disabled When up arrow is applied Then cursor is unchanged', () => {
    const state = { ...createCjkTextInputFlowState('abcdef'), cursor: 5 };

    const result = applyCjkTextInput(
      state,
      '',
      { upArrow: true },
      {
        canPaste: true,
        enableVerticalNavigation: false,
        availableWidth: 2,
      },
    );

    expect(result.state).toBe(state);
    expect(result.effect).toEqual({ type: 'none' });
  });
});

/**
 * CLI-2004 — `Ctrl+W` and `Ctrl+U` are NEW BINDINGS, and they are unconditional.
 *
 * Ink reports `Ctrl+W` as `input: 'w'` with `ctrl: true`, so before this change the keystroke fell
 * through to the printable path and typed a literal `w` into the buffer. That is a defect on the
 * default path, not only in screen-reader mode, so the fix is not gated on the mode — which makes it
 * a change to today's behaviour, and these cases are where that change is pinned. What the mode adds
 * is only the announcement, which is `InputArea`'s to render from `deleted` / `deletedScope`.
 */
describe('CLI-2004 — word and line deletion are default bindings, not mode-gated ones', () => {
  it('Given Ctrl+W When applied Then the word before the cursor is deleted, not a "w" typed', () => {
    const result = applyCjkTextInput(
      createCjkTextInputFlowState('hello world'),
      'w',
      { ctrl: true },
      { canPaste: true },
    );

    expect(result.state).toMatchObject({ value: 'hello ', cursor: 6 });
    expect(result.effect).toEqual({
      type: 'change',
      value: 'hello ',
      deleted: 'world',
      deletedScope: 'word',
    });
  });

  it('Given Ctrl+W with trailing spaces Then the spaces go with the word, as every shell does', () => {
    const result = applyCjkTextInput(
      createCjkTextInputFlowState('one two   '),
      'w',
      { ctrl: true },
      { canPaste: true },
    );

    expect(result.state.value).toBe('one ');
    expect(result.effect).toMatchObject({ deleted: 'two   ', deletedScope: 'word' });
  });

  it('Given Ctrl+U When applied Then everything before the cursor is deleted', () => {
    const state = { ...createCjkTextInputFlowState('abc def'), cursor: 4 };

    const result = applyCjkTextInput(state, 'u', { ctrl: true }, { canPaste: true });

    expect(result.state).toMatchObject({ value: 'def', cursor: 0 });
    expect(result.effect).toEqual({
      type: 'change',
      value: 'def',
      deleted: 'abc ',
      deletedScope: 'line',
    });
  });

  it('Given a plain "w" with no ctrl Then it is still typed', () => {
    const result = applyCjkTextInput(
      createCjkTextInputFlowState('ne'),
      'w',
      {},
      { canPaste: true },
    );

    expect(result.state.value).toBe('new');
    expect(result.effect).toEqual({ type: 'change', value: 'new' });
  });

  it('Given the cursor at the start Then either deletion is a no-op rather than an empty change', () => {
    const state = createCjkTextInputFlowState('');

    expect(applyCjkTextInput(state, 'w', { ctrl: true }, { canPaste: true }).effect).toEqual({
      type: 'none',
    });
    expect(applyCjkTextInput(state, 'u', { ctrl: true }, { canPaste: true }).effect).toEqual({
      type: 'none',
    });
  });
});
