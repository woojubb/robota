/**
 * CMD-004 Phase 2 Stage C (TC-04): the TUI is a pure renderer — the four UI screens open from the
 * requester-routed `ui_intent` session event (never from legacy `result.effects` branches), the
 * session title updates from the broadcast `session_renamed` event (never by the TUI mutating the
 * session), and the statusline re-reads its persisted settings when a command result arrives
 * (refresh-on-result — the HOST applies the patch; the TUI no longer writes settings).
 *
 * Red-first evidence: written against the pre-Stage-C hook (which still consumed legacy effects and
 * had no session subscription) — every behavioral case below failed there.
 */

import { Text } from 'ink';
import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useSideEffects } from '../hooks/useSideEffects.js';
import { useStatusLineSettings } from '../hooks/useStatusLineSettings.js';
import { TuiCliAdapterProvider } from '../tui-cli-adapter-context.js';

import type { IUseSideEffectsOptions, IUseSideEffectsResult } from '../hooks/side-effects-types.js';
import type { ITuiCliAdapter } from '../tui-cli-adapter.js';
import type { TUniversalValue } from '@robota-sdk/agent-core';

const FRAME_DEADLINE_MS = 3000;

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + FRAME_DEADLINE_MS;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(predicate()).toBe(true);
}

type TSessionListener = (payload: unknown) => void;

/** Minimal InteractiveSession stand-in: a typed event emitter (`on`/`off`/`emit`). */
class FakeSessionEmitter {
  private readonly listeners = new Map<string, Set<TSessionListener>>();

  on(event: string, handler: TSessionListener): void {
    const set = this.listeners.get(event) ?? new Set<TSessionListener>();
    set.add(handler);
    this.listeners.set(event, set);
  }

  off(event: string, handler: TSessionListener): void {
    this.listeners.get(event)?.delete(handler);
  }

