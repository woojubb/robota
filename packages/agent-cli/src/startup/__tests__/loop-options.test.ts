import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { WorkspaceTrustService } from '@robota-sdk/agent-framework';
import { createLoopDefaultPromptResolver, DEFAULT_LOOP_MAINTENANCE_PROMPT } from '../loop-options.js';

import type { IWorkspaceIdentity, IWorkspaceTrustStoreSnapshot } from '@robota-sdk/agent-framework';

const roots: string[] = [];
function root(): string {
  const path = realpathSync(mkdtempSync(join(tmpdir(), 'robota-loop-prompt-')));
  roots.push(path);
  return path;
}
async function trustedAccess(path: string) {
  const identity: IWorkspaceIdentity = {
    repositoryKey: `fixture:${path}`, displayPath: path, worktreeRoot: path,
  };
  const snapshot: IWorkspaceTrustStoreSnapshot = { state: 'trusted', generation: 1 };
  return new WorkspaceTrustService({
    identityResolver: { resolve: () => identity },
    store: {
      inspect: async () => snapshot,
      grant: async () => snapshot,
      revoke: async () => ({ ...snapshot, state: 'revoked' as const }),
    },
  }).inspect(path);
}
afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('live default loop prompt', () => {
  it('prefers the trusted project file, re-reads edits, then falls back to user and built-in', async () => {
    const project = root();
    const userHome = root();
    mkdirSync(join(project, '.robota'));
    mkdirSync(join(userHome, '.robota'));
    const projectFile = join(project, '.robota', 'loop.md');
    const userFile = join(userHome, '.robota', 'loop.md');
    writeFileSync(userFile, 'user prompt');
    writeFileSync(projectFile, 'project first');
    const resolve = createLoopDefaultPromptResolver({
      projectAccess: await trustedAccess(project), userHome,
    });
    expect(resolve()).toBe('project first');
    writeFileSync(projectFile, 'project second');
    expect(resolve()).toBe('project second');
    rmSync(projectFile);
    expect(resolve()).toBe('user prompt');
    rmSync(userFile);
    expect(resolve()).toBe(DEFAULT_LOOP_MAINTENANCE_PROMPT);
  });

  it('rejects oversized and symlinked prompt files instead of silently falling back', async () => {
    const project = root();
    const userHome = root();
    mkdirSync(join(project, '.robota'));
    mkdirSync(join(userHome, '.robota'));
    const projectFile = join(project, '.robota', 'loop.md');
    writeFileSync(projectFile, 'x'.repeat(4_097));
    const resolve = createLoopDefaultPromptResolver({
      projectAccess: await trustedAccess(project), userHome,
    });
    expect(resolve).toThrow(/limit|4096/i);
    rmSync(projectFile);
    symlinkSync(join(userHome, '.robota'), projectFile);
    expect(resolve).toThrow(/unsafe|symlink|authority/i);
  });
});
