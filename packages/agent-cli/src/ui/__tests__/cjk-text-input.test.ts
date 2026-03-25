/**
 * Tests for CjkTextInput pure utility functions.
 *
 * These test the input filtering and insertion logic extracted from
 * the React component, without requiring Ink/React rendering.
 */

import { describe, it, expect } from 'vitest';
import {
  filterPrintable,
  insertAtCursor,
  displayOffset,
  charIndexAtDisplayOffset,
} from '../CjkTextInput.js';

describe('filterPrintable', () => {
  it('returns empty string for null input', () => {
    expect(filterPrintable(null)).toBe('');
  });

  it('returns empty string for undefined input', () => {
    expect(filterPrintable(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(filterPrintable('')).toBe('');
  });

  it('passes through normal ASCII text', () => {
    expect(filterPrintable('hello')).toBe('hello');
  });

  it('passes through Korean characters', () => {
    expect(filterPrintable('안녕하세요')).toBe('안녕하세요');
  });

  it('passes through emoji', () => {
    expect(filterPrintable('🎉')).toBe('🎉');
  });

  it('filters out null byte', () => {
    expect(filterPrintable('\x00')).toBe('');
  });

  it('filters out escape character', () => {
    expect(filterPrintable('\x1b')).toBe('');
  });

  it('filters out DEL character', () => {
    expect(filterPrintable('\x7f')).toBe('');
  });

  it('filters out mixed control characters, keeps printable', () => {
    expect(filterPrintable('\x01hello\x02world\x7f')).toBe('helloworld');
  });

  it('returns empty when input is only control characters', () => {
    expect(filterPrintable('\x00\x01\x02\x03\x1f\x7f')).toBe('');
  });

  it('handles tab character (0x09) — filtered as control', () => {
    expect(filterPrintable('\t')).toBe('');
  });

  it('handles newline (0x0a) — filtered as control', () => {
    expect(filterPrintable('\n')).toBe('');
  });
});

describe('insertAtCursor', () => {
  it('inserts at the beginning', () => {
    const result = insertAtCursor('world', 0, 'hello ');
    expect(result.value).toBe('hello world');
    expect(result.cursor).toBe(6);
  });

  it('inserts at the end', () => {
    const result = insertAtCursor('hello', 5, ' world');
    expect(result.value).toBe('hello world');
    expect(result.cursor).toBe(11);
  });

  it('inserts in the middle', () => {
    const result = insertAtCursor('helo', 3, 'l');
    expect(result.value).toBe('hello');
    expect(result.cursor).toBe(4);
  });

  it('inserts into empty string', () => {
    const result = insertAtCursor('', 0, 'abc');
    expect(result.value).toBe('abc');
    expect(result.cursor).toBe(3);
  });

  it('handles multi-character paste', () => {
    const result = insertAtCursor('ac', 1, 'bb');
    expect(result.value).toBe('abbc');
    expect(result.cursor).toBe(3);
  });

  it('handles Korean character insertion', () => {
    const result = insertAtCursor('안세요', 1, '녕하');
    expect(result.value).toBe('안녕하세요');
    expect(result.cursor).toBe(3);
  });

  it('handles emoji insertion', () => {
    const result = insertAtCursor('hello world', 6, '🎉 ');
    expect(result.value).toBe('hello 🎉 world');
    expect(result.cursor).toBe(9);
  });
});

describe('displayOffset', () => {
  it('returns 0 for charIndex 0', () => {
    expect(displayOffset([...'hello'], 0, 10)).toBe(0);
  });

  it('returns char count for ASCII within one line', () => {
    expect(displayOffset([...'hello'], 3, 10)).toBe(3);
  });

  it('accumulates across wrap boundary', () => {
    // "abcde" width 3: offset at index 4 = 4 (abc on line 0, de on line 1)
    expect(displayOffset([...'abcde'], 4, 3)).toBe(4);
  });

  it('cursor before CJK char is at end of previous content', () => {
    // "abcd한" width 5: cursor before "한" is at col 4 on line 0
    // gap happens when "한" renders, not at cursor position
    expect(displayOffset([...'abcd한'], 4, 5)).toBe(4);
    // cursor after "한": 4(gap included) + 2 = 7 → but via offset: gap is at render
    expect(displayOffset([...'abcd한'], 5, 5)).toBe(7);
  });

  it('handles pure CJK', () => {
    // "한글" width 5: "한"=2, "글"=2 → total 4, fits on one line
    expect(displayOffset([...'한글'], 2, 5)).toBe(4);
  });

  it('handles CJK wrapping', () => {
    // "한글테" width 5: cursor before "테" is after "글" (offset 4)
    // "테" doesn't fit at col 4, but cursor is BEFORE the wrap
    expect(displayOffset([...'한글테'], 2, 5)).toBe(4);
    // cursor after "테": gap(1) + 2 = offset 7
    expect(displayOffset([...'한글테'], 3, 5)).toBe(7);
  });
});

describe('charIndexAtDisplayOffset', () => {
  it('returns 0 for offset 0', () => {
    expect(charIndexAtDisplayOffset([...'hello'], 0, 10)).toBe(0);
  });

  it('finds correct index for ASCII', () => {
    expect(charIndexAtDisplayOffset([...'hello'], 3, 10)).toBe(3);
  });

  it('returns text length when offset exceeds text', () => {
    expect(charIndexAtDisplayOffset([...'hi'], 100, 10)).toBe(2);
  });

  it('round-trips with displayOffset for ASCII', () => {
    const text = 'abcdefghij';
    const chars = [...text];
    const width = 4;
    for (let i = 0; i <= chars.length; i++) {
      const off = displayOffset(chars, i, width);
      expect(charIndexAtDisplayOffset(chars, off, width)).toBe(i);
    }
  });

  it('round-trips with displayOffset for CJK', () => {
    const text = '한글테스트';
    const chars = [...text];
    const width = 5;
    for (let i = 0; i <= chars.length; i++) {
      const off = displayOffset(chars, i, width);
      expect(charIndexAtDisplayOffset(chars, off, width)).toBe(i);
    }
  });

  it('up arrow simulation: offset - width gives previous line position', () => {
    // "abcdef" width 3: line 0 = "abc", line 1 = "def"
    // cursor at index 4 (line 1, col 1) → offset = 4
    // offset - 3 = 1 → charIndex 1 (line 0, col 1)
    const chars = [...'abcdef'];
    const off = displayOffset(chars, 4, 3);
    expect(charIndexAtDisplayOffset(chars, off - 3, 3)).toBe(1);
  });
});
