import { BrokeredWorkspaceTrustService } from '../../startup/brokered-workspace-trust.js';
import { spawn } from '@homebridge/node-pty-prebuilt-multiarch';

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
