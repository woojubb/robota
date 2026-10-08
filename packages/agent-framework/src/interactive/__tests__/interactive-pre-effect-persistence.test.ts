import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { describe, expect, it, vi } from 'vitest';

import { InteractiveSession } from '../interactive-session.js';

import type { IInteractiveSessionRecord, IInteractiveSessionStore } from '@robota-sdk/agent-interface-session';
import type { IToolWithEventService } from '@robota-sdk/agent-core';

describe('composed interactive pre-effect persistence', () => {
  it('saves the user turn before the provider and the original tool call before its body', async () => {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'interactive-pre-effect-')));
    const records = new Map<string, IInteractiveSessionRecord>();
    const snapshots: Array<{ at: 'provider' | 'tool'; record?: IInteractiveSessionRecord }> = [];
    const snapshot = (at: 'provider' | 'tool'): void => {
      const record = [...records.values()][0];
      snapshots.push({ at, ...(record ? { record: structuredClone(record) } : {}) });
    };
    const store: IInteractiveSessionStore = {
      save: (record) => { records.set(record.id, record); },
      load: (id) => {
        const record = records.get(id);
        return record ? { status: 'valid', record } : { status: 'missing' };
      },
      list: () => [], delete: (id) => { records.delete(id); },
    };
    const scripted = createScriptedProvider([
      { toolCalls: [{ name: 'Probe', args: { value: 'once' } }] },
      { text: 'finished' },
    ]);
    const provider = { ...scripted.provider,
      chat: async (...args: Parameters<typeof scripted.provider.chat>) => {
        snapshot('provider');
        return scripted.provider.chat(...args);
      },
    };
    const tool: IToolWithEventService = {
      schema: { name: 'Probe', description: 'Records one local effect', parameters: { type: 'object', properties: {
        value: { type: 'string' },
      } } },
      getName: () => 'Probe', getDescription: () => 'Records one local effect',
      validate: () => true, validateParameters: () => ({ isValid: true, errors: [] }),
      setEventService: () => {},
      execute: async () => { snapshot('tool'); return { success: true, data: 'done' }; },
    };
    const session = new InteractiveSession({ cwd, provider, bare: true, permissionMode: 'bypassPermissions',
      sessionStore: store, defaultTools: [], additionalTools: [tool] });
    try {
      const turn = await session.submit('run once');
      await turn.completed;
      const firstProvider = snapshots.find((entry) => entry.at === 'provider');
      expect(firstProvider?.record?.messages?.some((message) => message.role === 'user' && message.content === 'run once')).toBe(true);
      const atTool = snapshots.find((entry) => entry.at === 'tool');
      expect(atTool?.record?.messages?.some((message) => message.role === 'assistant' &&
        message.toolCalls?.[0]?.id === 'scripted-call-1-0')).toBe(true);
      expect(snapshots.filter((entry) => entry.at === 'tool')).toHaveLength(1);
    } finally {
      await session.shutdown();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('allows an interactive tool turn with persistence disabled', async () => {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'interactive-no-persistence-')));
    const scripted = createScriptedProvider([
      { toolCalls: [{ name: 'Probe', args: {} }] }, { text: 'finished' },
    ]);
    const execute = vi.fn(async () => ({ success: true, data: 'done' }));
    const tool: IToolWithEventService = {
      schema: { name: 'Probe', description: 'Local probe', parameters: { type: 'object', properties: {} } },
      getName: () => 'Probe', getDescription: () => 'Local probe',
      validate: () => true, validateParameters: () => ({ isValid: true, errors: [] }),
      setEventService: () => {}, execute,
    };
    const session = new InteractiveSession({ cwd, provider: scripted.provider, bare: true,
      permissionMode: 'bypassPermissions', defaultTools: [], additionalTools: [tool] });
    try {
      const turn = await session.submit('run once');
      await turn.completed;
      expect(execute).toHaveBeenCalledTimes(1);
    } finally {
      await session.shutdown();
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
