import { describe, it, expect } from 'vitest';
import { expandPasteLabels } from '../paste-labels.js';

describe('expandPasteLabels', () => {
  it('should expand single paste label', () => {
    const store = new Map([[1, 'line1\nline2\nline3']]);
    const result = expandPasteLabels('[Pasted text #1 +3 lines]', store);
    expect(result).toBe('line1\nline2\nline3');
  });

  it('should expand multiple paste labels', () => {
    const store = new Map([
      [1, 'first paste'],
      [2, 'second paste'],
    ]);
    const result = expandPasteLabels(
      'before [Pasted text #1 +1 lines] middle [Pasted text #2 +1 lines] after',
      store,
    );
    expect(result).toBe('before first paste middle second paste after');
  });

  it('should return empty string for missing store entry', () => {
    const store = new Map<number, string>();
    const result = expandPasteLabels('[Pasted text #1 +3 lines]', store);
    expect(result).toBe('');
  });

  it('should preserve text without paste labels', () => {
    const store = new Map<number, string>();
    const result = expandPasteLabels('regular text without labels', store);
    expect(result).toBe('regular text without labels');
  });

  it('should handle label with different line counts', () => {
    const store = new Map([[1, 'a\nb']]);
    expect(expandPasteLabels('[Pasted text #1 +2 lines]', store)).toBe('a\nb');
    expect(expandPasteLabels('[Pasted text #1 +99 lines]', store)).toBe('a\nb');
  });
});
