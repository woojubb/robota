/**
 * When this device's own relay cannot listen, the error names the setting that the cause asks the
 * user to change: a taken port is not fixed by changing the host, nor a foreign host by the port.
 */
import { createSocket, type Socket } from 'node:dgram';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createInMemoryItemNetwork } from '@robota-sdk/agent-transport-webrtc';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFileCredentialStore } from '../../credentials/file-credential-store.js';
import { createDeviceIdentityService } from '../device-identity-service.js';
import { openDeviceMesh } from '../device-mesh.js';
import { parseMeshInternetSettings } from '../mesh-internet-settings.js';
import { scriptedOperator } from './fake-secret-terminal.js';

import type { ICredentialStore } from '@robota-sdk/agent-core';

let home: string;
let root: string;
let store: ICredentialStore;
const holders: Socket[] = [];

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'robota-mesh-relay-bind-'));
  root = join(home, '.robota');
  store = createFileCredentialStore(join(root, 'credentials'), { withinRoot: root });
  const service = createDeviceIdentityService({
    directory: join(root, 'devices'),
    withinRoot: root,
    store,
    openTerminal: () => scriptedOperator().session,
    defaultDeviceName: () => 'laptop',
  });
  expect((await service.init({})).ok).toBe(true);
});

afterEach(() => {
  for (const holder of holders.splice(0)) holder.close();
  rmSync(home, { recursive: true, force: true });
});

function openWithRelay(relay: Record<string, unknown>): Promise<unknown> {
  return openDeviceMesh({
    root,
    store,
    lan: { host: '127.0.0.1', mdns: false },
    internet: {
      settings: parseMeshInternetSettings({ relay: { serve: true, ...relay } }),
      stores: [createInMemoryItemNetwork().store()],
    },
  });
}

describe("this device's relay cannot listen", () => {
  it('on a taken port: says to choose another port', async () => {
    const holder = createSocket('udp4');
    holders.push(holder);
    await new Promise<void>((resolve) => holder.bind(0, '127.0.0.1', resolve));
    const opened = openWithRelay({ host: '127.0.0.1', port: holder.address().port });
    await expect(opened).rejects.toThrow(/the port is taken.*Choose another `[^`]*relay\.port`/);
  });

  it('on a host that is not this machine: says to change the host, not the port', async () => {
    const opened = openWithRelay({ host: '192.0.2.1', port: 3478 });
    await expect(opened).rejects.toThrow(/not an address of this machine.*`[^`]*relay\.host`/);
    await expect(opened).rejects.not.toThrow(/Choose another/);
  });
});
