/**
 * RUNTIME-002 (#2845) conformance evidence, folded into issue #2875 criterion 4: the SERVED host —
 * `agent-cli`'s own composition root (`buildCommandSetup`, the desktop's presentation-free
 * executable path `headless-bin.ts` runs through) — gives `/workflows` a live detached owner.
 *
 * Two things are demonstrated end to end, through the REAL command module `buildCommandSetup`
 * assembles (no mock of `LocalDagRuntimeProvider` or of the DAG runtime):
 *
 *   1. `run --detach` is accepted when the host is served (not print mode, no `--goal`) — the exact
 *      condition `buildCommandSetup` uses to compute `allowDetachedRuns`.
 *   2. Shutting the served host down (`driver.stop()` → `InteractiveSession.shutdown()` → every
 *      command module's `shutdown(host)`) aborts an active detached run's provider AND joins its
 *      cleanup — `stop()` does not resolve until the aborted run has actually settled.
 *
 * Only the LLM/prompt provider is a held test double; everything else — the workflows command
 * module, the DAG runtime, the programmatic driver/session — is the real production wiring.
 */
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  WorkspaceTrustService,
  createProgrammaticAgent,
  createWorkspaceProjectMutation,
} from '@robota-sdk/agent-framework';
import { createAssistantMessage } from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';

import { buildCommandSetup } from '../startup/command-setup.js';
import { ROBOTA_PROJECT_STATE_DIRECTORIES } from '../product/robota-project-state-directories.js';

import type {
  ICommandModule,
  IWorkspaceIdentity,
  IWorkspaceProjectMutation,
  IWorkspaceTrustStoreSnapshot,
  TWorkspaceProjectAccess,
} from '@robota-sdk/agent-framework';
import type { IAIProvider, IProviderDefinition, TUniversalMessage } from '@robota-sdk/agent-core';
import type { IAgentDriver, InteractionEvent } from '@robota-sdk/agent-interface-session';
import type { IParsedCliArgs } from '../utils/cli-args.js';

const roots: string[] = [];
let driver: IAgentDriver | undefined;

afterEach(async () => {
  await driver?.stop().catch(() => undefined);
  driver = undefined;
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function trustedRoot(prefix: string): Promise<{
  root: string;
  access: TWorkspaceProjectAccess;
  mutation: IWorkspaceProjectMutation;
}> {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  roots.push(root);
  const identity: IWorkspaceIdentity = {
    repositoryKey: `runtime-002-test:${root}`,
    displayPath: root,
    worktreeRoot: root,
  };
  const trusted: IWorkspaceTrustStoreSnapshot = {
    state: 'trusted',
    generation: 1,
    grantedAt: '2026-08-22T00:00:00.000Z',
  };
  const access = await new WorkspaceTrustService({
    identityResolver: { resolve: () => identity },
    store: {
      inspect: async () => trusted,
      grant: async () => trusted,
      revoke: async () => ({ state: 'revoked', generation: 2 }),
    },
    projectStateDirectories: ROBOTA_PROJECT_STATE_DIRECTORIES,
  }).inspect(root);
  if (access.status !== 'trusted') throw new Error('Expected trusted RUNTIME-002 fixture root.');
  const mutation = createWorkspaceProjectMutation(access.authority, {
    status: 'approved',
    purpose: 'RUNTIME-002 conformance evidence',
  });
  return { root, access, mutation };
}

/** A held provider: `chat()` hangs until `release()` is called. */
function makeHeldProvider(providerType: string): {
  definitions: IProviderDefinition[];
  entered: Promise<AbortSignal>;
  release(): void;
} {
  let notifyEntered!: (signal: AbortSignal) => void;
  const entered = new Promise<AbortSignal>((resolve) => {
    notifyEntered = resolve;
  });
  let resolveHeld!: () => void;
  const held = new Promise<TUniversalMessage>((resolve) => {
    resolveHeld = () => resolve(createAssistantMessage('late success'));
  });
  const provider: IAIProvider = {
    name: providerType,
    version: 'test',
    supportsTools: () => false,
    validateConfig: () => true,
    chat: async (_messages, options) => {
      if (!options?.signal) throw new Error('Missing task cancellation signal');
      notifyEntered(options.signal);
      return held;
    },
    generateResponse: async () => ({ content: 'unused' }),
  };
  return {
    definitions: [{ type: providerType, defaults: { model: 'test-model' }, createProvider: () => provider }],
    entered,
    release: () => resolveHeld(),
  };
}

function commandOutputs(events: readonly InteractionEvent[]): string[] {
  return events
    .filter(
      (e): e is Extract<InteractionEvent, { type: 'command-result' }> =>
        e.type === 'command-result',
    )
    .map((e) => e.output);
}

const MINIMAL_ARGS = { noUpdateCheck: true } as unknown as IParsedCliArgs;

describe('RUNTIME-002 (#2845): the served host owns a live detached /workflows run', () => {
  it('accepts run --detach when served (not print mode, no --goal), and shutdown aborts + joins the active run', async () => {
    const { root, access, mutation } = await trustedRoot('runtime-002-');
    await mkdir(join(root, '.workflows', 'nodes'), { recursive: true });
    await writeFile(
      join(root, '.workflows', 'nodes', 'held-prompt.node.json'),
      JSON.stringify({
        kind: 'prompt',
        nodeType: 'held-prompt',
        displayName: 'Held prompt',
        systemPromptTemplate: '{{text}}',
        inputPorts: [{ key: 'text' }],
        outputPort: { key: 'text' },
        provider: 'test',
      }),
    );
    await writeFile(
      join(root, 'flow.json'),
      JSON.stringify({
        dagId: 'runtime-002',
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

    // The real composition root: the same `buildCommandSetup` that `headless-bin.ts` / `cli.ts` runs
    // through for a served (non-print, no-goal) host. MINIMAL_ARGS carries neither `printMode` nor
    // `goal`, so `loadWorkflowsCommandModule`'s `allowDetachedRuns = !printMode && goal === undefined`
    // is true here — the exact condition this test is evidence for.
    const setup = buildCommandSetup(
      root,
      MINIMAL_ARGS,
      { projectAccess: access, projectMutation: mutation, providerDefinitions: held.definitions },
      '0.0.0-test',
    );
    const workflowsModule: ICommandModule | undefined = setup.fixedCommandModules.find(
      (m) => m.name === 'agent-command-workflows',
    );
    expect(workflowsModule).toBeDefined();
    if (!workflowsModule) return;

    const scripted = createScriptedProvider([{ text: 'unused' }]);
    driver = createProgrammaticAgent({
      provider: scripted.provider,
      cwd: root,
      projectAccess: access,
      commandModules: [workflowsModule],
    });
    await driver.start();

    await driver.send('/workflows run flow.json --detach');
    const outputs = commandOutputs(driver.events);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatch(/Run ID: [\w-]+/);
    expect(outputs[0]).not.toMatch(/unavailable in print mode/);

    const signal = await held.entered;
    expect(signal.aborted).toBe(false);

    let stopped = false;
    const stopping = driver.stop().then(() => {
      stopped = true;
    });

    await vi.waitFor(() => expect(signal.aborted).toBe(true));
    // Shutdown aborted the live provider call but must still be JOINING its cleanup — deterministic
    // because `DetachedWorkflowRuns.shutdown()` awaits every active run's `settled` promise, and this
    // run's provider has not settled yet.
    expect(stopped).toBe(false);

    held.release();
    await stopping;
    expect(stopped).toBe(true);
  });
});
