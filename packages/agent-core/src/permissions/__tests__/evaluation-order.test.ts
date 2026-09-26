import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearRegisteredToolProfiles,
  evaluatePermission,
  registerToolPermissionProfile,
} from '../permission-gate.js';
import { requiresFreshApproval } from '../permission-gate.js';
import { isProtectedPath, removesCriticalPath } from '../permission-safeguards.js';

/**
 * Issue #3081 — one evaluation order for every caller: deny → ceiling → unevaluable deny → the
 * never-auto-approve set → ask-everything → bypass → allow → mode.
 */
const where = { cwd: '/w/project', homeDirectory: '/home/me' };

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
  registerToolPermissionProfile('Read', {
    argument: { key: 'filePath', kind: 'path' },
    riskClass: 'inspect',
  });
});

afterEach(() => clearRegisteredToolProfiles());

describe('ask rules', () => {
  it('ask even under bypassPermissions', () => {
    expect(
      evaluatePermission('Bash', { command: 'git push origin main' }, 'bypassPermissions', {
        ask: ['Bash(git push *)'],
      }),
    ).toBe('approve');
  });

  it('outrank an allow rule for the same call', () => {
    expect(
      evaluatePermission('Bash', { command: 'git push' }, 'default', {
        allow: ['Bash(git *)'],
        ask: ['Bash(git push*)'],
      }),
    ).toBe('approve');
  });

  it('lose to a deny rule', () => {
    expect(
      evaluatePermission('Bash', { command: 'git push' }, 'default', {
        deny: ['Bash(git push*)'],
        ask: ['Bash(git push*)'],
      }),
    ).toBe('deny');
  });

  it('are matched per command, like a deny, so a compound line cannot hide one', () => {
    expect(
      evaluatePermission('Bash', { command: 'ls && git push' }, 'bypassPermissions', {
        ask: ['Bash(git push*)'],
      }),
    ).toBe('approve');
  });

  it('refuse in plan mode unless the call only inspects', () => {
    expect(
      evaluatePermission('Bash', { command: 'git push' }, 'plan', { ask: ['Bash'] }),
    ).toBe('deny');
    expect(
      evaluatePermission('Read', { filePath: '/w/project/a.ts' }, 'plan', { ask: ['Read'] }),
    ).toBe('approve');
  });
});

describe('critical-path removal is never auto-approved', () => {
  it.each([
    'rm -rf /',
    'rm -rf /usr',
    'rm -rf ~',
    'rm -rf $HOME',
    'rm -rf /home/me',
    'rm -rf .',
    'rm -rf ..',
    'rm -rf /w/project',
    'rm -rf /w',
    'cd /tmp && rm -rf ~',
    'sudo rm -r /etc',
    'rmdir ..',
    'rm -rf -- /',
    'sudo -u root rm -rf /',
    'nice -n 5 rm -rf ~',
    'env -i rm -rf /',
    'rm -rf $HOME/',
    'rm -rf "$HOME/"',
    'rm -rf ${HOME}/',
  ])('%s asks under bypassPermissions', (command) => {
    expect(evaluatePermission('Bash', { command }, 'bypassPermissions', {}, where)).toBe(
      'approve',
    );
  });

  it.each(['rm -rf build', 'rm -rf ./dist node_modules', 'rm -rf /w/project/tmp', 'rm ~/scratch.txt'])(
    '%s stays automatic under bypassPermissions',
    (command) => {
      expect(evaluatePermission('Bash', { command }, 'bypassPermissions', {}, where)).toBe('auto');
    },
  );

  it('is not rescued by an allow rule', () => {
    expect(
      evaluatePermission('Bash', { command: 'rm -rf ~' }, 'default', { allow: ['Bash'] }, where),
    ).toBe('approve');
  });
});

describe('protected paths', () => {
  it.each([
    '/w/project/.git/config',
    '/w/project/.robota/settings.json',
    '/w/project/.claude/settings.local.json',
    '/w/project/.agents/skills/x/SKILL.md',
    '/w/project/.mcp.json',
    '/home/me/.zshrc',
    '/home/me/.npmrc',
  ])('a write to %s asks in bypassPermissions and acceptEdits, allow rule or not', (filePath) => {
    expect(evaluatePermission('Write', { filePath }, 'bypassPermissions')).toBe('approve');
    expect(evaluatePermission('Write', { filePath }, 'acceptEdits', { allow: ['Write'] })).toBe(
      'approve',
    );
  });

  it('are ordinary files inside an isolated worktree, until a protected name recurs', () => {
    expect(
      evaluatePermission(
        'Write',
        { filePath: '/w/project/.robota/worktrees/a1/src/x.ts' },
        'acceptEdits',
      ),
    ).toBe('auto');
    expect(
      evaluatePermission(
        'Write',
        { filePath: '/w/project/.robota/worktrees/a1/.git/config' },
        'acceptEdits',
      ),
    ).toBe('approve');
  });

  it.each([
    '/w/p/.robota/worktrees/../settings.json',
    '.claude/worktrees/x/../../settings.json',
    '/w/p/src/../.git/config',
  ])('cannot be reached around the worktree exemption with .. (%s)', (filePath) => {
    expect(evaluatePermission('Write', { filePath }, 'bypassPermissions')).toBe('approve');
  });

  it('do not stop reading', () => {
    expect(
      evaluatePermission('Read', { filePath: '/w/project/.git/HEAD' }, 'default'),
    ).toBe('auto');
  });
});

