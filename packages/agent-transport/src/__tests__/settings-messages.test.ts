/**
 * #3282 §4a: the GUI Settings screen reads and writes through `get-settings`/`update-settings`,
 * correlated by `requestId` and answered by `settings` or `settings_error` — the same request/error
 * shape as `get-personal-usage-report`. The host-owned reporter decides what a read or write means;
 * this layer only correlates and carries the result.
 */

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { describe, expect, it, vi } from 'vitest';

import { createOutboundDelivery } from '../outbound-delivery.js';
import { createSessionMessageHandler } from '../session-message-handler.js';

import type { ISettingsReporter, TSettingsUpdateOutcome } from '../settings-messages.js';
import type { TClientMessage, TServerMessage } from '../wire-messages.js';
import type { ISettingsSnapshot } from '@robota-sdk/agent-interface-session';

const snapshot: ISettingsSnapshot = {
  language: { current: 'en', recommended: [], appliesNote: 'Takes effect after a restart.' },
  outputStyle: { current: 'default', choices: [] },
  preset: { current: 'default', choices: [], skipsAllChecksPresetIds: [] },
  permissionMode: { current: 'default', choices: [], skipsAllChecksMode: 'bypassPermissions' },
  permissionRules: [],
  sandbox: { enabled: true, available: true, description: 'Confines shell commands.' },
  mcp: { servers: [] },
  plugins: { plugins: [], canInstall: true },
  providers: { profiles: [] },
};

function createReporter(overrides: Partial<ISettingsReporter> = {}): ISettingsReporter {
  return {
    getSettings: vi.fn(() => snapshot),
    updateSettings: vi.fn(
      (): TSettingsUpdateOutcome => ({ ok: true, settings: snapshot }),
    ),
    ...overrides,
  };
}

function attach(
  options: {
    reporter?: ISettingsReporter;
    role?: 'drive' | 'observe';
    commandSurfaceLocality?: 'local' | 'remote';
  } = {},
): {
  sent: TServerMessage[];
  send: (message: TClientMessage) => void;
} {
  const sent: TServerMessage[] = [];
  const { onMessage } = createSessionMessageHandler({
    session: createTestInteractiveSession(),
    deliver: createOutboundDelivery((message) => sent.push(message), vi.fn()),
    ...(options.reporter ? { settingsReporter: options.reporter } : {}),
    ...(options.role ? { role: options.role } : {}),
    ...(options.commandSurfaceLocality
      ? { commandSurfaceLocality: options.commandSurfaceLocality }
      : {}),
  });
  return { sent, send: (message) => onMessage(JSON.stringify(message)) };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('settings messages (#3282 §4a)', () => {
  it('answers get-settings with the reporter snapshot, correlated by requestId', async () => {
    const reporter = createReporter();
    const client = attach({ reporter });
    client.send({ type: 'get-settings', requestId: 'r1' });
    await flush();
    expect(client.sent).toEqual([{ type: 'settings', requestId: 'r1', settings: snapshot }]);
  });

  it('answers not_available when the host has no settings reporter', async () => {
    const client = attach({});
    client.send({ type: 'get-settings', requestId: 'r1' });
    await flush();
    expect(client.sent).toEqual([
      {
        type: 'settings_error',
        requestId: 'r1',
        code: 'not_available',
        message: 'Settings are not available on this host.',
      },
    ]);
  });

  it('applies a patch through the reporter and answers with the fresh snapshot', async () => {
    const reporter = createReporter();
    const client = attach({ reporter });
    const patch = { field: 'outputStyle' as const, styleId: 'concise' };
    client.send({ type: 'update-settings', requestId: 'r2', patch });
    await flush();
    expect(reporter.updateSettings).toHaveBeenCalledOnce();
    expect(vi.mocked(reporter.updateSettings).mock.calls[0]?.[1]).toEqual(patch);
    expect(client.sent).toEqual([{ type: 'settings', requestId: 'r2', settings: snapshot }]);
  });

  it('reports a refused patch as settings_error with the reporter code and message, writing nothing', async () => {
    const reporter = createReporter({
      updateSettings: vi.fn(
        (): TSettingsUpdateOutcome => ({
          ok: false,
          code: 'refused',
          message: 'Entering "bypassPermissions" is blocked for this workspace.',
        }),
      ),
    });
    const client = attach({ reporter });
    client.send({
      type: 'update-settings',
      requestId: 'r3',
      patch: { field: 'permissionMode', mode: 'bypassPermissions' },
    });
    await flush();
    expect(client.sent).toEqual([
      {
        type: 'settings_error',
        requestId: 'r3',
        code: 'refused',
        message: 'Entering "bypassPermissions" is blocked for this workspace.',
      },
    ]);
  });

  it('reports a thrown error from the reporter as update_failed', async () => {
    const reporter = createReporter({
      updateSettings: vi.fn(() => {
        throw new Error('disk full');
      }),
    });
    const client = attach({ reporter });
    client.send({
      type: 'update-settings',
      requestId: 'r4',
      patch: { field: 'language', language: 'ko' },
    });
    await flush();
    expect(client.sent).toEqual([
      { type: 'settings_error', requestId: 'r4', code: 'update_failed', message: 'disk full' },
    ]);
  });

  it('lets an observer read settings but never write them', async () => {
    const reporter = createReporter();
    const observer = attach({ reporter, role: 'observe' });
    observer.send({ type: 'get-settings', requestId: 'r5' });
    observer.send({
      type: 'update-settings',
      requestId: 'r6',
      patch: { field: 'sandbox', enabled: false },
    });
    await flush();
    // The observer-role refusal is synchronous; the reporter's (possibly async) snapshot reply is
    // not, so it lands second even though `get-settings` was sent first.
    expect(observer.sent).toEqual([
      { type: 'protocol_error', message: 'Not permitted for an observer: update-settings' },
      { type: 'settings', requestId: 'r5', settings: snapshot },
    ]);
    expect(reporter.updateSettings).not.toHaveBeenCalled();
  });

  it('forwards this carrier\'s commandSurfaceLocality to both a read and a write (#3282 §4 part b-2)', async () => {
    const reporter = createReporter();
    const client = attach({ reporter, commandSurfaceLocality: 'remote' });
    client.send({ type: 'get-settings', requestId: 'r7' });
    client.send({
      type: 'update-settings',
      requestId: 'r8',
      patch: { field: 'reloadMcpServers' },
    });
    await flush();
    expect(vi.mocked(reporter.getSettings).mock.calls[0]?.[1]).toBe('remote');
    expect(vi.mocked(reporter.updateSettings).mock.calls[0]?.[2]).toBe('remote');
  });

  it.each([
    { field: 'mcpServerEnabled', serverId: 'docs', enabled: false },
    { field: 'reloadMcpServers' },
    { field: 'pluginEnabled', pluginId: 'formatter@fixture-agent', enabled: true },
    { field: 'reloadPlugins' },
    { field: 'installPlugin', pluginId: 'linter@fixture-agent' },
    { field: 'uninstallPlugin', pluginId: 'formatter@fixture-agent' },
  ] as const)('round-trips the $field patch through the reporter', async (patch) => {
    const reporter = createReporter();
    const client = attach({ reporter });
    client.send({ type: 'update-settings', requestId: 'rt', patch });
    await flush();
    expect(reporter.updateSettings).toHaveBeenCalledOnce();
    expect(vi.mocked(reporter.updateSettings).mock.calls[0]?.[1]).toEqual(patch);
    expect(client.sent).toEqual([{ type: 'settings', requestId: 'rt', settings: snapshot }]);
  });
});
