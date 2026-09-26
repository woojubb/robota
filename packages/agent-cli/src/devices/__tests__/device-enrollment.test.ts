/**
 * `/devices add` on a device that holds the signing key and `/devices join` on a new one, each with
 * its own `HOME`, meeting through a relay over WebRTC. The enrolled device then passes the device
 * handshake. A wrong, expired, reused or brute-forced code, a relay in the middle, and a declining
 * operator each leave both devices as they were, and the code is found nowhere but on the two
 * terminals.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { deriveEnrollmentMaterial } from '@robota-sdk/agent-remote-pairing';
import {
  createInMemoryMeshRelayHub,
  dialEnrollment,
  listenForEnrollment,
  type IEnrollmentChannel,
  type IInMemoryMeshRelayHub,
} from '@robota-sdk/agent-transport-webrtc';
import { createDevicesCommandModule } from '@robota-sdk/agent-command';
import { scriptedSession, type ScriptedSessionHarness } from '@robota-sdk/agent-framework/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFileCredentialStore } from '../../credentials/file-credential-store.js';
import { joinEnrollment } from '../device-enrollment.js';
import { openDeviceMesh, type IDeviceMeshEndpoint } from '../device-mesh.js';
import { DEVICE_SIGN_KEY } from '../identity-keys.js';
import { readIdentityState } from '../identity-state.js';
import { createDevicesCommandPort } from '../index.js';
import {
  scriptedOperator,
  type IScriptedOperator,
  type IScriptedOperatorOptions,
} from './fake-secret-terminal.js';
import { filesUnder } from './secret-leak.js';

import type { ICredentialStore } from '@robota-sdk/agent-core';
import type { IDevicesCommandPort, TDevicesOutcome } from '@robota-sdk/agent-command';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';

interface IHome {
  readonly root: string;
  readonly directory: string;
  readonly store: ICredentialStore;
  operator: IScriptedOperator;
}

let world: string;
let previousHome: string | undefined;
const sessions: ScriptedSessionHarness[] = [];
const endpoints: IDeviceMeshEndpoint[] = [];

beforeEach(() => {
  world = mkdtempSync(join(tmpdir(), 'robota-enrol-'));
  previousHome = process.env.HOME;
  process.env.HOME = world;
});

afterEach(async () => {
  for (const endpoint of endpoints.splice(0)) endpoint.close();
  for (const session of sessions.splice(0)) await session.dispose();
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  rmSync(world, { recursive: true, force: true });
});

function makeHome(label: string): IHome {
  const root = join(world, label, '.robota');
  mkdirSync(root, { recursive: true });
  return {
    root,
    directory: join(root, 'devices'),
    store: createFileCredentialStore(join(root, 'credentials'), { withinRoot: root }),
    operator: scriptedOperator(),
  };
}

function portOf(
  home: IHome,
  hub: IInMemoryMeshRelayHub | undefined,
  enrollment: { ttlMs?: number; maxFailedAttempts?: number } = {},
): IDevicesCommandPort {
  return createDevicesCommandPort({
    root: home.root,
    credentials: { store: home.store, describe: () => 'owner-only file (test)' },
    openTerminal: () => home.operator.session,
    openEnrollmentRelay: () => hub?.connect(),
    iceServers: () => undefined,
    enrollment: { connectTimeoutMs: 10_000, ...enrollment },
  });
}

async function initialized(label: string, hub: IInMemoryMeshRelayHub): Promise<IHome> {
  const home = makeHome(label);
  expect((await portOf(home, hub).init({ name: label })).ok).toBe(true);
  return home;
}

function operate(home: IHome, options: IScriptedOperatorOptions): IScriptedOperator {
  home.operator = scriptedOperator(options);
  return home.operator;
}

function reason<T>(outcome: TDevicesOutcome<T>): string {
  return outcome.ok ? 'ok' : outcome.reason;
}

function snapshot(home: IHome): string {
  return JSON.stringify(readIdentityState(home.directory) ?? null);
}

/** Run `add` on `existing`; once its code is on screen, `whenShown` runs with it. */
async function adding<T>(
  existing: IHome,
  port: IDevicesCommandPort,
  whenShown: (code: string) => Promise<T>,
  operatorOptions: IScriptedOperatorOptions = {},
): Promise<{ added: Awaited<ReturnType<IDevicesCommandPort['add']>>; joined: T }> {
  let joined!: Promise<T>;
  let shown!: () => void;
  const codeShown = new Promise<void>((resolve) => (shown = resolve));
  operate(existing, {
    ...operatorOptions,
    onCodeShown: (code) => {
      joined = whenShown(code);
      shown();
    },
  });
  const added = await port.add();
  await codeShown;
  return { added, joined: await joined };
}

