import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { userLocalStorageRoot, userPaths } from '../user-paths.js';

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
    });
    expect(second.sessions).toBe(join('/second-home', '.test-product', 'sessions'));
    expect(userLocalStorageRoot(createTestProductRuntime('test-product', { HOME: '/first-home' }))).toBe(join('/first-home', '.test-product'));
  });
});
