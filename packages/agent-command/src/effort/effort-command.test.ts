import { describe, expect, it, vi } from 'vitest';

import { executeEffortCommand } from './effort-command.js';

import { createTestCommandHost } from '@robota-sdk/agent-framework/testing';

describe('/effort', () => {
  it('applies a requested level and returns the complete resolution', async () => {
    const applyModelOptions = vi.fn();
    const writeSettings = vi.fn();
    const host = createTestCommandHost({
      session: { applyModelOptions },
      overrides: {
        getCommandHostAdapters: () => ({
          settings: { read: () => ({ theme: 'brief' }), write: writeSettings },
          effort: {
            getResolution: () => ({
              requested: 'high',
              effective: 'high',
              source: 'model-default',
              disposition: 'model-default',
              modelDefault: 'high',
            }),
            apply: async (selection) => ({
              requested: selection,
              effective: selection === 'auto' ? 'high' : selection,
              source: 'command',
              disposition: selection === 'auto' ? 'model-default' : 'applied',
              modelDefault: 'high',
            }),
          },
        }),
      },
    });

    const result = await executeEffortCommand(host, 'low');

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      effort: { requested: 'low', effective: 'low', source: 'command', disposition: 'applied' },
    });
    expect(applyModelOptions).not.toHaveBeenCalled();
    expect(writeSettings).toHaveBeenCalledWith({ theme: 'brief', effort: 'low' });
  });

  it('reports the current value without changing it when headless selection has no argument', async () => {
    const applyModelOptions = vi.fn();
    const host = createTestCommandHost({ session: { applyModelOptions } });

    const result = await executeEffortCommand(host, '');

    expect(result.success).toBe(true);
    expect(result.message).toContain('high');
    expect(applyModelOptions).not.toHaveBeenCalled();
  });

  it('reports an unadapted auto selection without treating auto as a concrete effective tier', async () => {
    const host = createTestCommandHost({
      session: { getModelEffort: () => 'auto' },
    });

    const result = await executeEffortCommand(host, '');

    expect(result.data).toMatchObject({
      effort: { requested: 'auto', effective: 'high', disposition: 'model-default' },
    });
  });

  it('removes a persisted explicit value when auto is selected', async () => {
    const writeSettings = vi.fn();
    const host = createTestCommandHost({
      overrides: {
        getCommandHostAdapters: () => ({
          settings: { read: () => ({ effort: 'low', theme: 'brief' }), write: writeSettings },
          effort: {
            getResolution: () => ({
              requested: 'low',
              effective: 'low',
              source: 'settings',
              disposition: 'applied',
              modelDefault: 'high',
            }),
            apply: async () => ({
              requested: 'auto',
              effective: 'high',
              source: 'command',
              disposition: 'model-default',
              modelDefault: 'high',
            }),
          },
        }),
      },
    });

    await executeEffortCommand(host, 'auto');

    expect(writeSettings).toHaveBeenCalledWith({ theme: 'brief' });
  });

  it('preserves auto in the session when no effort adapter is installed', async () => {
    const applyModelOptions = vi.fn();
    const host = createTestCommandHost({ session: { applyModelOptions } });

    const result = await executeEffortCommand(host, 'auto');

    expect(result.success).toBe(true);
    expect(applyModelOptions).toHaveBeenCalledWith({ effort: 'auto' });
  });

  it('leaves the live value and settings unchanged when the picker is cancelled', async () => {
    const applyModelOptions = vi.fn();
    const writeSettings = vi.fn();
    const host = createTestCommandHost({
      session: { applyModelOptions },
      overrides: {
        getUserInteraction: () => ({ ask: async () => ({ type: 'cancelled' }) }),
        getCommandHostAdapters: () => ({
          settings: { read: () => ({ effort: 'medium' }), write: writeSettings },
          effort: {
            getResolution: () => ({
              requested: 'medium',
              effective: 'medium',
              source: 'settings',
              disposition: 'applied',
              modelDefault: 'high',
            }),
            apply: vi.fn(),
          },
        }),
      },
    });

    const result = await executeEffortCommand(host, '');

    expect(result.success).toBe(true);
    expect(result.message).toContain('effective=medium');
    expect(applyModelOptions).not.toHaveBeenCalled();
    expect(writeSettings).not.toHaveBeenCalled();
  });
});
