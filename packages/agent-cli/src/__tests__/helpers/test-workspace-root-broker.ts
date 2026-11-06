import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Run the broker in another process so synchronous project operations can use IPC. */
export async function startTestBroker(endpoint: string, lockDirectory: string, history: string): Promise<{
  close(): Promise<void>;
}> {
  const loader = new URL('../../../node_modules/tsx/dist/loader.mjs', import.meta.url).href;
  const bin = fileURLToPath(new URL('../../bin.ts', import.meta.url));
  const child = spawn(process.execPath, [
    '--import', loader, '--conditions=source', bin,
    '--internal-root-broker', endpoint, lockDirectory, history,
  ], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Broker startup timed out: ${stderr}`)), 10_000);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      child.once('message', (message) => finish(message === 'ready' ? undefined : new Error(stderr)));
      child.once('exit', () => finish(new Error(`Broker exited: ${stderr}`)));
      child.once('error', finish);
    });
  } catch (error) {
    child.kill('SIGTERM');
    throw error;
  }
  let closing: Promise<void> | undefined;
  return {
    close: () => closing ??= new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
      child.once('close', () => resolve());
      child.kill('SIGTERM');
    }),
  };
}
