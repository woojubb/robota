import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clearRegisteredToolProfiles } from '@robota-sdk/agent-core';
import { World, type KillPlan } from './recovery-drill';
import { createFileRecoveryJournals } from './node';
import {
  createIn,
  drive,
  expectRecovered,
  loadIn,
  plansFor,
  reference,
  scenarios,
  type MatrixScenario,
  type Reference,
  type SettledEffect,
} from './kill-matrix-harness';

/**
 * The kill matrix over the file journal: the same conversations, killed at sampled journal appends
 * and conversation writes, and recovered by a new process reading what the dead one left on disk.
 * Every generation opens its own journal handles over one temporary directory, so nothing but files
 * carries the journal from the killed process to its successor.
 */
const directories: string[] = [];

afterEach(async () => {
  clearRegisteredToolProfiles();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function recover(
  scenario: MatrixScenario,
  ref: Reference,
  plans: readonly KillPlan[],
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'roundtable-file-journal-'));
  directories.push(root);
  const world = new World(() => createFileRecoveryJournals(root).journal);
  const settled: SettledEffect[] = [];
  let gen = world.generation(plans[0]);
  let room = createIn(scenario, gen);
  let out = await drive(world, gen, room, 'value', settled);
  expect(out.killed).toBe(true);
  for (const plan of [...plans.slice(1), undefined]) {
    gen = world.generation(plan);
    room = await loadIn(scenario, gen);
    out = await drive(world, gen, room, 'value', settled);
    if (!out.killed) break;
  }
  if (out.killed) throw new Error('The final generation was killed');
  await new Promise((resolve) => setImmediate(resolve));
  expectRecovered({ ref, world, room, result: out.result, settled });
  // The journal the recovery read was on disk, not in the world's memory.
  expect(world.journals.size).toBe(0);
  expect((await readdir(root)).length).toBeGreaterThan(0);
  await room.dispose();
  world.teardown();
  await new Promise((resolve) => setImmediate(resolve));
}

/** Kills spread over the run, and the journal's own first and last appends. */
function sampled(ref: Reference): KillPlan[] {
  const plans = plansFor(ref);
  return [
    ...[0.25, 0.5, 0.75].map((at) => plans[Math.floor(plans.length * at)]!),
    { at: 'append', k: 0, written: true },
    { at: 'append', k: 0, written: false },
    { at: 'append', k: ref.appends - 1, written: true },
  ];
}

describe.each(scenarios.map((scenario) => [scenario.name, scenario] as const))(
  'file journal drill: %s',
  (_name, scenario) => {
    it('recovers from kills spread over the run and at the journal ends', async () => {
      const ref = await reference(scenario);
      for (const plan of sampled(ref)) await recover(scenario, ref, [plan]);
    }, 60_000);

    it('recovers when the recovery itself is killed again', async () => {
      const ref = await reference(scenario);
      const plans = plansFor(ref);
      const first = plans[Math.floor(plans.length / 2)]!;
      await recover(scenario, ref, [first, { at: 'append', k: 1, written: true }]);
      await recover(scenario, ref, [first, { at: 'append', k: 2, written: false }]);
    }, 60_000);
  },
);
