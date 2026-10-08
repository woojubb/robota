import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';
import { createTestBinaryEnvironment } from './helpers/product-runtime.js';
import { hostedFixture } from '../hosted/__tests__/hosted-fixture.js';
import { robotaEnvironment } from '../../../../products/robota.mjs';

const root = fileURLToPath(new URL('../../../..', import.meta.url));
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'hosted-admission-')));
const taskHome = join(scratch, 'home');
const workspace = join(scratch, 'workspace');
mkdirSync(taskHome);
mkdirSync(workspace);
const embeddedEntry = join(scratch, 'embedded-cli.mjs');
writeFileSync(
  embeddedEntry,
  `import { startCli } from ${JSON.stringify(pathToFileURL(join(root, 'packages/agent-cli/src/cli.ts')).href)};
startCli({ environment: process.env }).catch((error) => { process.stderr.write(error.message + '\\n'); process.exitCode = 1; });\n`,
);
const completeEntry = join(scratch, 'complete-cli.mjs');
writeFileSync(
  completeEntry,
  `import { startCliEntry } from ${JSON.stringify(pathToFileURL(join(root, 'packages/agent-cli/src/cli-entry.ts')).href)};
void startCliEntry({ environment: process.env });\n`,
);

const fixtures: Awaited<ReturnType<typeof hostedFixture>>[] = [];
afterAll(async () => {
  for (const value of fixtures) await value.close();
  rmSync(scratch, { recursive: true, force: true });
});

function run(
  args: readonly string[],
  environment: Record<string, string>,
  entry: 'complete' | 'headless' | 'embedded' = 'complete',
): Promise<{ status: number | null; stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const argv = [
      '--import',
      join(root, 'node_modules/tsx/dist/loader.mjs'),
      '--conditions=source',
      entry === 'headless'
        ? join(root, 'packages/agent-cli/src/headless-bin.ts')
        : entry === 'complete' ? completeEntry : embeddedEntry,
      ...args,
      '--safe-mode',
    ];
    const child = spawn(process.execPath, argv, {
      cwd: workspace,
      env: createTestBinaryEnvironment(
        taskHome,
        entry === 'headless'
          ? { ...robotaEnvironment({}, taskHome), ...environment }
          : environment,
      ),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    let stdout = '';
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    child.stdin.end();
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('CLI did not settle admission'));
    }, 40_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stderr, stdout });
    });
  });
}

describe('the actual CLI admits hosted execution before composing a session', () => {
  it.each([
    ['headless', ['-p', 'hello']],
    ['daemon', ['--serve']],
    ['MCP', ['mcp', 'serve']],
    ['resume', ['-p', 'hello', '--resume', 'old-session']],
    ['launch handler', ['open', 'invalid-launch-link']],
  ])(
    'refuses %s without mandatory worker and broker configuration',
    async (_name, args) => {
      const result = await run(args, { PRODUCT_RUNTIME_POSTURE: 'hosted' });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Hosted runtime admission refused');
      expect(result.stderr).toContain('mandatory worker and broker');
      expect(result.stderr).not.toContain('No provider configuration found');
      expect(result.stdout).not.toContain('listening');
    },
    60_000,
  );

  it.each([
    ['headless', ['-p', 'hello']],
    ['daemon', ['--serve']],
    ['MCP', ['mcp', 'serve']],
  ])(
    'refuses %s on a real backend outage before provider composition',
    async (_name, args) => {
      const value = await hostedFixture();
      fixtures.push(value);
      value.setUnavailable('worker');
      const result = await run(args, value.environment);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('worker backend is unavailable');
      expect(result.stderr).not.toContain('No provider configuration found');
      expect(result.stdout).not.toContain('listening');
    },
    60_000,
  );

  it('refuses a stale signed broker epoch through the CLI itself', async () => {
    const value = await hostedFixture();
    fixtures.push(value);
    value.setProofTransform((proof) => (proof.role === 'broker' ? { ...proof, epoch: 2 } : proof));
    const result = await run(['-p', 'hello'], value.environment);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('broker identity, challenge or policy epoch does not match');
    expect(result.stderr).not.toContain('No provider configuration found');
  }, 60_000);

  it.each([['--resume', 'old-session'], ['--resume=old-session']])(
    'refuses snapshot-free resume %j without reaching either backend',
    async (...args) => {
      const value = await hostedFixture();
      fixtures.push(value);
      const result = await run(['-p', 'hello', ...args], value.environment);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('resume requires a verified worker snapshot');
      expect(value.requests()).toBe(0);
    },
    60_000,
  );

  it('never accepts signed health proofs as a substitute for an execution adapter', async () => {
    const value = await hostedFixture();
    fixtures.push(value);
    const result = await run(['-p', 'hello'], value.environment);
    expect(value.requests()).toBe(2);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('task worker execution adapter is unavailable');
    expect(result.stderr).toContain('host execution is refused');
  }, 60_000);

  it.each(['complete', 'headless', 'embedded'] as const)(
    'refuses the private local subagent route before composing host tools (%s)',
    async (entry) => {
      const value = await hostedFixture();
      fixtures.push(value);
      const result = await run(['--__agent-subagent-worker'], value.environment, entry);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('local subagent worker is unavailable in hosted posture');
      expect(result.stderr).toContain('host execution is refused');
      expect(value.requests()).toBe(0);
    },
    60_000,
  );

  it('refuses corrupted resume snapshot configuration before any backend or host session', async () => {
    const value = await hostedFixture();
    fixtures.push(value);
    value.writeConfig({ ...value.config, snapshot: { id: 'checkpoint-1', digest: 'corrupt' } });
    const result = await run(['-p', 'hello', '--resume', 'old-session'], value.environment);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('snapshot digest must be SHA-256');
    expect(result.stderr).not.toContain('No provider configuration found');
    expect(value.requests()).toBe(0);
  }, 60_000);

  it('retains the local startup path when hosted posture was not selected', async () => {
    const result = await run(['-p', 'hello'], { PRODUCT_RUNTIME_POSTURE: 'local' });
    expect(result.stderr).not.toContain('Hosted runtime admission refused');
    expect(result.stderr).toContain('No provider configuration found');
  }, 60_000);

  it('resolves a local open invocation before parsing an invalid flag', async () => {
    const result = await run(['open', 'invalid-launch-link', '--unknown-launch-flag'], {
      PRODUCT_RUNTIME_POSTURE: 'local',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Link refused:');
    expect(result.stderr).not.toContain('Unknown option');
    expect(result.stderr).not.toContain('Hosted runtime admission refused');
  }, 60_000);
});
