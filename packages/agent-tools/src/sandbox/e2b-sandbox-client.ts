import type { ISandboxClient, ISandboxRunOptions, ISandboxRunResult } from './types.js';

interface IE2BCommandStartOptions {
  timeoutMs?: number;
  cwd?: string;
  background?: false;
}

interface IE2BCommandResult {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  exit_code?: number;
}

interface IE2BCommands {
  run(command: string, options?: IE2BCommandStartOptions): Promise<IE2BCommandResult>;
}

interface IE2BFiles {
  read(path: string): Promise<string | Uint8Array>;
  write(path: string, content: string): Promise<void>;
}

interface IE2BSnapshot {
  snapshotId?: string;
  id?: string;
}

export interface IE2BSandboxAdapter {
  sandboxId?: string;
  commands: IE2BCommands;
  files: IE2BFiles;
  pause?(): Promise<boolean | string | void>;
  connect?(): Promise<IE2BSandboxAdapter>;
  createSnapshot?(): Promise<IE2BSnapshot>;
}

export interface IE2BSandboxClientOptions {
  sandbox: IE2BSandboxAdapter;
  connectSandbox?: (sandboxId: string) => Promise<IE2BSandboxAdapter>;
  createSandboxFromSnapshot?: (snapshotId: string) => Promise<IE2BSandboxAdapter>;
}

function reference(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > 1024 ||
    [...value].some((character) => {
      const code = character.codePointAt(0)!;
      return code < 32 || code === 127 || (code >= 0xd800 && code <= 0xdfff);
    })
  ) {
    throw new Error('E2B resumable worker reference is invalid.');
  }
  return value;
}

function validateAdapter(value: IE2BSandboxAdapter): void {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.commands?.run !== 'function' ||
    typeof value.files?.read !== 'function' ||
    typeof value.files?.write !== 'function'
  ) {
    throw new Error('E2B worker adapter is invalid.');
  }
}

function completion(result: IE2BCommandResult): ISandboxRunResult {
  if (result === null || typeof result !== 'object')
    throw new Error('E2B command exit code is missing.');
  const exitCode = result.exitCode !== undefined ? result.exitCode : result.exit_code;
  if (
    !Number.isSafeInteger(exitCode) ||
    (result.exitCode !== undefined &&
      result.exit_code !== undefined &&
      result.exitCode !== result.exit_code)
  ) {
    throw new Error('E2B command exit code is missing, invalid or inconsistent.');
  }
  if (
    (result.stdout !== undefined && typeof result.stdout !== 'string') ||
    (result.stderr !== undefined && typeof result.stderr !== 'string')
  ) {
    throw new Error('E2B command output is invalid.');
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', exitCode: exitCode! };
}

export class E2BSandboxClient implements ISandboxClient {
  private sandbox: IE2BSandboxAdapter | undefined;
  private generation = 0;
  private restoring = false;
  private readonly connectSandbox?: (sandboxId: string) => Promise<IE2BSandboxAdapter>;
  private readonly createSandboxFromSnapshot?: (snapshotId: string) => Promise<IE2BSandboxAdapter>;

  constructor(options: IE2BSandboxClientOptions) {
    validateAdapter(options.sandbox);
    this.sandbox = options.sandbox;
    this.connectSandbox = options.connectSandbox;
    this.createSandboxFromSnapshot = options.createSandboxFromSnapshot;
  }

  async run(command: string, options?: ISandboxRunOptions): Promise<ISandboxRunResult> {
    const result = await this.withWorker((sandbox) =>
      sandbox.commands.run(command, {
        background: false,
        timeoutMs: options?.timeoutMs,
        cwd: options?.workingDirectory,
      }),
    );
    return completion(result);
  }

  async readFile(path: string): Promise<string> {
    const content = await this.withWorker((sandbox) => sandbox.files.read(path));
    if (typeof content !== 'string' && !(content instanceof Uint8Array))
      throw new Error('E2B file response is invalid.');
    return typeof content === 'string' ? content : Buffer.from(content).toString('utf8');
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.withWorker((sandbox) => sandbox.files.write(path, content));
  }

  async snapshot(): Promise<string> {
    return this.withWorker(async (sandbox) => {
      if (sandbox.createSnapshot) {
        const snapshot = await sandbox.createSnapshot();
        if (
          snapshot === null ||
          typeof snapshot !== 'object' ||
          (snapshot.snapshotId !== undefined &&
            snapshot.id !== undefined &&
            snapshot.snapshotId !== snapshot.id)
        ) {
          throw new Error('E2B snapshot identity is invalid or inconsistent.');
        }
        return reference(snapshot.snapshotId ?? snapshot.id);
      }
      const sandboxId = reference(sandbox.sandboxId);
      if (!sandbox.pause) throw new Error('E2B sandbox adapter does not expose pause().');
      // false means already paused in the provider contract; it is a resumable state too.
      await sandbox.pause();
      return sandboxId;
    });
  }

  async restore(snapshotId: string): Promise<void> {
    if (this.restoring) throw new Error('E2B worker restore is already in progress.');
    const previous = this.sandbox;
    this.sandbox = undefined;
    this.generation++;
    this.restoring = true;
    try {
      reference(snapshotId);
      let restored: IE2BSandboxAdapter;
      if (this.createSandboxFromSnapshot) {
        restored = await this.createSandboxFromSnapshot(snapshotId);
      } else if (this.connectSandbox) {
        restored = await this.connectSandbox(snapshotId);
      } else if (previous?.sandboxId === snapshotId && previous.connect) {
        restored = await previous.connect();
      } else {
        throw new Error(
          'E2B sandbox restore requires connectSandbox(snapshotId) or sandbox.connect().',
        );
      }
      validateAdapter(restored);
      if (!this.createSandboxFromSnapshot && restored.sandboxId !== snapshotId) {
        throw new Error('E2B restored worker identity does not match the requested reference.');
      }
      this.sandbox = restored;
    } finally {
      this.restoring = false;
    }
  }

  private async withWorker<T>(operation: (sandbox: IE2BSandboxAdapter) => Promise<T>): Promise<T> {
    const sandbox = this.sandbox;
    const generation = this.generation;
    if (sandbox === undefined || this.restoring)
      throw new Error('E2B worker is not available; a successful restore is required.');
    const result = await operation(sandbox);
    if (generation !== this.generation || sandbox !== this.sandbox) {
      throw new Error(
        'E2B worker changed during the operation; the previous worker result is refused.',
      );
    }
    return result;
  }
}
