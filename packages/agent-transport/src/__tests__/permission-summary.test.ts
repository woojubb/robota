import { describe, expect, it } from 'vitest';

import { permissionSummaryArgument } from '../permission-summary.js';

describe('permissionSummaryArgument', () => {
  it('names a call by the argument a person recognises, file tools included', () => {
    expect(permissionSummaryArgument({ filePath: '/w/a.txt', content: 'x' })).toBe('/w/a.txt');
    expect(permissionSummaryArgument({ command: 'make', filePath: '/w/a.txt' })).toBe('make');
    expect(permissionSummaryArgument({ file_path: 'b.txt' })).toBe('b.txt');
    expect(permissionSummaryArgument({ url: 'https://x.test' })).toBe('https://x.test');
  });

  it('has nothing to show for empty or non-text arguments', () => {
    expect(permissionSummaryArgument({ command: '' })).toBeUndefined();
    expect(permissionSummaryArgument({ path: 3 })).toBeUndefined();
    expect(permissionSummaryArgument({})).toBeUndefined();
  });
});
