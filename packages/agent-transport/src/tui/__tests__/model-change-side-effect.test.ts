import { describe, expect, it } from 'vitest';
import type { IHistoryEntry, TSessionEndReason } from '@robota-sdk/agent-core';
import {
  addModelChangeCancelledMessage,
  applyConfirmedModelChange,
  formatModelChangeConfirmationMessage,
} from '../hooks/model-change-side-effect.js';

interface IShutdownCall {
  reason: TSessionEndReason;
  message: string;
}

interface IModelChangeCall {
  cwd: string;
  modelId: string;
  options?: { providerOverride?: string };
}

function entryContent(entry: IHistoryEntry): string {
  return (entry.data as { content: string }).content;
}

describe('model change side effect', () => {
  it('persists the selected model for the active provider override before exiting', () => {
    const entries: IHistoryEntry[] = [];
    const shutdowns: IShutdownCall[] = [];
    const calls: IModelChangeCall[] = [];
    const applyModelChange = (
      cwd: string,
      modelId: string,
      options?: { providerOverride?: string },
    ): { applied: boolean } => {
      calls.push({ cwd, modelId, ...(options !== undefined && { options }) });
      return { applied: true };
    };

    applyConfirmedModelChange({
      cwd: '/tmp/project',
      modelId: 'gpt-4.1',
      providerOverride: 'openai',
      addEntry: (entry) => entries.push(entry),
      requestShutdown: (reason, message) => shutdowns.push({ reason, message }),
      applyModelChange,
    });

    expect(calls).toEqual([
      {
        cwd: '/tmp/project',
        modelId: 'gpt-4.1',
        options: { providerOverride: 'openai' },
      },
    ]);
    expect(entryContent(entries[0]!)).toBe(
      'Model changed to gpt-4.1. Exiting so the next session uses it.',
    );
    expect(shutdowns).toEqual([{ reason: 'other', message: 'Model change applied' }]);
  });

  it('does not exit when persistence fails', () => {
    const entries: IHistoryEntry[] = [];
    const shutdowns: IShutdownCall[] = [];

    applyConfirmedModelChange({
      cwd: '/tmp/project',
      modelId: 'gpt-4.1',
      addEntry: (entry) => entries.push(entry),
      requestShutdown: (reason, message) => shutdowns.push({ reason, message }),
      applyModelChange: () => {
        throw new Error('settings write failed');
      },
    });

    expect(entryContent(entries[0]!)).toBe('Failed: settings write failed');
    expect(shutdowns).toEqual([]);
  });

  it('reports cancellation without applying settings or exiting', () => {
    const entries: IHistoryEntry[] = [];

    addModelChangeCancelledMessage((entry) => entries.push(entry));

    expect(entryContent(entries[0]!)).toBe('Model change cancelled.');
  });

  it('describes model changes as an exit for the next session', () => {
    expect(formatModelChangeConfirmationMessage('gpt-4.1')).toBe(
      'Change model to gpt-4.1? This will exit the current session so the next session uses it.',
    );
  });
});
