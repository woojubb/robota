/**
 * The point of children in their own session, observed on a real terminal: a process with a
 * controlling terminal (a pty here) starts a command hook, a stdio MCP server and a handover child,
 * and each tries to open `/dev/tty`. In plain mode all three can, as before. In secure mode the hook
 * and the server cannot — the hook fails with its own error — while the handover child, which the
 * owner gave the terminal, still can.
 *
 * The process under test runs against the built packages with a temporary HOME and product state.
 */

import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { spawn } from '@homebridge/node-pty-prebuilt-multiarch';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));
const RUN_TIMEOUT_MS = 30_000;

/** Run by the process under test: `<mode> <root>`, mode `plain` or `secure`. */
const SCRIPT = `
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CommandExecutor, enableOwnChildSessions } from '@robota-sdk/agent-core/node';
import { spawnInherited } from '@robota-sdk/agent-command';
import { MCPActivationAdmissionService, MCPDefinitionRegistry } from '@robota-sdk/agent-mcp';
import { createStdioAdapter } from '@robota-sdk/agent-mcp/node';

const [mode, root] = process.argv.slice(1);
if (mode === 'secure') enableOwnChildSessions();
const result = {};

const hook = await new CommandExecutor('/bin/sh').execute(
  { type: 'command', command: 'exec 3</dev/tty' },
  { session_id: 'pty', cwd: root, hook_event_name: 'SessionStart' },
);
result.hook = hook.outcome === 'allow' ? 'opened' : 'refused: ' + (hook.reason ?? hook.kind);

const server = join(root, 'server.cjs');
writeFileSync(server, [
  "const fs = require('node:fs');",
  "let answer; try { fs.closeSync(fs.openSync('/dev/tty', 'r')); answer = 'opened'; } catch (error) { answer = 'refused: ' + error.code; }",
  "fs.writeFileSync(process.argv[2], answer);",
  "process.stdin.resume(); process.stdin.on('end', () => process.exit(0));",
].join('\\n'));
const answer = join(root, 'server-answer');
const args = [server, answer];
const definition = { name: 'probe', source: 'project', origin: 'probe', transport: 'stdio', command: process.execPath, args, unsetVariables: [] };
const request = new MCPDefinitionRegistry(
  [{ name: 'probe', source: 'project', origin: 'probe', status: 'resolved', definition, shadowed: [] }],
  { workspace: { repositoryKey: root, trustState: 'trusted', generation: 1 } },
).list()[0];
const admission = new MCPActivationAdmissionService();
admission.approve(request);
const adapter = createStdioAdapter({
  admission,
  authority: { allowedRoot: root, generation: '1', executables: [{ command: process.execPath, args: [args] }], environment: { HOME: root } },
});
const admitted = await adapter.admit({ definition, activation: request });
const transport = adapter.construct(admitted.admitted);
await transport.start();
for (let tries = 0; !existsSync(answer) && tries < 200; tries += 1) await new Promise((resolve) => setTimeout(resolve, 25));
result.server = existsSync(answer) ? readFileSync(answer, 'utf8') : 'no answer';
await transport.close();

const handover = join(root, 'handover-answer');
await spawnInherited('/bin/sh', ['-c', 'if exec 3</dev/tty; then echo opened > ' + handover + '; else echo refused > ' + handover + '; fi'], root);
result.handover = readFileSync(handover, 'utf8').trim();

process.stdout.write('RESULT ' + JSON.stringify(result) + '\\n');
process.exit(0);
`;

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'child-session-pty-')));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function runOnTerminal(mode: 'plain' | 'secure'): Promise<Record<string, string>> {
  const home = join(root, 'home');
  return new Promise((resolve, reject) => {
    const terminal = spawn(process.execPath, ['--input-type=module', '-e', SCRIPT, mode, root], {
      cols: 200,
      rows: 40,
      cwd: PACKAGE_DIR,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: home,
        USERPROFILE: home,
        PRODUCT_USER_STATE_DIR: join(root, 'state'),
        ROBOTA_USER_STATE_DIR: join(root, 'state'),
        TERM: 'xterm-256color',
      },
    });
    let output = '';
    const timer = setTimeout(() => {
      terminal.kill();
      reject(new Error(`no result in time; output: ${output}`));
    }, RUN_TIMEOUT_MS);
    terminal.onData((data) => {
      output += data;
    });
    terminal.onExit(() => {
      clearTimeout(timer);
      const line = output.split(/\r?\n/u).find((candidate) => candidate.startsWith('RESULT '));
      if (line === undefined) reject(new Error(`no result; output: ${output}`));
      else resolve(JSON.parse(line.slice('RESULT '.length)) as Record<string, string>);
    });
  });
}

describe.skipIf(process.platform === 'win32')('children and the controlling terminal', () => {
  it(
    'all reach the terminal in plain mode, as before (guard)',
    async () => {
      expect(await runOnTerminal('plain')).toEqual({
        hook: 'opened',
        server: 'opened',
        handover: 'opened',
      });
    },
    RUN_TIMEOUT_MS,
  );

  it(
    'only the handover child reaches it in secure mode, and the hook fails with its own error',
    async () => {
      const result = await runOnTerminal('secure');

      expect(result.hook).toMatch(/^refused: .*\/dev\/tty/u);
      expect(result.server).toMatch(/^refused: ENXIO$/u);
      expect(result.handover).toBe('opened');
      expect(existsSync(join(root, 'handover-answer'))).toBe(true);
      expect(readFileSync(join(root, 'server-answer'), 'utf8')).not.toBe('opened');
    },
    RUN_TIMEOUT_MS,
  );
});
