/**
 * TRANS-009 — the toggle surface tells the truth about what it did.
 *
 * Two defects, one place. `registry.setEnabled` writes a settings file and returns; nothing on that
 * path starts a transport, and `startAll` reads `getEnabled()` at session start. So the row used to
 * report a transport as running because a file had changed. And the failure branch was
 * `.catch(() => setSaving(false))` — the error taken and discarded, so an unwritable settings file
 * looked exactly like a successful save.
 *
 * The assertions are on what the COMPONENT RENDERS, not on whether the registry was called. A test
 * that asserts `setEnabled` was invoked passes against both the old code and the new one, because
 * the call was never the defect.
 */
import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import TransportTUI from '../TransportTUI.js';

import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import type {
  ITransportEntry,
  ITransportSettingsRegistryView,
} from '@robota-sdk/agent-interface-transport';

function entry(name: string, enabled: boolean): ITransportEntry<IInteractiveSession> {
  return {
    transport: { name },
    config: { enabled, options: {} },
  } as unknown as ITransportEntry<IInteractiveSession>;
}

function registryWith(
  setEnabled: ITransportSettingsRegistryView<IInteractiveSession>['setEnabled'],
  entries = [entry('ws', false)],
): ITransportSettingsRegistryView<IInteractiveSession> {
  return {
    getAll: () => entries,
    setEnabled,
    setOptions: vi.fn().mockResolvedValue(undefined),
  } as unknown as ITransportSettingsRegistryView<IInteractiveSession>;
}

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

describe('TRANS-009: the surface says when a toggle applies', () => {
  it('states that a toggle applies at the next start', () => {
    const { lastFrame } = render(
      <TransportTUI
        registry={registryWith(vi.fn().mockResolvedValue(undefined))}
        onClose={vi.fn()}
      />,
    );
    expect(lastFrame()).toContain('applies the next time Robota starts');
  });

  it('does not describe a saved setting as a running transport', () => {
    // `[enabled]` read as "this is up". The badge names the saved setting instead.
    const { lastFrame } = render(
      <TransportTUI
        registry={registryWith(vi.fn().mockResolvedValue(undefined), [entry('ws', true)])}
        onClose={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('[enabled]');
    expect(frame).toContain('[on]');
  });

  it('names the saved setting for a disabled transport too', () => {
    // The other half of the badge's ternary. Asserting only the enabled branch leaves the disabled
    // one uncovered by the change that rewrote both — the coverage gap HARNESS-122 was made of: a
    // mutation proves a case measures the guard, not that the cases reach across it.
    const { lastFrame } = render(
      <TransportTUI
        registry={registryWith(vi.fn().mockResolvedValue(undefined), [entry('ws', false)])}
        onClose={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('[disabled]');
    expect(frame).toContain('[off]');
  });
});

describe('TRANS-009: a failed save is reported, not swallowed', () => {
  it('renders the reason when the write fails', async () => {
    const registry = registryWith(vi.fn().mockRejectedValue(new Error('EACCES: settings.json')));
    const { stdin, lastFrame } = render(<TransportTUI registry={registry} onClose={vi.fn()} />);

    stdin.write(' ');
    await flush();

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Not saved');
    expect(frame).toContain('EACCES: settings.json');
  });

  it('reports a non-Error rejection rather than rendering nothing', async () => {
    // The branch that would otherwise print `undefined` — a rejection that is not an Error still has
    // to produce a sentence, because the user's question is whether their change took effect.
    const registry = registryWith(vi.fn().mockRejectedValue('nope'));
    const { stdin, lastFrame } = render(<TransportTUI registry={registry} onClose={vi.fn()} />);

    stdin.write(' ');
    await flush();

    expect(lastFrame() ?? '').toContain('could not save the setting');
  });

  // THE POSITIVE CONTROL. Without it the two cases above pass against a component that renders
  // "Not saved" unconditionally — which would be a worse defect than the one being fixed.
  it('shows no failure when the save succeeds', async () => {
    const registry = registryWith(vi.fn().mockResolvedValue(undefined));
    const { stdin, lastFrame } = render(<TransportTUI registry={registry} onClose={vi.fn()} />);

    stdin.write(' ');
    await flush();

    expect(lastFrame() ?? '').not.toContain('Not saved');
  });
});
