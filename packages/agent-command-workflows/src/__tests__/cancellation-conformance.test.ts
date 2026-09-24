import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAssistantMessage } from '@robota-sdk/agent-core';
import type { IAIProvider, IProviderDefinition, TUniversalMessage } from '@robota-sdk/agent-core';
import { createTestCommandHost } from '@robota-sdk/agent-framework/testing';

import { createWorkflowsCommandModule } from '../workflows-command-module.js';
import { createWorkflowProjectFixture } from './workflow-project-fixture.js';

/**
 * Final combined conformance evidence for issue #2875 criterion 4, driven end to end through the
 * REAL `/workflows` command module (`createWorkflowsCommandModule`) and the REAL
 * `LocalDagRuntimeProvider` — nothing on the runtime is mocked. Only the LLM/prompt provider is a
 * held test double, so each case can control exactly when a node's work "completes" relative to an
 * explicit `cancel`.
 *
 * Every scenario below is evidence, not exploration: it is expected to PASS against the current
 * runtime. A failure here means the product genuinely regressed one of the guarantees issue #2875
 * asked to be pinned down (a committed cancellation outranking a late success/failure, nested
 * cancellation, result/cancel precedence, and DAG-004's total decode).
 *
 * What this file does NOT cover: the worker's own per-message admission check
 * (`cancelIfRunCancelled` in `dag-worker`'s `WorkerLoopService.processAcquiredMessage`), which fires
 * only when a queue message is actually DEQUEUED after its run is already committed cancelled. On
 * the `/workflows` local-runtime path, a single `RunAdvancementCoordinator` waiter settles as soon as
 * it observes the run is terminal, so the loop stops before ever dequeuing a message that was still
 * queued at cancellation time — meaning a downstream node here never even gets ENQUEUED (its
 * upstream's late outcome loses arbitration against the committed cancellation first: see
 * `dag-worker`'s `task-outcome-handler.ts`), and an already-queued sibling never gets DEQUEUED. That
 * admission check itself is exercised directly at the `dag-worker` unit level instead, where a
 * message can be placed in the queue and handed to `WorkerLoopService.processOnce()` after the run's
 * cancellation is already committed:
 *   - `packages/dag-worker/src/__tests__/worker-loop-service.test.ts` —
 *     "acknowledges a queued task of a cancelled run without starting or executing it" and
 *     "does not execute a task when its run is cancelled after the task is claimed".
 *   - `packages/dag-worker/src/__tests__/cancelled-ancestor-admission.test.ts` — the composite/nested
 *     case, admission refused from a persisted ancestor's cancelled status.
 */

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function makeRoot(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  roots.push(root);
  return root;
}

/** Writes a saved "prompt" instant node backed by the given provider type. */
async function writePromptNode(root: string, nodeType: string, providerType: string): Promise<void> {
  await mkdir(join(root, '.workflows', 'nodes'), { recursive: true });
  await writeFile(
    join(root, '.workflows', 'nodes', `${nodeType}.node.json`),
    JSON.stringify({
      kind: 'prompt',
      nodeType,
      displayName: nodeType,
      systemPromptTemplate: '{{text}}',
      inputPorts: [{ key: 'text' }],
      outputPort: { key: 'text' },
      provider: providerType,
    }),
  );
}

/** Writes a saved "composite" instant node wrapping the given inner DAG. */
async function writeCompositeNode(
  root: string,
  nodeType: string,
  innerDag: Record<string, unknown>,
): Promise<void> {
  await mkdir(join(root, '.workflows', 'nodes'), { recursive: true });
  await writeFile(
    join(root, '.workflows', 'nodes', `${nodeType}.node.json`),
    JSON.stringify({
      kind: 'composite',
      nodeType,
      displayName: nodeType,
      innerDag,
      exposedInputPort: { key: 'text', mapsTo: { nodeId: 'source', portKey: 'text' } },
      exposedOutputPorts: [{ key: 'text', mapsTo: { nodeId: 'source', portKey: 'text' } }],
    }),
  );
}

interface IHeldProvider {
  readonly definitions: IProviderDefinition[];
  /** Resolves with the AbortSignal the runtime attached to the first `chat` call it observes. */
  readonly entered: Promise<AbortSignal>;
  /** Settles the held call. Safe to call more than once — only the first call has any effect. */
  release(outcome: 'resolve' | 'reject', value?: string): void;
  /** Total number of times `chat` was invoked across every node using this provider. */
  callCount(): number;
}

