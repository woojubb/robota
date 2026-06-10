import { describe, expect, it } from 'vitest';

import { formatLockfileFailureMessage } from '../pre-push-updates.mjs';

describe('pre-push lockfile gate', () => {
  it('failure message names the CI error class and the fix commands', () => {
    const message = formatLockfileFailureMessage();
    expect(message).toContain('ERR_PNPM_OUTDATED_LOCKFILE');
    expect(message).toContain('pnpm install');
    expect(message).toContain('git add pnpm-lock.yaml');
    expect(message).toContain('push blocked');
  });
});
