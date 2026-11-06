import { BrokeredWorkspaceTrustService } from '../../startup/brokered-workspace-trust.js';
import { requestWorkspaceRootBroker } from '../../startup/workspace-root-broker.js';
import { workspaceRootBrokerEndpoint } from '../../startup/workspace-root-broker-process.js';
import { spawn } from '@homebridge/node-pty-prebuilt-multiarch';
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';

import type { ICliRuntimeContext } from '../../product/runtime-context.js';

/** Supplies a test-owned approval directly to the brokered service. */
export async function approveTestWorkspace(cwd: string, runtime: ICliRuntimeContext): Promise<number> {
  const brokered = await BrokeredWorkspaceTrustService.create(runtime);
  try {
    const candidate = await brokered.prepare(cwd);
    return (await brokered.grant(cwd, candidate)).status === 'trusted' ? 0 : 1;
  } finally {
    brokered.close();
  }
}

/** Stop only the broker launched for this fixture's disposable product state. */
export async function stopTestWorkspaceBroker(runtime: ICliRuntimeContext): Promise<void> {
  const endpoint = workspaceRootBrokerEndpoint(runtime);
  let pid: number;
  try {
    const response = await requestWorkspaceRootBroker(endpoint, { op: 'ping' });
    if (response.status !== 'ready') return;
    pid = response.pid;
  } catch {
    return;
  }
  if (pid === process.pid) throw new Error('The test broker resolved to the test process.');
  try {
    process.kill(pid);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      if (process.platform !== 'win32') rmSync(dirname(endpoint), { recursive: true, force: true });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`The test broker ${pid} did not exit after SIGTERM.`);
}

/** Test-owned terminal enters an affirmative answer through the normal CLI prompt. */
export function approveTestWorkspaceCommand(
  command: string,
  cwd: string,
  env: Record<string, string>,
  prefix: readonly string[] = [],
): Promise<{ code: number; status: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let terminal;
    try {
      terminal = spawn(command, [...prefix, 'trust', '--yes'], { cwd, env, cols: 100, rows: 30 });
    } catch (error) {
      reject(error);
      return;
    }
    let output = '';
    let answered = false;
    const timer = setTimeout(() => {
      terminal.kill();
      reject(new Error('The workspace trust question timed out.'));
    }, 30_000);
    terminal.onData((chunk) => {
      output += chunk;
      if (!answered && output.includes('Trust this exact folder? [y/N]')) {
        answered = true;
        terminal.write('y\r');
      }
    });
    terminal.onExit(({ exitCode }) => {
      clearTimeout(timer);
      resolve({ code: exitCode, status: exitCode, stdout: output, stderr: output });
    });
  });
}
