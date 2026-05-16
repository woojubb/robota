import {
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';

import type { IDirent, IFileSystem, IFileSystemAsync, IStats } from '@robota-sdk/agent-core';

export class NodeFileSystem implements IFileSystem {
  existsSync(path: string): boolean {
    return existsSync(path);
  }

  readFileSync(path: string, encoding: BufferEncoding): string {
    return readFileSync(path, encoding);
  }

  writeFileSync(path: string, data: string, encoding?: BufferEncoding): void {
    writeFileSync(path, data, encoding ?? 'utf8');
  }

  mkdirSync(path: string, options?: { recursive?: boolean }): void {
    mkdirSync(path, options);
  }

  readdirSync(path: string): string[];
  // eslint-disable-next-line no-dupe-class-members
  readdirSync(path: string, options: { withFileTypes: true }): IDirent[];
  // eslint-disable-next-line no-dupe-class-members
  readdirSync(path: string, options?: { withFileTypes?: true }): string[] | IDirent[] {
    if (options?.withFileTypes) {
      return readdirSync(path, { withFileTypes: true }) as IDirent[];
    }
    return readdirSync(path) as string[];
  }

  statSync(path: string): IStats {
    return statSync(path) as IStats;
  }

  rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void {
    rmSync(path, options);
  }

  cpSync(source: string, destination: string, options?: { recursive?: boolean }): void {
    cpSync(source, destination, options);
  }

  renameSync(oldPath: string, newPath: string): void {
    renameSync(oldPath, newPath);
  }

  get constants(): { F_OK: number; R_OK: number; W_OK: number } {
    return constants;
  }
}

export class NodeFileSystemAsync implements IFileSystemAsync {
  async access(path: string, mode?: number): Promise<void> {
    await access(path, mode);
  }

  async copyFile(src: string, dest: string, flags?: number): Promise<void> {
    await copyFile(src, dest, flags);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await mkdir(path, options);
  }

  async readFile(path: string, encoding: BufferEncoding): Promise<string> {
    return readFile(path, encoding);
  }

  async readdir(path: string): Promise<string[]>;
  // eslint-disable-next-line no-dupe-class-members
  async readdir(path: string, options: { withFileTypes: true }): Promise<IDirent[]>;
  // eslint-disable-next-line no-dupe-class-members
  async readdir(path: string, options?: { withFileTypes?: true }): Promise<string[] | IDirent[]> {
    if (options?.withFileTypes) {
      const result = await readdir(path, { withFileTypes: true });
      return result as IDirent[];
    }
    return readdir(path) as Promise<string[]>;
  }

  async realpath(path: string): Promise<string> {
    return realpath(path);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await rename(oldPath, newPath);
  }

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    await rm(path, options);
  }

  async stat(path: string): Promise<IStats> {
    return stat(path) as Promise<IStats>;
  }

  async writeFile(path: string, data: string, encoding?: BufferEncoding): Promise<void> {
    await writeFile(path, data, encoding ?? 'utf8');
  }
}
