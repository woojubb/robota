/**
 * #3282 §4a: the Settings screen's rule Remove button rewrites the same settings document
 * `/permissions` reads the rule from — `removePermissionRule` is the one function both paths call.
 */
import { describe, expect, it } from 'vitest';

import {
  createSettingsPermissionRulesAdapter,
  removePermissionRule,
} from '../permission-rule-layers.js';

import type { ISettingsDocumentStore } from '../settings-store-types.js';
import type { TSettingsData } from '../settings-io.js';

function createStore(
  scope: ISettingsDocumentStore['scope'],
  initial: TSettingsData,
): ISettingsDocumentStore & { written: TSettingsData[] } {
  let data = initial;
  const written: TSettingsData[] = [];
  return {
    kind: scope === 'user' ? 'host' : 'project',
    scope,
    displayName: `${scope}-settings.json`,
    source: { kind: 'host', scope: 'user' } as unknown as ISettingsDocumentStore['source'],
    read: () => data,
    write: (next) => {
      data = next;
      written.push(next);
    },
    written,
  };
}

describe('removePermissionRule (#3282 §4a)', () => {
  it('removes the pattern from the matching scope and leaves the rest of the document untouched', () => {
    const userStore = createStore('user', {
      language: 'en',
      permissions: { allow: ['Bash(git status:*)', 'Bash(git push:*)'], deny: ['Bash(rm -rf *)'] },
    });
    const removed = removePermissionRule([userStore], {
      scope: 'user',
      kind: 'allow',
      pattern: 'Bash(git push:*)',
    });
    expect(removed).toBe(true);
    expect(userStore.read()).toEqual({
      language: 'en',
      permissions: { allow: ['Bash(git status:*)'], deny: ['Bash(rm -rf *)'] },
    });
  });

  it('writes nothing and returns false when no store matches the scope', () => {
    const projectStore = createStore('project', { permissions: { allow: ['Bash(ls:*)'] } });
    const removed = removePermissionRule([projectStore], {
      scope: 'user',
      kind: 'allow',
      pattern: 'Bash(ls:*)',
    });
    expect(removed).toBe(false);
    expect(projectStore.written).toEqual([]);
  });

  it('writes nothing and returns false when the pattern is not actually present', () => {
    const userStore = createStore('user', { permissions: { allow: ['Bash(git status:*)'] } });
    const removed = removePermissionRule([userStore], {
      scope: 'user',
      kind: 'allow',
      pattern: 'Bash(git push:*)',
    });
    expect(removed).toBe(false);
    expect(userStore.written).toEqual([]);
  });

  it('writes nothing and returns false when the document has no permissions object at all', () => {
    const userStore = createStore('user', { language: 'en' });
    const removed = removePermissionRule([userStore], {
      scope: 'user',
      kind: 'deny',
      pattern: 'Bash(rm -rf *)',
    });
    expect(removed).toBe(false);
    expect(userStore.written).toEqual([]);
  });

  it('createSettingsPermissionRulesAdapter exposes removeRule only when stores are supplied', () => {
    const withoutStores = createSettingsPermissionRulesAdapter([]);
    expect(withoutStores.removeRule).toBeUndefined();

    const userStore = createStore('user', { permissions: { deny: ['Bash(rm -rf *)'] } });
    const withStores = createSettingsPermissionRulesAdapter([], [userStore]);
    expect(withStores.removeRule?.({ scope: 'user', kind: 'deny', pattern: 'Bash(rm -rf *)' })).toBe(
      true,
    );
    expect(userStore.read()).toEqual({ permissions: { deny: [] } });
  });
});
