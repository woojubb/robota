import { describe, expect, it } from 'vitest';
import { toCompletionOutcome } from './outcome';

describe('toCompletionOutcome', () => {
  it('maps non-empty text to speak, trimmed', () => {
    expect(toCompletionOutcome('  hello  ')).toEqual({ kind: 'speak', content: 'hello' });
  });

  it('maps an empty string to yield', () => {
    expect(toCompletionOutcome('')).toEqual({ kind: 'yield' });
  });

  it('maps a whitespace-only string to yield', () => {
    expect(toCompletionOutcome('   \n\t')).toEqual({ kind: 'yield' });
  });
});
