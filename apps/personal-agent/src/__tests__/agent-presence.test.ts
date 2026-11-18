import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { createAgentPresence } from '../agent-presence.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

it('recovers only when no other agent may still own a prompt', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-presence-'));
  directories.push(root);
  const first = createAgentPresence(root);
  const second = createAgentPresence(root);
  const third = createAgentPresence(root);
  const recover = vi.fn(async () => undefined);
  try {
    await first.enter(recover);
    await second.enter(recover);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(first.others()).toBe(true);
    expect(second.others()).toBe(true);
    first.close();
    expect(second.others()).toBe(false);
    second.close();
    await third.enter(recover);
    expect(recover).toHaveBeenCalledTimes(2);
  } finally {
    first.close();
    second.close();
    third.close();
  }
});

it.each(['run', 'answer'] as const)(
  'recovers an orphaned goal after its owning process exits: %s',
  async (trigger) => {
    if (process.platform === 'win32') return;
    const { spawn } = await import('node:child_process');
    const { startHarness } = await import('./harness.js');
    const root = mkdtempSync(join(tmpdir(), 'personal-presence-process-'));
    directories.push(root);
    const harnessUrl = new URL('./harness.ts', import.meta.url).href;
    const program = `
      import fs from 'node:fs';
      const { startHarness } = await import(${JSON.stringify(harnessUrl)});
      const h = await startHarness({ stateDir: ${JSON.stringify(root)} });
      h.model.script({ tool: 'ConnectorAct', args: {
        connector: 'connector-test', tool: 'send', argumentsJson: '{}' } });
      const goal = await h.capabilities.goals.create({ title: 'Pending', instructions: 'Send.' });
      await h.capabilities.runner().runDue();
      for (let i = 0; i < 200; i += 1) {
        const item = (await h.capabilities.goals.feed()).find(x => x.approval?.state === 'pending');
        if (item && (await h.capabilities.goals.get(goal.id))?.status === 'waiting') {
          fs.writeSync(1, 'READY:' + JSON.stringify({ goal: goal.id, approval: item.id }) + '\\n');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error('approval did not start');
    `;
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', program],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    const ended = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    let other: Awaited<ReturnType<typeof startHarness>> | undefined;
    try {
      const ids = await new Promise<{ goal: string; approval: string }>((resolve, reject) => {
        let output = '';
        child.stdout!.on('data', (chunk: Buffer) => {
          output += chunk.toString();
          const match = /READY:(\{[^\n]+\})/u.exec(output);
          if (match !== null) resolve(JSON.parse(match[1]!));
        });
        child.once('exit', () => reject(new Error('the owner exited before its prompt')));
        child.once('error', reject);
      });
      other = await startHarness({ stateDir: root });
      const goals = other.capabilities.goals;
      const runner = other.capabilities.runner()!;
      expect((await goals.get(ids.goal))?.status).toBe('waiting');
      expect((await goals.feedItem(ids.approval))?.approval?.state).toBe('pending');
      child.kill('SIGKILL');
      await ended;
      if (trigger === 'answer') {
        expect((await runner.answer(ids.approval, true)).approval?.state).toBe('expired');
        expect((await goals.get(ids.goal))?.status).toBe('active');
      }
      other.model.script({ text: 'The interrupted work can be reviewed again.' });
      expect(await runner.runDue()).toBe(1);
      await runner.settled();
      expect((await goals.feedItem(ids.approval))?.approval?.state).toBe('expired');
      expect((await goals.runs(ids.goal)).some((run) => run.outcome === 'interrupted')).toBe(true);
    } finally {
      child.kill('SIGKILL');
      await ended;
      await other?.close();
    }
  },
  20_000,
);

