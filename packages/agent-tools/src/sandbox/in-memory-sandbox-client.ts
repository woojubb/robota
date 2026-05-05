import type { ISandboxClient, ISandboxRunOptions, ISandboxRunResult } from './types.js';

export type TInMemorySandboxRunHandler = (
  command: string,
  options: ISandboxRunOptions | undefined,
  files: ReadonlyMap<string, string>,
) => Promise<ISandboxRunResult> | ISandboxRunResult;

export interface IInMemorySandboxClientOptions {
  files?: Record<string, string>;
  runHandler?: TInMemorySandboxRunHandler;
}

export class InMemorySandboxClient implements ISandboxClient {
  private readonly files = new Map<string, string>();
  private readonly snapshots = new Map<string, Map<string, string>>();
  private readonly runHandler?: TInMemorySandboxRunHandler;
  private snapshotSequence = 0;

  constructor(options: IInMemorySandboxClientOptions = {}) {
    for (const [path, content] of Object.entries(options.files ?? {})) {
      this.files.set(path, content);
    }
    this.runHandler = options.runHandler;
  }

  async run(command: string, options?: ISandboxRunOptions): Promise<ISandboxRunResult> {
    if (this.runHandler) {
      return this.runHandler(command, options, this.files);
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  }

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`Sandbox file not found: ${path}`);
    }
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async snapshot(): Promise<string> {
    const snapshotId = `snapshot-${++this.snapshotSequence}`;
    this.snapshots.set(snapshotId, new Map(this.files));
    return snapshotId;
  }

  async restore(snapshotId: string): Promise<void> {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) {
      throw new Error(`Sandbox snapshot not found: ${snapshotId}`);
    }
    this.files.clear();
    for (const [path, content] of snapshot.entries()) {
      this.files.set(path, content);
    }
  }

  getFile(path: string): string | undefined {
    return this.files.get(path);
  }
}
