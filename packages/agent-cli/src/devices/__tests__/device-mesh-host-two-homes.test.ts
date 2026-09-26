/**
 * End to end with the setting on: two devices, each with its own `HOME`, open the mesh the way an
 * interactive session does and link. A message arrives as a peer message with no authority; a file
 * and a hand-off each wait for the receiving operator, and land aside or saved, never run.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEVICE_CAPABILITIES,
  certifyDevice,
  generateDeviceKeyAgreementKeyPair,
  generateDeviceSignKeyPair,
  issueDeviceRoster,
} from '@robota-sdk/agent-remote-pairing';
import { createInMemoryMeshRelayHub } from '@robota-sdk/agent-transport-webrtc';
import { createUserSessionStore } from '@robota-sdk/agent-framework';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFileCredentialStore } from '../../credentials/file-credential-store.js';
import { createHandoffComposition } from '../../handoff/handoff-composition-root.js';
import { mintHandoffGrant } from '../../handoff/handoff-grant.js';
import { readHandoffIdentity } from '../../handoff/handoff-host-adapter.js';
import { createHandoffReceiver } from '../../handoff/handoff-receiving.js';
import { prepareOutgoingFile } from '../../peer-files/outgoing-file.js';
import { sessionPeerIngress } from '../../remote-control/peer-ingress.js';
import { createDeviceIdentityService } from '../device-identity-service.js';
import { createDeviceMeshHost, type IDeviceMeshHost } from '../device-mesh-host.js';
import { openDeviceMesh, type IDeviceMeshEndpoint } from '../device-mesh.js';
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

import type { ICredentialStore } from '@robota-sdk/agent-core';
import type { IInteractiveSessionRecord, ITurnHandle } from '@robota-sdk/agent-interface-session';
import type {
  ICapabilityApprovalRequest,
  IOperatorApprover,
} from '@robota-sdk/agent-interface-session-mobility';

interface IHome {
  readonly home: string;
  readonly root: string;
  readonly directory: string;
  readonly store: ICredentialStore;
}

function makeHome(label: string): IHome {
  const home = mkdtempSync(join(tmpdir(), `robota-mesh-on-${label}-`));
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
const hosts: IDeviceMeshHost[] = [];
const endpoints: IDeviceMeshEndpoint[] = [];

/** The desktop enrols with every capability in its certificate, so only local policy narrows it. */
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
    capabilities: DEVICE_CAPABILITIES,
    issuedAt: Date.now(),
  });
  const roster = await issueDeviceRoster({
    signingKey,
    seq: held.roster.seq + 1,
    issuedAt: Date.now(),
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
  laptop = makeHome('laptop');
  desktop = makeHome('desktop');
  const service = createDeviceIdentityService({
    directory: laptop.directory,
    withinRoot: laptop.root,
    store: laptop.store,
    openTerminal: () => scriptedOperator().session,
    defaultDeviceName: () => 'laptop',
  });
  expect((await service.init({})).ok).toBe(true);
});

afterEach(() => {
  for (const host of hosts.splice(0)) host.close();
  endpoints.length = 0;
  rmSync(laptop.home, { recursive: true, force: true });
  rmSync(desktop.home, { recursive: true, force: true });
});

const SETTINGS = {
  mesh: { enabled: true, options: { dht: false, pkarrRelays: [], nostrRelays: [] } },
};

function meshAt(
  home: IHome,
  hub: ReturnType<typeof createInMemoryMeshRelayHub>,
  said: string[] = [],
) {
  const host = createDeviceMeshHost({
    root: home.root,
    store: home.store,
    readTransports: () => SETTINGS,
    relay: () => hub.connect(),
    lan: false,
    connectTimeoutMs: 10_000,
    open: async (options) => {
      const endpoint = await openDeviceMesh(options);
      endpoints.push(endpoint);
      return endpoint;
    },
    report: (message) => said.push(message),
  });
  hosts.push(host);
  return host;
}

