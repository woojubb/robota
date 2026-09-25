import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { allowRulesForAutoMode, isBroadExecutionAllowRule } from '../auto-mode-rules';
import {
  clearRegisteredToolProfiles,
  evaluatePermission,
  registerToolPermissionProfile,
} from '../permission-gate';

describe('allow rules auto mode sets aside', () => {
  it.each([
    'Bash',
    'Bash(*)',
    'Shell(*)',
    '*',
    'Ba*',
    'Bash(python *)',
    'Bash(python3 *)',
    'Bash(node *)',
    'Bash(sh *)',
    'Bash(sudo *)',
    'Bash(npm run *)',
    'Bash(npm *)',
    'Bash(pnpm *)',
    'Bash(npx *)',
    'Bash(make *)',
    'Agent',
    'Agent(*)',
    'BackgroundProcess(*)',
    'BackgroundProcess(python *)',
    'ExecuteCommand',
    'ExecuteCommand(*)',
    'Computer',
    'Bash(pnpm run *)',
    'Bash(pnpm exec *)',
    'Bash(pnpm dlx *)',
    'Bash(yarn run *)',
    'Bash(npm run-script *)',
    'Bash(npx -y *)',
    'Bash(uv run python *)',
    'Bash(npm r*)',
    'Bash(py*)',
    'Bash(nod*)',
    'Bash(/usr/bin/python3 *)',
    'Bash(timeout 60 *)',
    'Bash(nohup *)',
    'Bash(docker run *)',
    'Bash(ssh *)',
    'Bash(find *)',
  ])('%s approves arbitrary execution', (pattern) => {
    expect(isBroadExecutionAllowRule(pattern)).toBe(true);
  });

  it.each([
    'Bash(npm test)',
    'Bash(pnpm test*)',
    'Bash(npm run build*)',
    'Bash(git status*)',
    'Bash(pnpm test*)',
    'Bash(pnpm --filter web test*)',
    'Bash(ls *)',
    'Bash(python)',
    'BackgroundProcess(npm test)',
    'ExecuteCommand(commit)',
    'Read(*)',
    'Write(/w/**)',
    'WebFetch(https://docs.example.com/*)',
  ])('%s stays', (pattern) => {
    expect(isBroadExecutionAllowRule(pattern)).toBe(false);
  });

  it('keeps the narrow rules in order', () => {
    expect(allowRulesForAutoMode(['Bash(*)', 'Bash(npm test)', 'Agent', 'Read(*)'])).toEqual([
      'Bash(npm test)',
      'Read(*)',
    ]);
  });
});

describe('the gate in auto mode', () => {
  beforeEach(() => {
    clearRegisteredToolProfiles();
    registerToolPermissionProfile('Bash', {
      argument: { key: 'command', kind: 'command' },
      riskClass: 'execute',
    });
    registerToolPermissionProfile('Write', {
      argument: { key: 'filePath', kind: 'path' },
      riskClass: 'modify',
    });
  });
  afterEach(() => clearRegisteredToolProfiles());

  const where = { cwd: '/w/project', homeDirectory: '/home/me' };

  it('approves in-workspace edits and leaves execution undecided', () => {
    expect(
      evaluatePermission(
        'Write',
        { filePath: '/w/project/a.ts' },
        'auto',
        { allow: [], deny: [] },
        where,
      ),
    ).toBe('auto');
    expect(
      evaluatePermission(
        'Bash',
        { command: 'npm install' },
        'auto',
        { allow: [], deny: [] },
        where,
      ),
    ).toBe('approve');
  });

  it('still denies what a deny rule names', () => {
    expect(
      evaluatePermission(
        'Bash',
        { command: 'git push' },
        'auto',
        { allow: [], deny: ['Bash(git push*)'] },
        where,
      ),
    ).toBe('deny');
  });

  it('lets a sandbox-confined command run, as in default mode', () => {
    expect(
      evaluatePermission(
        'Bash',
        { command: 'npm install' },
        'auto',
        { allow: [], deny: [] },
        { ...where, sandboxAutoApproved: true },
      ),
    ).toBe('auto');
  });
});
