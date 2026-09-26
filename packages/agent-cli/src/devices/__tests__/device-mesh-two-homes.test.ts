/**
 * End to end, CLI side: two devices, each with its own `HOME` (its own `~/.robota/devices` and its
 * own credential store), connect through a relay over WebRTC, admit each other with the device
 * handshake, and deliver a message. The identity each endpoint uses is only what `/devices` left
 * under its `HOME`.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  certifyDevice,
  generateDeviceKeyAgreementKeyPair,
  generateDeviceSignKeyPair,
  issueDeviceRevocationList,
  issueDeviceRoster,
} from '@robota-sdk/agent-remote-pairing';
import {
  createInMemoryMdnsBus,
  createInMemoryMeshRelayHub,
} from '@robota-sdk/agent-transport-webrtc';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFileCredentialStore } from '../../credentials/file-credential-store.js';
import { addressCachePath } from '../address-cache.js';
import { createDeviceIdentityService } from '../device-identity-service.js';
import { reissueDueLists } from '../device-list-reissue.js';
import {
  openDeviceMesh,
  saveAdoptedLists,
  type IDeviceMeshEndpoint,
  type IOpenDeviceMeshOptions,
} from '../device-mesh.js';
import {
  acceptDeviceChannels,
  acceptDeviceFiles,
  handoffToDevice,
  sendFileToDevice,
} from '../mesh-files.js';
import { createHandoffComposition } from '../../handoff/handoff-composition-root.js';
import { mintHandoffGrant } from '../../handoff/handoff-grant.js';
import { readHandoffIdentity } from '../../handoff/handoff-host-adapter.js';
import { createHandoffReceiver } from '../../handoff/handoff-receiving.js';
import { openHandoffWire } from '../../handoff/handoff-wire.js';
import { prepareOutgoingFile } from '../../peer-files/outgoing-file.js';
import {
  DEVICE_KA_KEY,
  DEVICE_SIGN_KEY,
  loadDevicePrivateKeys,
  loadSigningKey,
  storeKeyPair,
} from '../identity-keys.js';
import {
  readIdentityState,
  writeIdentityState,
  type IDeviceIdentityState,
} from '../identity-state.js';
import { scriptedOperator } from './fake-secret-terminal.js';

import { createUserSessionStore } from '@robota-sdk/agent-framework';

import type { TReceiveHandoffOutcome } from '../../handoff/handoff-receive.js';
import type { ICredentialStore } from '@robota-sdk/agent-core';
import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';
import type { ICapabilityApprovalRequest } from '@robota-sdk/agent-interface-session-mobility';
import type { IDeviceMeshLink } from '@robota-sdk/agent-transport-webrtc';

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
const endpointErrors: unknown[] = [];

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
  endpointErrors.length = 0;
  for (const endpoint of open.splice(0)) endpoint.close();
  rmSync(laptop.home, { recursive: true, force: true });
  rmSync(desktop.home, { recursive: true, force: true });
});

async function endpoint(
  home: IHome,
  hub: ReturnType<typeof createInMemoryMeshRelayHub>,
  extra: Pick<IOpenDeviceMeshOptions, 'localPolicy' | 'operatorApprover'> = {},
) {
  const opened = await openDeviceMesh({
    ...extra,
    root: home.root,
    store: home.store,
    relay: hub.connect(),
    now: () => clock,
    connectTimeoutMs: 10_000,
    onError: (error) => endpointErrors.push(error),
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
    // Lists travel in a handshake, so the desktop comes online only now: opened earlier, the two
    // endpoints connect on their own at start and this handshake would already be over.
    const desktopEndpoint = await endpoint(desktop, hub);

    await Promise.all([
      laptopEndpoint.node.connect(desktopId),
      desktopEndpoint.node.connect(newer.deviceCertificate.deviceId),
    ]);

    // Saving takes a lock and verifies the chain; give a loaded machine time, and fail with the reason.
    await expect
      .poll(() => (endpointErrors.length > 0 ? endpointErrors : stateOf(desktop).revocation.seq), {
        timeout: 10_000,
      })
      .toBe(newer.revocation.seq);
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

  describe('file transfer', () => {
    async function linked(approve: boolean | undefined) {
      const desktopId = await enrolDesktop();
      const laptopId = stateOf(laptop).deviceCertificate.deviceId;
      const hub = createInMemoryMeshRelayHub();
      const policy = ['file', 'message', 'presence'] as const;
      const asked: string[] = [];
      const atLaptop = (await endpoint(laptop, hub, { localPolicy: [...policy] })).node;
      const atDesktop = (
        await endpoint(desktop, hub, {
          localPolicy: [...policy],
          ...(approve !== undefined
            ? {
                operatorApprover: {
                  approve: async (request) => {
                    asked.push(request.summary ?? '');
                    return approve;
                  },
                },
              }
            : {}),
        })
      ).node;
      const [toDesktop, toLaptop] = await Promise.all([
        atLaptop.connect(desktopId),
        atDesktop.connect(laptopId),
      ]);
      const outcomes: unknown[] = [];
      acceptDeviceFiles(toLaptop, {
        root: desktop.root,
        onOutcome: (outcome) => outcomes.push(outcome),
      });
      const workspace = join(laptop.home, 'project');
      mkdirSync(workspace, { recursive: true });
      return { toDesktop, laptopId, asked, outcomes, workspace };
    }

    async function prepared(workspace: string, name: string, content: Buffer) {
      writeFileSync(join(workspace, name), content);
      const result = await prepareOutgoingFile({
        path: name,
        cwd: workspace,
        home: laptop.home,
        origin: 'operator',
        maxBytes: 32 * 1024 * 1024,
      });
      if (!result.ok) throw new Error(result.reason);
      return result.file;
    }

    it('delivers a verified copy on a channel of its own, with the operator yes', async () => {
      const { toDesktop, laptopId, asked, workspace } = await linked(true);
      const content = Buffer.from(Array.from({ length: 300_000 }, (_, i) => (i * 7) % 256));
      const messages: string[] = [];
      toDesktop.onMessage((body) => messages.push(body));

      await expect(
        sendFileToDevice(toDesktop, await prepared(workspace, 'data.bin', content)),
      ).resolves.toEqual({ state: 'delivered' });

      const kept = join(desktop.root, 'peer-files', laptopId, 'data.bin');
      expect(readFileSync(kept).equals(content)).toBe(true);
      expect(asked).toHaveLength(1);
      expect(asked[0]).toContain('data.bin');
      // Nothing of the transfer went over the message channel.
      expect(messages).toEqual([]);
    }, 40_000);

    it('refuses a file the receiving operator did not approve', async () => {
      const { toDesktop, laptopId, workspace } = await linked(false);
      const result = await sendFileToDevice(
        toDesktop,
        await prepared(workspace, 'data.bin', Buffer.from('nope')),
      );
      expect(result.state).toBe('refused');
      expect(readdirSync(join(desktop.root, 'peer-files', laptopId))).toEqual([]);
    }, 40_000);

    it('refuses every file when nobody can approve it', async () => {
      const { toDesktop, workspace } = await linked(undefined);
      const result = await sendFileToDevice(
        toDesktop,
        await prepared(workspace, 'data.bin', Buffer.from('nope')),
      );
      expect(result.state).toBe('refused');
    }, 40_000);
  });

  describe('hand-off', () => {
    const composition = createHandoffComposition();

    function session(): IInteractiveSessionRecord {
      return {
        id: 'session-laptop',
        cwd: '/work/project',
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T01:00:00.000Z',
        messages: [
          {
            id: 'm-0',
            timestamp: new Date('2026-09-01T00:00:00.000Z'),
            state: 'complete',
            role: 'user',
            content: 'from a peer',
            metadata: { driverId: 'peer:other', turnSource: 'peer' },
          },
        ],
      };
    }

    async function linked(approve: boolean) {
      const desktopId = await enrolDesktop();
      const laptopId = stateOf(laptop).deviceCertificate.deviceId;
      const hub = createInMemoryMeshRelayHub();
      const policy = ['handoff', 'message', 'presence'] as const;
      const asked: ICapabilityApprovalRequest[] = [];
      const atLaptop = (
        await endpoint(laptop, hub, {
          localPolicy: [...policy],
          operatorApprover: { approve: async () => true },
        })
      ).node;
      const atDesktop = (
        await endpoint(desktop, hub, {
          localPolicy: [...policy],
          operatorApprover: {
            approve: async (request) => {
              asked.push(request);
              return approve;
            },
          },
        })
      ).node;
      const [toDesktop, toLaptop] = await Promise.all([
        atLaptop.connect(desktopId),
        atDesktop.connect(laptopId),
      ]);
      // The desktop saves what it takes into a session store under its own HOME.
      const store = createUserSessionStore(join(desktop.home, '.robota', 'sessions'));
      const outcomes: TReceiveHandoffOutcome[] = [];
      const receiverAt = (
        home: IHome,
        deviceId: string,
        persist: (r: IInteractiveSessionRecord) => boolean,
      ) => ({
        deviceId,
        receive: createHandoffReceiver({
          root: home.root,
          composition,
          identity: () => readHandoffIdentity(home.root),
          resolveCredential: () => true,
          persist,
          deviceLabel: 'this device',
        }),
        onOutcome: (outcome: TReceiveHandoffOutcome) => outcomes.push(outcome),
      });
      acceptDeviceChannels(toLaptop, {
        handoff: receiverAt(desktop, desktopId, (kept) => {
          store.save(kept);
          return true;
        }),
      });
      // The laptop takes hand-offs too, so a pull reaches a receiver that could take one.
      acceptDeviceChannels(toDesktop, { handoff: receiverAt(laptop, laptopId, () => true) });
      const keys = await loadDevicePrivateKeys(laptop.store, stateOf(laptop).deviceCertificate);
      if (keys === undefined) throw new Error('no laptop keys');
      const signer = { userId: stateOf(laptop).userId, signPrivateKey: keys.signPrivateKey };
      return { toDesktop, toLaptop, desktopId, laptopId, asked, store, outcomes, signer };
    }

    function pushTo(
      link: IDeviceMeshLink,
      from: string,
      to: string,
      signer: { userId: string; signPrivateKey: CryptoKey },
      onReadOnly: () => void,
    ) {
      return handoffToDevice(link, {
        composition,
        request: {
          handoffId: 'handoff-laptop-1',
          sessionId: 'session-laptop',
          sourceDeviceId: from,
          destinationDeviceId: to,
          record: session(),
          runtime: {},
          offeredAt: clock,
        },
        mintGrant: (manifest, fingerprint) =>
          mintHandoffGrant(signer, manifest, fingerprint, Date.now()),
        onReadOnly,
      });
    }

    it('pushes a session from one HOME to the other, saved there unstarted, with the operator yes', async () => {
      const { toDesktop, desktopId, laptopId, asked, store, signer } = await linked(true);
      let readOnly = 0;
      const { outcome, source } = await pushTo(toDesktop, laptopId, desktopId, signer, () => {
        readOnly += 1;
      });

      expect(outcome.phase).toBe('committed');
      expect(source.isAuthoritative()).toBe(false);
      expect(readOnly).toBe(1);
      expect(asked).toHaveLength(1);
      expect(asked[0]).toMatchObject({
        capability: 'handoff',
        scope: 'request',
        deviceId: laptopId,
      });
      const loaded = store.load('session-laptop');
      expect(loaded.status).toBe('valid');
      if (loaded.status !== 'valid') return;
      // The peer attribution survived the seal, the carrier and the decoder.
      expect(loaded.record.messages[0]?.metadata).toEqual({
        driverId: 'peer:other',
        turnSource: 'peer',
      });
      // Nothing is left aside once it is saved.
      const aside = join(desktop.root, 'handoff', laptopId);
      await expect
        .poll(() => (existsSync(aside) ? readdirSync(aside) : []), { timeout: 10_000 })
        .toEqual([]);
    }, 40_000);

    it('refuses a session the receiving operator did not approve, and the source keeps it', async () => {
      const { toDesktop, desktopId, laptopId, store, signer } = await linked(false);
      const { outcome, source } = await pushTo(toDesktop, laptopId, desktopId, signer, () => {
        throw new Error('the source must not let go');
      });
      expect(outcome.phase).toBe('abandoned');
      expect(source.isAuthoritative()).toBe(true);
      expect(store.load('session-laptop').status).toBe('missing');
    }, 40_000);

    it('refuses a pull: the desktop cannot ask the laptop for its session', async () => {
      const { toLaptop, outcomes } = await linked(true);
      const wire = openHandoffWire(await toLaptop.openFileChannel());
      wire.send({ t: 'handoff-pull' });
      await expect(wire.next(10_000)).resolves.toMatchObject({
        t: 'handoff-refuse',
        reason: 'push-only',
      });
      wire.close();
      await expect.poll(() => outcomes.length).toBe(1);
      expect(outcomes[0]).toMatchObject({ received: false, reason: 'push-only' });
    }, 40_000);
  });

  it('on the local network, finds the peer before the relay and remembers where, owner-only', async () => {
    const desktopId = await enrolDesktop();
    const laptopId = stateOf(laptop).deviceCertificate.deviceId;
    const bus = createInMemoryMdnsBus();
    const lan = {
      host: '127.0.0.1',
      mdns: { createTransport: () => bus.transport('127.0.0.1'), addresses: () => ['127.0.0.1'] },
    };
    // Each home has its own relay, so only the local network can join them.
    const open2 = async (home: IHome) => {
      const opened = await openDeviceMesh({
        root: home.root,
        store: home.store,
        relay: createInMemoryMeshRelayHub().connect(),
        lan,
        now: () => clock,
        connectTimeoutMs: 10_000,
      });
      open.push(opened);
      return opened.node;
    };
    const [atLaptop, atDesktop] = [await open2(laptop), await open2(desktop)];

    const [toDesktop, toLaptop] = await Promise.all([
      atLaptop.connect(desktopId),
      atDesktop.connect(laptopId),
    ]);
    const received = new Promise<string>((resolve) => toLaptop.onMessage(resolve));
    toDesktop.send('across the room');
    await expect(received).resolves.toBe('across the room');

    const path = addressCachePath(laptop.directory);
    await expect.poll(() => readFileSync(path, 'utf8')).toContain(desktopId);
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
    const stored = readFileSync(path, 'utf8');
    expect(stored).toContain('127.0.0.1');
    expect(stored).not.toContain(stateOf(laptop).deviceCertificate.kaKey);
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
