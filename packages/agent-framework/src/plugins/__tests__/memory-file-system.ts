import { dirnamePath, resolvePath } from '@robota-sdk/agent-core';

import type { IDirent, IFileSystem, IStats } from '@robota-sdk/agent-core';

/**
 * A file system held in a map, keyed by the lexically normalised path text. It touches no `node:*`
 * module, so a test can run the plugin code over a Windows-spelled root (`C:\Users\me\plugins`) on
 * any host: nothing here may depend on the platform the test runs on.
 */
export class MemoryFileSystem implements IFileSystem {
  readonly constants = { F_OK: 0, R_OK: 4, W_OK: 2 };
  private readonly files = new Map<string, string>();
  private readonly directories = new Set<string>();

  private key(path: string): string {
    return resolvePath(path, '.');
  }

  /** Creates `path` and every directory above it. */
  private ensureDirectory(path: string): void {
    let current = this.key(path);
    while (!this.directories.has(current)) {
      this.directories.add(current);
      const parent = dirnamePath(current);
      if (parent === current) return;
      current = parent;
    }
  }

  seed(path: string, content: string): void {
    this.ensureDirectory(dirnamePath(this.key(path)));
    this.files.set(this.key(path), content);
  }

  paths(): string[] {
    return [...this.files.keys()].sort();
  }

  existsSync(path: string): boolean {
    const key = this.key(path);
    return this.files.has(key) || this.directories.has(key);
  }

  readFileSync(path: string): string {
    const content = this.files.get(this.key(path));
    if (content === undefined) throw new Error(`ENOENT: no such file, open '${path}'`);
    return content;
  }

  writeFileSync(path: string, data: string): void {
    this.seed(path, data);
  }

  mkdirSync(path: string): void {
    this.ensureDirectory(path);
  }

  readdirSync(path: string): string[];
  readdirSync(path: string, options: { withFileTypes: true }): IDirent[];
  readdirSync(path: string, options?: { withFileTypes: true }): string[] | IDirent[] {
    const key = this.key(path);
    if (!this.directories.has(key)) throw new Error(`ENOENT: no such directory, scandir '${path}'`);
    const children = new Map<string, boolean>();
    for (const file of this.files.keys()) {
      if (dirnamePath(file) === key) children.set(file.slice(key.length + 1), false);
    }
    for (const directory of this.directories) {
      if (directory !== key && dirnamePath(directory) === key) {
        children.set(directory.slice(key.length + 1), true);
      }
    }
    const names = [...children.keys()].sort();
    if (options?.withFileTypes !== true) return names;
    return names.map((name) => ({
      name,
      isFile: () => children.get(name) === false,
      isDirectory: () => children.get(name) === true,
    }));
  }

  statSync(path: string): IStats {
    const key = this.key(path);
    const isDirectory = this.directories.has(key);
    if (!isDirectory && !this.files.has(key))
      throw new Error(`ENOENT: no such file, stat '${path}'`);
    return {
      mtimeMs: 0,
      birthtimeMs: 0,
      size: this.files.get(key)?.length ?? 0,
      isFile: () => !isDirectory,
      isDirectory: () => isDirectory,
    };
  }

  rmSync(path: string): void {
    const key = this.key(path);
    this.files.delete(key);
    for (const file of [...this.files.keys()]) {
      if (file.startsWith(`${key}${file.includes('\\') ? '\\' : '/'}`)) this.files.delete(file);
    }
    for (const directory of [...this.directories]) {
      if (
        directory === key ||
        directory.startsWith(`${key}${directory.includes('\\') ? '\\' : '/'}`)
      ) {
        this.directories.delete(directory);
      }
    }
  }

  cpSync(): void {
    throw new Error('cpSync is not needed by the tests that use this file system');
  }

  renameSync(): void {
    throw new Error('renameSync is not needed by the tests that use this file system');
  }

  /** There are no symlinks: a path is its own canonical form. */
  realpathSync(path: string): string {
    if (!this.existsSync(path)) throw new Error(`ENOENT: no such file, realpath '${path}'`);
    return this.key(path);
  }
}