  emit(event: string, payload: unknown): void {
    for (const handler of [...(this.listeners.get(event) ?? [])]) handler(payload);
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  setName = vi.fn();
  getName = (): string | undefined => undefined;
}

function fakeCliAdapter(store: () => Record<string, TUniversalValue>): ITuiCliAdapter {
  return {
    getUserSettingsPath: () => '/tmp/fake-settings.json',
    readSettings: () => store(),
    reloadPluginCommandSource: vi.fn(),
    applyActiveModelChange: vi.fn().mockReturnValue({ applied: true }),
    getGitBranch: vi.fn().mockReturnValue(undefined),
    getProviderDisplayName: vi.fn((type: string) => type),
  } as unknown as ITuiCliAdapter;
}

interface IHarness {
  session: FakeSessionEmitter;
  result: () => IUseSideEffectsResult;
  lastFrame: () => string | undefined;
  unmount: () => void;
  spies: {
    setSessionName: ReturnType<typeof vi.fn>;
    refreshStatusLineSettings: ReturnType<typeof vi.fn>;
    openAgentSwitcher: ReturnType<typeof vi.fn>;
    baseHandleSubmit: ReturnType<typeof vi.fn>;
  };
}

function mountHarness(): IHarness {
  const session = new FakeSessionEmitter();
  const spies = {
    setSessionName: vi.fn(),
    refreshStatusLineSettings: vi.fn(),
    openAgentSwitcher: vi.fn(),
    baseHandleSubmit: vi.fn(async () => {}),
  };
  const resultRef: { current: IUseSideEffectsResult | null } = { current: null };

  // Superset options object: carries both the pre-Stage-C fields (queue, addEntry, …) and the
  // Stage-C fields so the SAME test file compiled red (pre) and green (post).
  const options = {
    cwd: '/tmp',
    interactiveSession: session,
    commandEffectQueue: {
      enqueueEffects: () => undefined,
      drain: () => undefined,
      clear: () => undefined,
    },
    addEntry: vi.fn(),
    baseHandleSubmit: spies.baseHandleSubmit,
    setSessionName: spies.setSessionName,
    setStatusLineSettings: vi.fn(),
    refreshStatusLineSettings: spies.refreshStatusLineSettings,
    showSessionPickerOnStart: false,
    openAgentSwitcher: spies.openAgentSwitcher,
  } as unknown as IUseSideEffectsOptions;

  function Probe(): React.ReactElement {
    const state = useSideEffects(options);
    resultRef.current = state;
    return (
      <Text>
        {`plugin:${state.showPluginTUI ? 1 : 0} settings:${state.showTransportTUI ? 1 : 0} picker:${state.showSessionPicker ? 1 : 0}`}
      </Text>
    );
  }

  const instance = render(
    <TuiCliAdapterProvider value={fakeCliAdapter(() => ({}))}>
      <Probe />
    </TuiCliAdapterProvider>,
  );

  return {
    session,
    result: () => {
      if (!resultRef.current) throw new Error('useSideEffects result not captured');
      return resultRef.current;
    },
    lastFrame: instance.lastFrame,
    unmount: instance.unmount,
    spies,
  };
}

describe('ui_intent → TUI screens (requester-routed, CMD-004 Stage C)', () => {
  it('show-settings with the owner requester opens the settings screen', async () => {
    const h = mountHarness();
    h.session.emit('ui_intent', { intent: { type: 'show-settings' }, requesterDriverId: 'owner' });
    await waitUntil(() => (h.lastFrame() ?? '').includes('settings:1'));
    h.unmount();
  });

  it('show-plugin-manager with the owner requester opens the plugin screen', async () => {
    const h = mountHarness();
    h.session.emit('ui_intent', {
      intent: { type: 'show-plugin-manager' },
      requesterDriverId: 'owner',
    });
    await waitUntil(() => (h.lastFrame() ?? '').includes('plugin:1'));
    h.unmount();
  });

  it('show-session-picker with the owner requester opens the session picker', async () => {
    const h = mountHarness();
    h.session.emit('ui_intent', {
      intent: { type: 'show-session-picker' },
      requesterDriverId: 'owner',
    });
    await waitUntil(() => (h.lastFrame() ?? '').includes('picker:1'));
    h.unmount();
  });

  it('show-agent-switcher with the owner requester invokes the switcher callback', async () => {
    const h = mountHarness();
    h.session.emit('ui_intent', {
      intent: { type: 'show-agent-switcher' },
      requesterDriverId: 'owner',
    });
    await waitUntil(() => h.spies.openAgentSwitcher.mock.calls.length === 1);
    h.unmount();
  });

  it('an intent stamped with ANOTHER surface driver id is ignored (requester-routed)', async () => {
    const h = mountHarness();
    h.session.emit('ui_intent', {
      intent: { type: 'show-settings' },
      requesterDriverId: 'device-remote-1',
    });
    h.session.emit('ui_intent', {
      intent: { type: 'show-agent-switcher' },
      requesterDriverId: 'device-remote-1',
    });
    // Give the (wrong) render a chance to happen, then assert it did not.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.lastFrame()).toContain('settings:0');
    expect(h.spies.openAgentSwitcher).not.toHaveBeenCalled();
    h.unmount();
  });

  it('an unattributed intent (no requester id) is ignored by this surface', async () => {
    const h = mountHarness();
    h.session.emit('ui_intent', { intent: { type: 'show-settings' } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.lastFrame()).toContain('settings:0');
    h.unmount();
  });

  it('unmounting unsubscribes the ui_intent and session_renamed listeners', async () => {
    const h = mountHarness();
    await waitUntil(
      () =>
        h.session.listenerCount('ui_intent') === 1 &&
        h.session.listenerCount('session_renamed') === 1,
    );
    h.unmount();
    await waitUntil(
      () =>
        h.session.listenerCount('ui_intent') === 0 &&
        h.session.listenerCount('session_renamed') === 0,
    );
  });
});

describe('session_renamed broadcast → TUI title (CMD-004 Stage C / TC-10)', () => {
  it('updates the session name from the broadcast without mutating the session itself', async () => {
    const h = mountHarness();
    h.session.emit('session_renamed', { name: 'Renamed via broadcast' });
    await waitUntil(() => h.spies.setSessionName.mock.calls.length === 1);
    expect(h.spies.setSessionName).toHaveBeenCalledWith('Renamed via broadcast');
    // Pure renderer: the TUI reflects the host-executed rename; it never performs it.
    expect(h.session.setName).not.toHaveBeenCalled();
    h.unmount();
  });
});

describe('statusline refresh-on-result (CMD-004 Stage C)', () => {
  it('re-reads statusline settings after a slash-command result arrives', async () => {
    const h = mountHarness();
    await h.result().handleSubmit('/statusline off');
    expect(h.spies.baseHandleSubmit).toHaveBeenCalledWith('/statusline off');
    expect(h.spies.refreshStatusLineSettings).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  it('does not re-read for a plain (non-command) submit', async () => {
    const h = mountHarness();
    await h.result().handleSubmit('hello there');
    expect(h.spies.refreshStatusLineSettings).not.toHaveBeenCalled();
    h.unmount();
  });
});

describe('useStatusLineSettings exposes a from-disk refresh', () => {
  it('refresh() re-reads the persisted settings document', async () => {
    let doc: Record<string, TUniversalValue> = { statusline: { enabled: true, gitBranch: true } };
    const adapter = fakeCliAdapter(() => doc);
    const captured: {
      settings: { enabled: boolean; gitBranch: boolean } | null;
      refresh: (() => void) | null;
    } = { settings: null, refresh: null };

    function Probe(): React.ReactElement {
      const [settings, refresh] = useStatusLineSettings();
      captured.settings = settings;
      captured.refresh = refresh as unknown as () => void;
      return <Text>{`enabled:${settings.enabled ? 1 : 0}`}</Text>;
    }

    const instance = render(
      <TuiCliAdapterProvider value={adapter}>
        <Probe />
      </TuiCliAdapterProvider>,
    );
    await waitUntil(() => (instance.lastFrame() ?? '').includes('enabled:1'));

    // The HOST persisted a patch (Stage B applies it via the settings adapter); the TUI refreshes.
    doc = { statusline: { enabled: false, gitBranch: true } };
    captured.refresh?.();
    await waitUntil(() => (instance.lastFrame() ?? '').includes('enabled:0'));
    expect(captured.settings?.enabled).toBe(false);
    instance.unmount();
  });
});
