import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

import { createPersonalCapabilities } from '../capabilities.js';
import { startLocalMode } from '../local-mode.js';
import { createProviderFromProfile } from '../provider.js';
import { startScriptedModel } from './scripted-model.js';

it('recovers a later answer on the Windows path after a temporary queue failure', async () => {
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

it('recovers an accepted Windows-path answer after a normal restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-answer-fallback-restart-'));
  const model = await startScriptedModel();
  const environment = { HOME: root, SCRIPTED_KEY: 'scripted-key' };
  const profile = {
    type: 'openai' as const,
    model: 'scripted-model',
    baseURL: model.baseURL,
    apiKeyEnv: 'SCRIPTED_KEY',
  };
  const start = async () => {
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
    return { caps, local };
  };
  let current = await start();
  try {
    const { case: opened } = await current.caps.cases.open({
      title: 'Question',
      noticed: 'A note',
      source: 'test:fallback-restart',
    });
    const { item } = await current.caps.cases.ask(opened.id, {
      question: 'Continue?',
      options: ['Yes'],
    });
    vi.spyOn(current.caps.runner()!, 'runDue').mockResolvedValue(0);
    vi.spyOn(current.caps.goals, 'enqueueCaseAnswer').mockRejectedValue(new Error('unavailable'));
    const response = await current.caps.api({
      method: 'POST',
      path: `/feed/${item.id}/answer`,
      segments: ['feed', item.id, 'answer'],
      query: new URLSearchParams(),
      body: { choice: 'Yes' },
    });
    expect(response.status).toBe(200);
    expect(await current.caps.goals.list()).toEqual([]);
    await current.caps.dispose();
    await current.local.stop();
    current = await start();
    for (let attempt = 0; model.requests.length === 0 && attempt < 200; attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 10));
    await current.caps.runner()!.settled();
    const goal = (await current.caps.goals.list()).find((entry) => entry.caseId === opened.id)!;
    expect(
      (await current.caps.goals.runs(goal.id)).filter((run) => run.outcome === 'done'),
    ).toHaveLength(1);
  } finally {
    await current.caps.dispose();
    await current.local.stop();
    await model.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);
