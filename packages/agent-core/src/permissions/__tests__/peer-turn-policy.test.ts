import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearRegisteredToolProfiles,
  evaluatePermission,
  isToolAvailableInPeerTurn,
  registerToolPermissionProfile,
} from '../permission-gate.js';
import { isSecretPath } from '../peer-turn-policy.js';

import type { IPeerTurnAuthority } from '../peer-turn-policy.js';
import type { TResolveInWorkspace } from '../read-only-commands.js';

/**
 * A peer turn is decided by the same evaluator as the operator's, with the peer's authority as one
 * more input. Another host gets no tool; the same host gets reads inside the workspace; the reply
 * after a tool use asks the operator.
 */

let root: string;
let home: string;
let workspace: string;

function resolverFor(cwd: string): TResolveInWorkspace {
  return (base, path) => {
    const target = resolve(base ?? cwd, path);
    let real = target;
    try {
      real = realpathSync(target);
    } catch {
      // allow-fallback: a path that does not exist is judged where it would be.
      real = join(realpathSync(dirname(target)), target.slice(dirname(target).length + 1));
    }
    const fromRoot = relative(realpathSync(cwd), real);
    return fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot))
      ? real
      : undefined;
  };
}

function context(cwd: string, peerTurn?: IPeerTurnAuthority) {
  return {
    cwd,
    homeDirectory: home,
    resolveInWorkspace: resolverFor(cwd),
    ...(peerTurn ? { peerTurn } : {}),
  };
}

const sameHost: IPeerTurnAuthority = { reach: 'same-host', allowChanges: false, toolUsed: false };
const anotherHost: IPeerTurnAuthority = { ...sameHost, reach: 'another-host' };

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'peer-policy-')));
  home = join(root, 'home');
  workspace = join(home, 'project');
  mkdirSync(join(home, '.aws'), { recursive: true });
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(home, '.aws', 'credentials'), 'aws_secret_access_key=TOP');
  writeFileSync(join(workspace, 'README.md'), 'hello');
  writeFileSync(join(workspace, '.env.local'), 'TOKEN=TOP');

  clearRegisteredToolProfiles();
  registerToolPermissionProfile('Read', {
    argument: { key: 'filePath', kind: 'path' },
    riskClass: 'inspect',
    workspacePaths: ['filePath'],
  });
  registerToolPermissionProfile('Grep', {
    argument: { key: 'pattern', kind: 'text' },
    riskClass: 'inspect',
    workspacePaths: ['path', 'glob'],
  });
  registerToolPermissionProfile('WebFetch', {
    argument: { key: 'url', kind: 'url' },
    riskClass: 'inspect',
  });
  registerToolPermissionProfile('Write', {
    argument: { key: 'filePath', kind: 'path' },
    riskClass: 'modify',
  });
  registerToolPermissionProfile('Bash', {
    argument: { key: 'command', kind: 'command' },
    riskClass: 'execute',
  });
  registerToolPermissionProfile('peer_reply', { repliesToPeer: true });
});

afterEach(() => {
  clearRegisteredToolProfiles();
  rmSync(root, { recursive: true, force: true });
});

describe('a peer from another host', () => {
  it('may use no tool, whatever the mode', () => {
    const read = { filePath: join(workspace, 'README.md') };
    expect(
      evaluatePermission('Read', read, 'bypassPermissions', {}, context(workspace, anotherHost)),
    ).toBe('deny');
    expect(isToolAvailableInPeerTurn('Read', anotherHost)).toBe(false);
  });

  it('may still answer, directly', () => {
    expect(
      evaluatePermission(
        'peer_reply',
        { text: 'hi' },
        'default',
        {},
        context(workspace, anotherHost),
      ),
    ).toBe('auto');
    expect(isToolAvailableInPeerTurn('peer_reply', anotherHost)).toBe(true);
  });
});