/** A session that records what it was asked to run, and runs nothing. */
function recordingSession() {
  const submitted: { input: string; options: Record<string, unknown> }[] = [];
  const handle: ITurnHandle = {
    id: 'turn',
    completed: new Promise(() => undefined),
  } as unknown as ITurnHandle;
  return {
    submitted,
    session: {
      submit: async (input: string, _d: unknown, _r: unknown, options: Record<string, unknown>) => {
        submitted.push({ input, options });
        (options['onAccepted'] as (h: ITurnHandle) => void)(handle);
        return handle;
      },
    },
  };
}

function approver(answer: boolean) {
  const asked: ICapabilityApprovalRequest[] = [];
  const approve: IOperatorApprover = {
    approve: async (request) => {
      asked.push(request);
      return answer;
    },
  };
  return { asked, approve };
}

async function linked(desktopApprover: IOperatorApprover | undefined) {
  const desktopId = await enrolDesktop();
  const laptopId = stateOf(laptop).deviceCertificate.deviceId;
  const hub = createInMemoryMeshRelayHub();
  const atLaptop = meshAt(laptop, hub);
  const said: string[] = [];
  const atDesktop = meshAt(desktop, hub, said);
  await atLaptop.start({ operatorApprover: { approve: async () => true } });
  await atDesktop.start(desktopApprover !== undefined ? { operatorApprover: desktopApprover } : {});
  await expect
    .poll(() => atLaptop.devices().map((d) => d.deviceId), { timeout: 15_000 })
    .toEqual([desktopId]);
  await expect
    .poll(() => atDesktop.devices().map((d) => d.deviceId), { timeout: 15_000 })
    .toEqual([laptopId]);
  return { atLaptop, atDesktop, desktopId, laptopId, said };
}

