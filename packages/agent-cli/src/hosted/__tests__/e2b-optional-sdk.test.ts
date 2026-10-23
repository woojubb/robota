import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createTestBinaryEnvironment } from '../../__tests__/helpers/product-runtime.js';
import { hostedFixture } from './hosted-fixture.js';

const repo = fileURLToPath(new URL('../../../../..', import.meta.url));
type TAvailability =
  'absent' | 'broken-entry' | 'nested-dependency' | 'initialization' | 'incompatible-exports';

async function probe(
  code: string,
  environment: Record<string, string> = {},
  availability: TAvailability = 'absent',
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const directory = mkdtempSync(join(tmpdir(), 'e2b-optional-'));
  const home = join(directory, 'home');
  mkdirSync(home);
  const sdk = join(directory, 'sdk.mjs');
  if (availability === 'initialization')
    writeFileSync(sdk, "throw new Error('synthetic SDK initialization fault');\n");
  if (availability === 'nested-dependency')
    writeFileSync(sdk, "import 'synthetic-e2b-nested-missing';\n");
  if (availability === 'incompatible-exports')
    writeFileSync(sdk, 'export const Sandbox = undefined;\n');
  const hook = join(directory, 'resolve.mjs');
  writeFileSync(
    hook,
    `export async function resolve(specifier, context, next) {
    if (specifier === 'e2b' || specifier.startsWith('e2b/')) {
      if (${JSON.stringify(availability)} !== 'absent') {
        if (specifier === 'e2b') return next(specifier, context);
        return { url: ${JSON.stringify(pathToFileURL(sdk).href)}, shortCircuit: true };
      }
      throw Object.assign(new Error("Cannot find package 'e2b' imported from " + context.parentURL), { code: 'ERR_MODULE_NOT_FOUND' });
    }
    return next(specifier, context);
  }\n`,
  );
  const register = `import { register } from 'node:module'; register(${JSON.stringify(pathToFileURL(hook).href)});`;
  const entry = join(directory, 'probe.mjs');
  writeFileSync(entry, code);
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          '--import',
          join(repo, 'node_modules/tsx/dist/loader.mjs'),
          '--conditions=source',
          '--import',
          `data:text/javascript,${encodeURIComponent(register)}`,
          entry,
        ],
        {
          cwd: directory,
          env: createTestBinaryEnvironment(home, environment),
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('close', (status) => {
        clearTimeout(timer);
        resolve({ status, stdout, stderr });
      });
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function source(relative: string): string {
  return JSON.stringify(pathToFileURL(join(repo, 'packages/agent-cli/src', relative)).href);
}

describe('optional E2B capability', () => {
  it('imports public helpers without resolving the optional SDK', async () => {
    const result = await probe(`
      const api = await import(${source('index.ts')});
      const inventory = api.createE2BOrganizationInventory({ apiKey: 'synthetic', controlPlane: 'owner', tenant: 'tenant' });
      console.log(JSON.stringify({ inventory: typeof inventory.list, connect: typeof api.connectE2BTaskWorker,
        provision: typeof api.provisionE2BTaskWorker, errorIdentity: new api.E2BWorkerProvisioningError('allocation-unknown', 'operation') instanceof api.E2BWorkerProvisioningError }));
    `);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      inventory: 'function',
      connect: 'function',
      provision: 'function',
      errorIdentity: true,
    });
  }, 40_000);

  it('refuses before admission effects when the stock SDK is absent', async () => {
    const fixture = await hostedFixture();
    try {
      const result = await probe(
        `
        const { runHostedRuntime } = await import(${source('hosted/hosted-runtime-startup.ts')});
        process.argv.splice(2, process.argv.length, '-p', 'hello');
        try { await runHostedRuntime({}, process.env, 'test-product'); process.exitCode = 2; }
        catch (error) { console.log(JSON.stringify({ message: error.message })); }
      `,
        {
          ...fixture.environment,
          PRODUCT_HOSTED_WORKER_EXECUTION_CONFIG: join(fixture.directory, 'not-read.json'),
        },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        message: expect.stringMatching(/E2B.*not installed.*e2b@2\.51\.0/u),
      });
      expect(fixture.requests()).toBe(0);
    } finally {
      await fixture.close();
    }
  }, 40_000);

  it('keeps injected executors usable without the stock SDK', async () => {
    const fixture = await hostedFixture();
    try {
      const result = await probe(
        `
        const { runHostedRuntime } = await import(${source('hosted/hosted-runtime-startup.ts')});
        process.argv.splice(2, process.argv.length, '-p', 'hello');
        const calls = [];
        await runHostedRuntime({ hostedRuntimeExecutorFactory: async () => ({
          run: async () => { calls.push('run'); }, stop: async () => { calls.push('stop'); }, release: async () => { calls.push('release'); },
        }) }, process.env, 'test-product');
        console.log(JSON.stringify(calls));
      `,
        {
          ...fixture.environment,
          PRODUCT_HOSTED_WORKER_EXECUTION_CONFIG: join(fixture.directory, 'not-read.json'),
        },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(['run', 'stop', 'release']);
      expect(fixture.requests()).toBeGreaterThanOrEqual(2);
    } finally {
      await fixture.close();
    }
  }, 40_000);

  it.each(['broken-entry', 'nested-dependency', 'initialization', 'incompatible-exports'] as const)(
    'retains installed SDK failure causes for %s',
    async (availability) => {
      const result = await probe(
        `
        const { loadE2BSdk } = await import(${source('hosted/e2b-sdk.ts')});
        try { await loadE2BSdk(); process.exitCode = 2; }
        catch (error) { console.log(JSON.stringify({ message: error.message, cause: error.cause?.message })); }
      `,
        {},
        availability,
      );
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        message: expect.stringMatching(/E2B.*failed to load/u),
        cause: expect.any(String),
      });
      expect(result.stdout).not.toMatch(/not installed/u);
    },
    40_000,
  );
});
