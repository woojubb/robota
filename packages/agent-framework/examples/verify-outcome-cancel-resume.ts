import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';

import {
  createAgentRuntime,
  createNodeHostSessionStore,
  runEval,
  type InteractiveSession,
} from '../src/index.js';

const root = mkdtempSync(join(tmpdir(), 'agent-cancel-outcome-'));
const oldHome = process.env.HOME;
const oldState = process.env.PRODUCT_USER_STATE_DIR;
let first: InteractiveSession | undefined;
let resumed: InteractiveSession | undefined;
try {
  const home = join(root, 'home');
  mkdirSync(home);
  process.env.HOME = home;
  process.env.PRODUCT_USER_STATE_DIR = join(root, 'state');
  const file = join(root, 'checkpoint.txt');
  writeFileSync(file, 'pending');
  const store = createNodeHostSessionStore(join(root, 'sessions'));
  let notifyStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });
  const script = createScriptedProvider([{ text: 'unused' }]);
  const provider = {
    ...script.provider,
    chat: async (
      _messages: Parameters<typeof script.provider.chat>[0],
      options?: Parameters<typeof script.provider.chat>[1],
    ): ReturnType<typeof script.provider.chat> => {
      if (!options?.signal) throw new Error('Provider did not receive cancellation signal');
      const signal = options.signal;
      return new Promise((_resolve, reject) => {
        const abort = (): void => reject(new DOMException('Cancelled', 'AbortError'));
        signal.addEventListener('abort', abort, { once: true });
        notifyStarted();
        if (signal.aborted) abort();
      });
    },
  };
  first = createAgentRuntime({ cwd: root, provider, sessionStore: store }).createSession({
    bare: true,
    permissionMode: 'acceptEdits',
    allowedTools: ['Write'],
  });
  const firstStart = performance.now();
  const pending = first.submit('Complete checkpoint.txt');
  await started;
  first.abort();
  const handle = await pending;
  const interrupted = await handle.completed;
  const firstElapsedMs = performance.now() - firstStart;
  const report = await runEval(
    {
      cases: [{ input: 'checkpoint' }],
      metrics: [{ name: 'soft', score: () => true }],
    },
    async () => interrupted,
  );
  if (!interrupted.interrupted || report.passed || readFileSync(file, 'utf8') !== 'pending') {
    throw new Error('Interrupted task falsely completed or changed the checkpoint');
  }
  const id = first.getSession().getSessionId();
  await first.shutdown();
  first = undefined;
  const continuation = createScriptedProvider([
    { toolCalls: [{ name: 'Write', args: { filePath: file, content: 'complete' } }] },
    { text: 'Done' },
  ]);
  resumed = createAgentRuntime({
    cwd: root,
    provider: continuation.provider,
    sessionStore: store,
  }).createSession({
    bare: true,
    permissionMode: 'acceptEdits',
    allowedTools: ['Write'],
    resumeSessionId: id,
  });
  const resumedStart = performance.now();
  const continued = await resumed.submit('Continue checkpoint.txt');
  const resumedResult = await continued.completed;
  const resumedElapsedMs = performance.now() - resumedStart;
  if (resumed.getSession().getSessionId() !== id || readFileSync(file, 'utf8') !== 'complete') {
    throw new Error('Restored task did not complete the actual checkpoint');
  }
  console.log(
    JSON.stringify({
      fixtureRevision: 'checkpoint-v1',
      provider: 'scripted-test-provider',
      model: 'offline-script',
      permissionMode: 'acceptEdits',
      sampleSize: 2,
      stochasticComparison: false,
      attempts: [
        {
          outcome: 'interrupted',
          success: false,
          elapsedMs: firstElapsedMs,
          toolSteps: interrupted.toolSummaries.length,
          costUsd:
            interrupted.usage?.costStatus !== 'unknown'
              ? (interrupted.usage?.costUsd ?? null)
              : null,
        },
        {
          outcome: 'resumed',
          success: true,
          elapsedMs: resumedElapsedMs,
          toolSteps: resumedResult.toolSummaries.length,
          costUsd:
            resumedResult.usage?.costStatus !== 'unknown'
              ? (resumedResult.usage?.costUsd ?? null)
              : null,
        },
      ],
      costPerSuccess:
        interrupted.usage?.costUsd !== undefined &&
        resumedResult.usage?.costUsd !== undefined &&
        interrupted.usage.costStatus !== 'unknown' &&
        resumedResult.usage.costStatus !== 'unknown'
          ? interrupted.usage.costUsd + resumedResult.usage.costUsd
          : null,
      interruptedPassed: report.passed,
      resumedOutcome: true,
      sameSessionId: true,
      isolation: 'temporary-state; no OS sandbox',
    }),
  );
} finally {
  await Promise.allSettled([first?.shutdown(), resumed?.shutdown()]);
  if (oldHome === undefined) delete process.env.HOME;
  else process.env.HOME = oldHome;
  if (oldState === undefined) delete process.env.PRODUCT_USER_STATE_DIR;
  else process.env.PRODUCT_USER_STATE_DIR = oldState;
  rmSync(root, { recursive: true, force: true });
}
