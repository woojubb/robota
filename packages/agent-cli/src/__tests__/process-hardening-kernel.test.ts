/**
 * The kernel's side of same-user inspection hardening, which no fake can prove: a second process of
 * the same user is refused `/proc/<pid>/environ` of a hardened process and still gets it from an
 * unhardened one, the hardened process still does the product's own work through `/proc/self`, and
 * SIGUSR1 opens no inspector a same-user client could connect to. Runs on Linux only, and not as
 * root — root reads every process's environment whatever its dumpable state, so the comparison
 * would say nothing.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../..', import.meta.url));
const runnable = process.platform === 'linux' && process.getuid?.() !== 0;
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'process-hardening-')));
const READY = `process.stdout.write('ready ' + applied + '\\n');\nprocess.stdin.resume();\n`;
const sourceUrl = (path: string): string => JSON.stringify(pathToFileURL(join(root, path)).href);
/** An unprotected process prints its inspector URL within milliseconds of the signal. */
const INSPECTOR_SETTLE_MS = 1_500;

const entry = join(scratch, 'entry.mjs');
writeFileSync(
  entry,
  `import { hardenProcessAgainstSameUserInspection, hardenProductProcess } from ${sourceUrl('packages/agent-cli/src/process-hardening.ts')};
const mode = process.argv[2];
const applied = mode === 'harden' ? hardenProcessAgainstSameUserInspection() : mode === 'product' ? (hardenProductProcess(), 'product') : false;
${READY}`,
);

/**
 * A hardened process doing what the product does through `/proc/self`: a trusted project-state
 * write walks `/proc/self/fd`, and the Read tool's path guard resolves `/proc/self/fd/<n>`. The
 * escaping link and the linked ancestor are the negative controls: still refused once hardened.
 */
const battery = join(scratch, 'battery.mjs');
writeFileSync(
  battery,
  `import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hardenProductProcess } from ${sourceUrl('packages/agent-cli/src/process-hardening.ts')};
import { createNodeWorkspaceTrustService, getWorkspaceProjectStateStorage } from ${sourceUrl('packages/agent-framework/src/index.ts')};
import { createReadTool } from ${sourceUrl('packages/agent-tools/src/index.ts')};

hardenProductProcess();
const prctl = createRequire(${sourceUrl('packages/agent-cli/package.json')})('koffi')
  .load('libc.so.6')
  .func('int prctl(int option, unsigned long a2, unsigned long a3, unsigned long a4, unsigned long a5)');
const attempt = (run) => { try { run(); return 'ok'; } catch (error) { return error.code ?? error.name; } };
const base = realpathSync(mkdtempSync(join(tmpdir(), 'hardened-battery-')));
try {
  const workspace = join(base, 'workspace');
  const outside = join(base, 'outside');
  mkdirSync(workspace);
  mkdirSync(join(outside, 'elsewhere'), { recursive: true });
  writeFileSync(join(workspace, 'inside.txt'), 'INSIDE-CONTENT');
  writeFileSync(join(outside, 'secret.txt'), 'OUTSIDE-SECRET');
  symlinkSync(join(outside, 'secret.txt'), join(workspace, 'escape.txt'));
  // A workspace's trust identity is its Git root.
  execFileSync('git', ['init', '--quiet'], { cwd: workspace });
  const trust = createNodeWorkspaceTrustService(join(base, 'trust.json'), {
    sessions: '.state/sessions', 'session-logs': '.state/logs', memory: '.state/memory', checkpoints: '.state/checkpoints',
  });
  const access = await trust.grant(workspace);
  const logs = getWorkspaceProjectStateStorage(access.authority, 'session-logs');
  const result = { dumpable: prctl(3, 0, 0, 0, 0), trust: access.status };
  result.write = attempt(() => logs.writeText('nested/run.jsonl', '{"line":1}\\n', 'kernel test'));
  result.onDisk = readFileSync(join(workspace, '.state/logs/nested/run.jsonl'), 'utf8');
  result.readBack = logs.readText('nested/run.jsonl', 'kernel test');
  symlinkSync(join(outside, 'elsewhere'), join(workspace, '.state/logs/linked'));
  result.linkedAncestor = attempt(() => logs.writeText('linked/x.jsonl', 'no', 'kernel test'));
  result.outsideAfterLinkedWrite = readdirSync(join(outside, 'elsewhere'));
  const read = async (file) => JSON.parse(String((await createReadTool({ cwd: workspace }).execute({ filePath: join(workspace, file) })).data));
  const inside = await read('inside.txt');
  const escape = await read('escape.txt');
  result.readInside = inside.success === true && inside.output.includes('INSIDE-CONTENT');
  result.readEscape = escape.success === true || escape.output.includes('OUTSIDE-SECRET');
  process.stdout.write('result ' + JSON.stringify(result) + '\\n');
} finally {
  rmSync(base, { recursive: true, force: true });
}
`,
);

/**
 * The shipped CommonJS wrapper, copied beside a stand-in for the module graph it imports: whatever
 * the wrapper does before that import is all the stand-in process has seen.
 */
const wrapper = join(scratch, 'wrapper', 'bin', 'agent.cjs');
mkdirSync(join(scratch, 'wrapper', 'bin'), { recursive: true });
mkdirSync(join(scratch, 'wrapper', 'dist', 'node'), { recursive: true });
mkdirSync(join(scratch, 'wrapper', 'node_modules'), { recursive: true });
writeFileSync(join(scratch, 'wrapper', 'package.json'), '{"type":"module"}\n');
copyFileSync(join(root, 'packages/agent-cli/bin/agent.cjs'), wrapper);
writeFileSync(
  join(scratch, 'wrapper', 'dist', 'node', 'bin.js'),
  `const applied = 'n/a';\n${READY}`,
);
symlinkSync(
  dirname(createRequire(import.meta.url).resolve('koffi')),
  join(scratch, 'wrapper', 'node_modules', 'koffi'),
  'dir',
);

