import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';

import { createWorkspaceMemoryStore, InteractiveSession, runEval } from '../src/index.js';
import { createTrustedProjectStateFixture } from '../src/testing/trusted-project-state-fixture.js';

// Keep the original manual source-edit baseline; public correction/forgetting has separate runtime regressions.
if (process.platform !== 'linux')
  throw new Error('This fixture requires the admitted Linux project-state writer');
const root = mkdtempSync(join(tmpdir(), 'memory-correction-outcome-'));
const oldHome = process.env.HOME;
const oldState = process.env.PRODUCT_USER_STATE_DIR;
const stale = 'Build output is in legacy-output.';
const corrected = 'Build output is in current-output.';
const budget = { maxTopics: 4, maxTopicChars: 2000 };
let session: InteractiveSession | undefined;
try {
  const home = join(root, 'home');
  mkdirSync(home);
  process.env.HOME = home;
  process.env.PRODUCT_USER_STATE_DIR = join(root, 'state');
  const storage = await createTrustedProjectStateFixture(root, 'memory');
  const writer = createWorkspaceMemoryStore(storage);
  await writer.append({ type: 'project', topic: 'build', text: stale });
  const first = createScriptedProvider([{ text: 'Done' }]);
  session = new InteractiveSession({
    cwd: root,
    provider: first.provider,
    bare: true,
    permissionMode: 'default',
    memoryStore: writer,
    recallMemory: { budget },
  });
  const firstStart = performance.now();
  const firstHandle = await session.submit('Where is the build output?');
  const firstResult = await firstHandle.completed;
  const firstElapsedMs = performance.now() - firstStart;
  const unchangedRecall = Object.freeze(await writer.recall('build output', budget));
  const falseDone = await runEval(
    {
      cases: [{ input: 'correct memory' }],
      threshold: 0.5,
      metrics: [
        {
          name: 'saved-correction',
          required: true,
          score: () =>
            unchangedRecall.content.includes(corrected) && !unchangedRecall.content.includes(stale),
        },
        { name: 'claims-done', score: (run) => run.response === 'Done' },
      ],
    },
    async () => firstResult,
  );
  if (falseDone.passed) throw new Error('Unchanged saved knowledge falsely passed correction');
  if (!JSON.stringify(first.requests).includes(stale))
    throw new Error('Initial saved fact did not reach the model request');
  await session.shutdown();
  session = undefined;
  // Fixture owner corrects the authoritative source files, as a human can today.
  for (const path of ['MEMORY.md', 'topics/build.md']) {
    const text = storage.readText(path, 'read fixture memory source');
    if (!text?.includes(stale)) throw new Error('Missing stale source');
    storage.writeText(
      path,
      text.replace(stale, corrected),
      'apply manual fixture memory correction',
    );
  }
  const reader = createWorkspaceMemoryStore(await createTrustedProjectStateFixture(root, 'memory'));
  const second = createScriptedProvider([{ text: 'Done' }]);
  session = new InteractiveSession({
    cwd: root,
    provider: second.provider,
    bare: true,
    permissionMode: 'default',
    memoryStore: reader,
    recallMemory: { budget },
  });
  const secondStart = performance.now();
  const secondHandle = await session.submit('Where is the build output?');
  const result = await secondHandle.completed;
  const secondElapsedMs = performance.now() - secondStart;
  const recall = await reader.recall('build output', budget);
  const startup = await reader.loadStartupMemory();
  const other = join(root, 'other-project');
  mkdirSync(other);
  const unrelated = createWorkspaceMemoryStore(
    await createTrustedProjectStateFixture(other, 'memory'),
  );
  const unrelatedRecall = await unrelated.recall('build output', budget);
  const request = JSON.stringify(second.requests);
  const observation = Object.freeze({
    correctedAfterRestart:
      request.includes(corrected) &&
      !request.includes(stale) &&
      recall.content.includes(corrected) &&
      !recall.content.includes(stale) &&
      startup.content.includes(corrected) &&
      !startup.content.includes(stale),
    isolated: unrelatedRecall.content === '',
  });
  const report = await runEval(
    {
      cases: [{ input: 'memory correction' }],
      threshold: 0.5,
      metrics: [
        {
          name: 'corrected-after-restart',
          required: true,
          score: () => observation.correctedAfterRestart,
        },
        { name: 'project-isolation', required: true, score: () => observation.isolated },
        { name: 'claims-done', score: (run) => run.response === 'Done' },
      ],
    },
    async () => result,
  );
  if (!report.passed) throw new Error('Memory correction baseline failed');
  console.log(
    JSON.stringify({
      fixtureRevision: 'source-correction-v1',
      provider: 'scripted-test-provider',
      model: 'offline-script',
      permissionMode: 'default',
      sampleSize: 2,
      stochasticComparison: false,
      attempts: [
        {
          outcome: 'unchanged',
          success: false,
          elapsedMs: firstElapsedMs,
          toolSteps: firstResult.toolSummaries.length,
          costUsd:
            firstResult.usage?.costStatus !== 'unknown'
              ? (firstResult.usage?.costUsd ?? null)
              : null,
        },
        {
          outcome: 'source-corrected',
          success: true,
          elapsedMs: secondElapsedMs,
          toolSteps: result.toolSummaries.length,
          costUsd: result.usage?.costStatus !== 'unknown' ? (result.usage?.costUsd ?? null) : null,
        },
      ],
      costPerSuccess:
        firstResult.usage?.costUsd !== undefined &&
        result.usage?.costUsd !== undefined &&
        firstResult.usage.costStatus !== 'unknown' &&
        result.usage.costStatus !== 'unknown'
          ? firstResult.usage.costUsd + result.usage.costUsd
          : null,
      passed: report.passed,
      falseDonePassed: falseDone.passed,
      usedTopics: session.getUsedMemoryReferences().map((reference) => reference.topic),
      correctionRoute:
        'fixture-owner edits both authoritative source files; public commands are exercised separately',
      ...observation,
      isolation: 'temporary-state; admitted Linux project-state writer; no OS sandbox',
    }),
  );
} finally {
  try {
    await session?.shutdown();
  } finally {
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    if (oldState === undefined) delete process.env.PRODUCT_USER_STATE_DIR;
    else process.env.PRODUCT_USER_STATE_DIR = oldState;
    rmSync(root, { recursive: true, force: true });
  }
}