it('adopts a stopped owner’s pending answer while other agents remain active', async () => {
  if (process.platform === 'win32') return;
  const { spawn } = await import('node:child_process');
  const { startHarness } = await import('./harness.js');
  const { offeredTools } = await import('./scripted-model.js');
  const root = mkdtempSync(join(tmpdir(), 'personal-answer-owner-'));
  directories.push(root);
  const harnessUrl = new URL('./harness.ts', import.meta.url).href;
  const program = `
    import fs from 'node:fs';
    const { startHarness } = await import(${JSON.stringify(harnessUrl)});
    const h = await startHarness({ stateDir: ${JSON.stringify(root)} });
    h.capabilities.runner().runDue = async () => 0;
    const { case: opened } = await h.capabilities.cases.open({ title: 'Answer', noticed: 'A note', source: 'test:owner' });
    const { item } = await h.capabilities.cases.ask(opened.id, { question: 'Continue?', options: ['Yes', 'No'] });
    await h.capabilities.api({ method: 'POST', path: '/feed/' + item.id + '/answer',
      segments: ['feed', item.id, 'answer'], query: new URLSearchParams(), body: { choice: 'Yes' } });
    fs.writeSync(1, 'READY:' + JSON.stringify({ caseId: opened.id, feedId: item.id }) + '\\n');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  `;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', program], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const ended = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  let second: Awaited<ReturnType<typeof startHarness>> | undefined;
  let third: Awaited<ReturnType<typeof startHarness>> | undefined;
  try {
    const ids = await new Promise<{ caseId: string; feedId: string }>((resolve, reject) => {
      let output = '';
      child.stdout!.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        const match = /READY:(\{[^\n]+\})/u.exec(output);
        if (match !== null) resolve(JSON.parse(match[1]!));
      });
      child.once('exit', () => reject(new Error('the owner exited before its answer')));
      child.once('error', reject);
    });
    second = await startHarness({ stateDir: root });
    third = await startHarness({ stateDir: root });
    expect(await second.capabilities.runner()!.runDue()).toBe(0);
    child.kill('SIGKILL');
    await ended;
    second.model.script({ text: 'The interrupted answer is handled read-only.' });
    expect(await second.capabilities.runner()!.runDue()).toBe(1);
    await second.capabilities.runner()!.settled();
    const goal = (await second.capabilities.goals.list()).find(
      (entry) => entry.caseId === ids.caseId,
    )!;
    expect(await second.capabilities.goals.runs(goal.id)).toHaveLength(1);
    expect(offeredTools(second.model.requests[0]!)).not.toContain('ConnectorAct');
    expect(await third.capabilities.runner()!.runDue()).toBe(0);
  } finally {
    child.kill('SIGKILL');
    await ended;
    await second?.close();
    await third?.close();
  }
}, 20_000);

it('adopts a normally closed owner’s pending answer while other agents remain active', async () => {
  const { startHarness } = await import('./harness.js');
  const { offeredTools } = await import('./scripted-model.js');
  const root = mkdtempSync(join(tmpdir(), 'personal-answer-close-'));
  directories.push(root);
  const first = await startHarness({ stateDir: root });
  const second = await startHarness({ stateDir: root });
  const third = await startHarness({ stateDir: root });
  let firstClosed = false;
  try {
    vi.spyOn(first.capabilities.runner()!, 'runDue').mockResolvedValue(0);
    const { case: opened } = await first.capabilities.cases.open({
      title: 'Answer',
      noticed: 'A note',
      source: 'test:close-owner',
    });
    const { item } = await first.capabilities.cases.ask(opened.id, {
      question: 'Continue?',
      options: ['Yes', 'No'],
    });
    const answered = await first.capabilities.api({
      method: 'POST',
      path: `/feed/${item.id}/answer`,
      segments: ['feed', item.id, 'answer'],
      query: new URLSearchParams(),
      body: { choice: 'Yes' },
    });
    expect(answered.status).toBe(200);
    await first.close();
    firstClosed = true;
    second.model.script({ text: 'The previous owner closed.' });
    expect(await second.capabilities.runner()!.runDue()).toBe(1);
    await second.capabilities.runner()!.settled();
    const goal = (await second.capabilities.goals.list()).find(
      (entry) => entry.caseId === opened.id,
    )!;
    expect(await second.capabilities.goals.runs(goal.id)).toHaveLength(1);
    expect(offeredTools(second.model.requests[0]!)).not.toContain('ConnectorAct');
    expect(await third.capabilities.runner()!.runDue()).toBe(0);
  } finally {
    if (!firstClosed) await first.close();
    await second.close();
    await third.close();
  }
}, 20_000);

