import { describe, expect, it } from 'vitest';

import { formatOrgPolicyViolationMessage, isApiKeyPlaintext } from '../org-policy-format.js';

describe('formatOrgPolicyViolationMessage', () => {
  it('says the reason alone when the policy names no administrator', () => {
    expect(formatOrgPolicyViolationMessage('Provider blocked.', undefined)).toBe(
      'Provider blocked.',
    );
    expect(formatOrgPolicyViolationMessage('Provider blocked.', '')).toBe('Provider blocked.');
  });

  it('adds the administrator to contact when there is one', () => {
    expect(formatOrgPolicyViolationMessage('Provider blocked.', 'it@example.test')).toBe(
      'Provider blocked.\nContact your administrator: it@example.test',
    );
  });
});

describe('isApiKeyPlaintext', () => {
  it('is true for a literal key, false for an environment reference or no key', () => {
    expect(isApiKeyPlaintext('sk-literal')).toBe(true);
    expect(isApiKeyPlaintext('$ENV:API_KEY')).toBe(false);
    expect(isApiKeyPlaintext(undefined)).toBe(false);
    expect(isApiKeyPlaintext('')).toBe(false);
  });
});
