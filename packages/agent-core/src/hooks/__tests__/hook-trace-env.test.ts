/**
 * A command hook's child receives Robota's `TRACEPARENT` through its environment only: never in the
 * stdin JSON, never in an HTTP hook body, and never over a `TRACEPARENT` the user's group sets.
 */
import { createServer, type Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandExecutor } from '../executors/command-executor.js';
import { HttpExecutor } from '../executors/http-executor.js';
import { runHooks } from '../hook-runner.js';

import type { IHookInput, IHookTypeExecutor, THooksConfig } from '../types.js';
import type { AddressInfo } from 'node:net';

const TRACE = { TRACEPARENT: '00-4bf92f3577b34da6a3ce929d0e0e4736-b7ad6b7169203331-01' };
const USER_TRACEPARENT = '00-11111111111111111111111111111111-2222222222222222-01';
const input: IHookInput = { session_id: 's', cwd: process.cwd(), hook_event_name: 'UserPromptSubmit' };
const posix = process.platform !== 'win32';

/** A command that prints both variables, or `-` for an unset one, then its stdin. */
const PRINT = 'printf "%s|%s\\n" "${TRACEPARENT:--}" "${TRACESTATE:--}"; cat';

function hooksWith(env?: Record<string, string>): THooksConfig {
  return { UserPromptSubmit: [{ matcher: '', ...(env ? { env } : {}), hooks: [{ type: 'command', command: PRINT }] }] };
}

/** Records what each executor was given, while the real command executor runs. */
function recording(): { executors: IHookTypeExecutor[]; stdouts: string[]; httpArgs: unknown[][] } {
  const stdouts: string[] = [];
  const httpArgs: unknown[][] = [];
  const command = new CommandExecutor();
  return {
    stdouts,
    httpArgs,
    executors: [
      {
        type: 'command',
        execute: async (...args: unknown[]) => {
          const outcome = await (command.execute as (...a: unknown[]) => ReturnType<CommandExecutor['execute']>)(...args);
          if (outcome.outcome === 'allow') stdouts.push(outcome.stdout);
          return outcome;
        },
      } as IHookTypeExecutor,
      {
        type: 'http',
        execute: vi.fn(async (...args: unknown[]) => {
          httpArgs.push(args);
          return { outcome: 'allow' as const, source: 'http' as const, stdout: '' };
        }),
      } as IHookTypeExecutor,
    ],
  };
}

describe('command hook trace environment', () => {
  beforeEach(() => {
    vi.stubEnv('TRACEPARENT', '00-99999999999999999999999999999999-8888888888888888-01');
    vi.stubEnv('TRACESTATE', 'vendor=ambient');
  });
  afterEach(() => vi.unstubAllEnvs());

  it.runIf(posix)('replaces the ambient trace and keeps it out of the stdin JSON', async () => {
    const { executors, stdouts } = recording();
    await runHooks(hooksWith(), 'UserPromptSubmit', input, executors, TRACE);
    const [first, stdin] = stdouts[0]!.split('\n', 2);
    expect(first).toBe(`${TRACE.TRACEPARENT}|-`);
    expect(stdin).not.toContain('TRACEPARENT');
    expect(stdin).not.toContain(TRACE.TRACEPARENT);
    expect(process.env['TRACESTATE']).toBe('vendor=ambient');
  });

  it.runIf(posix)('lets a group TRACEPARENT win and then passes the ambient env unchanged', async () => {
    const { executors, stdouts } = recording();
    await runHooks(hooksWith({ TRACEPARENT: USER_TRACEPARENT }), 'UserPromptSubmit', input, executors, TRACE);
    expect(stdouts[0]!.split('\n')[0]).toBe(`${USER_TRACEPARENT}|vendor=ambient`);
  });

  it.runIf(posix)('leaves the ambient trace untouched without a Robota value', async () => {
    const { executors, stdouts } = recording();
    await runHooks(hooksWith(), 'UserPromptSubmit', input, executors);
    expect(stdouts[0]!.split('\n')[0]).toBe(
      '00-99999999999999999999999999999999-8888888888888888-01|vendor=ambient',
    );
  });

  it('hands the value to the command executor only, never to another hook type', async () => {
    const { executors, httpArgs } = recording();
    const config: THooksConfig = {
      UserPromptSubmit: [{ matcher: '', hooks: [{ type: 'http', url: 'http://127.0.0.1:1/hook' }] }],
    };
    await runHooks(config, 'UserPromptSubmit', input, executors, TRACE);
    expect(httpArgs).toHaveLength(1);
    expect(httpArgs[0]).toHaveLength(2);
    expect(JSON.stringify(httpArgs[0])).not.toContain(TRACE.TRACEPARENT);
  });
});

describe('HTTP hook body', () => {
  let server: Server;
  let url: string;
  let body = '';
  let headers: Record<string, unknown> = {};

  beforeEach(async () => {
    server = createServer((req, res) => {
      headers = req.headers;
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        body = Buffer.concat(chunks).toString('utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('never carries the Robota value in the body or headers', async () => {
    const config: THooksConfig = { UserPromptSubmit: [{ matcher: '', hooks: [{ type: 'http', url }] }] };
    await runHooks(config, 'UserPromptSubmit', input, [new CommandExecutor(), new HttpExecutor()], TRACE);
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toContain(TRACE.TRACEPARENT);
    expect(JSON.stringify(headers)).not.toContain(TRACE.TRACEPARENT);
  });
});
