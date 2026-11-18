import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { startHarness } from './harness.js';

it.each([
  'claim',
  'claim-newer',
  'before-report',
  'after-report',
  'before-goal',
  'quiet',
  'damaged',
] as const)(
  'recovers an interrupted case run at %s',
  async (phase) => {
    if (process.platform === 'win32') return;
    const root = mkdtempSync(join(tmpdir(), 'personal-case-run-recovery-'));
    const harnessUrl = new URL('./harness.ts', import.meta.url).href;
    const program = `
      import fs from 'node:fs';
      const { startHarness } = await import(${JSON.stringify(harnessUrl)});
      const h = await startHarness({ stateDir: ${JSON.stringify(root)} });
      const { case: opened } = await h.capabilities.cases.open({ title: 'Question', noticed: 'A note', source: 'test:run-recovery' });
      const { item } = await h.capabilities.cases.ask(opened.id, { question: 'Continue?', options: ['Yes'] });
      const checkpoint = () => {
        fs.writeSync(1, 'READY:' + JSON.stringify({ caseId: opened.id }) + '\\n');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      };
      const store = h.capabilities.goals.store;
      const putGoal = store.putGoal.bind(store), putRun = store.putRun.bind(store), putFeed = store.putFeedItem.bind(store);
      store.putGoal = async goal => {
        if (goal.caseId === opened.id && ((['claim', 'claim-newer'].includes(${JSON.stringify(phase)}) && goal.status === 'running') ||
            (['before-goal', 'quiet'].includes(${JSON.stringify(phase)}) && goal.status === 'done'))) checkpoint();
        return putGoal(goal);
      };
      store.putRun = async run => {
        if (${JSON.stringify(phase)} === 'after-report' && run.caseReport === 'recorded') checkpoint();
        return putRun(run);
      };
      store.putFeedItem = async item => {
        if (${JSON.stringify(phase)} === 'before-report' && item.kind === 'report') checkpoint();
        return putFeed(item);
      };
      if (${JSON.stringify(phase)} === 'quiet') h.model.script(
        { tool: 'CaseNote', args: { id: opened.id, text: 'Handled in the case.' } }, { text: 'Done.' });
      else if (${JSON.stringify(phase)} === 'damaged') h.model.script(() => { checkpoint(); return { text: 'Done.' }; });
      else h.model.script({ text: 'Nothing else is needed.' });
      await h.capabilities.api({ method: 'POST', path: '/feed/' + item.id + '/answer',
        segments: ['feed', item.id, 'answer'], query: new URLSearchParams(), body: { choice: 'Yes' } });
    `;
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', program],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const ended = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    let errors = '';
    child.stderr!.on('data', (chunk: Buffer) => {
      errors += chunk.toString();
    });
    let second: Awaited<ReturnType<typeof startHarness>> | undefined;
    let third: Awaited<ReturnType<typeof startHarness>> | undefined;
    try {
      const ids = await new Promise<{ caseId: string }>((resolve, reject) => {
        let output = '';
        child.stdout!.on('data', (chunk: Buffer) => {
          output += chunk.toString();
          const match = /READY:(\{[^\n]+\})/u.exec(output);
          if (match !== null) resolve(JSON.parse(match[1]!));
        });
        child.once('exit', () =>
          reject(new Error(`owner exited before the checkpoint: ${errors}`)),
        );
        child.once('error', reject);
      });
      second = await startHarness({ stateDir: root });
      third = await startHarness({ stateDir: root });
      child.kill('SIGKILL');
      await ended;
      const goals = second.capabilities.goals;
      const goal = (await goals.list()).find((entry) => entry.caseId === ids.caseId)!;
      if (phase === 'damaged') {
        writeFileSync(join(root, 'goals', 'runs', `${goal.id}.json`), '{damaged');
        const other = await goals.create({ title: 'Other', instructions: 'Do unrelated work.' });
        second.model.script({ text: 'Finished the other goal.' });
        expect(await second.capabilities.runner()!.runDue()).toBe(1);
        await second.capabilities.runner()!.settled();
        expect((await goals.get(other.id))?.status).toBe('done');
        expect((await goals.get(goal.id))?.activeCaseRun).toBeDefined();
        await second.close();
        second = undefined;
        await third.close();
        third = undefined;
        const restarted = await startHarness({ stateDir: root });
        try {
          expect(await restarted.capabilities.runner()!.runDue()).toBe(0);
          expect((await restarted.capabilities.goals.get(goal.id))?.activeCaseRun).toBeDefined();
        } finally {
          await restarted.close();
        }
      } else if (phase === 'claim') {
        second.model.script({ text: 'The answer was reconsidered.' });
        expect(await second.capabilities.runner()!.runDue()).toBe(1);
        await second.capabilities.runner()!.settled();
        expect((await goals.runs(goal.id)).map((run) => run.outcome)).toEqual(
          expect.arrayContaining(['interrupted', 'done']),
        );
      } else if (phase === 'claim-newer') {
        const later = await second.capabilities.cases.ask(ids.caseId, {
          question: 'Another answer?',
          options: ['Yes'],
        });
        second.model.script({ text: 'The newer answer was handled.' });
        const answered = await second.capabilities.api({
          method: 'POST',
          path: `/feed/${later.item.id}/answer`,
          segments: ['feed', later.item.id, 'answer'],
          query: new URLSearchParams(),
          body: { choice: 'Yes' },
        });
        expect(answered.status).toBe(200);
        for (let attempt = 0; (await goals.runs(goal.id)).length < 2 && attempt < 200; attempt += 1)
          await new Promise((resolve) => setTimeout(resolve, 10));
        await second.capabilities.runner()!.settled();
        expect((await goals.runs(goal.id)).map((run) => run.outcome)).toEqual(
          expect.arrayContaining(['interrupted', 'done']),
        );
      } else {
        expect(await second.capabilities.runner()!.runDue()).toBe(0);
        expect((await goals.get(goal.id))?.status).toBe('done');
        const reports = (await goals.feed()).filter(
          (entry) => entry.goalId === goal.id && entry.kind === 'report',
        );
        expect(reports).toHaveLength(phase === 'quiet' ? 0 : 1);
        if (phase !== 'quiet') expect(reports[0]?.body).toBe('Nothing else is needed.');
        expect(second.model.requests).toHaveLength(0);
      }
      if (third !== undefined) expect(await third.capabilities.runner()!.runDue()).toBe(0);
    } finally {
      child.kill('SIGKILL');
      await ended;
      await second?.close();
      await third?.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
  20_000,
);
