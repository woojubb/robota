/**
 * Runs one MCP header helper for the host: an allowed, approved helper's exact argv, no shell.
 *
 * The helper is bounded in time and output and cannot outlive a cancelled or overdue run: it is
 * started as its own process group and the whole group is killed. Its stderr is discarded unread
 * and its stdout is returned only to `agent-mcp`'s strict parser; a failure is an
 * `MCPHeadersHelperError` naming a fixed reason, never anything the helper printed.
 *
 * The environment is the host's minus what changes how a runtime loads code, and — for a helper a
 * repository's definition declared — minus every credential-shaped variable, since the user
 * allowed the program, not the passing of their credentials to whatever that repository points it
 * at. The server's name and URL are set so one helper can serve several servers.
 */

import { spawn, spawnSync } from 'node:child_process';

import {
  MCPHeadersHelperError,
  isCredentialShapedName,
  isExecutionEnvironmentName,
  isWorkspaceHelperSource,
} from '@robota-sdk/agent-mcp';

import type { ChildProcess } from 'node:child_process';
import type {
  IMCPHeadersHelper,
  TMCPActivationSource,
  TMCPHeadersHelperFailure,
} from '@robota-sdk/agent-mcp';

export const HEADERS_HELPER_TIMEOUT_MS = 10_000;
export const HEADERS_HELPER_MAX_STDOUT_BYTES = 64 * 1024;

export interface IHeadersHelperRun {
  readonly helper: IMCPHeadersHelper;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxStdoutBytes?: number;
}

/** The environment a helper runs with. */
export function headersHelperEnvironment(
  hostEnv: Readonly<Record<string, string | undefined>>,
  source: TMCPActivationSource,
  serverName: string,
  serverUrl: string,
): Record<string, string> {
  const scrubCredentials = isWorkspaceHelperSource(source);
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(hostEnv)) {
    if (value === undefined || isExecutionEnvironmentName(name)) continue;
    if (scrubCredentials && isCredentialShapedName(name)) continue;
    env[name] = value;
  }
  env['ROBOTA_MCP_SERVER_NAME'] = serverName;
  env['ROBOTA_MCP_SERVER_URL'] = serverUrl;
  return env;
}

const isWindows = process.platform === 'win32';

/**
 * Kill the helper and everything it started. On Windows `taskkill` does the tree; it runs
 * asynchronously except while the process is exiting, when nothing asynchronous runs any more.
 */
function killTree(child: ChildProcess, exiting = false): void {
  if (typeof child.pid !== 'number') return;
  if (isWindows) {
    const taskkill = ['/pid', String(child.pid), '/T', '/F'];
    const options = { stdio: 'ignore', windowsHide: true } as const;
    if (exiting) {
      spawnSync('taskkill', taskkill, options);
      return;
    }
    const killer = spawn('taskkill', taskkill, options);
    // allow-fallback: a failed taskkill leaves nothing further to try; the helper is already refused.
    killer.on('error', () => undefined);
    killer.unref();
    return;
  }
  try {
    // The helper leads its own group (`detached`), so the negative pid reaches its descendants.
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // allow-fallback: the group is already gone; signal the direct child in case it is not.
    try {
      child.kill('SIGKILL');
    } catch {
      // allow-fallback: an already-exited child cannot be signalled, which is the goal.
    }
  }
}

/**
 * Helpers still running. Each leads its own process group, so it would outlive this process; an
 * exit hook kills them rather than leaving them orphaned.
 */
const live = new Set<ChildProcess>();
let exitHookInstalled = false;

function track(child: ChildProcess): void {
  live.add(child);
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once('exit', () => {
    for (const running of live) killTree(running, true);
    live.clear();
  });
}

/** Run the helper once and resolve with its stdout. */
export function runHeadersHelper(run: IHeadersHelperRun): Promise<string> {
  const timeoutMs = run.timeoutMs ?? HEADERS_HELPER_TIMEOUT_MS;
  const maxStdoutBytes = run.maxStdoutBytes ?? HEADERS_HELPER_MAX_STDOUT_BYTES;
  return new Promise<string>((resolve, reject) => {
    if (run.signal.aborted) {
      reject(new MCPHeadersHelperError('cancelled'));
      return;
    }
    let child: ChildProcess;
    try {
      child = spawn(run.helper.command, [...run.helper.args], {
        cwd: run.cwd,
        env: run.env,
        shell: false,
        stdio: ['ignore', 'pipe', 'ignore'],
        detached: !isWindows,
        windowsHide: true,
      });
    } catch {
      // allow-fallback: a synchronous spawn failure is reported by reason only.
      reject(new MCPHeadersHelperError('spawn-failed'));
      return;
    }

    track(child);
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;
    const cleanup = (): void => {
      settled = true;
      live.delete(child);
      clearTimeout(timer);
      run.signal.removeEventListener('abort', onAbort);
    };
    const fail = (reason: TMCPHeadersHelperFailure, running = true): void => {
      if (settled) return;
      cleanup();
      if (running) killTree(child);
      child.stdout?.destroy();
      reject(new MCPHeadersHelperError(reason));
    };
    const onAbort = (): void => fail('cancelled');
    const timer = setTimeout(() => fail('timeout'), timeoutMs);
    run.signal.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (chunk: Buffer) => {
      received += chunk.byteLength;
      if (received > maxStdoutBytes) {
        fail('output-too-large');
        return;
      }
      chunks.push(chunk);
    });
    child.stdout?.on('error', () => fail('spawn-failed'));
    child.on('error', () => fail('spawn-failed'));
    child.on('close', (code) => {
      live.delete(child);
      if (settled) return;
      if (code !== 0) {
        fail('exit-status', false);
        return;
      }
      cleanup();
      try {
        resolve(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      } catch {
        // allow-fallback: output that is not UTF-8 is malformed; its bytes are not quoted.
        reject(new MCPHeadersHelperError('output-malformed'));
      }
    });
  });
}
