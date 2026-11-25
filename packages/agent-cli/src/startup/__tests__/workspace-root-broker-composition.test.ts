import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  prepareRestrictedRoot,
  requestWorkspaceRootBroker,
  workspaceRootBrokerEndpoint,
} from '@robota-sdk/agent-local-host';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { startTestBroker } from '../../__tests__/helpers/test-workspace-root-broker.js';
import {
  createBrokeredWorkspaceTrust,
  staleBrokerMessage,
} from '../workspace-root-broker-composition.js';
import { runWorkspaceTrustCommand } from '../workspace-trust-command.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe.skipIf(process.platform === 'win32')(
  'the CLI runs its own binary as the workspace-root broker',
  () => {
    it('starts the broker for a fresh non-Git Restricted desktop choice', async () => {
      const parent = mkdtempSync(join(tmpdir(), 'brokered-restricted-'));
      const home = join(parent, 'home');
      const root = join(parent, 'plain');
      mkdirSync(home);
      mkdirSync(root);
      const runtime = createTestProductRuntime('test-product', { HOME: home });
      const endpoint = workspaceRootBrokerEndpoint(runtime.layout.userRoot);
      const output: string[] = [];
      const write = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
        output.push(String(chunk));
        return true;
      }) as never);
      try {
        expect(await runWorkspaceTrustCommand(['status', '--json'], root, runtime)).toBe(0);
        expect(JSON.parse(output.join(''))).toMatchObject({
          state: 'identity-unavailable',
          workspace: root,
        });
        expect(await prepareRestrictedRoot(runtime.layout.userRoot, root)).toMatch(
          /^[0-9a-f]{8}-/u,
        );
      } finally {
        write.mockRestore();
        try {
          const ready = await requestWorkspaceRootBroker(endpoint, { op: 'ping' });
          if (ready.status === 'ready' && ready.pid !== process.pid) process.kill(ready.pid);
        } catch {
          /* The broker may already have exited. */
        }
        rmSync(dirname(endpoint), { recursive: true, force: true });
        rmSync(parent, { recursive: true, force: true });
      }
    }, 30_000);

    it('refuses a desktop-approved candidate answered with --yes and leaves the root untrusted', async () => {
      const parent = mkdtempSync(join(tmpdir(), 'brokered-cli-trust-'));
      const home = join(parent, 'home');
      const root = join(parent, 'root');
      mkdirSync(home);
      mkdirSync(root);
      execFileSync('git', ['init', '--quiet', root]);
      const runtime = createTestProductRuntime('test-product', { HOME: home });
      const endpoint = workspaceRootBrokerEndpoint(runtime.layout.userRoot);
      mkdirSync(dirname(endpoint), { recursive: true, mode: 0o700 });
      const broker = await startTestBroker(
        endpoint,
        dirname(endpoint),
        runtime.layout.userPaths.workspaceTrust,
      );
      const service = await createBrokeredWorkspaceTrust(runtime);
      cleanups.push(async () => {
        service.close();
        await broker.close();
        rmSync(dirname(endpoint), { recursive: true, force: true });
        rmSync(parent, { recursive: true, force: true });
      });

      expect(await service.inspect(root)).toMatchObject({
        status: 'restricted',
        trustState: 'untrusted',
      });
      const candidate = await service.prepare(root);
      expect(
        await runWorkspaceTrustCommand(
          ['--yes', '--desktop-approved-candidate', candidate],
          root,
          runtime,
        ),
      ).toBe(1);
      expect(await service.inspect(root)).toMatchObject({
        status: 'restricted',
        trustState: 'untrusted',
      });
    }, 40_000);
  },
);

describe('the restart advice for a broker an older CLI started', () => {
  it('names the CLI, the operation and the process to end', () => {
    expect(staleBrokerMessage('remove directories')).toMatch(
      /^The running workspace-root broker is older than this CLI and cannot remove directories\. Restart the workspace-root broker: end its process \(started with --internal-root-broker\)/u,
    );
    expect(staleBrokerMessage('append without creating')).toMatch(
      /cannot append without creating\. Restart the workspace-root broker/u,
    );
  });
});
