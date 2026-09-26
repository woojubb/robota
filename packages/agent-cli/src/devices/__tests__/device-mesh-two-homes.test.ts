/**
 * End to end, CLI side: two devices, each with its own `HOME` (its own `~/.robota/devices` and its
 * own credential store), connect through a relay over WebRTC, admit each other with the device
 * handshake, and deliver a message. The identity each endpoint uses is only what `/devices` left
 * under its `HOME`.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  certifyDevice,
  generateDeviceKeyAgreementKeyPair,
  generateDeviceSignKeyPair,
  issueDeviceRevocationList,
  issueDeviceRoster,
} from '@robota-sdk/agent-remote-pairing';
import { createInMemoryMeshRelayHub } from '@robota-sdk/agent-transport-webrtc';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFileCredentialStore } from '../../credentials/file-credential-store.js';
import { createDeviceIdentityService } from '../device-identity-service.js';
import { reissueDueLists } from '../device-list-reissue.js';
import { openDeviceMesh, saveAdoptedLists, type IDeviceMeshEndpoint } from '../device-mesh.js';
import { DEVICE_KA_KEY, DEVICE_SIGN_KEY, loadSigningKey, storeKeyPair } from '../identity-keys.js';
import {
  readIdentityState,
  writeIdentityState,
  type IDeviceIdentityState,
} from '../identity-state.js';
import { scriptedOperator } from './fake-secret-terminal.js';

import type { ICredentialStore } from '@robota-sdk/agent-core';

const HOUR = 60 * 60 * 1000;

interface IHome {
  readonly home: string;
  readonly root: string;
  readonly directory: string;
  readonly store: ICredentialStore;
}

function makeHome(label: string): IHome {
  const home = mkdtempSync(join(tmpdir(), `robota-mesh-${label}-`));
  const root = join(home, '.robota');
  return {
    home,
    root,
    directory: join(root, 'devices'),
    store: createFileCredentialStore(join(root, 'credentials'), { withinRoot: root }),
  };
}

function stateOf(home: IHome): IDeviceIdentityState {
  const state = readIdentityState(home.directory);
  if (state === undefined) throw new Error('no identity');
  return state;
}

let laptop: IHome;
let desktop: IHome;
let clock: number;
const open: IDeviceMeshEndpoint[] = [];

function service(home: IHome) {
  return createDeviceIdentityService({
    directory: home.directory,
    withinRoot: home.root,
    store: home.store,
    openTerminal: () => scriptedOperator().session,
    now: () => clock,
    defaultDeviceName: () => 'laptop',
  });
}

/**
 * The desktop enrols the way `/devices add|join` will: it generates its own keys, the laptop (the
 * signing-key holder) certifies them and issues a roster naming it, and the desktop keeps the result.
 */
async function enrolDesktop(): Promise<string> {
  const held = stateOf(laptop);
  const signingKey = await loadSigningKey(laptop.store, held.signingKeyCertificate);
  if (signingKey === undefined) throw new Error('no signing key');
  const [sign, ka] = await Promise.all([
    generateDeviceSignKeyPair(true),
    generateDeviceKeyAgreementKeyPair(true),
  ]);
  const certificate = await certifyDevice({
    signingKey,
    signPublicKey: sign.publicKey,
    kaPublicKey: ka.publicKey,
    kaEpoch: 0,
    name: 'desktop',
    capabilities: ['message', 'presence'],
    issuedAt: clock,
  });
  const roster = await issueDeviceRoster({
    signingKey,
    seq: held.roster.seq + 1,
    issuedAt: clock,
    devices: [...held.roster.devices, certificate],
  });
  writeIdentityState(laptop.directory, { ...held, roster }, laptop.root);
  await storeKeyPair(desktop.store, DEVICE_SIGN_KEY, sign);
  await storeKeyPair(desktop.store, DEVICE_KA_KEY, ka);
  writeIdentityState(
    desktop.directory,
    { ...held, roster, deviceCertificate: certificate, holdsSigningKey: false, marks: {} },
    desktop.root,
  );
  return certificate.deviceId;
}

beforeEach(async () => {
  clock = Date.now();
  laptop = makeHome('laptop');
  desktop = makeHome('desktop');
  expect((await service(laptop).init({})).ok).toBe(true);
});

afterEach(() => {
  for (const endpoint of open.splice(0)) endpoint.close();
  rmSync(laptop.home, { recursive: true, force: true });
  rmSync(desktop.home, { recursive: true, force: true });
});

async function endpoint(home: IHome, hub: ReturnType<typeof createInMemoryMeshRelayHub>) {
  const opened = await openDeviceMesh({
    root: home.root,
    store: home.store,
    relay: hub.connect(),
    now: () => clock,
    connectTimeoutMs: 10_000,
  });
  open.push(opened);
  return opened;
}