it('adopts an unqueued answer after its owner closes normally', async () => {
  if (process.platform === 'win32') return;
  const { startHarness } = await import('./harness.js');
  const { offeredTools } = await import('./scripted-model.js');
  const root = mkdtempSync(join(tmpdir(), 'personal-answer-close-unqueued-'));
  directories.push(root);
  const first = await startHarness({ stateDir: root });
  const second = await startHarness({ stateDir: root });
  const third = await startHarness({ stateDir: root });
  let firstClosed = false;
  try {
    vi.spyOn(first.capabilities.runner()!, 'runDue').mockResolvedValue(0);
    vi.spyOn(first.capabilities.goals, 'enqueueCaseAnswer').mockRejectedValue(
      new Error('unavailable'),
    );
    const { case: opened } = await first.capabilities.cases.open({
      title: 'Answer',
      noticed: 'A note',
      source: 'test:close-unqueued',
    });
    const { item } = await first.capabilities.cases.ask(opened.id, {
      question: 'Continue?',
      options: ['Yes', 'No'],
    });
    const answered = await first.capabilities.api({
      method: 'POST',
      path: `/feed/${item.id}/answer`,
      segments: ['feed', item.id, 'answer'],
      query: new URLSearchParams(),
      body: { choice: 'Yes' },
    });
    expect(answered.status).toBe(200);
    expect(await first.capabilities.goals.list()).toEqual([]);
    await first.close();
    firstClosed = true;
    second.model.script({ text: 'The previous owner closed.' });
    expect(await second.capabilities.runner()!.runDue()).toBe(1);
    await second.capabilities.runner()!.settled();
    const goal = (await second.capabilities.goals.list()).find(
      (entry) => entry.caseId === opened.id,
    )!;
    expect(await second.capabilities.goals.runs(goal.id)).toHaveLength(1);
    expect(offeredTools(second.model.requests[0]!)).not.toContain('ConnectorAct');
    expect(await third.capabilities.runner()!.runDue()).toBe(0);
  } finally {
    if (!firstClosed) await first.close();
    await second.close();
    await third.close();
  }
}, 20_000);

it('retains owner shutdown evidence when another agent queues its answer first', async () => {
  if (process.platform === 'win32') return;
  const { startHarness } = await import('./harness.js');
  const root = mkdtempSync(join(tmpdir(), 'personal-answer-close-recovered-'));
  directories.push(root);
  const first = await startHarness({ stateDir: root });
  const second = await startHarness({ stateDir: root });
  const third = await startHarness({ stateDir: root });
  let firstClosed = false;
  try {
    vi.spyOn(first.capabilities.runner()!, 'runDue').mockResolvedValue(0);
    const failure = vi
      .spyOn(first.capabilities.goals, 'enqueueCaseAnswer')
      .mockRejectedValue(new Error('unavailable'));
    const { case: opened } = await first.capabilities.cases.open({
      title: 'Answer',
      noticed: 'A note',
      source: 'test:close-recovered',
    });
    const { item } = await first.capabilities.cases.ask(opened.id, {
      question: 'Continue?',
      options: ['Yes', 'No'],
    });
    const answered = await first.capabilities.api({
      method: 'POST',
      path: `/feed/${item.id}/answer`,
      segments: ['feed', item.id, 'answer'],
      query: new URLSearchParams(),
      body: { choice: 'Yes' },
    });
    expect(answered.status).toBe(200);
    failure.mockRestore();
    expect(await second.capabilities.runner()!.runDue()).toBe(0);
    expect(
      (await second.capabilities.goals.list()).find((goal) => goal.caseId === opened.id)
        ?.pendingCaseAnswer,
    ).toBeDefined();
    await first.close();
    firstClosed = true;
    expect(await second.capabilities.runner()!.runDue()).toBe(1);
    await second.capabilities.runner()!.settled();
    expect(await third.capabilities.runner()!.runDue()).toBe(0);
  } finally {
    if (!firstClosed) await first.close();
    await second.close();
    await third.close();
  }
}, 20_000);