describe('a peer on the same host', () => {
  it('reads inside the workspace like the operator would', () => {
    const read = { filePath: join(workspace, 'README.md') };
    expect(evaluatePermission('Read', read, 'default', {}, context(workspace, sameHost))).toBe(
      'auto',
    );
    expect(isToolAvailableInPeerTurn('Read', sameHost)).toBe(true);
  });

  it('never reads outside the workspace, even under bypassPermissions or an allow rule', () => {
    const read = { filePath: join(home, '.aws', 'credentials') };
    expect(
      evaluatePermission(
        'Read',
        read,
        'bypassPermissions',
        { allow: ['Read'] },
        context(workspace, sameHost),
      ),
    ).toBe('deny');
    expect(
      evaluatePermission(
        'Read',
        { filePath: '../.aws/credentials' },
        'default',
        {},
        context(workspace, sameHost),
      ),
    ).toBe('deny');
  });

  it('never reads a secret, even when the workspace contains it', () => {
    // The operator started the session in their home directory: ~/.aws is inside the workspace.
    expect(
      evaluatePermission(
        'Read',
        { filePath: join(home, '.aws', 'credentials') },
        'default',
        {},
        context(home, sameHost),
      ),
    ).toBe('deny');
    expect(
      evaluatePermission(
        'Read',
        { filePath: '.env.local' },
        'default',
        {},
        context(workspace, sameHost),
      ),
    ).toBe('deny');
    expect(
      evaluatePermission(
        'Grep',
        { pattern: 'TOKEN', glob: '.env*' },
        'default',
        {},
        context(workspace, sameHost),
      ),
    ).toBe('deny');
  });

  it('does not follow a link out of the workspace', () => {
    symlinkSync(join(home, '.aws'), join(workspace, 'cloud'));
    expect(
      evaluatePermission(
        'Read',
        { filePath: 'cloud/credentials' },
        'default',
        {},
        context(workspace, sameHost),
      ),
    ).toBe('deny');
  });

  it('may not use a read that reaches past the workspace', () => {
    expect(
      evaluatePermission(
        'WebFetch',
        { url: 'https://example.com' },
        'default',
        {},
        context(workspace, sameHost),
      ),
    ).toBe('deny');
    expect(isToolAvailableInPeerTurn('WebFetch', sameHost)).toBe(false);
  });

  it('may not write or execute unless the operator enabled it', () => {
    const write = { filePath: join(workspace, 'x.txt'), content: 'x' };
    expect(
      evaluatePermission('Write', write, 'bypassPermissions', {}, context(workspace, sameHost)),
    ).toBe('deny');
    expect(
      evaluatePermission(
        'Bash',
        { command: 'ls' },
        'acceptEdits',
        {},
        context(workspace, sameHost),
      ),
    ).toBe('deny');
    expect(isToolAvailableInPeerTurn('Write', sameHost)).toBe(false);
  });

  it('asks about every write or execution once the operator enabled them', () => {
    const enabled = { ...sameHost, allowChanges: true };
    const write = { filePath: join(workspace, 'x.txt'), content: 'x' };
    expect(
      evaluatePermission(
        'Write',
        write,
        'bypassPermissions',
        { allow: ['Write'] },
        context(workspace, enabled),
      ),
    ).toBe('approve');
    expect(
      evaluatePermission('Bash', { command: 'ls' }, 'default', {}, context(workspace, enabled)),
    ).toBe('approve');
    expect(isToolAvailableInPeerTurn('Write', enabled)).toBe(true);
  });

  it('asks before a reply that follows a tool use, in every mode', () => {
    const used = { ...sameHost, toolUsed: true };
    expect(
      evaluatePermission('peer_reply', { text: 'hi' }, 'default', {}, context(workspace, sameHost)),
    ).toBe('auto');
    expect(
      evaluatePermission(
        'peer_reply',
        { text: 'hi' },
        'bypassPermissions',
        { allow: ['peer_reply'] },
        context(workspace, used),
      ),
    ).toBe('approve');
  });

  it('a deny rule still refuses the reply', () => {
    expect(
      evaluatePermission(
        'peer_reply',
        { text: 'hi' },
        'default',
        { deny: ['peer_reply'] },
        context(workspace, sameHost),
      ),
    ).toBe('deny');
  });
});

describe('an operator turn', () => {
  it('is decided exactly as before', () => {
    const read = { filePath: join(home, '.aws', 'credentials') };
    expect(evaluatePermission('Read', read, 'bypassPermissions', {}, context(workspace))).toBe(
      'auto',
    );
    expect(
      evaluatePermission(
        'Write',
        { filePath: join(workspace, 'x') },
        'default',
        {},
        context(workspace),
      ),
    ).toBe('approve');
  });

  it('has no peer to reply to', () => {
    expect(
      evaluatePermission('peer_reply', { text: 'hi' }, 'bypassPermissions', {}, context(workspace)),
    ).toBe('deny');
  });
});

describe('secret paths', () => {
  it.each([
    ['~/.ssh/id_ed25519'],
    ['/h/.aws/config'],
    ['.env'],
    ['app/.env.production'],
    ['/h/.config/gh/hosts.yml'],
    ['/h/.robota/mcp-credentials/x.json'],
    ['/h/.netrc'],
    ['deploy/key.pem'],
  ])('%s is a secret', (path) => {
    expect(isSecretPath(path, '/h')).toBe(true);
  });

  it.each([['src/index.ts'], ['/h/project/README.md'], ['docs/environment.md']])(
    '%s is not',
    (path) => {
      expect(isSecretPath(path, '/h')).toBe(false);
    },
  );
});
