/**
 * SEC-015 — user-execution scenario for the decoded hook outcome contract (issue #2083).
 *
 * Run it with:
 *   pnpm --filter @robota-sdk/agent-session scenario:verify
 *
 * What it shows, at the public SDK surface and with no provider credentials:
 *
 *   1. A hook that DENIES still blocks the tool call — the underlying tool never runs.
 *   2. A hook that FAILS (its process could not start) does not block, and the failure is now
 *      REPORTED on `IRunHooksResult.errors` instead of being indistinguishable from approval.
 *   3. A hook that answers `{"ok": "false"}` — a string, not a boolean — is reported the same way.
 *      Before this change that body was truthy, so the engine read it as approval and the gate was
 *      silently disabled. Its mirror image, `{}`, was falsy and BLOCKED the tool on a verdict no
 *      endpoint issued.
 *   4. A hook that allows lets the tool run.
 *
 * Cases 2 and 3 print "tool NOT blocked" deliberately, and that is not an oversight: deciding that a
 * failed hook must DENY on an enforcing event is issue #2093, and this leaf only makes the failure
 * representable so that decision has something to act on. What changed here is the reporting, not
 * the policy.
 */

import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, chmodSync, writeFileSync } from 'node:fs';
import { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runHooks } from '@robota-sdk/agent-core';
import { CommandExecutor, HttpExecutor } from '@robota-sdk/agent-core/node';

import { PermissionEnforcer } from '../src/index.js';

import type {
  IHookInput,
  IHookTypeExecutor,
  IToolResult,
  IToolWithEventService,
  THooksConfig,
} from '@robota-sdk/agent-core';
import type { ISpinner, ITerminalOutput } from '../src/index.js';
import type { IPermissionEnforcerOptions } from '../src/permission-types.js';

const DENY_REASON = 'SEC-015 scenario: denied by command hook';

const silentTerminal: ITerminalOutput = {
  writeError(): void {},
  async prompt(): Promise<string> {
    return '';
  },
  async select(_options: string[], initialIndex = 0): Promise<number> {
    return initialIndex;
  },
  write(): void {},
  writeLine(): void {},
  writeMarkdown(): void {},
  spinner(): ISpinner {
    return { stop(): void {}, update(): void {} };
  },
};

/**
 * A tool that records whether it actually ran — the observable for "was the call blocked?".
 *
 * Every member of `IToolContract` is implemented rather than asserted past with
 * `as unknown as`. A blind cast here would be the same "trust me, this is the right shape" that
 * SEC-015 removes from the hook contract, and it would hide a real signal: if the interface gains a
 * member, this example should stop compiling rather than start lying.
 */
function makeTool(ran: { value: boolean }): IToolWithEventService {
  return {
    schema: {
      name: 'Bash',
      description: 'Scenario stand-in for a shell tool',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    getName: () => 'Bash',
    getDescription: () => 'Scenario stand-in for a shell tool',
    validate: () => true,
    validateParameters: () => ({ isValid: true, errors: [], warnings: [] }),
    execute: async (): Promise<IToolResult> => {
      ran.value = true;
      return { success: true, data: 'tool ran', metadata: {} };
    },
    setEventService: () => {},
  };
}

function hooksFor(command: string): THooksConfig {
  return { PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command }] }] };
}

/** Drive the real enforcement boundary and report whether the tool was allowed to run. */
async function toolRuns(
  cwd: string,
  hooks: THooksConfig,
  executors: IHookTypeExecutor[],
): Promise<boolean> {
  const ran = { value: false };
  const options: IPermissionEnforcerOptions = {
    sessionId: 'sec-015-scenario',
    cwd,
    getPermissionMode: () => 'bypassPermissions',
    config: { permissions: { allow: [], deny: [] }, hooks },
    terminal: silentTerminal,
    hookTypeExecutors: executors,
  };
  const [wrapped] = new PermissionEnforcer(options).wrapTools([makeTool(ran)]);
  const parameters = { command: 'echo hi' };
  await wrapped!.execute(parameters, { toolName: 'Bash', parameters });
  return ran.value;
}

