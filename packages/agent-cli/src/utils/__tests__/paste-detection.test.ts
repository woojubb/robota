/**
 * Tests for paste detection and the full paste → label → expand pipeline.
 */

import { describe, it, expect } from 'vitest';
import { filterPrintable } from '../../ui/CjkTextInput.js';
import { expandPasteLabels } from '../paste-labels.js';

describe('Paste detection: multiline detection condition', () => {
  /**
   * The condition for multiline paste detection is:
   *   input.length > 1 && input.includes('\n')
   *
   * This tests whether various input strings would trigger paste detection.
   */
  function isMultilinePaste(input: string): boolean {
    return input.length > 1 && (input.includes('\n') || input.includes('\r'));
  }

  it('should detect multiline text with newlines', () => {
    expect(isMultilinePaste('line1\nline2')).toBe(true);
    expect(isMultilinePaste('a\nb\nc')).toBe(true);
  });

  it('should NOT detect single character', () => {
    expect(isMultilinePaste('a')).toBe(false);
  });

  it('should NOT detect empty string', () => {
    expect(isMultilinePaste('')).toBe(false);
  });

  it('should NOT detect single newline only', () => {
    // '\n' has length 1, so length > 1 is false
    expect(isMultilinePaste('\n')).toBe(false);
  });

  it('should NOT detect long single-line text (no newline)', () => {
    expect(isMultilinePaste('this is a long single line paste')).toBe(false);
  });

  it('should detect even two-char input with newline', () => {
    expect(isMultilinePaste('a\n')).toBe(true);
    expect(isMultilinePaste('\na')).toBe(true);
  });

  it('should detect carriage return (raw mode sends \\r instead of \\n)', () => {
    expect(isMultilinePaste('line1\rline2')).toBe(true);
    expect(isMultilinePaste('a\r\nb')).toBe(true);
  });
});

describe('Raw mode newline normalization', () => {
  function normalizeNewlines(input: string): string {
    return input.replace(/\r\n?/g, '\n');
  }

  it('should normalize \\r to \\n', () => {
    expect(normalizeNewlines('a\rb\rc')).toBe('a\nb\nc');
  });

  it('should normalize \\r\\n to \\n', () => {
    expect(normalizeNewlines('a\r\nb\r\nc')).toBe('a\nb\nc');
  });

  it('should preserve existing \\n', () => {
    expect(normalizeNewlines('a\nb\nc')).toBe('a\nb\nc');
  });
});

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
