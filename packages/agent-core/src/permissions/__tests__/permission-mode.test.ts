import { describe, expect, it } from 'vitest';
import { evaluatePermission } from '../permission-gate';

describe('permission mode policy', () => {
  it('classifies local web tools as read-only known tools', () => {
    expect(evaluatePermission('WebFetch', { url: 'https://example.com' }, 'plan')).toBe('auto');
    expect(evaluatePermission('WebSearch', { query: 'robota sdk' }, 'plan')).toBe('auto');
    expect(evaluatePermission('WebFetch', { url: 'https://example.com' }, 'default')).toBe('auto');
    expect(evaluatePermission('WebSearch', { query: 'robota sdk' }, 'acceptEdits')).toBe('auto');
  });
});
