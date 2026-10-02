import { CommandExitError } from 'e2b/dist/index.mjs';
import { hostedAdmissionError } from './hosted-runtime-config.js';
import type { Sandbox, CommandHandle } from 'e2b/dist/index.mjs';

export interface IE2BWorkerProcessOptions {
  readonly command: string;
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly pty?: { readonly cols: number; readonly rows: number };
  readonly onStdout: (data: string | Uint8Array) => void;
  readonly onStderr: (data: string) => void;
}

export interface IE2BWorkerProcess {
  wait(): Promise<number>;
  sendInput(data: string | Uint8Array): Promise<void>;
  closeInput(): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
  disconnect(): Promise<void>;
}

/** The SDK handle and its management connection stay in the runtime, outside task-visible values. */
export async function startE2BWorkerProcess(
  sandbox: Sandbox,
  options: IE2BWorkerProcessOptions,
  assertOpen: () => void,
): Promise<IE2BWorkerProcess> {
  assertOpen();
  let handle: CommandHandle | undefined;
  const output = (data: string | Uint8Array): void => {
    assertOpen();
    options.onStdout(data);
  };
  try {
    handle =
      options.pty === undefined
        ? await sandbox.commands.run(options.command, {
            cwd: options.cwd,
            envs: { ...options.environment },
            background: true,
            stdin: true,
            timeoutMs: options.timeoutMs,
            onStdout: output,
            onStderr: (data) => {
              assertOpen();
              options.onStderr(data);
            },
          })
        : await sandbox.pty.create({
            cwd: options.cwd,
            envs: { ...options.environment },
            ...options.pty,
            timeoutMs: options.timeoutMs,
            onData: output,
          });
    assertOpen();
    if (options.pty !== undefined) {
      // Readline interprets control bytes before shell quoting. Carry only ASCII hex escapes
      // through terminal input; Bash decodes the command directly into its -c argument.
      const encoded = [...Buffer.from(options.command, 'utf8')]
        .map((byte) => `\\x${byte.toString(16).padStart(2, '0')}`)
        .join('');
      await sandbox.pty.sendInput(
        handle.pid,
        Buffer.from(`exec /bin/bash -c $'${encoded}'\n`, 'ascii'),
      );
    }
  } catch {
    if (handle !== undefined) {
      try {
        await handle.disconnect();
      } catch {
        throw hostedAdmissionError('worker CLI dispatch outcome and stream cleanup are unresolved');
      }
    }
    throw hostedAdmissionError('worker CLI dispatch outcome is unknown');
  }
  const allocated = handle;
  const operation = async (perform: () => Promise<unknown>, reason: string): Promise<void> => {
    assertOpen();
    try {
      await perform();
      assertOpen();
    } catch {
      throw hostedAdmissionError(reason);
    }
  };
  let disconnecting: Promise<void> | undefined;
  return {
    wait: async () => {
      try {
        const result = await allocated.wait();
        assertOpen();
        if (!Number.isSafeInteger(result.exitCode)) throw new Error('invalid exit receipt');
        return result.exitCode;
      } catch (error) {
        assertOpen();
        if (error instanceof CommandExitError && Number.isSafeInteger(error.exitCode))
          return error.exitCode;
        throw hostedAdmissionError('worker CLI completion outcome is unknown');
      }
    },
    sendInput: (data) =>
      operation(
        () =>
          options.pty === undefined
            ? allocated.sendStdin(data)
            : sandbox.pty.sendInput(
                allocated.pid,
                typeof data === 'string' ? Buffer.from(data, 'utf8') : data,
              ),
        'worker CLI input failed',
      ),
    closeInput: () =>
      operation(
        // A PTY has no stdin-close RPC. EOF requests the stock CLI's Ctrl-C shutdown instead.
        () =>
          options.pty === undefined
            ? allocated.closeStdin()
            : sandbox.pty.sendInput(allocated.pid, Uint8Array.of(3)),
        'worker CLI input close failed',
      ),
    resize: (cols, rows) =>
      operation(
        () => sandbox.pty.resize(allocated.pid, { cols, rows }),
        'worker CLI terminal resize failed',
      ),
    disconnect: () => {
      disconnecting ??= allocated.disconnect().catch(() => {
        throw hostedAdmissionError('worker CLI stream cleanup failed');
      });
      return disconnecting;
    },
  };
}
