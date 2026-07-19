import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { TransportRegistry } from '../transport-registry';

import type {
  IConfigurableTransport,
  IInteractiveSession,
} from '@robota-sdk/agent-interface-transport';

/**
 * SELFHOST-013 TC-01 — the load-bearing "one agent definition → many channels" DIP claim: the registry fans a
 * SINGLE `IInteractiveSession` instance out to every enabled transport. Each recording transport captures the
 * exact `attach()` argument; the test then asserts strict reference identity (the same instance reached both),
 * which would fail if the registry ever copied/cloned/rebuilt the session per transport.
 */

/** A test-support transport that records the exact session instance handed to `attach()`. */
class RecordingTransport implements IConfigurableTransport<IInteractiveSession> {
  readonly defaultEnabled = true;
  attached: IInteractiveSession | undefined;
  started = false;

  constructor(readonly name: string) {}

  attach(session: IInteractiveSession): void {
    this.attached = session;
  }
  start(): Promise<void> {
    this.started = true;
    return Promise.resolve();
  }
  stop(): Promise<void> {
    return Promise.resolve();
  }
}

function newRegistry(): TransportRegistry {
  // A fresh temp settings path → no saved overrides → each transport's `defaultEnabled` decides (true here).
  return new TransportRegistry(
    path.join(mkdtempSync(path.join(tmpdir(), 'deploy-matrix-')), 'settings.json'),
  );
}

describe('one definition → many transports (reference identity)', () => {
  it('startAll fans the SAME session instance to every enabled transport', async () => {
    const registry = newRegistry();
    const t1 = new RecordingTransport('alpha');
    const t2 = new RecordingTransport('beta');
    registry.register(t1);
    registry.register(t2);

    // One session (as built once by buildRuntimeSession) — a distinct sentinel instance.
    const session = { id: 'the-one-session' } as unknown as IInteractiveSession;

    await registry.startAll(session);

    // The precise falsifiable claim: one instance reached BOTH transports (not a copy/clone/per-transport rebuild).
    expect(t1.attached).toBe(session);
    expect(t2.attached).toBe(session);
    expect(t1.attached).toBe(t2.attached);
    expect(t1.started && t2.started).toBe(true);
  });

  it('a defaultEnabled:false transport is not started by startAll (out-of-band attach only)', async () => {
    const registry = newRegistry();
    const enabled = new RecordingTransport('enabled');
    const outOfBand = new RecordingTransport('outofband');
    (outOfBand as { defaultEnabled: boolean }).defaultEnabled = false;
    registry.register(enabled);
    registry.register(outOfBand);

    const session = { id: 's' } as unknown as IInteractiveSession;
    await registry.startAll(session);

    expect(enabled.attached).toBe(session);
    expect(outOfBand.attached).toBeUndefined(); // startAll skips it; REMOTE-001 attaches it out-of-band on the same session
  });
});