describe('/devices add and /devices join between two HOMEs', () => {
  it('enrols the new device, which then passes the device handshake; the code is nowhere else', async () => {
    const hub = createInMemoryMeshRelayHub();
    const laptop = await initialized('laptop', hub);
    const desktop = makeHome('desktop');
    const terminal = {
      canHandoffTerminal: true,
      runWithTerminal: <T>(work: () => Promise<T>) => work(),
    };
    const atLaptop = scriptedSession({
      turns: [{ text: 'laptop answer' }],
      persistence: true,
      terminalHandoff: terminal,
      commandModules: [createDevicesCommandModule(portOf(laptop, hub))],
    });
    const atDesktop = scriptedSession({
      turns: [{ text: 'desktop answer' }],
      persistence: true,
      terminalHandoff: terminal,
      commandModules: [createDevicesCommandModule(portOf(desktop, hub))],
    });
    sessions.push(atLaptop, atDesktop);

    let code = '';
    let joining!: Promise<ICommandResult | null>;
    operate(laptop, {
      onCodeShown: (shown) => {
        code = shown;
        operate(desktop, { code: () => shown });
        joining = atDesktop.command('devices', 'join desktop');
      },
    });
    const added = await atLaptop.command('devices', 'add');
    const joined = await joining;
    expect(added?.success).toBe(true);
    expect(added?.message).toMatch(/Enrolled desktop/);
    expect(joined?.success).toBe(true);
    expect(joined?.message).toMatch(/Joined the devices/);

    const laptopState = readIdentityState(laptop.directory)!;
    const desktopState = readIdentityState(desktop.directory)!;
    expect(laptopState.roster.devices.map((d) => d.name).sort()).toEqual(['desktop', 'laptop']);
    expect(desktopState.deviceCertificate.name).toBe('desktop');
    expect(desktopState.holdsSigningKey).toBe(false);
    expect(desktopState.masterPublicKey).toBe(laptopState.masterPublicKey);
    expect(desktopState.roster.seq).toBe(laptopState.roster.seq);
    // Both operators were shown the same short string.
    expect(desktop.operator.shownSas()).toMatch(/^\d{3} \d{3}$/);
    expect(laptop.operator.shownSas()).toBe(desktop.operator.shownSas());

    // The desktop has an identity now; joining again is refused.
    const again = await atDesktop.command('devices', 'join');
    expect(again?.success).toBe(false);
    await atLaptop.submit('hello after enrolling');
    await atDesktop.submit('hello after joining');

    // The two devices now admit each other with the device handshake.
    const open = async (home: IHome) => {
      const endpoint = await openDeviceMesh({
        root: home.root,
        store: home.store,
        relay: hub.connect(),
        connectTimeoutMs: 10_000,
      });
      endpoints.push(endpoint);
      return endpoint.node;
    };
    const [laptopNode, desktopNode] = [await open(laptop), await open(desktop)];
    const desktopId = desktopState.deviceCertificate.deviceId;
    const laptopId = laptopState.deviceCertificate.deviceId;
    const [toDesktop, toLaptop] = await Promise.all([
      laptopNode.connect(desktopId),
      desktopNode.connect(laptopId),
    ]);
    expect(toDesktop.admission.deviceId).toBe(desktopId);
    expect(toLaptop.admission.deviceId).toBe(laptopId);

    // The code was on the two terminals and nowhere else.
    const canonical = code.replace(/-/g, '');
    const groups = code.split('-');
    const fragments = [code, canonical, ...groups.slice(1).map((g, i) => `${groups[i]}-${g}`)];
    expect(laptop.operator.everything()).toContain(code);
    const places: Array<[string, string]> = [
      ...[atLaptop, atDesktop].flatMap((session, i): Array<[string, string]> => [
        [`requests ${i}`, JSON.stringify(session.requests)],
        [`history ${i}`, JSON.stringify(session.history())],
        [`log ${i}`, JSON.stringify(session.sessionLog())],
        [`record ${i}`, JSON.stringify(session.sessionRecord() ?? null)],
        [`transcript ${i}`, session.transcript()],
        [`events ${i}`, JSON.stringify(session.emittedEvents('user_message'))],
        ...filesUnder(session.cwd).map((f): [string, string] => [f.path, f.text]),
      ]),
      ['results', JSON.stringify([added, joined, again])],
      ...filesUnder(world).map((f): [string, string] => [f.path, f.text]),
    ];
    expect(atLaptop.requests.length + atDesktop.requests.length).toBe(2);
    for (const [where, text] of places) {
      expect({ where, leaked: fragments.filter((f) => text.includes(f)) }).toEqual({
        where,
        leaked: [],
      });
    }
  }, 60_000);

  it('refuses a wrong code; the existing device keeps waiting until its code expires', async () => {
    const hub = createInMemoryMeshRelayHub();
    const laptop = await initialized('laptop', hub);
    const desktop = makeHome('desktop');
    const before = snapshot(laptop);
    const { added, joined } = await adding(
      laptop,
      portOf(laptop, hub, { ttlMs: 1_500 }),
      (code) => {
        const wrong = code.startsWith('0') ? `1${code.slice(1)}` : `0${code.slice(1)}`;
        operate(desktop, { code: () => wrong });
        return portOf(desktop, hub).join({ name: 'desktop' });
      },
    );
    expect(reason(joined)).toBe('code-not-accepted');
    expect(reason(added)).toBe('enrollment-expired');
    expect(snapshot(laptop)).toBe(before);
    expect(readIdentityState(desktop.directory)).toBeUndefined();
    expect(await desktop.store.get(DEVICE_SIGN_KEY)).toBeUndefined();
  }, 30_000);

  it('refuses an expired code, and a code already used', async () => {
    const hub = createInMemoryMeshRelayHub();
    const laptop = await initialized('laptop', hub);

    let expiredCode = '';
    const expired = await adding(laptop, portOf(laptop, hub, { ttlMs: 200 }), async (code) => {
      expiredCode = code;
    });
    expect(reason(expired.added)).toBe('enrollment-expired');
    const late = makeHome('late');
    operate(late, { code: () => expiredCode });
    expect(reason(await portOf(late, hub).join({}))).toBe('code-not-accepted');

    const desktop = makeHome('desktop');
    let usedCode = '';
    const used = await adding(laptop, portOf(laptop, hub), (code) => {
      usedCode = code;
      operate(desktop, { code: () => code });
      return portOf(desktop, hub).join({ name: 'desktop' });
    });
    expect(reason(used.added)).toBe('ok');
    expect(reason(used.joined)).toBe('ok');
    const replay = makeHome('replay');
    operate(replay, { code: () => usedCode });
    expect(reason(await portOf(replay, hub).join({}))).toBe('code-not-accepted');
    expect(readIdentityState(replay.directory)).toBeUndefined();
    expect(readIdentityState(laptop.directory)!.roster.devices).toHaveLength(2);
  }, 60_000);

  it('a relay in the middle cannot enrol anyone: the proof is bound to the DTLS fingerprints', async () => {
    // The relay terminates WebRTC toward each side and forwards every frame between them.
    const towardLaptop = createInMemoryMeshRelayHub();
    const towardDesktop = createInMemoryMeshRelayHub();
    const laptop = await initialized('laptop', towardLaptop);
    const desktop = makeHome('desktop');
    const before = snapshot(laptop);
    const relays = [towardLaptop.connect(), towardDesktop.connect()];
    const { added, joined } = await adding(
      laptop,
      portOf(laptop, towardLaptop, { maxFailedAttempts: 1 }),
      async (code) => {
        // A relay sees the topics; it is handed them here, and never the keys.
        const { existingInbox, joinerInbox } = await deriveEnrollmentMaterial(code);
        const listener = listenForEnrollment({
          relay: relays[1]!,
          inbound: existingInbox,
          outbound: joinerInbox,
          onChannel: (fromDesktop: IEnrollmentChannel) => {
            void dialEnrollment({
              relay: relays[0]!,
              inbound: joinerInbox,
              outbound: existingInbox,
            }).then((toLaptop) => {
              fromDesktop.onFrame((frame) => toLaptop.send(frame));
              toLaptop.onFrame((frame) => fromDesktop.send(frame));
              fromDesktop.onClose(() => toLaptop.close());
              toLaptop.onClose(() => fromDesktop.close());
            });
          },
        });
        operate(desktop, { code: () => code });
        try {
          return await portOf(desktop, towardDesktop).join({ name: 'desktop' });
        } finally {
          listener.close();
        }
      },
    );
    for (const relay of relays) relay.close();
    expect(reason(joined)).toBe('code-not-accepted');
    expect(reason(added)).toBe('too-many-attempts');
    expect(snapshot(laptop)).toBe(before);
    expect(readIdentityState(desktop.directory)).toBeUndefined();
  }, 30_000);

  it('bounds guessing: after failed proofs the code stops working, even for the right device', async () => {
    const hub = createInMemoryMeshRelayHub();
    const laptop = await initialized('laptop', hub);
    const desktop = makeHome('desktop');
    const before = snapshot(laptop);
    const { added, joined } = await adding(
      laptop,
      portOf(laptop, hub, { maxFailedAttempts: 3 }),
      async (code) => {
        // Someone who learned the topics (the relay) guesses the key three times.
        const right = await deriveEnrollmentMaterial(code);
        const guess = await deriveEnrollmentMaterial('0000000000000000000000000');
        const guesses: string[] = [];
        for (let i = 0; i < 3; i += 1) {
          const guesser = makeHome(`guesser-${i}`);
          guesses.push(
            reason(
              await joinEnrollment({
                directory: guesser.directory,
                withinRoot: guesser.root,
                store: guesser.store,
                relay: hub.connect(),
                now: Date.now,
                material: { ...right, proofKey: guess.proofKey, sasKey: guess.sasKey },
                name: 'guesser',
                showSas: () => undefined,
                cancelled: new AbortController().signal,
              }),
            ),
          );
        }
        operate(desktop, { code: () => code });
        return { guesses, real: await portOf(desktop, hub).join({ name: 'desktop' }) };
      },
    );
    expect(joined.guesses).toEqual(['code-not-accepted', 'code-not-accepted', 'code-not-accepted']);
    expect(reason(added)).toBe('too-many-attempts');
    expect(reason(joined.real)).toBe('code-not-accepted');
    expect(snapshot(laptop)).toBe(before);
  }, 60_000);

  it('issues nothing when the operator declines', async () => {
    const hub = createInMemoryMeshRelayHub();
    const laptop = await initialized('laptop', hub);
    const desktop = makeHome('desktop');
    const before = snapshot(laptop);
    const { added, joined } = await adding(
      laptop,
      portOf(laptop, hub),
      (code) => {
        operate(desktop, { code: () => code });
        return portOf(desktop, hub).join({ name: 'desktop' });
      },
      { enrolAnswer: 'no' },
    );
    expect(reason(added)).toBe('enrollment-declined');
    expect(reason(joined)).toBe('enrollment-declined');
    expect(laptop.operator.shownSas()).toBe(desktop.operator.shownSas());
    expect(snapshot(laptop)).toBe(before);
    expect(readIdentityState(desktop.directory)).toBeUndefined();
    expect(await desktop.store.get(DEVICE_SIGN_KEY)).toBeUndefined();
  }, 30_000);

  it('refuses without an interactive terminal, without a relay, and a code typed as an argument', async () => {
    const hub = createInMemoryMeshRelayHub();
    const laptop = await initialized('laptop', hub);
    const desktop = makeHome('desktop');
    const headless = (home: IHome): IDevicesCommandPort =>
      createDevicesCommandPort({
        root: home.root,
        credentials: { store: home.store, describe: () => undefined },
        openTerminal: () => undefined,
        openEnrollmentRelay: () => hub.connect(),
      });
    expect(reason(await headless(laptop).add())).toBe('no-terminal');
    expect(reason(await headless(desktop).join({}))).toBe('no-terminal');
    expect(reason(await portOf(laptop, undefined).add())).toBe('no-relay');
    expect(reason(await portOf(desktop, undefined).join({}))).toBe('no-relay');
    expect(reason(await portOf(desktop, hub).join({ name: 'ABCDE-FGHJK-MNPQR-STVWX-YZ012' }))).toBe(
      'code-on-command-line',
    );
    // ctrl-C while waiting for the new device ends the enrollment and changes nothing.
    const before = snapshot(laptop);
    operate(laptop, { cancelWaiting: true });
    expect(reason(await portOf(laptop, hub).add())).toBe('cancelled');
    expect(snapshot(laptop)).toBe(before);
    expect(readIdentityState(desktop.directory)).toBeUndefined();
  }, 30_000);
});
