import { Buffer } from 'node:buffer';

import { optionArgv } from '../utils/option-argv.js';

/** A forwarding launcher supplies only its admitted child environment on its private IPC channel. */
export const FORWARDED_ENVIRONMENT_FLAG = '--supervised-forwarded-environment';
const MAX_ENVIRONMENT_BYTES = 128 * 1024;
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const HOSTED_DECISION_NAMES = new Set(['PRODUCT_RUNTIME_POSTURE', 'PRODUCT_HOSTED_RUNTIME_CONFIG']);
const WAIT_MS = 20_000;
export const MAX_REPORTED_CREDENTIAL_NAMES = 256;
const MAX_CREDENTIAL_NAME_LENGTH = 256;

export interface IForwardedAdmission {
  readonly environment: Readonly<Record<string, string>>;
  /** Advisory names reported as set by the launcher; no credential values. */
  readonly availableCredentialNames: readonly string[];
}

export function forwardedEnvironmentRequested(argv: readonly string[]): boolean {
  return optionArgv(argv).includes(FORWARDED_ENVIRONMENT_FLAG);
}

/** Read an admitted environment from the spawning CLI, never from argv or the control socket. */
export async function receiveForwardedEnvironment(
  argv: readonly string[],
  options: { readonly timeoutMs?: number } = {},
): Promise<IForwardedAdmission> {
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
      const available = 'availableCredentialNames' in message ? message.availableCredentialNames : [];
      if (entries.some(([name, value]) => !ENVIRONMENT_NAME.test(name) || HOSTED_DECISION_NAMES.has(name.toUpperCase()) || typeof value !== 'string') ||
          !Array.isArray(available) || available.length > MAX_REPORTED_CREDENTIAL_NAMES ||
          available.some((name: unknown) => typeof name !== 'string' || name.length > MAX_CREDENTIAL_NAME_LENGTH || !ENVIRONMENT_NAME.test(name)) ||
          new Set(available).size !== available.length ||
          Buffer.byteLength(JSON.stringify({ environment: message.environment, available }), 'utf8') > MAX_ENVIRONMENT_BYTES) {
        finish(() => reject(new Error('The forwarded runtime admission was malformed.')));
        return;
      }
      finish(() => resolve({ environment: Object.fromEntries(entries), availableCredentialNames: available }));
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
