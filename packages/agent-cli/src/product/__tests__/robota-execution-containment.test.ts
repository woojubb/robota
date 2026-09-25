import { InMemorySandboxClient } from '@robota-sdk/agent-tools';
import { describe, expect, it } from 'vitest';

import {
  checkExecutionContainment,
  robotaSandboxClient,
} from '../robota-execution-containment.js';

/** Issue #3081 — robota names where commands run, and the doctor reports that same value. */
describe('robota execution containment', () => {
  it('robota composes no sandbox, and the doctor says commands run unconfined on the host', () => {
    expect(robotaSandboxClient()).toBeUndefined();
    const check = checkExecutionContainment();
    expect(check.id).toBe('execution.containment');
    expect(check.cause).toBe('host');
    expect(check.detail?.join(' ')).toContain('unconfined');
  });

  it('names a sandbox by its filesystem relation', () => {
    expect(checkExecutionContainment(new InMemorySandboxClient()).cause).toBe('sandbox-separate');
    const shared = Object.assign(new InMemorySandboxClient(), { filesystem: 'shared' as const });
    expect(checkExecutionContainment(shared).cause).toBe('sandbox-shared');
  });
});
