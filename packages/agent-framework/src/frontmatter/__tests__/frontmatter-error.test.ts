import { describe, expect, it } from 'vitest';

import { FrontmatterDecodeError } from '../frontmatter-error.js';

describe('FrontmatterDecodeError', () => {
  it('preserves diagnostics while keeping untrusted received values out of the message', () => {
    const diagnostics = [
      {
        code: 'invalid-value' as const,
        source: '/workspace/private/SKILL.md',
        line: 3,
        column: 7,
        field: 'disable-model-invocation',
        expected: 'a boolean',
        received: 'secret-value',
      },
    ] as const;

    const error = new FrontmatterDecodeError(diagnostics);
    expect(error.diagnostics).toBe(diagnostics);
    expect(error.message).toContain('/workspace/private/SKILL.md:3:7 [invalid-value]');
    expect(error.message).toContain('disable-model-invocation');
    expect(error.message).not.toContain('secret-value');
  });
});
