/**
 * Opening the mesh endpoint with the local network on starts a listening socket before the node
 * exists; if the node cannot be made, that socket must not outlive the failed open.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createInMemoryMeshRelayHub } from '@robota-sdk/agent-transport-webrtc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFileCredentialStore } from '../../credentials/file-credential-store.js';
import { createFileMeshAddressCache } from '../address-cache.js';
import { createDeviceIdentityService } from '../device-identity-service.js';
import { openDeviceMesh } from '../device-mesh.js';
import { scriptedOperator } from './fake-secret-terminal.js';

vi.mock('@robota-sdk/agent-transport-webrtc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-transport-webrtc')>();
  return {
    ...actual,
    DeviceMeshNode: class {
      public constructor() {
        throw new Error('node could not be made');
      }
    },
  };
});

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'robota-mesh-open-failure-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function bindable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

describe('a failed open of the mesh endpoint', () => {
  it('closes the local-network endpoint it had started', async () => {
    const root = join(home, '.robota');
    const directory = join(root, 'devices');
    const store = createFileCredentialStore(join(root, 'credentials'), { withinRoot: root });
    const service = createDeviceIdentityService({
      directory,
      withinRoot: root,
      store,
      openTerminal: () => scriptedOperator().session,
      defaultDeviceName: () => 'laptop',
    });
    expect((await service.init({})).ok).toBe(true);

    await expect(
      openDeviceMesh({
        root,
        store,
        relay: createInMemoryMeshRelayHub().connect(),
        lan: { host: '127.0.0.1', mdns: false },
      }),
    ).rejects.toThrow(/could not be made/);

    const port = createFileMeshAddressCache(directory).lastListenPort();
    expect(port).toBeDefined();
    await expect.poll(() => bindable(port!)).toBe(true);
  });
});
