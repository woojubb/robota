import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { userLocalStorageRoot, userPaths } from '../user-paths.js';

import type { ICliRuntimeContext } from '../runtime-context.js';

/** A runtime whose layout holds only the user root, spelled as a configuration file may spell it. */
function runtimeWithUserRoot(userRoot: string): ICliRuntimeContext {
  return { layout: { userRoot } } as unknown as ICliRuntimeContext;
}

describe('test-product Agent user paths', () => {
  it('keeps every user-owned runtime path under the selected home', () => {
    const first = userPaths(createTestProductRuntime('test-product', { HOME: '/first-home' }));
    const second = userPaths(createTestProductRuntime('test-product', { HOME: '/second-home' }));

    expect(first).toEqual({
      settings: join('/first-home', '.test-product', 'settings.json'),
      sessions: join('/first-home', '.test-product', 'sessions'),
      onboarded: join('/first-home', '.test-product', 'onboarded'),
      history: join('/first-home', '.test-product', 'history.jsonl'),
      workspaceTrust: join('/first-home', '.test-product', 'workspace-trust.json'),
      orgPolicy: join('/first-home', '.test-product', 'org-policy.json'),
      mcpApprovals: join('/first-home', '.test-product', 'mcp-approvals.json'),
      secure: join('/first-home', '.test-product', 'secure'),
      keyring: join('/first-home', '.test-product', 'secure', 'keyring.json'),
      spill: join('/first-home', '.test-product', 'spill'),
      editor: join('/first-home', '.test-product', 'editor'),
      ephemeralCheckpoints: join('/first-home', '.test-product', 'ephemeral-checkpoints'),
      presence: join('/first-home', '.test-product', 'presence'),
    });
    expect(second.sessions).toBe(join('/second-home', '.test-product', 'sessions'));
    expect(
      userLocalStorageRoot(createTestProductRuntime('test-product', { HOME: '/first-home' })),
    ).toBe(join('/first-home', '.test-product'));
  });

  // The framework takes only a root it can place without the process directory, so the Node root
  // resolves it first: a spelling that is absolute only to this platform's own `path` (a Windows
  // `\state`, which takes its drive from the process) arrives complete.
  it('resolves the user-local storage root against the platform before the framework sees it', () => {
    expect(userLocalStorageRoot(runtimeWithUserRoot('state'))).toBe(resolve('state'));
    expect(userLocalStorageRoot(runtimeWithUserRoot(`${join('/home/me', '.state')}/`))).toBe(
      join('/home/me', '.state'),
    );
  });

  it.runIf(process.platform === 'win32')('completes a rooted Windows root with its drive', () => {
    expect(userLocalStorageRoot(runtimeWithUserRoot('\\state'))).toBe(resolve('\\state'));
    expect(userLocalStorageRoot(runtimeWithUserRoot('\\state'))).toMatch(/^[A-Za-z]:\\state$/);
  });
});
