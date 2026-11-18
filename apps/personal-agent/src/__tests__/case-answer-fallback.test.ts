import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

import { createPersonalCapabilities } from '../capabilities.js';
import { startLocalMode } from '../local-mode.js';
import { createProviderFromProfile } from '../provider.js';
import { startScriptedModel } from './scripted-model.js';

it('retries a later answer when the non-durable queue is temporarily unavailable', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-answer-fallback-'));
  const model = await startScriptedModel();
  const environment = { HOME: root, SCRIPTED_KEY: 'scripted-key' };
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  let caps: ReturnType<typeof createPersonalCapabilities>;
  try {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    caps = createPersonalCapabilities({
      stateDir: root,
      environment,
      goalTickMs: 0,
      deliveryTickMs: 0,
    });
  } finally {
    Object.defineProperty(process, 'platform', originalPlatform);
  }
  const profile = {
    type: 'openai' as const,
    model: 'scripted-model',
    baseURL: model.baseURL,
    apiKeyEnv: 'SCRIPTED_KEY',
  };
  const local = await startLocalMode({
    stateDir: root,
    provider: createProviderFromProfile(profile, environment),
    model: 'scripted-model',
    tools: caps.tools,
    instructions: caps.instructions,
    gui: false,
    api: caps.api,
    landing: caps.landing,
  });
  await caps.attach(local.agent);
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    reached = resolve;
  });
  try {
    const { case: opened } = await caps.cases.open({
      title: 'Question',
      noticed: 'A note',
      source: 'test:fallback',
    });
    const first = await caps.cases.ask(opened.id, { question: 'First?', options: ['Yes'] });
    model.script(async () => {
      reached();
      await gate;
      return { text: 'Finished.' };
    });
    const answer = (id: string) =>
      caps.api({
        method: 'POST',
        path: `/feed/${id}/answer`,
        segments: ['feed', id, 'answer'],
        query: new URLSearchParams(),
        body: { choice: 'Yes' },
      });
    expect((await answer(first.item.id)).status).toBe(200);
    await waiting;
    const next = await caps.cases.ask(opened.id, { question: 'Second?', options: ['Yes'] });
    const failure = vi
      .spyOn(caps.goals, 'enqueueCaseAnswer')
      .mockRejectedValueOnce(new Error('temporary'));
    expect((await answer(next.item.id)).status).toBe(200);
    for (let attempt = 0; failure.mock.calls.length < 2 && attempt < 200; attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(failure.mock.calls.length).toBeGreaterThanOrEqual(2);
    release();
    const goal = (await caps.goals.list()).find((entry) => entry.caseId === opened.id)!;
    for (
      let attempt = 0;
      (await caps.goals.runs(goal.id)).length < 2 && attempt < 200;
      attempt += 1
    ) {
      await caps.runner()!.runDue();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await caps.runner()!.settled();
    expect(await caps.goals.runs(goal.id)).toHaveLength(2);
  } finally {
    release();
    await caps.dispose();
    await local.stop();
    await model.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);
