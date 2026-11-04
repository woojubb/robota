/**
 * A stdio MCP server is a program a repository may configure. In secure mode it runs in its own
 * session, its close ends everything it started, and when this process dies without running any
 * code (SIGKILL) the server ends on stdin EOF, as the MCP stdio convention requires. In plain mode it
 * runs exactly as before, in this process's group.
 */

import { execFileSync, spawn } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { enableOwnChildSessions } from '@robota-sdk/agent-core/node';
import { resetChildSessionsForTesting } from '@robota-sdk/agent-core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MCPDefinitionRegistry } from '../definition/registry.js';
import { MCPActivationAdmissionService } from '../mcp-activation.js';
import { createStdioAdapter } from '../node/stdio.js';
import { MCPStdioTransport } from '../node/stdio-transport.js';

const POSIX = process.platform !== 'win32';
const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const CHILD_TIMEOUT_MS = 30_000;

/**
 * Not an MCP server: the transport only starts and stops the program, and these cases are about
 * that. It reports its pid, its group and (in `group` mode) a grandchild it started into `pids`.
 */
const STUB = `
const { execFileSync, spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const [mode, pids] = process.argv.slice(2);
const group = execFileSync('/bin/ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' }).trim();
const grandchild = mode === 'group' ? spawn('/bin/sleep', ['60'], { stdio: 'ignore' }).pid : 0;
writeFileSync(pids, process.pid + ' ' + group + ' ' + grandchild);
process.stdin.resume();
// The MCP stdio convention: a server ends when its input ends. The 'group' stub does not, so its
// close has to be ended by signal.
if (mode === 'eof') process.stdin.on('end', () => process.exit(0));
setInterval(() => {}, 1000);
`;

let root: string;
const strays: number[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'mcp-stdio-session-')));
  writeFileSync(join(root, 'stub.cjs'), STUB);
});

afterEach(() => {
  resetChildSessionsForTesting();
  for (const pid of strays.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  rmSync(root, { recursive: true, force: true });
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor<T>(read: () => T | undefined, ms: number): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function goneWithin(pid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && alive(pid))
    await new Promise((resolve) => setTimeout(resolve, 50));
  return !alive(pid);
}

async function readPids(file: string): Promise<{ pid: number; group: number; grandchild: number }> {
  const text = await waitFor(
    () => (existsSync(file) ? readFileSync(file, 'utf8') : undefined),
    5000,
  );
  const [pid, group, grandchild] = text.trim().split(/\s+/u).map(Number);
  for (const value of [pid, grandchild]) if (value) strays.push(value);
  return { pid: pid!, group: group!, grandchild: grandchild! };
}

async function transportFor(mode: string): Promise<{ transport: MCPStdioTransport; pids: string }> {
  const stub = join(root, 'stub.cjs');
  const pids = join(root, `${mode}.pids`);
  const definition = {
    name: 'stub',
    source: 'project' as const,
    origin: 'stub',
    transport: 'stdio' as const,
    command: process.execPath,
    args: [stub, mode, pids],
    unsetVariables: [],
  };
  const request = new MCPDefinitionRegistry(
    [
      {
        name: 'stub',
        source: 'project',
        origin: 'stub',
        status: 'resolved',
        definition,
        shadowed: [],
      },
    ],
    { workspace: { repositoryKey: root, trustState: 'trusted', generation: 1 } },
  ).list()[0];
  if (request === undefined) throw new Error('missing request');
  const service = new MCPActivationAdmissionService();
  service.approve(request);
  const adapter = createStdioAdapter({
    admission: service,
    authority: {
      allowedRoot: root,
      generation: '1',
      executables: [{ command: process.execPath, args: [[stub, mode, pids]] }],
      environment: { HOME: root },
    },
  });
  const admission = await adapter.admit({ definition, activation: request });
  if (!admission.ok) throw new Error(`admission failed: ${admission.reason}`);
  const transport = adapter.construct(admission.admitted);
  if (!(transport instanceof MCPStdioTransport)) throw new Error('wrong transport');
  return { transport, pids };
}

function processGroupOf(pid: number): number {
  return Number(
    execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim(),
  );
}

describe.skipIf(!POSIX)('a stdio MCP server and the terminal session', () => {
  it('runs in this process group in plain mode, as before (guard)', async () => {
    const { transport, pids } = await transportFor('eof');
    await transport.start();
    try {
      const { group } = await readPids(pids);

      expect(group).toBe(processGroupOf(process.pid));
    } finally {
      await transport.close();
    }
  });

  it('leads its own session and group in secure mode', async () => {
    enableOwnChildSessions();
    const { transport, pids } = await transportFor('eof');
    await transport.start();
    try {
      const { pid, group } = await readPids(pids);

      expect(group).toBe(pid);
    } finally {
      await transport.close();
    }
  });

  it(
    'ends everything the server started when it is closed in secure mode',
    async () => {
      enableOwnChildSessions();
      const { transport, pids } = await transportFor('group');
      await transport.start();
      const { pid, grandchild } = await readPids(pids);

      await transport.close();

      expect(await goneWithin(pid, 3000)).toBe(true);
      expect(await goneWithin(grandchild, 3000)).toBe(true);
    },
    CHILD_TIMEOUT_MS,
  );

  it(
    'ends on stdin EOF when this process is SIGKILLed in secure mode (guard)',
    async () => {
      const stub = join(root, 'stub.cjs');
      const pids = join(root, 'killed.pids');
      const here = (path: string): string =>
        JSON.stringify(pathToFileURL(fileURLToPath(new URL(path, import.meta.url))).href);
      const script = [
        "import { enableOwnChildSessions } from '@robota-sdk/agent-core/node';",
        `import { MCPDefinitionRegistry } from ${here('../definition/registry.ts')};`,
        `import { MCPActivationAdmissionService } from ${here('../mcp-activation.ts')};`,
        `import { createStdioAdapter } from ${here('../node/stdio.ts')};`,
        'enableOwnChildSessions();',
        `const root = ${JSON.stringify(root)};`,
        `const args = [${JSON.stringify(stub)}, 'eof', ${JSON.stringify(pids)}];`,
        "const definition = { name: 'stub', source: 'project', origin: 'stub', transport: 'stdio', command: process.execPath, args, unsetVariables: [] };",
        "const request = new MCPDefinitionRegistry([{ name: 'stub', source: 'project', origin: 'stub', status: 'resolved', definition, shadowed: [] }], { workspace: { repositoryKey: root, trustState: 'trusted', generation: 1 } }).list()[0];",
        'const service = new MCPActivationAdmissionService();',
        'service.approve(request);',
        "const adapter = createStdioAdapter({ admission: service, authority: { allowedRoot: root, generation: '1', executables: [{ command: process.execPath, args: [args] }], environment: { HOME: root } } });",
        'const admission = await adapter.admit({ definition, activation: request });',
        'await adapter.construct(admission.admitted).start();',
        "process.stdout.write('started\\n');",
        'setInterval(() => {}, 1000);',
      ].join('\n');
      const parent = spawn(
        process.execPath,
        ['--import', tsx, '--input-type=module', '-e', script],
        {
          cwd: fileURLToPath(new URL('../..', import.meta.url)),
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let stderr = '';
      parent.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
      await waitFor(() => (existsSync(pids) ? true : undefined), 20_000).catch(() => {
        throw new Error(`the parent never started the server: ${stderr}`);
      });
      const { pid, group } = await readPids(pids);
      expect(group).toBe(pid);

      parent.kill('SIGKILL');

      expect(await goneWithin(pid, 5000)).toBe(true);
    },
    CHILD_TIMEOUT_MS,
  );
});
