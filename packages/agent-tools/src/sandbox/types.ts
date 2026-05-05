export interface ISandboxRunOptions {
  timeoutMs?: number;
  workingDirectory?: string;
}

export interface ISandboxRunResult {
  stdout: string;
  stderr?: string;
  exitCode: number;
}

export interface ISandboxClient {
  run(command: string, options?: ISandboxRunOptions): Promise<ISandboxRunResult>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  snapshot?(): Promise<string>;
  restore?(snapshotId: string): Promise<void>;
}

export interface ISandboxToolOptions {
  sandboxClient?: ISandboxClient;
}
