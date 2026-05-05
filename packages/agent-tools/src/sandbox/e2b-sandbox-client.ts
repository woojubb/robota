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

export interface IE2BSandboxAdapter {
  sandboxId?: string;
  commands: IE2BCommands;
  files: IE2BFiles;
  pause?(): Promise<boolean | string | void>;
  connect?(): Promise<IE2BSandboxAdapter>;
}

export interface IE2BSandboxClientOptions {
  sandbox: IE2BSandboxAdapter;
  connectSandbox?: (sandboxId: string) => Promise<IE2BSandboxAdapter>;
}

export class E2BSandboxClient implements ISandboxClient {
  private sandbox: IE2BSandboxAdapter;
  private readonly connectSandbox?: (sandboxId: string) => Promise<IE2BSandboxAdapter>;

  constructor(options: IE2BSandboxClientOptions) {
    this.sandbox = options.sandbox;
    this.connectSandbox = options.connectSandbox;
  }

  async run(command: string, options?: ISandboxRunOptions): Promise<ISandboxRunResult> {
    const result = await this.sandbox.commands.run(command, {
      background: false,
      timeoutMs: options?.timeoutMs,
      cwd: options?.workingDirectory,
    });

    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: result.exitCode ?? result.exit_code ?? 0,
    };
  }

  async readFile(path: string): Promise<string> {
    const content = await this.sandbox.files.read(path);
    return typeof content === 'string' ? content : Buffer.from(content).toString('utf8');
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.sandbox.files.write(path, content);
  }

  async snapshot(): Promise<string> {
    const sandboxId = this.sandbox.sandboxId;
    if (!sandboxId) {
      throw new Error('E2B sandboxId is required to create a resumable sandbox snapshot.');
    }
    if (!this.sandbox.pause) {
      throw new Error('E2B sandbox adapter does not expose pause().');
    }
    await this.sandbox.pause();
    return sandboxId;
  }

  async restore(snapshotId: string): Promise<void> {
    if (this.connectSandbox) {
      this.sandbox = await this.connectSandbox(snapshotId);
      return;
    }
    if (this.sandbox.sandboxId === snapshotId && this.sandbox.connect) {
      this.sandbox = await this.sandbox.connect();
      return;
    }
    throw new Error(
      'E2B sandbox restore requires connectSandbox(snapshotId) or sandbox.connect().',
    );
  }
}