describe('the device mesh, turned on in two HOMEs', () => {
  it('delivers a message as a peer message with no authority, from the confirmed sender', async () => {
    const { atLaptop, atDesktop, desktopId, laptopId } = await linked(approver(false).approve);
    const { session, submitted } = recordingSession();
    atDesktop.bind({ ingress: sessionPeerIngress(() => session) });

    expect(atLaptop.devices()).toEqual([
      { deviceId: desktopId, name: 'desktop', locality: 'another-host' },
    ]);
    const ack = await atLaptop.send(desktopId, 'hello from the laptop');
    expect(ack.state).toBe('pending');
    expect(submitted).toHaveLength(1);
    expect(submitted[0]!.input).toBe('hello from the laptop');
    // A peer turn, attributed to the device the handshake proved, answered to it, and nothing more:
    // the session's ordinary permissions decide what it may do, and the rate limit counts it.
    const { onAccepted: _accepted, ...options } = submitted[0]!.options;
    expect(options).toEqual({
      turnSource: 'peer',
      driverId: `peer:${laptopId}`,
      peer: { messageId: expect.any(String), replyTo: laptopId },
    });
    // The answer goes back the same way, and a reply to something never received is refused.
    const atLaptopSession = recordingSession();
    atLaptop.bind({ ingress: sessionPeerIngress(() => atLaptopSession.session) });
    const reply = await atDesktop.send(laptopId, 'hello back', {
      inReplyTo: (options['peer'] as { messageId: string }).messageId,
    });
    expect(reply.state).toBe('pending');
    expect(atLaptopSession.submitted.map((s) => s.options['driverId'])).toEqual([
      `peer:${desktopId}`,
    ]);
    const stray = await atDesktop.send(laptopId, 'not an answer', { inReplyTo: 'nothing' });
    expect(stray.state).toBe('refused');
  }, 60_000);

  it('refuses a message while no session is there to take it', async () => {
    const { atLaptop, desktopId } = await linked(undefined);
    const ack = await atLaptop.send(desktopId, 'anyone?');
    expect(ack.state).toBe('refused');
  }, 60_000);

  it('keeps a file aside only with the receiving operator yes', async () => {
    const { asked, approve } = approver(true);
    const { atLaptop, desktopId, laptopId, said } = await linked(approve);
    const workspace = join(laptop.home, 'project');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, 'notes.txt'), 'plain notes');
    const prepared = await prepareOutgoingFile({
      path: 'notes.txt',
      cwd: workspace,
      home: laptop.home,
      origin: 'operator',
      maxBytes: 1024 * 1024,
    });
    if (!prepared.ok) throw new Error(prepared.reason);

    await expect(atLaptop.sendFile(desktopId, prepared.file)).resolves.toEqual({
      state: 'delivered',
    });
    expect(asked.map((request) => request.capability)).toEqual(['file']);
    const kept = join(desktop.root, 'peer-files', laptopId, 'notes.txt');
    expect(readFileSync(kept, 'utf8')).toBe('plain notes');
    await expect.poll(() => said.join('\n')).toContain('notes.txt');
  }, 60_000);

  it('refuses a file when nobody can approve it, as in a run with no terminal', async () => {
    const { atLaptop, desktopId } = await linked(undefined);
    const workspace = join(laptop.home, 'project');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, 'notes.txt'), 'plain notes');
    const prepared = await prepareOutgoingFile({
      path: 'notes.txt',
      cwd: workspace,
      home: laptop.home,
      origin: 'operator',
      maxBytes: 1024 * 1024,
    });
    if (!prepared.ok) throw new Error(prepared.reason);
    const result = await atLaptop.sendFile(desktopId, prepared.file);
    expect(result.state).toBe('refused');
  }, 60_000);

  it('saves a pushed session unstarted, only with the receiving operator yes', async () => {
    const { asked, approve } = approver(true);
    const { atLaptop, atDesktop, desktopId, laptopId } = await linked(approve);
    const composition = createHandoffComposition();
    const store = createUserSessionStore(join(desktop.root, 'sessions'));
    const outcomes: string[] = [];
    atDesktop.bind({
      handoff: {
        receive: createHandoffReceiver({
          root: desktop.root,
          composition,
          identity: () => readHandoffIdentity(desktop.root),
          resolveCredential: () => true,
          persist: (record) => {
            store.save(record);
            return true;
          },
          deviceLabel: 'this device',
        }),
        onOutcome: (_from, outcome) => outcomes.push(outcome.received ? 'saved' : 'refused'),
      },
    });
    const keys = await loadDevicePrivateKeys(laptop.store, stateOf(laptop).deviceCertificate);
    if (keys === undefined) throw new Error('no keys');
    const record: IInteractiveSessionRecord = {
      id: 'session-laptop',
      cwd: '/work/project',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T01:00:00.000Z',
      messages: [],
    };
    const result = await atLaptop.handoff(desktopId, {
      composition,
      request: {
        handoffId: 'handoff-1',
        sessionId: record.id,
        sourceDeviceId: laptopId,
        destinationDeviceId: desktopId,
        record,
        runtime: {},
        offeredAt: Date.now(),
      },
      mintGrant: (manifest, fingerprint) =>
        mintHandoffGrant(
          { userId: stateOf(laptop).userId, signPrivateKey: keys.signPrivateKey },
          manifest,
          fingerprint,
          Date.now(),
        ),
      onReadOnly: () => undefined,
    });
    expect(result.outcome.phase).toBe('committed');
    expect(asked.map((request) => request.capability)).toEqual(['handoff']);
    expect(store.load('session-laptop').status).toBe('valid');
    await expect.poll(() => outcomes).toEqual(['saved']);
  }, 60_000);

  it('grants no delegate, observe or drive by default', async () => {
    const { desktopId } = await linked(approver(true).approve);
    const link = endpoints[0]!.node.link(desktopId);
    if (link === undefined) throw new Error('no link');
    for (const capability of ['delegate', 'observe', 'drive'] as const) {
      await expect(link.authority.authorize(capability)).resolves.toEqual({
        allowed: false,
        reason: 'not-granted',
      });
    }
    await expect(link.authority.authorize('message')).resolves.toEqual({ allowed: true });
  }, 60_000);

  it('closes the mesh on exit, and the other device sees the link go', async () => {
    const { atLaptop, atDesktop } = await linked(undefined);
    atLaptop.close();
    expect(atLaptop.devices()).toEqual([]);
    await expect.poll(() => atDesktop.devices(), { timeout: 20_000 }).toEqual([]);
    expect(existsSync(join(laptop.root, 'devices'))).toBe(true);
    expect(readdirSync(join(laptop.root, 'devices')).length).toBeGreaterThan(0);
  }, 60_000);
});
