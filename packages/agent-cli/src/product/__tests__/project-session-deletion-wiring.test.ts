/**
 * What the product hands the project session store for a delete: the checkpoints facet of the same
 * grant as the records, and a subagent-log remover bound to the root this run's workers write under.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { createCliRuntimeContext } from '../runtime-context.js';

import type { IProjectSessionStoreOptions } from '@robota-sdk/agent-framework/node';
import type { ITrustedWorkspaceProjectAccess } from '@robota-sdk/agent-framework';

const framework = vi.hoisted(() => ({
  facets: [] as Array<{ authority: unknown; namespace: string }>,
  stores: [] as IProjectSessionStoreOptions[],
  removals: [] as Array<[string, string]>,
}));

vi.mock('@robota-sdk/agent-framework', async (original) => ({
  ...(await original<typeof import('@robota-sdk/agent-framework')>()),
  getWorkspaceProjectStateStorage: (authority: unknown, namespace: string) => {
    const facet = { authority, namespace };
    framework.facets.push(facet);
    return facet;
  },
}));
vi.mock('@robota-sdk/agent-framework/node', async (original) => ({
  ...(await original<typeof import('@robota-sdk/agent-framework/node')>()),
  createProjectSessionStore: (
    _sessions: unknown,
    _logs: unknown,
    options: IProjectSessionStoreOptions,
  ) => {
    framework.stores.push(options);
    return {};
  },
  removeSubagentLogs: (root: string, id: string) => {
    framework.removals.push([root, id]);
    return 'removed';
  },
}));
vi.mock('../process-presence.js', async (original) => ({
  ...(await original<typeof import('../process-presence.js')>()),
  enterProductStores: () => undefined,
}));
vi.mock('../session-sealing.js', async (original) => ({
  ...(await original<typeof import('../session-sealing.js')>()),
  resolveProductSessionSealing: () => 'plain',
}));

const { createProductProjectSessionStore } = await import('../session-stores.js');

const homes: string[] = [];
afterEach(() => {
  framework.facets.length = 0;
  framework.stores.length = 0;
  framework.removals.length = 0;
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function runtimes() {
  const home = mkdtempSync(join(tmpdir(), 'project-session-deletion-wiring-'));
  homes.push(home);
  const plain = createTestProductRuntime('test-product', { HOME: home });
  return {
    plain,
    secure: createCliRuntimeContext(plain.config, plain.environment, undefined, 'secure'),
  };
}

const authority = Symbol('grant') as unknown as ITrustedWorkspaceProjectAccess['authority'];

describe('the project session store the product builds', () => {
  it('deletes with the checkpoints facet of the same grant and no log sinks of its own', () => {
    createProductProjectSessionStore(authority, runtimes().plain);

    const deletion = framework.stores[0]?.deletion;
    expect(deletion?.checkpoints).toEqual({ authority, namespace: 'checkpoints' });
    expect(framework.facets.map((facet) => facet.namespace).sort()).toEqual([
      'checkpoints',
      'session-logs',
      'sessions',
    ]);
    expect(framework.facets.every((facet) => facet.authority === authority)).toBe(true);
    expect(deletion?.logSinks).toBeUndefined();
  });

  it('removes subagent logs under the plain log root, or its secure-v1 root in secure mode', () => {
    const { plain, secure } = runtimes();
    createProductProjectSessionStore(authority, plain);
    createProductProjectSessionStore(authority, secure);

    framework.stores[0]?.deletion?.removeSubagentLogs?.('session-a');
    framework.stores[1]?.deletion?.removeSubagentLogs?.('session-b');
    expect(framework.removals).toEqual([
      [plain.config.storage.logRoot, 'session-a'],
      [join(plain.config.storage.logRoot, 'secure-v1'), 'session-b'],
    ]);
    expect(secure.layout.subagentLogsRoot).toBe(join(plain.config.storage.logRoot, 'secure-v1'));
  });
});
