import { Buffer } from 'node:buffer';

import { optionArgv } from '../utils/option-argv.js';

/** A forwarding launcher supplies only its admitted child environment on its private IPC channel. */
export const FORWARDED_ENVIRONMENT_FLAG = '--supervised-forwarded-environment';
const MAX_ENVIRONMENT_BYTES = 128 * 1024;
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const WAIT_MS = 20_000;

export function forwardedEnvironmentRequested(argv: readonly string[]): boolean {
  return optionArgv(argv).includes(FORWARDED_ENVIRONMENT_FLAG);
}

/** Read an admitted environment from the spawning CLI, never from argv or the control socket. */
export async function receiveForwardedEnvironment(
  argv: readonly string[],
  options: { readonly timeoutMs?: number } = {},
): Promise<Record<string, string>> {
  const args = optionArgv(argv);
  const index = args.indexOf('--supervised-session-id');
  const id = index < 0 ? undefined : args[index + 1];
  if (id === undefined || typeof process.send !== 'function' || !process.connected) {
    throw new Error('The forwarded runtime has no private admission channel.');
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(() => reject(new Error('The forwarded runtime admission timed out.'))), options.timeoutMs ?? WAIT_MS);
    const onDisconnect = (): void => finish(() => reject(new Error('The forwarded runtime admission channel closed.')));
    const onMessage = (message: unknown): void => {
      if (typeof message !== 'object' || message === null || !('kind' in message) || message.kind !== 'forwarded-environment' ||
          !('id' in message) || message.id !== id || !('environment' in message) || typeof message.environment !== 'object' ||
          message.environment === null || Array.isArray(message.environment)) {
        finish(() => reject(new Error('The forwarded runtime admission was malformed.')));
        return;
      }
      const entries = Object.entries(message.environment);
      if (entries.some(([name, value]) => !ENVIRONMENT_NAME.test(name) || typeof value !== 'string') ||
          Buffer.byteLength(JSON.stringify(message.environment), 'utf8') > MAX_ENVIRONMENT_BYTES) {
        finish(() => reject(new Error('The forwarded runtime admission was malformed.')));
        return;
      }
      finish(() => resolve(Object.fromEntries(entries)));
    };
    const finish = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.off('message', onMessage);
      process.off('disconnect', onDisconnect);
      complete();
    };
    process.on('message', onMessage);
    process.once('disconnect', onDisconnect);
    process.send?.({ kind: 'forwarded-environment-needed', id }, (error) => {
      if (error) finish(() => reject(new Error('The forwarded runtime admission channel failed.')));
    });
  });
}