const children: ChildProcessWithoutNullStreams[] = [];
afterAll(() => {
  for (const child of children) child.kill('SIGKILL');
  rmSync(scratch, { recursive: true, force: true });
});

interface IStarted {
  readonly pid: number;
  readonly applied: string;
  readonly stderr: () => string;
}

/** Starts a same-user process and resolves once it reports ready; `applied` is what it reported. */
function startProcess(argv: readonly string[], env: NodeJS.ProcessEnv = {}): Promise<IStarted> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...argv], {
      env: { ...process.env, HARDENING_TEST_SECRET: 'kernel-test-value', ...env },
    });
    children.push(child);
    let output = '';
    let errors = '';
    child.stderr.on('data', (chunk: Buffer) => {
      errors += chunk.toString('utf8');
    });
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      const ready = /^ready (\S+)$/mu.exec(output);
      if (ready !== null && child.pid !== undefined)
        resolve({ pid: child.pid, applied: ready[1] ?? '', stderr: () => errors });
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      reject(new Error(`entry exited with ${code} before it was ready: ${errors}`)),
    );
  });
}

const TSX = ['--import', join(root, 'node_modules/tsx/dist/loader.mjs'), '--conditions=source'];

function startEntry(mode: 'harden' | 'product' | 'control', env?: NodeJS.ProcessEnv): Promise<IStarted> {
  return startProcess([...TSX, entry, mode], env);
}

function readProcFile(pid: number, name: string): 'readable' | string {
  try {
    readFileSync(`/proc/${pid}/${name}`);
    return 'readable';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code ?? 'unknown';
  }
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/** What a same-user inspector client gets: the target list, then a debugger session over WebSocket. */
async function inspectorClientConnects(port: number): Promise<boolean> {
  let targets: { webSocketDebuggerUrl?: string }[];
  try {
    targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as typeof targets;
  } catch {
    return false;
  }
  const url = targets[0]?.webSocketDebuggerUrl;
  if (url === undefined) return false;
  return new Promise((resolve) => {
    const socket = new WebSocket(url);
    socket.addEventListener('open', () => {
      socket.close();
      resolve(true);
    });
    socket.addEventListener('error', () => resolve(false));
  });
}

/** Sends SIGUSR1 to a process started with `--inspect-port=<port>` and reports what opened. */
async function signalInspector(
  started: IStarted,
  port: number,
): Promise<{ announced: boolean; clientConnects: boolean; alive: boolean }> {
  process.kill(started.pid, 'SIGUSR1');
  const deadline = Date.now() + INSPECTOR_SETTLE_MS;
  while (Date.now() < deadline && !started.stderr().includes('Debugger listening')) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const clientConnects = await inspectorClientConnects(port);
  let alive = true;
  try {
    process.kill(started.pid, 0);
  } catch {
    alive = false;
  }
  return { announced: started.stderr().includes('Debugger listening'), clientConnects, alive };
}

(runnable ? describe : describe.skip)('same-user inspection hardening on a real kernel', () => {
  it('refuses another process of the same user /proc/<pid>/environ once hardened', async () => {
    const control = await startEntry('control');
    const hardened = await startEntry('harden');

    expect(control.applied).toBe('false');
    expect(readProcFile(control.pid, 'environ')).toBe('readable');
    expect(hardened.applied).toBe('true');
    expect(readProcFile(hardened.pid, 'environ')).toBe('EACCES');
  }, 60_000);

  it('leaves what other tools read to find a process alive and identify it', async () => {
    const hardened = await startEntry('harden');

    expect(hardened.applied).toBe('true');
    for (const name of ['stat', 'status', 'cmdline']) {
      expect(readProcFile(hardened.pid, name)).toBe('readable');
    }
    expect(() => process.kill(hardened.pid, 0)).not.toThrow();
  }, 60_000);

  it('still reads through the Read tool and writes trusted project state once hardened', async () => {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [...TSX, battery]);
      children.push(child);
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
      child.on('error', reject);
      child.on('exit', (code) => (code === 0 ? resolve(stdout) : reject(new Error(stderr))));
    });
    const result = JSON.parse(/^result (.+)$/mu.exec(output)?.[1] ?? '{}') as Record<string, unknown>;

    expect(result).toEqual({
      dumpable: 0,
      trust: 'trusted',
      write: 'ok',
      onDisk: '{"line":1}\n',
      readBack: '{"line":1}\n',
      linkedAncestor: 'WORKSPACE_AUTHORITY_REQUIRED',
      outsideAfterLinkedWrite: [],
      readInside: true,
      readEscape: false,
    });
  }, 120_000);

  it('opens no inspector on SIGUSR1 in a process the product entry hardened', async () => {
    const port = await freePort();
    const hardened = await startEntry('product', { NODE_OPTIONS: `--inspect-port=${port}` });

    expect(readProcFile(hardened.pid, 'environ')).toBe('EACCES');
    expect(await signalInspector(hardened, port)).toEqual({
      announced: false,
      clientConnects: false,
      alive: true,
    });
  }, 60_000);

  it('is applied by the executable wrapper before the module graph it loads', async () => {
    const port = await freePort();
    const started = await startProcess([wrapper], { NODE_OPTIONS: `--inspect-port=${port}` });

    expect(readProcFile(started.pid, 'environ')).toBe('EACCES');
    expect(await signalInspector(started, port)).toEqual({
      announced: false,
      clientConnects: false,
      alive: true,
    });
  }, 60_000);
});
