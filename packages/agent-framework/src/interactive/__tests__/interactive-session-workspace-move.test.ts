import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import '../../tools/tool-permission-profiles.js';
import { createRestrictedWorkspaceProjectAccess } from '../../workspace-trust/index.js';
import {
  buildWorkspaceMoveNotice,
  prepareWorkspaceMove,
} from '../interactive-session-workspace-move.js';

import type { IPrepareWorkspaceMoveInput } from '../interactive-session-workspace-move.js';

/** Issue #3081 — what the session decides before a `/cd`. */
let root: string;
let from: string;
let to: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'robota-cd-')));
  from = join(root, 'a');
  to = join(root, 'b');
  mkdirSync(from);
  mkdirSync(to);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function input(overrides: Partial<IPrepareWorkspaceMoveInput> = {}): IPrepareWorkspaceMoveInput {
  return {
    requestedPath: '../b',
    workspace: { cwd: from, projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', from) },
    executing: false,
    liveBackgroundTasks: 0,
    permissionMode: 'default',
    rules: { allow: [], deny: [], ask: [] },
    source: {
      getHistory: () => [],
      getSystemMessage: () => 'SYSTEM PROMPT',
      getToolSchemas: () => [],
      getFullHistory: () => [],
    },
    sessionName: 'work',
    homeDirectory: root,
    ...overrides,
  };
}

describe('prepareWorkspaceMove', () => {
  it('resolves the target against the current directory and copies the conversation there', () => {
    const request = prepareWorkspaceMove(input());
    expect(request.fromCwd).toBe(from);
    expect(request.targetCwd).toBe(to);
    expect(request.record.cwd).toBe(to);
    expect(request.record.systemPrompt).toBe('SYSTEM PROMPT');
    expect(request.record.name).toBe('work');
  });

  it('expands ~ against the home directory', () => {
    expect(prepareWorkspaceMove(input({ requestedPath: '~/b' })).targetCwd).toBe(to);
  });

  it('keeps a restricted session restricted', () => {
    expect(prepareWorkspaceMove(input()).restricted).toBe(true);
  });

  it.each([
    [{ executing: true }, /current turn/],
    [{ liveBackgroundTasks: 2 }, /background task/],
    [{ requestedPath: '../missing' }, /No such directory/],
    [{ requestedPath: '.' }, /Already in/],
    [{ requestedPath: '  ' }, /Usage/],
  ])('refuses %o', (overrides, message) => {
    expect(() => prepareWorkspaceMove(input(overrides))).toThrow(message);
  });

  it('refuses a target a Cd deny rule names', () => {
    expect(() =>
      prepareWorkspaceMove(input({ rules: { allow: [], deny: [`Cd(${to}/**)`], ask: [] } })),
    ).toThrow(/denied by a permission rule/);
  });
});

describe('buildWorkspaceMoveNotice', () => {
  it('names both directories and carries the new instructions', () => {
    const notice = buildWorkspaceMoveNotice({
      fromCwd: '/w/a',
      toCwd: '/w/b',
      restricted: false,
      instructions: [{ filePath: 'AGENTS.md', content: 'Use pnpm.\n' }],
    });
    expect(notice).toContain('from /w/a to /w/b');
    expect(notice).toContain('## AGENTS.md\nUse pnpm.');
  });

  it('says a restricted target loaded nothing', () => {
    const notice = buildWorkspaceMoveNotice({
      fromCwd: '/w/a',
      toCwd: '/w/b',
      restricted: true,
      instructions: [],
    });
    expect(notice).toContain('not trusted');
  });
});
