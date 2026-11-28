import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearRegisteredToolProfiles } from '@robota-sdk/agent-core';
import { runDurableRestart } from './durable-restart';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'roundtable-durable-example-'));
});
afterEach(async () => {
  clearRegisteredToolProfiles();
  await rm(directory, { recursive: true, force: true });
});

describe('durable loadRoundtable example', () => {
  it('continues after a restart without running the completed effect again', async () => {
    const run = await runDurableRestart(directory);

    // The first process was stopped after the booking ran and before its turn finished.
    expect(run.interrupted).toMatchObject({ status: 'cancelled' });
    expect(run.effectsBeforeRestart).toEqual({ 'booking-42': 1 });

    // The reloaded conversation finished from what was on disk, and the booking still ran once.
    expect(run.result).toMatchObject({ status: 'completed', reason: 'done' });
    expect(run.effects).toEqual({ 'booking-42': 1 });
    expect(run.transcript).toEqual([
      'clerk: Booked: confirmed booking-42',
      expect.stringMatching(/^auditor: Audit: /),
    ]);

    // Everything the ledger admitted is settled, the paid effect included.
    expect(run.usage.reservedCalls).toBe(0);
    expect(run.usage.toolEffects).toBe(1);

    // The state lives in files: the conversation and, under their own directory, the journals.
    expect((await readdir(directory)).sort()).toEqual(['conversations', 'journals']);
    expect(await readdir(join(directory, 'journals'))).toEqual(['recovery-journal']);
  });
});