/**
 * A test `IAIProvider` whose `chat()` call hangs until the test releases it. Every call — from any
 * node registered against this provider type — increments a shared counter, which is how a case
 * proves a downstream/sibling node's provider was never reached.
 */
function makeHeldProvider(providerType: string): IHeldProvider {
  let calls = 0;
  let notifyEntered!: (signal: AbortSignal) => void;
  const entered = new Promise<AbortSignal>((resolve) => {
    notifyEntered = resolve;
  });
  let settle!: (outcome: 'resolve' | 'reject', value?: string) => void;
  let released = false;
  const held = new Promise<TUniversalMessage>((resolve, reject) => {
    settle = (outcome, value) => {
      if (released) return;
      released = true;
      if (outcome === 'reject') reject(new Error(value ?? 'late rejection'));
      else resolve(createAssistantMessage(value ?? 'late success'));
    };
  });
  const provider: IAIProvider = {
    name: providerType,
    version: 'test',
    supportsTools: () => false,
    validateConfig: () => true,
    chat: async (_messages, options) => {
      calls += 1;
      if (!options?.signal) throw new Error('Missing task cancellation signal');
      notifyEntered(options.signal);
      return held;
    },
    generateResponse: async () => ({ content: 'unused' }),
  };
  return {
    definitions: [{ type: providerType, defaults: { model: 'test-model' }, createProvider: () => provider }],
    entered,
    release: (outcome, value) => settle(outcome, value),
    callCount: () => calls,
  };
}

/** A test `IAIProvider` that answers immediately — for cases that must never legitimately reach it. */
function makeImmediateProvider(providerType: string): {
  definitions: IProviderDefinition[];
  callCount(): number;
} {
  let calls = 0;
  const provider: IAIProvider = {
    name: providerType,
    version: 'test',
    supportsTools: () => false,
    validateConfig: () => true,
    chat: async () => {
      calls += 1;
      return createAssistantMessage('should never be reached');
    },
    generateResponse: async () => ({ content: 'unused' }),
  };
  return {
    definitions: [{ type: providerType, defaults: { model: 'test-model' }, createProvider: () => provider }],
    callCount: () => calls,
  };
}

function extractRunId(message: string): string {
  const runId = message.match(/Run ID: ([\w-]+)/)?.[1];
  if (!runId) throw new Error(`No run ID in: ${message}`);
  return runId;
}

