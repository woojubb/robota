/**
 * User-execution scenario for the decoded hook outcome contract.
 *
 * Run it with:
 *   pnpm --filter @robota-sdk/agent-session scenario:verify
 *
 * What it shows, at the public SDK surface and with no provider credentials:
 *
 *   1. A hook that DENIES blocks the tool call — the underlying tool never runs.
 *   2. A hook that FAILS (its process could not start) now BLOCKS too, and the failure is reported
 *      on `IRunHooksResult.errors` with its `kind` and `source`.
 *   3. A hook that answers `{"ok": "false"}` — a string, not a boolean — blocks the same way.
 *      A truthy string body must never read as approval, or the gate would be silently
 *      disabled. Its mirror image, `{}`, is falsy and must not block on a verdict no endpoint
 *      issued. Both are `error`, and `PreToolUse` fails closed on `error`.
 *   4. A hook that allows lets the tool run.
 *
 * **Cases 2 and 3 block because a failure must DENY.** A failure that is representable but that
 * nothing consumes leaves the tool unblocked; `runPreToolHook` reads `errors` and denies, so these
 * two cases block. A scenario asserting the unblocked behaviour would be a scenario that has
 * become false, not one that needs its expectation relaxed.
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

const DENY_REASON = 'denied by command hook';

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
 * the hook contract rules out, and it would hide a real signal: if the interface gains a
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
    sessionId: 'hook-outcome-scenario',
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
    session_id: 'hook-outcome-scenario',
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
  const cwd = mkdtempSync(join(tmpdir(), 'hook-outcome-scenario-'));
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
      // `!spawnResult.blocked` is the half that makes this demo show the DESIGN rather than just
      // the outcome: the runner still does not set `blocked` on an error — it reports and the
      // BOUNDARY decides. Dropping it left the demo proving the tool was stopped without showing
      // which layer stopped it, which is the whole split between runner and boundary.
      !spawnToolRan &&
        !spawnResult.blocked &&
        spawnError?.kind === 'spawn-failure' &&
        spawnError.source === 'command',
      `error/spawn-failure: tool BLOCKED by the boundary, runner did NOT set blocked (source=${spawnError?.source ?? 'MISSING'})`,
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
      !httpToolRan &&
        !httpResult.blocked &&
        httpError?.kind === 'malformed-response' &&
        httpError.source === 'http',
      `error/malformed-response: tool BLOCKED by the boundary, runner did NOT set blocked (source=${httpError?.source ?? 'MISSING'})`,
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
    console.error('Hook outcome contract scenario FAILED');
    process.exit(1);
  }
  console.log('Hook outcome contract scenario passed.');
}

await main();
