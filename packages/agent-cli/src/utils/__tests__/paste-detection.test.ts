/**
 * Tests for paste detection and the full paste → label → expand pipeline.
 */

import { describe, it, expect } from 'vitest';
import { filterPrintable } from '../../ui/CjkTextInput.js';
import { expandPasteLabels } from '../paste-labels.js';

describe('filterPrintable and newlines', () => {
  it('should strip newlines from input (they are control chars)', () => {
    expect(filterPrintable('line1\nline2')).toBe('line1line2');
  });

  it('should strip carriage returns', () => {
    expect(filterPrintable('line1\r\nline2')).toBe('line1line2');
  });

  it('should strip tabs', () => {
    expect(filterPrintable('a\tb')).toBe('ab');
  });

  it('should preserve normal text', () => {
    expect(filterPrintable('hello world')).toBe('hello world');
  });
});

describe('Full paste pipeline: detect → label → expand', () => {
  it('should correctly round-trip multiline paste content', () => {
    const pastedText = 'const a = 1;\nconst b = 2;\nconst c = 3;';
    const store = new Map<number, string>();

    // Simulate paste detection
    expect(pastedText.length > 1 && pastedText.includes('\n')).toBe(true);

    // Simulate store + label creation (as InputArea.handlePaste does)
    const id = 1;
    store.set(id, pastedText);
    const lineCount = pastedText.split('\n').length;
    const label = `[Pasted text #${id} +${lineCount} lines]`;
    expect(label).toBe('[Pasted text #1 +3 lines]');

    // Simulate submit → expand
    const expanded = expandPasteLabels(label, store);
    expect(expanded).toBe(pastedText);
  });

  it('should handle paste mixed with typed text', () => {
    const pastedText = 'function hello() {\n  return "world";\n}';
    const store = new Map<number, string>();
    store.set(1, pastedText);

    const userInput = 'Review this code: [Pasted text #1 +3 lines] and fix any bugs';
    const expanded = expandPasteLabels(userInput, store);
    expect(expanded).toBe(
      'Review this code: function hello() {\n  return "world";\n} and fix any bugs',
    );
  });

  it('should handle multiple pastes in one message', () => {
    const store = new Map<number, string>();
    store.set(1, 'first\npaste');
    store.set(2, 'second\npaste\nhere');

    const input = '[Pasted text #1 +2 lines] compare with [Pasted text #2 +3 lines]';
    const expanded = expandPasteLabels(input, store);
    expect(expanded).toBe('first\npaste compare with second\npaste\nhere');
  });
});