describe('cancellation conformance: /workflows path (#2875 criterion 4)', () => {
  it('late success loses to a committed cancellation; downstream never dispatched', async () => {
    const root = await makeRoot('cancel-conformance-queued-');
    await writePromptNode(root, 'held-prompt', 'test');
    await writeFile(
      join(root, 'flow.json'),
      JSON.stringify({
        dagId: 'queued-admission',
        version: 1,
        status: 'draft',
        nodes: [
          { nodeId: 'source', nodeType: 'input', dependsOn: [], config: { text: 'x' } },
          { nodeId: 'a', nodeType: 'held-prompt', dependsOn: ['source'], config: {} },
          { nodeId: 'b', nodeType: 'held-prompt', dependsOn: ['a'], config: {} },
        ],
        edges: [
          { from: 'source', to: 'a', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
          { from: 'a', to: 'b', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
        ],
      }),
    );

    const shared = makeHeldProvider('test');
    const module = createWorkflowsCommandModule({
      project: await createWorkflowProjectFixture(root),
      providerDefinitions: shared.definitions,
    });
    const command = module.systemCommands?.[0];
    if (!command) throw new Error('workflows command missing');
    const context = createTestCommandHost({ cwd: root });

    try {
      const started = await command.execute(context, 'run flow.json --detach');
      expect(started.success).toBe(true);
      const runId = extractRunId(started.message);

      const signal = await shared.entered;

      // Cancel first — while node "a" is still held — then let "a" resolve SUCCESSFULLY only after
      // cancellation has already committed. "a"'s late success must lose arbitration against the
      // already-cancelled run, so node "b" is never dispatched even though its one dependency
      // eventually produced a successful result.
      const cancelling = command.execute(context, `cancel ${runId}`);
      await vi.waitFor(() => expect(signal.aborted).toBe(true));
      shared.release('resolve', 'a finished after cancel');

      const cancelled = await cancelling;
      expect(cancelled.success).toBe(true);

      const status = await command.execute(context, `status ${runId}`);
      expect(status.message).toContain('cancelled');
      expect(status.message).not.toContain('a finished after cancel');
      expect(shared.callCount()).toBe(1);
    } finally {
      shared.release('resolve', 'unused');
      await module.shutdown?.(context);
    }
  });

  it('active cancellation: cancel does not resolve until the held provider it aborted has settled', async () => {
    const root = await makeRoot('cancel-conformance-active-');
    await writePromptNode(root, 'held-prompt', 'test');
    await writeFile(
      join(root, 'flow.json'),
      JSON.stringify({
        dagId: 'active-cancel',
        version: 1,
        status: 'draft',
        nodes: [
          { nodeId: 'source', nodeType: 'input', dependsOn: [], config: { text: 'x' } },
          { nodeId: 'a', nodeType: 'held-prompt', dependsOn: ['source'], config: {} },
        ],
        edges: [{ from: 'source', to: 'a', bindings: [{ outputKey: 'text', inputKey: 'text' }] }],
      }),
    );

    const held = makeHeldProvider('test');
    const module = createWorkflowsCommandModule({
      project: await createWorkflowProjectFixture(root),
      providerDefinitions: held.definitions,
    });
    const command = module.systemCommands?.[0];
    if (!command) throw new Error('workflows command missing');
    const context = createTestCommandHost({ cwd: root });

    try {
      const started = await command.execute(context, 'run flow.json --detach');
      const runId = extractRunId(started.message);
      const signal = await held.entered;

      let cancelResolved = false;
      const cancelling = Promise.resolve(command.execute(context, `cancel ${runId}`)).then(
        (result) => {
          cancelResolved = true;
          return result;
        },
      );

      await vi.waitFor(() => expect(signal.aborted).toBe(true));
      // The provider has observed the abort but still owns cleanup until it settles — `cancel` must
      // still be pending here, deterministically, because `DetachedWorkflowRuns.cancel` awaits the
      // run's `settled` promise before it returns.
      expect(cancelResolved).toBe(false);

      held.release('resolve', 'late success');
      const result = await cancelling;
      expect(cancelResolved).toBe(true);
      expect(result.success).toBe(true);

      const status = await command.execute(context, `status ${runId}`);
      expect(status.message).toContain('cancelled');
      expect(status.message).not.toContain('late success');
    } finally {
      held.release('resolve', 'unused');
      await module.shutdown?.(context);
    }
  });

  it('nested run stops after explicit cancel; sibling never started', async () => {
    const root = await makeRoot('cancel-conformance-nested-');
    await writePromptNode(root, 'held-prompt', 'test');
    await writeCompositeNode(root, 'wrap', {
      dagId: 'wrap-inner',
      version: 1,
      status: 'draft',
      nodes: [
        { nodeId: 'source', nodeType: 'input', dependsOn: [], config: { text: 'x' } },
        // Two children of the SAME parent, neither depending on the other — true siblings.
        { nodeId: 'held', nodeType: 'held-prompt', dependsOn: ['source'], config: {} },
        { nodeId: 'sibling', nodeType: 'held-prompt', dependsOn: ['source'], config: {} },
      ],
      edges: [
        { from: 'source', to: 'held', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
        { from: 'source', to: 'sibling', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
      ],
    });
    await writeFile(
      join(root, 'parent.json'),
      JSON.stringify({
        dagId: 'nested-parent',
        version: 1,
        status: 'draft',
        nodes: [
          { nodeId: 'source', nodeType: 'input', dependsOn: [], config: { text: 'x' } },
          { nodeId: 'wrapped', nodeType: 'wrap', dependsOn: ['source'], config: {} },
        ],
        edges: [
          { from: 'source', to: 'wrapped', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
        ],
      }),
    );

    const shared = makeHeldProvider('test');
    const module = createWorkflowsCommandModule({
      project: await createWorkflowProjectFixture(root),
      providerDefinitions: shared.definitions,
    });
    const command = module.systemCommands?.[0];
    if (!command) throw new Error('workflows command missing');
    const context = createTestCommandHost({ cwd: root });

    try {
      const started = await command.execute(context, 'run parent.json --detach');
      expect(started.success).toBe(true);
      const runId = extractRunId(started.message);

      const signal = await shared.entered;

      const cancelling = command.execute(context, `cancel ${runId}`);
      await vi.waitFor(() => expect(signal.aborted).toBe(true));
      shared.release('resolve', 'held child finished after cancel');

      const cancelled = await cancelling;
      expect(cancelled.success).toBe(true);

      const status = await command.execute(context, `status ${runId}`);
      expect(status.message).toContain('cancelled');
      // Only the composite's "held" child ever reached the provider; "sibling" never did.
      expect(shared.callCount()).toBe(1);
    } finally {
      shared.release('resolve', 'unused');
      await module.shutdown?.(context);
    }
  });

  it.each(['resolve', 'reject'] as const)(
    'result/cancel precedence: a late %s after cancel still leaves the run cancelled with no result excerpt',
    async (outcome) => {
      const root = await makeRoot(`cancel-conformance-precedence-${outcome}-`);
      await writePromptNode(root, 'held-prompt', 'test');
      await writeFile(
        join(root, 'flow.json'),
        JSON.stringify({
          dagId: 'precedence',
          version: 1,
          status: 'draft',
          nodes: [
            { nodeId: 'source', nodeType: 'input', dependsOn: [], config: { text: 'x' } },
            { nodeId: 'a', nodeType: 'held-prompt', dependsOn: ['source'], config: {} },
          ],
          edges: [{ from: 'source', to: 'a', bindings: [{ outputKey: 'text', inputKey: 'text' }] }],
        }),
      );

      const held = makeHeldProvider('test');
      const module = createWorkflowsCommandModule({
        project: await createWorkflowProjectFixture(root),
        providerDefinitions: held.definitions,
      });
      const command = module.systemCommands?.[0];
      if (!command) throw new Error('workflows command missing');
      const context = createTestCommandHost({ cwd: root });

      const excerpt = outcome === 'resolve' ? 'late resolved output' : 'late rejection detail';
      try {
        const started = await command.execute(context, 'run flow.json --detach');
        const runId = extractRunId(started.message);
        const signal = await held.entered;

        const cancelling = command.execute(context, `cancel ${runId}`);
        await vi.waitFor(() => expect(signal.aborted).toBe(true));

        held.release(outcome, excerpt);

        const cancelled = await cancelling;
        expect(cancelled.success).toBe(true);

        const status = await command.execute(context, `status ${runId}`);
        expect(status.message).toContain('cancelled');
        expect(status.message).not.toContain(excerpt);
      } finally {
        held.release(outcome, 'unused');
        await module.shutdown?.(context);
      }
    },
  );

  it('DAG-004: a workflow file with a field the total decoder rejects fails before any node runs', async () => {
    const root = await makeRoot('cancel-conformance-dag004-');
    await writePromptNode(root, 'held-prompt', 'test');
    await writeFile(
      join(root, 'flow.json'),
      JSON.stringify({
        dagId: 'malformed',
        version: 1,
        // 'active' is not a valid DAG_DEFINITION file status (draft | published | deprecated) — the
        // DAG-004 total decoder must reject this by field path instead of casting it onward.
        status: 'active',
        nodes: [
          { nodeId: 'source', nodeType: 'input', dependsOn: [], config: { text: 'x' } },
          { nodeId: 'a', nodeType: 'held-prompt', dependsOn: ['source'], config: {} },
        ],
        edges: [{ from: 'source', to: 'a', bindings: [{ outputKey: 'text', inputKey: 'text' }] }],
      }),
    );

    // Immediately-resolving, NOT held: if the DAG-004 decode regresses and this node actually runs,
    // the test must fail fast on `callCount()` rather than hang forever on a held promise nobody
    // releases.
    const immediate = makeImmediateProvider('test');
    const module = createWorkflowsCommandModule({
      project: await createWorkflowProjectFixture(root),
      providerDefinitions: immediate.definitions,
    });
    const command = module.systemCommands?.[0];
    if (!command) throw new Error('workflows command missing');
    const context = createTestCommandHost({ cwd: root });

    try {
      const result = await command.execute(context, 'run flow.json');
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/status/i);
      expect(immediate.callCount()).toBe(0);
    } finally {
      await module.shutdown?.(context);
    }
  });
});