it('drains an answer already being recorded before marking its owner stopped', async () => {
  if (process.platform === 'win32') return;
  const { startHarness } = await import('./harness.js');
  const root = mkdtempSync(join(tmpdir(), 'personal-answer-close-inflight-'));
  directories.push(root);
  const first = await startHarness({ stateDir: root });
  const second = await startHarness({ stateDir: root });
  const third = await startHarness({ stateDir: root });
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let closing: Promise<void> | undefined;
  try {
    vi.spyOn(first.capabilities.runner()!, 'runDue').mockResolvedValue(0);
    const goals = first.capabilities.goals;
    const save = goals.answerQuestion.bind(goals);
    vi.spyOn(goals, 'answerQuestion').mockImplementation(async (...args) => {
      reached();
      await gate;
      return save(...args);
    });
    const { case: opened } = await first.capabilities.cases.open({
      title: 'Answer',
      noticed: 'A note',
      source: 'test:close-inflight',
    });
    const { item } = await first.capabilities.cases.ask(opened.id, {
      question: 'Continue?',
      options: ['Yes', 'No'],
    });
    const answer = first.capabilities.api({
      method: 'POST',
      path: `/feed/${item.id}/answer`,
      segments: ['feed', item.id, 'answer'],
      query: new URLSearchParams(),
      body: { choice: 'Yes' },
    });
    await waiting;
    closing = first.close();
    const refused = await first.capabilities.api({
      method: 'GET',
      path: '/feed',
      segments: ['feed'],
      query: new URLSearchParams(),
      body: undefined,
    });
    expect(refused.status).toBe(503);
    expect(
      await Promise.race([
        closing.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 50)),
      ]),
    ).toBe(false);
    release();
    expect((await answer).status).toBe(200);
    await closing;
    expect(await second.capabilities.runner()!.runDue()).toBe(1);
    await second.capabilities.runner()!.settled();
    expect(await third.capabilities.runner()!.runDue()).toBe(0);
  } finally {
    release();
    if (closing === undefined) closing = first.close();
    await closing;
    await second.close();
    await third.close();
  }
}, 20_000);

it('cancels an approval being recorded as shutdown starts', async () => {
  const { startHarness } = await import('./harness.js');
  const root = mkdtempSync(join(tmpdir(), 'personal-shutdown-approval-'));
  directories.push(root);
  const first = await startHarness({ stateDir: root });
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let closing: Promise<void> | undefined;
  try {
    first.model.script({
      tool: 'ConnectorAct',
      args: {
        connector: 'connector-test',
        tool: 'send',
        argumentsJson: '{}',
      },
    });
    const goals = first.capabilities.goals;
    await goals.create({ title: 'Pending action', instructions: 'Send.' });
    await first.capabilities.runner()!.runDue();
    let approval = (await goals.feed()).find((item) => item.approval?.state === 'pending');
    for (let attempt = 0; approval === undefined && attempt < 200; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      approval = (await goals.feed()).find((item) => item.approval?.state === 'pending');
    }
    expect(approval).toBeDefined();
    const save = goals.setApproval.bind(goals);
    vi.spyOn(goals, 'setApproval').mockImplementation(async (id, state) => {
      const result = await save(id, state);
      if (id === approval!.id && state === 'approved') {
        reached();
        await gate;
      }
      return result;
    });
    const answering = first.capabilities.api({
      method: 'POST',
      path: `/feed/${approval!.id}/approve`,
      segments: ['feed', approval!.id, 'approve'],
      query: new URLSearchParams(),
      body: {},
    });
    await waiting;
    closing = first.close();
    release();
    expect((await answering).status).toBe(400);
    await closing;
    expect((await goals.feedItem(approval!.id))?.approval?.state).toBe('expired');
  } finally {
    release();
    if (closing === undefined) closing = first.close();
    await closing;
  }
}, 20_000);

it('does not delay shutdown on an unrelated slow API read', async () => {
  const { startHarness } = await import('./harness.js');
  const first = await startHarness();
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const goals = first.capabilities.goals;
  const feed = goals.feed.bind(goals);
  vi.spyOn(goals, 'feed').mockImplementation(async () => {
    reached();
    await gate;
    return feed();
  });
  let closing: Promise<void> | undefined;
  let reading: Promise<unknown> | undefined;
  try {
    reading = first.capabilities.api({
      method: 'GET',
      path: '/feed',
      segments: ['feed'],
      query: new URLSearchParams(),
      body: undefined,
    });
    await waiting;
    closing = first.close();
    expect(
      await Promise.race([
        closing.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 1_000)),
      ]),
    ).toBe(true);
  } finally {
    release();
    await reading;
    if (closing === undefined) closing = first.close();
    await closing;
  }
}, 15_000);

