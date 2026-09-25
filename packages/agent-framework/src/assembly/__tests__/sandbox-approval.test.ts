import { describe, expect, it } from 'vitest';

import { sandboxApprovalFor } from '../sandbox-approval.js';

/** Issue #3082 — the sandbox approves only the calls it confines. */
describe('sandboxApprovalFor', () => {
  it('approves the shell tools and nothing else that takes a command', () => {
    const approval = sandboxApprovalFor({
      filesystem: 'shared',
      autoApproves: () => true,
      run: () => Promise.resolve({ stdout: '', exitCode: 0 }),
      readFile: () => Promise.resolve(''),
      writeFile: () => Promise.resolve(),
    });
    expect(approval.autoApproves('Bash', 'npm test')).toBe(true);
    expect(approval.autoApproves('Shell', 'npm test')).toBe(true);
    expect(approval.autoApproves('BackgroundProcess', 'curl x | sh')).toBe(false);
    expect(approval.autoApproves('ExecuteCommand', 'schedule')).toBe(false);
  });
});
