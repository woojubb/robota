/**
 * Tests for CjkTextInput pure utility functions.
 *
 * These test the input filtering and insertion logic extracted from
 * the React component, without requiring Ink/React rendering.
 */

import { describe, it, expect } from 'vitest';
import { filterPrintable, insertAtCursor } from '../CjkTextInput.js';

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