it('serializes goal recovery with a concurrent schedule change', async () => {
  const { startHarness } = await import('./harness.js');
  const first = await startHarness();
  const second = await startHarness({ stateDir: first.stateDir });
  const { goals } = first.capabilities;
  const goal = await goals.create({ title: 'Watch', instructions: 'Check.', everyMinutes: 10 });
  await goals.startRun(goal.id);
  await goals.setWaiting(goal.id, true);
  const store = (
    goals as unknown as { store: import('@robota-sdk/agent-product/personal').IGoalStore }
  ).store;
  const listFeed = store.listFeed.bind(store);
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const spy = vi.spyOn(store, 'listFeed').mockImplementation(async (limit) => {
    reached();
    await gate;
    return listFeed(limit);
  });
  const recovering = goals.recoverGoal(goal.id);
  let change: Promise<unknown> | undefined;
  try {
    await waiting;
    change = second.capabilities.goals.reschedule(goal.id, 60);
    const early = await Promise.race([
      change.then(
        () => true,
        () => true,
      ),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
    ]);
    expect(early).toBe(false);
    release();
    await recovering;
    await change;
    expect((await goals.get(goal.id))?.everyMinutes).toBe(60);
  } finally {
    release();
    await Promise.allSettled([recovering, ...(change === undefined ? [] : [change])]);
    spy.mockRestore();
    await second.close();
    await first.close();
  }
}, 15_000);

it('starts a shared due goal only once across two agents', async () => {
  const { startHarness } = await import('./harness.js');
  const first = await startHarness();
  const second = await startHarness({ stateDir: first.stateDir });
  try {
    const goal = await first.capabilities.goals.create({ title: 'Once', instructions: 'Look.' });
    first.model.script({ text: 'Done.' });
    second.model.script({ text: 'Done.' });
    const counts = await Promise.all([
      first.capabilities.runner()!.runDue(),
      second.capabilities.runner()!.runDue(),
    ]);
    await Promise.all([
      first.capabilities.runner()!.settled(),
      second.capabilities.runner()!.settled(),
    ]);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(await first.capabilities.goals.runs(goal.id)).toHaveLength(1);
  } finally {
    await second.close();
    await first.close();
  }
}, 15_000);

it('does not recover a goal while its own run claim is being registered', async () => {
  const { startHarness } = await import('./harness.js');
  const harness = await startHarness();
  const { goals } = harness.capabilities;
  const goal = await goals.create({ title: 'Once', instructions: 'Look.' });
  harness.model.script({ text: 'Done.' });
  const original = goals.startRun.bind(goals);
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const spy = vi.spyOn(goals, 'startRun').mockImplementation(async (...args) => {
    const run = await original(...args);
    reached();
    await gate;
    return run;
  });
  const runner = harness.capabilities.runner()!;
  const first = runner.runDue();
  try {
    await waiting;
    expect(runner.isRunning(goal.id)).toBe(true);
    expect(await runner.runDue()).toBe(0);
    release();
    expect(await first).toBe(1);
    await runner.settled();
    expect(await goals.runs(goal.id)).toHaveLength(1);
    expect((await goals.runs(goal.id))[0]?.outcome).toBe('done');
  } finally {
    release();
    await Promise.allSettled([first]);
    spy.mockRestore();
    await harness.close();
  }
}, 15_000);

it('waits for an in-progress run claim before stopping', async () => {
  const { startHarness } = await import('./harness.js');
  const harness = await startHarness();
  const { goals } = harness.capabilities;
  await goals.create({ title: 'Once', instructions: 'Look.' });
  const original = goals.startRun.bind(goals);
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const spy = vi.spyOn(goals, 'startRun').mockImplementation(async (...args) => {
    const run = await original(...args);
    reached();
    await gate;
    return run;
  });
  const runner = harness.capabilities.runner()!;
  const starting = runner.runDue();
  let stopping: Promise<void> | undefined;
  try {
    await waiting;
    stopping = runner.stop();
    const early = await Promise.race([
      stopping.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
    ]);
    expect(early).toBe(false);
    release();
    await Promise.all([starting, stopping]);
    expect(harness.model.requests).toHaveLength(0);
  } finally {
    release();
    await Promise.allSettled([starting, ...(stopping === undefined ? [] : [stopping])]);
    spy.mockRestore();
    await harness.close();
  }
}, 15_000);

