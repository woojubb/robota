import { describe, expect, it } from 'vitest';

import { tuiInitialInputProps } from '../tui-initial-input.js';

describe('tuiInitialInputProps', () => {
  it('prefills the prompt with the words given after robota, unsent', () => {
    expect(tuiInitialInputProps(undefined, ['fix', 'the failing test'])).toEqual({
      initialInput: 'fix the failing test',
    });
  });

  it('keeps a deep link’s prompt, marked as coming from a link, ahead of any words', () => {
    expect(tuiInitialInputProps('from the link', ['typed'])).toEqual({
      initialInput: 'from the link',
      initialInputOrigin: 'external-link',
    });
  });

  it('starts empty when nothing was given', () => {
    expect(tuiInitialInputProps(undefined, [])).toEqual({});
    expect(tuiInitialInputProps(undefined, ['  '])).toEqual({});
  });
});