describe('device mesh between two HOMEs', () => {
  it('connects, admits each other by the device handshake, and delivers a message', async () => {
    const desktopId = await enrolDesktop();
    const laptopId = stateOf(laptop).deviceCertificate.deviceId;
    const hub = createInMemoryMeshRelayHub();
    const [atLaptop, atDesktop] = [
      (await endpoint(laptop, hub)).node,
      (await endpoint(desktop, hub)).node,
    ];

    const [toDesktop, toLaptop] = await Promise.all([
      atLaptop.connect(desktopId),
      atDesktop.connect(laptopId),
    ]);

    expect(toDesktop.admission.deviceId).toBe(desktopId);
    expect(toLaptop.admission.deviceId).toBe(laptopId);
    // Capabilities are the certificate's intersected with the local policy.
    expect([...toDesktop.admission.capabilities].sort()).toEqual(['message', 'presence']);
    const received = new Promise<string>((resolve) => toLaptop.onMessage(resolve));
    toDesktop.send('from the laptop');
    await expect(received).resolves.toBe('from the laptop');
  }, 40_000);

  it('lists reissued while running are put in force, handed over to the peer, and saved there', async () => {
    const desktopId = await enrolDesktop();
    const hub = createInMemoryMeshRelayHub();
    const laptopEndpoint = await endpoint(laptop, hub);
    const desktopEndpoint = await endpoint(desktop, hub);
    // Hours later the laptop, which holds the signing key, reissues its lists on disk.
    clock += 20 * HOUR;
    await expect(
      reissueDueLists({
        directory: laptop.directory,
        withinRoot: laptop.root,
        store: laptop.store,
        now: () => clock,
      }),
    ).resolves.toBe('reissued');
    const newer = stateOf(laptop);
    expect(stateOf(desktop).revocation.seq).toBeLessThan(newer.revocation.seq);
    await laptopEndpoint.refresh();

    await Promise.all([
      laptopEndpoint.node.connect(desktopId),
      desktopEndpoint.node.connect(newer.deviceCertificate.deviceId),
    ]);

    await expect.poll(() => stateOf(desktop).revocation.seq).toBe(newer.revocation.seq);
    expect(stateOf(desktop).roster.seq).toBe(newer.roster.seq);
  }, 40_000);

  it('after `/devices revoke`, the revoked device is refused', async () => {
    const desktopId = await enrolDesktop();
    const laptopId = stateOf(laptop).deviceCertificate.deviceId;
    expect((await service(laptop).revoke(desktopId.slice(0, 12))).ok).toBe(true);

    const hub = createInMemoryMeshRelayHub();
    const [atLaptop, atDesktop] = [
      (await endpoint(laptop, hub)).node,
      (await endpoint(desktop, hub)).node,
    ];

    await expect(atLaptop.connect(desktopId)).rejects.toThrow(/not a rostered, unrevoked/);
    await expect(atDesktop.connect(laptopId, 3_000)).rejects.toThrow();
    expect(atLaptop.link(desktopId)).toBeUndefined();
  }, 40_000);

  it('refuses to open without an identity, naming the command to run', async () => {
    const hub = createInMemoryMeshRelayHub();
    await expect(endpoint(desktop, hub)).rejects.toThrow(/\/devices init/);
  });
});

describe('saving lists a peer handed over', () => {
  async function laptopSigningKey() {
    const key = await loadSigningKey(laptop.store, stateOf(laptop).signingKeyCertificate);
    if (key === undefined) throw new Error('no signing key');
    return key;
  }

  it('ignores a list that is not newer', async () => {
    const before = stateOf(laptop);
    const older = await issueDeviceRevocationList({
      signingKey: await laptopSigningKey(),
      seq: before.revocation.seq - 1,
      issuedAt: clock,
      revokedDeviceIds: [],
    });
    await expect(
      saveAdoptedLists(laptop.directory, laptop.root, { revocation: older, marks: {} }, clock),
    ).resolves.toBe(false);
    expect(stateOf(laptop).revocation.sig).toBe(before.revocation.sig);
  });

  it('ignores a list from another signing key', async () => {
    const before = stateOf(laptop);
    const foreign = {
      ...before.revocation,
      seq: before.revocation.seq + 1,
      signingKeyId: 'x'.repeat(43),
    };
    await expect(
      saveAdoptedLists(laptop.directory, laptop.root, { revocation: foreign, marks: {} }, clock),
    ).resolves.toBe(false);
    expect(stateOf(laptop).revocation.sig).toBe(before.revocation.sig);
  });

  it('refuses, and saves nothing, when the list does not verify for this device', async () => {
    const before = stateOf(laptop);
    const revokingSelf = await issueDeviceRevocationList({
      signingKey: await laptopSigningKey(),
      seq: before.revocation.seq + 1,
      issuedAt: clock,
      revokedDeviceIds: [before.deviceCertificate.deviceId],
    });
    await expect(
      saveAdoptedLists(
        laptop.directory,
        laptop.root,
        { revocation: revokingSelf, marks: {} },
        clock,
      ),
    ).rejects.toThrow(/did not verify/);
    expect(stateOf(laptop).revocation.sig).toBe(before.revocation.sig);
  });
});
