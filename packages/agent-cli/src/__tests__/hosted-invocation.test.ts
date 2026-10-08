import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';
import { createTestBinaryEnvironment } from './helpers/product-runtime.js';
import { hostedFixture } from '../hosted/__tests__/hosted-fixture.js';

const root = fileURLToPath(new URL('../../../..', import.meta.url));
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'hosted-invocation-')));
const fixtures: Awaited<ReturnType<typeof hostedFixture>>[] = [];
afterAll(async () => {
  for (const fixture of fixtures) await fixture.close();
  rmSync(scratch, { recursive: true, force: true });
});

async function invoke(argv: string[], resume = false, mutate = false) {
  const fixture = await hostedFixture();
  fixtures.push(fixture);
  if (resume) {
    const snapshot = { id: 'checkpoint', digest: 'a'.repeat(64) };
    fixture.writeConfig({ ...fixture.config, snapshot });
    fixture.setProofTransform((proof) => ({ ...proof, snapshot }));
  }
  if (mutate) fixture.setBrokerDelay(100);
  const directory = mkdtempSync(join(scratch, 'run-'));
  const home = join(directory, 'home');
  const workspace = join(directory, 'workspace');
  mkdirSync(home);
  mkdirSync(workspace);
  const resultFile = join(directory, 'worker-result.json');
  const entry = join(directory, 'entry.mjs');
  writeFileSync(
    entry,
    `
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { startCli } from ${JSON.stringify(pathToFileURL(join(root, 'packages/agent-cli/src/cli.ts')).href)};
let child;
let closed;
const cleanup = [];
const workerScript = 'let input="";process.stdin.setEncoding("utf8");process.stdin.on("data",data=>input+=data);process.stdin.on("end",()=>process.stdout.write(input));';
const run = startCli({ environment: process.env, hostedRuntimeExecutorFactory: async (admission, signal, invocation) => {
  writeFileSync(${JSON.stringify(join(directory, 'factory-called'))}, 'called');
  if (invocation === undefined || !Object.isFrozen(invocation) || !Object.isFrozen(invocation.argv)) throw new Error('missing immutable hosted invocation');
  try { invocation.argv.push('mutated'); throw new Error('invocation was mutable'); } catch (error) { if (!(error instanceof TypeError)) throw error; }
  return {
    run: async (_admission, control) => {
      signal.throwIfAborted(); control.signal.throwIfAborted();
      child = spawn(process.execPath, ['-e', workerScript], { cwd: ${JSON.stringify(workspace)}, env: { HOME: ${JSON.stringify(home)} }, stdio: ['pipe', 'pipe', 'pipe'] });
      let result = '';
      child.stdout.on('data', chunk => result += chunk);
      closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error('fixture worker failed'))); });
      child.stdin.end(JSON.stringify({ invocation, identity: admission.config.identity, epoch: admission.config.epoch }));
      await closed;
      writeFileSync(${JSON.stringify(resultFile)}, result);
    },
    stop: async () => { cleanup.push('stop'); if (child?.exitCode === null) child.kill(); await closed; },
    release: async () => { cleanup.push('release'); writeFileSync(${JSON.stringify(join(directory, 'cleanup.json'))}, JSON.stringify(cleanup)); },
  };
}});
${mutate ? "process.argv.splice(2, process.argv.length, '--serve', 'changed-after-capture');" : ''}
run.catch(error => { process.stderr.write(error.message + '\\n'); process.exitCode = 1; });
`,
  );
  const outcome = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        join(root, 'node_modules/tsx/dist/loader.mjs'),
        '--conditions=source',
        entry,
        ...argv,
      ],
      {
        cwd: workspace,
        env: createTestBinaryEnvironment(home, fixture.environment),
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('fixture CLI did not finish'));
    }, 40_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
  return { ...outcome, directory, resultFile, fixture };
}

describe('the actual CLI passes its captured request to the hosted execution owner', () => {
  it.each([
    ['headless', ['-p', 'task marker', '--safe-mode']],
    ['serve', ['--serve', '--safe-mode']],
    ['mcp', ['mcp', 'serve', '--safe-mode']],
    ['headless', ['-p', 'task marker', '--serve', '--safe-mode']],
    ['interactive', ['--goal=', '--safe-mode']],
    ['serve', ['--goal=', '--serve', '--safe-mode']],
    ['command', ['--help', '-p', 'unused task']],
    ['command', ['--version', '--serve']],
  ])(
    'delivers %s to the separately owned fixture worker',
    async (mode, argv) => {
      const result = await invoke(argv);
      expect(result.stderr).toBe('');
      expect(result.code).toBe(0);
      const output = JSON.parse(readFileSync(result.resultFile, 'utf8'));
      expect(output).toEqual({
        invocation: { mode, argv, resume: false },
        identity: result.fixture.config.identity,
        epoch: result.fixture.config.epoch,
      });
      expect(JSON.parse(readFileSync(join(result.directory, 'cleanup.json'), 'utf8'))).toEqual([
        'stop',
        'release',
      ]);
    },
    60_000,
  );

  it('keeps resume selection and original arguments while admission awaits', async () => {
    const argv = ['-p', 'original task', '--resume=prior-session', '--safe-mode'];
    const result = await invoke(argv, true, true);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(JSON.parse(readFileSync(result.resultFile, 'utf8')).invocation).toEqual({
      mode: 'headless',
      argv,
      resume: true,
    });
  }, 60_000);

  it('refuses direct API-key configuration before admission or execution', async () => {
    const result = await invoke(['-p', 'task', '--api-key=synthetic-fixture-only']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('direct API-key configuration');
    expect(result.fixture.requests()).toBe(0);
    expect(existsSync(join(result.directory, 'factory-called'))).toBe(false);
  }, 60_000);

  it.each([
    [['mcp', 'bad'], 'Usage:'],
    [['mcp', 'serve', '-p', 'task'], 'Usage:'],
    [['mcp', 'serve', '-p'], 'cannot be combined'],
    [['mcp', 'serve', '--http-port=8443'], 'only valid for mcp serve HTTP mode'],
    [['--serve', '--http-port=8443'], 'not served by a task worker'],
  ])(
    'refuses invalid MCP invocation %j before either backend or execution',
    async (argv, message) => {
      const result = await invoke(argv);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(message);
      expect(result.fixture.requests()).toBe(0);
      expect(existsSync(join(result.directory, 'factory-called'))).toBe(false);
    },
    60_000,
  );

  it('preserves credential-shaped text after the option terminator as task content', async () => {
    const argv = ['-p', '--', '--api-key=ordinary task text'];
    const result = await invoke(argv);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(JSON.parse(readFileSync(result.resultFile, 'utf8')).invocation.argv).toEqual(argv);
  }, 60_000);
});
