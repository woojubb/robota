import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IOwnerHandover } from '@robota-sdk/agent-keyring';
import type { ISpawnerPairResult } from '@robota-sdk/agent-transport/link';

const links = vi.hoisted(() => ({ openSpawner: vi.fn(), openOwner: vi.fn() }));
const control = vi.hoisted(() => ({ list: vi.fn(), stop: vi.fn() }));

vi.mock('../owner-link-client.js', () => ({
  openRegisteredSpawnerLink: links.openSpawner,
  openRegisteredOwnerLink: links.openOwner,
}));
vi.mock('../supervised-control-client.js', () => ({
  listSupervisedRuntimes: control.list,
  stopStartedSupervisedSession: control.stop,
}));

import { launchAndCertifyRuntime } from '../certified-runtime-launch.js';

const ROOT = '/supervised';
const ID = 'runtime-1';
const GENERATION = 'generation-1';
const INSTANCE_KEY = new Uint8Array([1, 2, 3]);
const BINDING = { runtimeId: ID, generation: GENERATION };

/** Every call the launch makes on its collaborators, in order. */
let calls: string[];
let spawnerKey: { wipe: ReturnType<typeof vi.fn> };
let spawner: { instancePublicKey: Uint8Array; binding: typeof BINDING; installTrustRoot: ReturnType<typeof vi.fn>; closed: Promise<void>; close: ReturnType<typeof vi.fn> };
let owner: { control: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
let handover: { certify: ReturnType<typeof vi.fn> };

const alive = (id: string, generation: string): object => ({ id, liveness: 'alive', control: 'available', generation });

function launch(options: { daemonRole?: boolean; start?: () => Promise<{ id: string } & ISpawnerPairResult> } = {}): Promise<{ id: string; generation: string }> {
  return launchAndCertifyRuntime({
    root: ROOT,
    handover: handover as unknown as IOwnerHandover,
    ...(options.daemonRole === undefined ? {} : { daemonRole: options.daemonRole }),
    start: options.start ?? (async () => {
      calls.push('start');
      return { id: ID, spawnerKey: spawnerKey as unknown as ISpawnerPairResult['spawnerKey'], instancePublicKey: INSTANCE_KEY };
    }),
  });
}

beforeEach(() => {
  calls = [];
  spawnerKey = { wipe: vi.fn(() => { calls.push('wipe'); }) };
  spawner = {
    instancePublicKey: INSTANCE_KEY,
    binding: BINDING,
    installTrustRoot: vi.fn(async () => { calls.push('install-trust-root'); }),
    closed: Promise.resolve(),
    close: vi.fn(() => { calls.push('close-spawner'); }),
  };
  owner = {
    control: vi.fn(async () => { calls.push('take-daemon-role'); return { status: 'daemon' }; }),
    close: vi.fn(() => { calls.push('close-owner'); }),
  };
  handover = { certify: vi.fn(() => 'certificate') };
  control.list.mockReset().mockImplementation(async () => {
    calls.push('list');
    return [alive('another', 'generation-x'), alive(ID, GENERATION)];
  });
  control.stop.mockReset().mockImplementation(async () => { calls.push('stop'); });
  links.openSpawner.mockReset().mockImplementation(async () => { calls.push('open-spawner'); return spawner; });
  links.openOwner.mockReset().mockImplementation(async () => { calls.push('open-owner'); return owner; });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('certified runtime launch', () => {
  it('proves the runtime, installs the owner trust root, then opens the owner link, wiping the key last', async () => {
    await expect(launch()).resolves.toEqual({ id: ID, generation: GENERATION });
    expect(calls).toEqual(['start', 'list', 'open-spawner', 'install-trust-root', 'close-spawner', 'open-owner', 'close-owner', 'wipe']);
    expect(control.list).toHaveBeenCalledWith(ROOT);
    expect(links.openSpawner).toHaveBeenCalledWith({ root: ROOT, id: ID, generation: GENERATION, spawnerKey, instancePublicKey: INSTANCE_KEY });
    expect(handover.certify).toHaveBeenCalledWith(INSTANCE_KEY, BINDING);
    expect(spawner.installTrustRoot).toHaveBeenCalledWith('certificate');
    expect(links.openOwner).toHaveBeenCalledWith({ root: ROOT, id: ID, generation: GENERATION, handover });
    expect(owner.control).not.toHaveBeenCalled();
    expect(control.stop).not.toHaveBeenCalled();
  });

  it('takes the daemon role through the owner link only when asked', async () => {
    await launch({ daemonRole: true });
    expect(owner.control).toHaveBeenCalledWith({ command: 'take-daemon-role', fields: {} });
    expect(calls.slice(-3)).toEqual(['take-daemon-role', 'close-owner', 'wipe']);
    expect(control.stop).not.toHaveBeenCalled();
  });

  it('stops the runtime it started when the daemon role is not accepted', async () => {
    owner.control.mockResolvedValue({ status: 'refused' });
    await expect(launch({ daemonRole: true })).rejects.toThrow('The runtime did not accept its daemon role.');
    expect(owner.close).toHaveBeenCalledOnce();
    expect(control.stop).toHaveBeenCalledExactlyOnceWith(ID, ROOT, GENERATION);
    expect(spawnerKey.wipe).toHaveBeenCalledOnce();
  });

  it('stops the runtime it started when certification fails after the runtime was proved', async () => {
    handover.certify.mockImplementation(() => { throw new Error('Certification refused'); });
    await expect(launch()).rejects.toThrow('Certification refused');
    expect(spawner.close).toHaveBeenCalledOnce();
    expect(links.openOwner).not.toHaveBeenCalled();
    expect(control.stop).toHaveBeenCalledExactlyOnceWith(ID, ROOT, GENERATION);
    expect(calls.slice(-3)).toEqual(['close-spawner', 'stop', 'wipe']);
  });

  it('does not return a failure before the runtime it stopped is gone', async () => {
    handover.certify.mockImplementation(() => { throw new Error('Certification refused'); });
    let gone!: () => void;
    control.stop.mockImplementation(() => new Promise<void>((resolve) => { gone = resolve; }));
    let settled = false;
    const outcome = launch().catch((error: unknown) => error).finally(() => { settled = true; });
    await vi.waitFor(() => { expect(control.stop).toHaveBeenCalledOnce(); });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    expect(spawnerKey.wipe).not.toHaveBeenCalled();
    gone();
    expect(await outcome).toEqual(new Error('Certification refused'));
    expect(spawnerKey.wipe).toHaveBeenCalledOnce();
  });

  it('reports its own failure when the stop of the started runtime fails', async () => {
    spawner.installTrustRoot.mockRejectedValue(new Error('Trust root refused'));
    control.stop.mockRejectedValue(new Error('Stop refused'));
    await expect(launch()).rejects.toThrow('Trust root refused');
    expect(control.stop).toHaveBeenCalledOnce();
    expect(spawnerKey.wipe).toHaveBeenCalledOnce();
  });

  it('gives up on an owner admission that does not complete within its deadline', async () => {
    vi.useFakeTimers();
    spawner.installTrustRoot.mockReturnValue(new Promise(() => undefined));
    const outcome = launch().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(control.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toEqual(new Error('The runtime did not complete owner admission in time.'));
    expect(spawner.close).toHaveBeenCalledOnce();
    expect(control.stop).toHaveBeenCalledExactlyOnceWith(ID, ROOT, GENERATION);
  });

  describe('before the runtime was proved', () => {
    it.each([
      ['no registration at all', async () => []],
      ['only registrations of other runtimes', async () => [alive('another', 'generation-x')]],
      ['a registration whose control does not answer', async () => [{ id: ID, liveness: 'alive', control: 'unavailable' }]],
      ['a registration that is not alive', async () => [{ id: ID, liveness: 'unknown', control: 'unavailable' }]],
    ])('refuses %s, stops nothing and wipes the key', async (_name, rows) => {
      control.list.mockImplementation(rows);
      await expect(launch()).rejects.toThrow('The started runtime has no live registration.');
      expect(links.openSpawner).not.toHaveBeenCalled();
      expect(control.stop).not.toHaveBeenCalled();
      expect(spawnerKey.wipe).toHaveBeenCalledOnce();
    });

    it('stops nothing and wipes the key when the spawner link cannot be opened', async () => {
      links.openSpawner.mockRejectedValue(new Error('Spawner link refused'));
      await expect(launch()).rejects.toThrow('Spawner link refused');
      expect(control.stop).not.toHaveBeenCalled();
      expect(links.openOwner).not.toHaveBeenCalled();
      expect(spawnerKey.wipe).toHaveBeenCalledOnce();
    });

    it('does nothing further when the runtime could not be started', async () => {
      await expect(launch({ start: async () => { throw new Error('Start refused'); } })).rejects.toThrow('Start refused');
      expect(control.list).not.toHaveBeenCalled();
      expect(control.stop).not.toHaveBeenCalled();
    });
  });
});
