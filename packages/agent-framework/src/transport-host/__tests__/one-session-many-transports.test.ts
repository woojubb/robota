import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';

import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { TransportRegistry } from '../transport-registry';
import { bindTransportAdapter } from '../bind-transport-adapter.js';

import type { IConfigurableTransport } from '@robota-sdk/agent-interface-transport';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';

/**
 * SELFHOST-013 TC-01 — the load-bearing "one agent definition → many channels" DIP claim: the registry fans a
 * SINGLE `IInteractiveSession` instance into every enabled bound transport. Each recording transport captures the
 * exact `attach()` argument; the test then asserts strict reference identity (the same instance reached both),
 * which would fail if the registry ever copied/cloned/rebuilt the session per transport.
 */

/** A test-support transport that records the exact session instance handed to `attach()`. */
class RecordingTransport implements IConfigurableTransport<IInteractiveSession> {
  readonly defaultEnabled = true;
  readonly lifecycle = Object.freeze({ kind: 'service' as const });
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
    path.join(realpathSync(mkdtempSync(path.join(tmpdir(), 'deploy-matrix-'))), 'settings.json'),
  );
}

describe('one definition → many transports (reference identity)', () => {
  it('bound adapters start with the SAME session instance', async () => {
    const registry = newRegistry();
    const t1 = new RecordingTransport('alpha');
    const t2 = new RecordingTransport('beta');
    // One session (as built once by buildRuntimeSession) — a distinct sentinel instance.
    const session = Object.assign(createTestInteractiveSession(), { id: 'the-one-session' });
    registry.register(bindTransportAdapter(t1, session));
    registry.register(bindTransportAdapter(t2, session));

    await registry.startAll();

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
    const session = Object.assign(createTestInteractiveSession(), { id: 's' });
    registry.register(bindTransportAdapter(enabled, session));
    registry.register(bindTransportAdapter(outOfBand, session));
    await registry.startAll();

    expect(enabled.attached).toBe(session);
    expect(outOfBand.attached).toBeUndefined(); // startAll skips it; REMOTE-001 attaches it out-of-band on the same session
  });
});
