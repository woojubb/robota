import { describe, expect, it } from 'vitest';
import { isProtectedPath } from '../permission-safeguards.js';

describe('configured state path protection', () => {
  const context = {
    cwd: '/work/project',
    pathProtection: {
      protectedDirectoryNames: ['.product-a'],
      protectedPaths: ['/home/user/product-a'],
      writableWorktreeContainers: ['.product-a/worktrees'],
    },
  };

  it('protects selected project and absolute user state', () => {
    expect(isProtectedPath('.product-a/settings.json', context)).toBe(true);
    expect(isProtectedPath('/home/user/product-a/keys.json', context)).toBe(true);
    expect(isProtectedPath('../../home/user/product-a/keys.json', { ...context, cwd: '/work' })).toBe(true);
    expect(isProtectedPath('/home/user/product-ab/file', context)).toBe(false);
  });

  it('allows ordinary worktree files while protecting nested configuration and traversal', () => {
    expect(isProtectedPath('.product-a/worktrees/one/src/app.ts', context)).toBe(false);
    expect(isProtectedPath('.product-a/worktrees/one/.product-a/settings.json', context)).toBe(true);
    expect(isProtectedPath('.product-a/worktrees/../settings.json', context)).toBe(true);
    expect(isProtectedPath('.product-a/worktrees/one/.git/config', context)).toBe(true);
    expect(isProtectedPath('.product-a/worktrees', context)).toBe(true);
  });

  it('does not retain a different instance policy or weaken built-in protection', () => {
    expect(isProtectedPath('.product-b/settings.json', context)).toBe(false);
    expect(isProtectedPath('.product-b/settings.json', {
      pathProtection: { ...context.pathProtection, protectedDirectoryNames: ['.product-b'] },
    })).toBe(true);
    expect(isProtectedPath('.product-b/settings.json', context)).toBe(false);
    expect(isProtectedPath('.git/config', context)).toBe(true);
    expect(isProtectedPath('.zshrc', context)).toBe(true);
  });
});
