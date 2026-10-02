import { Sandbox } from 'e2b/dist/index.mjs';
import type { SandboxInfo } from 'e2b/dist/index.mjs';
import { afterEach, expect, it, vi } from 'vitest';
import { createE2BOrganizationInventory } from '../e2b-organization-inventory.js';

afterEach(() => vi.restoreAllMocks());

const info = (resource: string, overrides: Record<string, string> = {}): SandboxInfo => ({
  sandboxId: resource, metadata: { organizationControlPlane: 'owner-control', organizationGrant: resource,
    tenant: 'company', task: 'task', rootTask: 'root', actor: resource, runtime: resource, epoch: '1', ...overrides },
} as unknown as SandboxInfo);

it('enumerates every provider page including paused resources and rechecks ownership before termination', async () => {
  const pages = [[info('child-1')], [info('child-2')]];
  let index = 0;
  const list = vi.spyOn(Sandbox, 'list').mockReturnValue({ get hasNext() { return index < pages.length; },
    nextItems: async () => pages[index++]!,
  } as unknown as ReturnType<typeof Sandbox.list>);
  const get = vi.spyOn(Sandbox, 'getInfo').mockResolvedValue(info('child-2'));
  const kill = vi.spyOn(Sandbox, 'kill').mockResolvedValue(true);
  const inventory = createE2BOrganizationInventory({ apiKey: 'owner-only-key', tenant: 'company', controlPlane: 'owner-control' });
  const records = await inventory.list(AbortSignal.timeout(1000));
  expect(records.map((entry) => entry.resource)).toEqual(['child-1', 'child-2']);
  expect(list.mock.calls[0]![0]!.query!.state).toEqual(['running', 'paused']);
  await inventory.terminate(records[1]!, AbortSignal.timeout(1000));
  expect(get.mock.calls[0]![0]).toBe('child-2');
  expect(kill.mock.calls[0]![0]).toBe('child-2');
  expect(kill.mock.calls[0]![1]).not.toHaveProperty('signal');
});

it('refuses incomplete or changed ownership without deleting another owner resource', async () => {
  let pending = true;
  vi.spyOn(Sandbox, 'list').mockReturnValue({ get hasNext() { return pending; }, nextItems: async () => { pending = false; return [info('child')]; } } as unknown as ReturnType<typeof Sandbox.list>);
  const inventory = createE2BOrganizationInventory({ apiKey: 'owner-only-key', tenant: 'company', controlPlane: 'owner-control' });
  const records = await inventory.list(AbortSignal.timeout(1000));
  vi.spyOn(Sandbox, 'getInfo').mockResolvedValue(info('child', { organizationControlPlane: 'another-owner' }));
  const kill = vi.spyOn(Sandbox, 'kill').mockResolvedValue(true);
  await expect(inventory.terminate(records[0]!, AbortSignal.timeout(1000))).rejects.toThrow(/ownership/u);
  expect(kill).not.toHaveBeenCalled();
});
