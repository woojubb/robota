import { describe, expect, it } from 'vitest';

import { createBoundedOutput } from './bounded-output';

describe('createBoundedOutput (ARCH-056)', () => {
  it('head retention keeps the first maxBytes and reports what was dropped', () => {
    const output = createBoundedOutput({ maxBytes: 5 });
    output.append('abc');
    output.append('defgh');
    output.append(new TextEncoder().encode('ij'));
    expect(output.retainedBytes).toBe(5);
    expect(output.totalBytes).toBe(10);
    expect(output.droppedBytes).toBe(5);
    expect(output.truncated).toBe(true);
    expect(output.toString()).toBe('abcde\n…[output truncated: 5 byte(s) dropped]');
  });

  it('tail retention keeps the last maxBytes across chunk boundaries', () => {
    const output = createBoundedOutput({ maxBytes: 4, retain: 'tail' });
    output.append('12');
    output.append('345');
    output.append('6789abc');
    expect(output.retainedBytes).toBe(4);
    expect(output.toString()).toBe('…[output truncated: 8 byte(s) dropped]\n9abc');
  });

  it('memory stays bounded while reading: retained bytes never exceed the budget', () => {
    const output = createBoundedOutput({ maxBytes: 1024, retain: 'tail' });
    for (let i = 0; i < 10_000; i += 1) {
      output.append('x'.repeat(100));
      expect(output.retainedBytes).toBeLessThanOrEqual(1024);
    }
    expect(output.totalBytes).toBe(1_000_000);
  });

  it('is unchanged and unmarked when under budget, and decodes multi-byte text once', () => {
    const output = createBoundedOutput({ maxBytes: 100 });
    const bytes = new TextEncoder().encode('한글 텍스트');
    output.append(bytes.subarray(0, 4)); // split inside a 3-byte character
    output.append(bytes.subarray(4));
    expect(output.truncated).toBe(false);
    expect(output.toString()).toBe('한글 텍스트');
  });
});