function hookInput(cwd: string): IHookInput {
  return {
    session_id: 'sec-015-scenario',
    cwd,
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
  };
}

let failed = false;
function check(condition: boolean, line: string): void {
  if (condition) {
    console.log(`PASS ${line}`);
  } else {
    failed = true;
    console.error(`FAIL ${line}`);
  }
}

async function main(): Promise<void> {
  const cwd = mkdtempSync(join(tmpdir(), 'sec-015-scenario-'));
  let server: Server | undefined;

  try {
    const command = [new CommandExecutor()];
    const http = [new HttpExecutor()];

    // ── 1. deny ──────────────────────────────────────────────────────────────────────────────
    const denyScript = join(cwd, 'deny.sh');
    writeFileSync(denyScript, `#!/bin/sh\necho "${DENY_REASON}" >&2\nexit 2\n`);
    chmodSync(denyScript, 0o755);
    const denyHooks = hooksFor(denyScript);
    const denyResult = await runHooks(denyHooks, 'PreToolUse', hookInput(cwd), command);
    const denyBlockedTool = !(await toolRuns(cwd, denyHooks, command));
    check(
      denyBlockedTool && denyResult.blocked && denyResult.reason === DENY_REASON,
      `deny: tool blocked, reason="${denyResult.reason ?? ''}"`,
    );

    // ── 2. error / spawn-failure ─────────────────────────────────────────────────────────────
    // The hook's process cannot start at all (its working directory does not exist). Before this
    // change that arrived as exit code 1 and the runner discarded it.
    const spawnHooks = hooksFor('echo unreachable');
    const spawnInput = { ...hookInput(cwd), cwd: join(cwd, 'does-not-exist') };
    const spawnResult = await runHooks(spawnHooks, 'PreToolUse', spawnInput, command);
    const spawnError = spawnResult.errors?.[0];
    const spawnToolRan = await toolRuns(join(cwd, 'does-not-exist'), spawnHooks, command);
    check(
      spawnToolRan &&
        !spawnResult.blocked &&
        spawnError?.kind === 'spawn-failure' &&
        spawnError.source === 'command',
      `error/spawn-failure: tool NOT blocked, error reported (source=${spawnError?.source ?? 'MISSING'})`,
    );

    // ── 3. error / malformed-response ────────────────────────────────────────────────────────
    server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // A string, not a boolean. Truthy — so this used to read as approval.
      res.end('{"ok":"false"}');
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
    const httpHooks: THooksConfig = {
      PreToolUse: [{ matcher: '', hooks: [{ type: 'http', url, timeout: 5 }] }],
    };
    const httpResult = await runHooks(httpHooks, 'PreToolUse', hookInput(cwd), http);
    const httpError = httpResult.errors?.[0];
    const httpToolRan = await toolRuns(cwd, httpHooks, http);
    check(
      httpToolRan &&
        !httpResult.blocked &&
        httpError?.kind === 'malformed-response' &&
        httpError.source === 'http',
      `error/malformed-response: tool NOT blocked, error reported (source=${httpError?.source ?? 'MISSING'})`,
    );

    // ── 4. allow ─────────────────────────────────────────────────────────────────────────────
    const allowHooks = hooksFor('exit 0');
    const allowResult = await runHooks(allowHooks, 'PreToolUse', hookInput(cwd), command);
    const allowToolRan = await toolRuns(cwd, allowHooks, command);
    check(
      allowToolRan && !allowResult.blocked && allowResult.errors === undefined,
      'allow: tool executed',
    );
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    rmSync(cwd, { recursive: true, force: true });
  }

  if (failed) {
    console.error('SEC-015 hook outcome contract scenario FAILED');
    process.exit(1);
  }
  console.log('SEC-015 hook outcome contract scenario passed.');
}

await main();
