/**
 * DIST-006 — black-box e2e proving the BUILT binary can start a subagent worker.
 *
 * The defect: `/agent run` failed on the built binary with
 * `Subagent worker exited before result: exit code 1`, and the child's real stderr was
 * `Cannot find module '…/agent-cli/dist/node/child-process-subagent-worker.js'`.
 * `getDefaultSubagentWorkerPath()` resolved the worker relative to its own `import.meta.url`;
 * bundling `agent-subagent-runner` into `agent-cli/dist/node/bin.js` moved that directory one
 * package along, where the worker was never emitted. Every subagent path in every distributed
 * build was dead. It worked from source, which is why no test caught it — and the unit test that
 * did exist asserted only the SHAPE of the returned string, so it stayed green throughout.
 *
 * That is why this suite is build-gated rather than a unit test: the invariant is about the
 * ARTIFACT, and only an artifact can be asked.
 *
 * Coverage:
 *   TC-A  the built binary, re-executed with the worker-mode flag, completes the IPC handshake
 *         — the exact step that failed with `Cannot find module`;
 *   TC-B  the same flag typed by hand, with no IPC channel, is refused loudly and non-zero
 *         ("Silence is not success" — a worker that cannot report must not look started);
 *   TC-C  the shipped bundle names no worker file at all, so there is no path left to get wrong.
 *
 * Deliberately NOT a full subagent run: that needs a model provider in the child, which this
 * change does not own. The handshake is the whole of what DIST-006 broke.
 *
 * Build-gated (`*.bintest.ts`, `test:bin` project): requires `pnpm --filter @robota-sdk/agent-cli build`.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/** The built Node bundle — the artifact that could not spawn a subagent. */
const BUILT_BUNDLE = fileURLToPath(new URL('../../../dist/node/bin.js', import.meta.url));
/** Kept in step with `SUBAGENT_WORKER_MODE_FLAG`; spelled out so the wire contract is visible here. */
const WORKER_MODE_FLAG = '--__robota-subagent-worker';
const HANDSHAKE_BUDGET_MS = 30_000;
const TEST_TIMEOUT_MS = 45_000;
const MISUSE_EXIT_CODE = 2;

interface IWorkerHandshake {
  message: unknown;
  stderr: string;
}

/** Spawn the built bundle in worker mode over an IPC channel and wait for its first message. */
function handshakeWithWorker(): Promise<IWorkerHandshake> {
  return new Promise<IWorkerHandshake>((resolve, reject) => {
    const child = spawn(process.execPath, [BUILT_BUNDLE, WORKER_MODE_FLAG], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    let stderr = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`worker never completed the handshake; stderr: ${stderr.slice(0, 500)}`));
    }, HANDSHAKE_BUDGET_MS);

    child.once('message', (message: unknown) => {
      clearTimeout(timer);
      child.kill('SIGKILL');
      resolve({ message, stderr });
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`worker exited before any message (code ${code}); stderr: ${stderr}`));
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

describe('DIST-006 — the built binary is its own subagent worker', () => {
  it(
    'TC-A completes the worker IPC handshake',
    async () => {
      const { message, stderr } = await handshakeWithWorker();

      // `ready` is precisely what never arrived: the child died at module load instead.
      expect(message).toMatchObject({ type: 'ready' });
      expect(stderr).not.toMatch(/Cannot find module/);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'TC-B refuses the flag when there is no IPC channel',
    async () => {
      const result = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
        const child = spawn(process.execPath, [BUILT_BUNDLE, WORKER_MODE_FLAG], {
          stdio: ['ignore', 'ignore', 'pipe'],
        });
        let stderr = '';
        child.stderr?.setEncoding('utf8');
        child.stderr?.on('data', (chunk: string) => {
          stderr += chunk;
        });
        child.on('exit', (code) => resolve({ code, stderr }));
      });

      expect(result.code).toBe(MISUSE_EXIT_CODE);
      expect(result.stderr).toMatch(/requires an IPC channel/);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "ARCH-021: the built binary composes ROBOTA's pack tools, not an imported default set",
    async () => {
      // The strongest available real-artifact check, and the one the scratch-pack scenario could not
      // reach: the built binary composes statically, so there is no runtime pack-injection path. The
      // child declares what it composed, so the claim is verified per run rather than assumed.
      //
      // Red against unfixed code in the direction that matters: before ARCH-021 the child built from
      // `createDefaultTools()` regardless of the product, so this assertion was about the DEFAULT
      // tier and said nothing about robota's packs. It now reads the product's own surface.
      const { message } = await handshakeWithWorker();
      const names = (message as { composedToolNames?: readonly string[] }).composedToolNames;

      expect(names).toBeDefined();
      expect(names?.length ?? 0).toBeGreaterThan(0);
      // ARCH-006's invariant, asserted in the CHILD: these come from `pack-coding`, which the
      // product profile hands the whole tool surface.
      expect(names).toEqual(
        expect.arrayContaining(['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash']),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it('TC-C ships no worker file for anything to look for', () => {
    // The fix is not "emit the file where the resolver looks" — it is that nothing looks.
    const bundle = readFileSync(BUILT_BUNDLE, 'utf8');

    expect(bundle).not.toContain('child-process-subagent-worker.js');
    expect(bundle).toContain(WORKER_MODE_FLAG);
  });
});
