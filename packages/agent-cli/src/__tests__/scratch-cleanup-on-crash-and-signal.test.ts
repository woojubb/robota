/**
 * A run's scratch directories hold conversation content (spilled tool results, the editor buffer).
 * They must be gone however the run ends — a print run interrupted or hung up mid-turn, or a crash
 * that the CLI's crash policy rethrows — and the run must end exactly as it did before: death by the
 * same signal, or the same exit code.
 *
 * Each case runs the real source in a child process, because a signal's default action and Node's
 * fatal-exception exit are what is under test.
 */
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';
import { resolveSdk } from './helpers/sdk-url.js';

const CHILD_TIMEOUT_MS = 60_000;
const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const source = (relative: string): string =>
  pathToFileURL(fileURLToPath(new URL(relative, import.meta.url))).href;
const sdk = resolveSdk;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'test-product-scratch-end-')));
  roots.push(root);
  return root;
}

interface IChildEnd {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
}

/** Run `entry` as a module; once `ready` exists, deliver `send` (if any). */
function runEntry(
  entry: string,
  options: { cwd: string; env: NodeJS.ProcessEnv; ready?: string; send?: NodeJS.Signals },
): Promise<IChildEnd> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', tsx, '--conditions=product-source', entry], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), CHILD_TIMEOUT_MS);
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    const poll =
      options.ready === undefined
        ? undefined
        : setInterval(() => {
            if (!existsSync(options.ready!)) return;
            clearInterval(poll);
            child.kill(options.send);
          }, 50);
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (poll !== undefined) clearInterval(poll);
      resolve({ code, signal, stderr });
    });
  });
}

describe('a crash the CLI crash policy rethrows', () => {
  it(
    'removes the registered scratch directories and still exits with the fatal-handler code',
    async () => {
      const root = tempRoot();
      const parent = join(root, 'spill');
      const entry = join(root, 'crash-entry.mjs');
      writeFileSync(
        entry,
        [
          `import { installCliCrashPolicy } from ${JSON.stringify(source('../cli-crash-policy.ts'))};`,
          `import { createProcessScopedDirectory, removeDirectoryOnProcessExit } from ${JSON.stringify(sdk('@robota-sdk/agent-core/node'))};`,
          "import { writeFileSync } from 'node:fs';",
          "installCliCrashPolicy('test-product');",
          `const directory = createProcessScopedDirectory(${JSON.stringify(parent)}, 'agent-tool-results-');`,
          "writeFileSync(directory + '/result.txt', 'conversation content');",
          'removeDirectoryOnProcessExit(directory);',
          "setTimeout(() => { throw new Error('boom from a headless run'); }, 10);",
        ].join('\n'),
      );

      const end = await runEntry(entry, { cwd: root, env: { ...process.env } });

      // 7: an `uncaughtException` handler threw — what the rethrowing crash policy has always produced.
      expect({ code: end.code, signal: end.signal }).toEqual({ code: 7, signal: null });
      expect(end.stderr).toContain('boom from a headless run');
      expect(readdirSync(parent)).toEqual([]);
    },
    CHILD_TIMEOUT_MS,
  );
});

describe.skipIf(process.platform === 'win32')('a print run ended by a signal mid-turn', () => {
  for (const signal of ['SIGINT', 'SIGHUP'] as const) {
    it(
      `leaves no spilled result after ${signal} and still dies by ${signal}`,
      async () => {
        const root = tempRoot();
        const home = join(root, 'home');
        const project = join(root, 'project');
        mkdirSync(home);
        mkdirSync(project);
        const ready = join(root, 'spilled');
        const entry = join(root, 'print-entry.mjs');
        writeFileSync(
          entry,
          [
            "import { writeFileSync } from 'node:fs';",
            `import { startCli } from ${JSON.stringify(source('../cli.ts'))};`,
            `import { createTestProductRuntime } from ${JSON.stringify(source('./helpers/product-runtime.ts'))};`,
            `import { prepareSpillParentDirectory } from ${JSON.stringify(source('../startup/ephemeral-state.ts'))};`,
            `import { createNodeToolResultSpillStore } from ${JSON.stringify(sdk('@robota-sdk/agent-framework/node'))};`,
            `const productRuntime = createTestProductRuntime('test-product', { HOME: ${JSON.stringify(home)}, PRODUCT_SCRATCH_END_TEST_KEY: 'test-only-key' });`,
            'const providerDefinition = {',
            "  type: 'scratch-end-test',",
            "  defaults: { model: 'test-model', apiKey: '$ENV:PRODUCT_SCRATCH_END_TEST_KEY' },",
            '  requiresApiKey: true,',
            '  createProvider: () => ({',
            "    name: 'scratch-end-test',",
            "    version: 'test',",
            '    async chat() {',
            "      const store = createNodeToolResultSpillStore({ parentDirectory: prepareSpillParentDirectory(productRuntime), sealing: 'plain' });",
            "      await store.write('a spilled tool result');",
            `      writeFileSync(${JSON.stringify(ready)}, 'spilled');`,
            '      return new Promise(() => {});',
            '    },',
            "    async generateResponse() { return { content: 'unused' }; },",
            '    supportsTools: () => true,',
            '    validateConfig: () => true,',
            '  }),',
            '};',
            "process.argv = ['node', 'test-product', '-p', 'say hello'];",
            'await startCli({ productRuntime, providerDefinitions: [providerDefinition] });',
            `writeFileSync(${JSON.stringify(join(root, 'spill-parent'))}, productRuntime.layout.userPaths.spill);`,
          ].join('\n'),
        );

        const end = await runEntry(entry, {
          cwd: project,
          env: { ...process.env, HOME: home, PRODUCT_SCRATCH_END_TEST_KEY: 'test-only-key' },
          ready,
          send: signal,
        });

        expect(existsSync(ready), end.stderr).toBe(true);
        expect({ code: end.code, signal: end.signal }).toEqual({ code: null, signal });
        const spill = join(home, '.test-product', 'spill');
        expect(readdirSync(spill)).toEqual([]);
        expect(existsSync(join(root, 'spill-parent'))).toBe(false);
        expect(readFileSync(ready, 'utf8')).toBe('spilled');
      },
      CHILD_TIMEOUT_MS,
    );
  }
});