it('waits for an in-progress recovery before stopping', async () => {
  const { startHarness } = await import('./harness.js');
  const harness = await startHarness();
  const { goals } = harness.capabilities;
  const goal = await goals.create({ title: 'Abandoned', instructions: 'Look.' });
  await goals.startRun(goal.id);
  const store = (
    goals as unknown as { store: import('@robota-sdk/agent-product/personal').IGoalStore }
  ).store;
  const original = store.listFeed.bind(store);
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const spy = vi.spyOn(store, 'listFeed').mockImplementation(async (limit) => {
    reached();
    await gate;
    return original(limit);
  });
  const runner = harness.capabilities.runner()!;
  const scheduling = runner.runDue();
  let stopping: Promise<void> | undefined;
  try {
    await waiting;
    stopping = runner.stop();
    const early = await Promise.race([
      stopping.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
    ]);
    expect(early).toBe(false);
    release();
    await Promise.all([scheduling, stopping]);
    expect(harness.model.requests).toHaveLength(0);
    expect((await goals.runs(goal.id))[0]?.outcome).toBe('interrupted');
  } finally {
    release();
    await Promise.allSettled([scheduling, ...(stopping === undefined ? [] : [stopping])]);
    spy.mockRestore();
    await harness.close();
  }
}, 15_000);

it('interrupts a goal whose run is claimed but whose session is not open yet', async () => {
  const { startHarness } = await import('./harness.js');
  const harness = await startHarness();
  const { goals } = harness.capabilities;
  const goal = await goals.create({ title: 'Once', instructions: 'Look.' });
  const original = goals.startRun.bind(goals);
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const spy = vi.spyOn(goals, 'startRun').mockImplementation(async (...args) => {
    const run = await original(...args);
    reached();
    await gate;
    return run;
  });
  const runner = harness.capabilities.runner()!;
  const starting = runner.runDue();
  let settling: Promise<void> | undefined;
  try {
    await waiting;
    runner.interrupt(goal.id);
    settling = runner.settled(goal.id);
    const early = await Promise.race([
      settling.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
    ]);
    expect(early).toBe(false);
    release();
    await settling;
    expect(await starting).toBe(0);
    expect(harness.model.requests).toHaveLength(0);
    expect((await goals.runs(goal.id))[0]?.outcome).toBe('interrupted');
  } finally {
    release();
    await Promise.allSettled([starting, ...(settling === undefined ? [] : [settling])]);
    spy.mockRestore();
    await harness.close();
  }
}, 15_000);

it('waits for recovery and prevents a goal from starting after Stop', async () => {
  const { startHarness } = await import('./harness.js');
  const harness = await startHarness();
  const { goals } = harness.capabilities;
  const goal = await goals.create({ title: 'Abandoned', instructions: 'Look.' });
  await goals.startRun(goal.id);
  const store = (
    goals as unknown as { store: import('@robota-sdk/agent-product/personal').IGoalStore }
  ).store;
  const original = store.listFeed.bind(store);
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const spy = vi.spyOn(store, 'listFeed').mockImplementation(async (limit) => {
    reached();
    await gate;
    return original(limit);
  });
  const runner = harness.capabilities.runner()!;
  const scheduling = runner.runDue();
  let settling: Promise<void> | undefined;
  try {
    await waiting;
    runner.interrupt(goal.id);
    settling = runner.settled(goal.id);
    const early = await Promise.race([
      settling.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
    ]);
    expect(early).toBe(false);
    release();
    await settling;
    expect(await scheduling).toBe(0);
    expect(harness.model.requests).toHaveLength(0);
    expect((await goals.runs(goal.id))[0]?.outcome).toBe('interrupted');
  } finally {
    release();
    await Promise.allSettled([scheduling, ...(settling === undefined ? [] : [settling])]);
    spy.mockRestore();
    await harness.close();
  }
}, 15_000);
