import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createTestRuntimeContext } from '../../devices/__tests__/runtime-context-fixture.js';
import { ensureRendezvousDirectory, resolveRendezvousDirectory } from '../local-peer-rendezvous.js';

const made: string[] = [];
function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-rendezvous-'));
  made.push(root);
  return root;
}
afterEach(() => {
  while (made.length > 0) rmSync(made.pop()!, { recursive: true, force: true });
});

describe('configured peer rendezvous location', () => {
  it('uses the configured runtime root and neutral daemon namespace', () => {
    const root = scratch();
    const runtime = createTestRuntimeContext(root);
    const expected = join(root, 'run', 'test-agent', 'peers');
    expect(resolveRendezvousDirectory(runtime)).toBe(expected);
    expect(ensureRendezvousDirectory(runtime).admitted).toBe(true);
    expect(statSync(expected).mode & 0o777).toBe(0o700);
  });

  it('uses the configured user root when the captured runtime directory is absent', () => {
    const root = scratch();
    const runtime = createTestRuntimeContext(root);
    const withoutRuntime = { ...runtime, environment: {} };
    expect(resolveRendezvousDirectory(withoutRuntime)).toBe(join(root, 'peers'));
    expect(ensureRendezvousDirectory(withoutRuntime).admitted).toBe(true);
  });
});
