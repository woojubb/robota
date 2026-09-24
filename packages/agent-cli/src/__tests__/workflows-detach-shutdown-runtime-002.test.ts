/**
 * RUNTIME-002 (#2845) conformance evidence, folded into issue #2875 criterion 4: the SERVED host —
 * `agent-cli`'s own composition root (`buildCommandSetup`, the desktop's presentation-free
 * executable path `headless-bin.ts` runs through) — gives `/workflows` a live detached owner.
 *
 * Two things are demonstrated end to end, through the REAL command module `buildCommandSetup`
 * assembles and the REAL served-host lifecycle (no mock of `LocalDagRuntimeProvider`, the DAG
 * runtime, or the host's shutdown race):
 *
 *   1. `run --detach` is accepted when the host is served (not print mode, no `--goal`) — the exact
 *      condition `buildCommandSetup` uses to compute `allowDetachedRuns`.
 *   2. Shutting the served host down goes through the SAME path `robota --serve` uses —
 *      `startRuntimeHost` → `IRuntimeHostHandle.shutdown()` → `InteractiveSession.shutdown()` → every
 *      command module's `shutdown(host)` — which races the session shutdown against a hard
 *      `RUNTIME_SHUTDOWN_TIMEOUT_MS` (5000ms, `agent-framework`'s `runtime-host.ts`) so a wedged
 *      subsystem cannot block process exit. This test proves the detached run's provider is aborted
 *      AND joined comfortably inside that race, not merely that `shutdown()` eventually returns
 *      because the 5s bound fired.
 *
 * Only the LLM/prompt provider is a held test double; everything else — the workflows command
 * module, the DAG runtime, `startRuntimeHost`, the session — is the real production wiring.
 *
 * `HOME` is stubbed to this test's own temp root before `buildCommandSetup` runs: the composition
 * root reads `~/.robota` (org policy, user settings, workspace-trust state) via `os.homedir()`
 * (`node:os` resolves it from `HOME` on POSIX at call time, not at import time), and this test must
 * not depend on — or perturb — whatever happens to live in the real developer/CI home directory.
 */
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  WorkspaceTrustService,
  createWorkspaceProjectMutation,
  startRuntimeHost,
} from '@robota-sdk/agent-framework';
import { createAssistantMessage } from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';

import { buildCommandSetup } from '../startup/command-setup.js';
import { ROBOTA_PROJECT_STATE_DIRECTORIES } from '../product/robota-project-state-directories.js';

import type {
  ICommandModule,
  IRuntimeHostHandle,
  IWorkspaceIdentity,
  IWorkspaceProjectMutation,
  IWorkspaceTrustStoreSnapshot,
  TWorkspaceProjectAccess,
} from '@robota-sdk/agent-framework';
import type { IAIProvider, IProviderDefinition, TUniversalMessage } from '@robota-sdk/agent-core';
import type { IParsedCliArgs } from '../utils/cli-args.js';

/** Mirrors the private `RUNTIME_SHUTDOWN_TIMEOUT_MS` in `agent-framework`'s `runtime-host.ts`.
 * Nothing compares the two, so update this value if that bound changes. */
const RUNTIME_SHUTDOWN_TIMEOUT_MS = 5000;

const roots: string[] = [];
let handle: IRuntimeHostHandle | undefined;

beforeEach(() => {
  const home = mkHomeSentinel();
  vi.stubEnv('HOME', home);
  // Canary: os.homedir() must actually honor the stub in this runtime (it reads HOME on POSIX at
  // call time), or every "reads ~/.robota" assumption below is untested.
  expect(homedir()).toBe(home);
});

function mkHomeSentinel(): string {
  // A distinct, never-created directory is enough to prove HOME is honored; the real fixture root
  // (trusted, holding the workflow files) is created separately per test via `trustedRoot()`.
  return join(tmpdir(), `runtime-002-home-sentinel-${process.pid}-${Date.now()}`);
}

afterEach(async () => {
  await handle?.shutdown().catch(() => undefined);
  handle = undefined;
  vi.unstubAllEnvs();
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

/** A held provider: `chat()` hangs until `release()` is called. Safe to call `release()` more than once. */
function makeHeldProvider(providerType: string): {
  definitions: IProviderDefinition[];
  entered: Promise<AbortSignal>;
  release(): void;
} {
  let notifyEntered!: (signal: AbortSignal) => void;
  const entered = new Promise<AbortSignal>((resolve) => {
    notifyEntered = resolve;
  });
  let released = false;
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
    release: () => {
      if (released) return;
      released = true;
      resolveHeld();
    },
  };
}

const MINIMAL_ARGS = { disableUpdateCheck: true } as unknown as IParsedCliArgs;

describe('RUNTIME-002 (#2845): the served host owns a live detached /workflows run', () => {
  it('accepts run --detach when served (not print mode, no --goal), and shutdown aborts + joins the active run well inside the 5s bound', async () => {
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

    // The real served-host lifecycle: `startRuntimeHost` builds the same `InteractiveSession` that
    // `robota --serve` runs (via `runServeMode`), and its `shutdown()` is the same bounded race.
    const scripted = createScriptedProvider([{ text: 'unused' }]);
    handle = await startRuntimeHost({
      session: {
        provider: scripted.provider,
        cwd: root,
        projectAccess: access,
        commandModules: [workflowsModule],
      },
    });

    try {
      const started = await handle.session.executeCommand('workflows', 'run flow.json --detach', 'user');
      expect(started?.success).toBe(true);
      expect(started?.message).toMatch(/Run ID: [\w-]+/);
      expect(started?.message).not.toMatch(/unavailable in print mode/);

      const signal = await held.entered;
      expect(signal.aborted).toBe(false);

      const shutdownStartedAt = Date.now();
      let shutdownSettled = false;
      const shuttingDown = handle.shutdown().then(() => {
        shutdownSettled = true;
      });

      await vi.waitFor(() => expect(signal.aborted).toBe(true));
      // Shutdown aborted the live provider call but must still be JOINING its cleanup — deterministic
      // because `DetachedWorkflowRuns.shutdown()` awaits every active run's `settled` promise, and
      // this run's provider has not settled yet. If this were instead the 5s race bound winning, it
      // could not possibly have fired yet (elapsed time here is milliseconds).
      expect(shutdownSettled).toBe(false);
      expect(Date.now() - shutdownStartedAt).toBeLessThan(RUNTIME_SHUTDOWN_TIMEOUT_MS / 2);

      held.release();
      await shuttingDown;
      expect(shutdownSettled).toBe(true);
      // A real JOIN, not the timeout bound winning the race: comfortably under the 5s cap.
      expect(Date.now() - shutdownStartedAt).toBeLessThan(RUNTIME_SHUTDOWN_TIMEOUT_MS - 1000);
    } finally {
      held.release();
    }
  }, 15_000);
});