describe('the caller ceiling', () => {
  it('denies outside it even under bypassPermissions', () => {
    expect(
      evaluatePermission('Write', { filePath: '/w/project/a.ts' }, 'bypassPermissions', {}, {
        ceiling: ['Read'],
      }),
    ).toBe('deny');
  });

  it('denies rather than asks when the call is outside it and also never-auto', () => {
    expect(
      evaluatePermission('Bash', { command: 'rm -rf ~' }, 'bypassPermissions', {}, {
        ...where,
        ceiling: ['Read'],
      }),
    ).toBe('deny');
  });

  it('an empty ceiling denies everything', () => {
    expect(
      evaluatePermission('Read', { filePath: '/w/project/a.ts' }, 'bypassPermissions', {}, {
        ceiling: [],
      }),
    ).toBe('deny');
  });

  it('lets calls inside it continue to the rest of the order', () => {
    expect(
      evaluatePermission('Read', { filePath: '/w/project/a.ts' }, 'bypassPermissions', {}, {
        ceiling: ['Read'],
      }),
    ).toBe('auto');
  });
});

describe('ask-everything callers', () => {
  it('ask under bypassPermissions, and still lose to a deny', () => {
    expect(
      evaluatePermission('Read', { filePath: '/w/project/a.ts' }, 'bypassPermissions', {}, {
        askAll: true,
      }),
    ).toBe('approve');
    expect(
      evaluatePermission(
        'Read',
        { filePath: '/w/project/a.ts' },
        'bypassPermissions',
        { deny: ['Read'] },
        { askAll: true },
      ),
    ).toBe('deny');
  });
});

describe('safeguard predicates', () => {
  it('isProtectedPath handles relative and Windows-style paths', () => {
    expect(isProtectedPath('.git/hooks/pre-commit')).toBe(true);
    expect(isProtectedPath('C:\\repo\\.claude\\settings.json')).toBe(true);
    expect(isProtectedPath('src/git/index.ts')).toBe(false);
    expect(isProtectedPath('.claude/worktrees')).toBe(true);
  });

  it('removesCriticalPath without a known cwd or home judges only what it can', () => {
    expect(removesCriticalPath('rm -rf /', {})).toBe(true);
    expect(removesCriticalPath('rm -rf ~', {})).toBe(true);
    expect(removesCriticalPath('rm -rf ..', {})).toBe(false);
    expect(removesCriticalPath('echo rm -rf /', {})).toBe(false);
  });
});

describe('requiresFreshApproval', () => {
  it('is true for the never-auto set and ask rules, false for a mode-derived ask', () => {
    expect(requiresFreshApproval('Bash', { command: 'rm -rf ~' }, {}, where)).toBe(true);
    expect(
      requiresFreshApproval('Bash', { command: 'git push' }, { ask: ['Bash(git push*)'] }),
    ).toBe(true);
    expect(requiresFreshApproval('Write', { filePath: '/w/project/.git/config' })).toBe(true);
    expect(requiresFreshApproval('Bash', { command: 'rm -rf build' }, {}, where)).toBe(false);
  });
});

describe('a turn a peer’s message started', () => {
  const MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions', 'auto'] as const;
  const RULES = [{}, { allow: ['Write'] }, { deny: ['Write'] }, { ask: ['Read'] }];
  const CALLS: ReadonlyArray<readonly [string, Record<string, string>]> = [
    ['Write', { filePath: '/w/project/a.txt', content: 'x' }],
    ['Read', { filePath: '/home/me/.aws/credentials' }],
    ['Bash', { command: 'rm -rf build' }],
  ];

  it('decides every other call exactly as the session’s own turn would', () => {
    for (const mode of MODES) {
      for (const rules of RULES) {
        for (const [tool, args] of CALLS) {
          const own = evaluatePermission(tool, { ...args }, mode, rules, where);
          const peer = evaluatePermission(tool, { ...args }, mode, rules, {
            ...where,
            peerTurn: true,
          });
          expect(peer, `${tool} in ${mode} with ${JSON.stringify(rules)}`).toBe(own);
        }
      }
    }
  });

  it('is the only place the reply to the peer exists', () => {
    registerToolPermissionProfile('peer_reply', {
      argument: { key: 'text', kind: 'text' },
      repliesToPeer: true,
    });
    expect(evaluatePermission('peer_reply', { text: 'hi' }, 'bypassPermissions', {}, where)).toBe(
      'deny',
    );
    expect(
      evaluatePermission('peer_reply', { text: 'hi' }, 'default', {}, { ...where, peerTurn: true }),
    ).toBe('approve');
  });
});
