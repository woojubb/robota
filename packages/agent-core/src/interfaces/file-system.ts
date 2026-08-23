export interface IDirent {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
}

export interface IStats {
  mtimeMs: number;
  birthtimeMs: number;
  size: number;
  isFile(): boolean;
  isDirectory(): boolean;
}

export interface IFileSystem {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: BufferEncoding): string;
  writeFileSync(path: string, data: string, encoding?: BufferEncoding): void;
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
  readdirSync(path: string): string[];
  readdirSync(path: string, options: { withFileTypes: true }): IDirent[];
  statSync(path: string): IStats;
  rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  cpSync(source: string, destination: string, options?: { recursive?: boolean }): void;
  renameSync(oldPath: string, newPath: string): void;
  /**
   * The canonical path with every symlink resolved. Throws if `path` does not exist.
   *
   * SEC-018: containment checks compare canonical forms. Without this, `<root>/link` pointing at
   * `/etc` passes a lexical prefix test, so a symlink inside a plugin root can redirect a copy,
   * rename, load or recursive delete outside it.
   */
  realpathSync(path: string): string;
  constants: { F_OK: number; R_OK: number; W_OK: number };
}

export interface IFileSystemAsync {
  access(path: string, mode?: number): Promise<void>;
  copyFile(src: string, dest: string, flags?: number): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  readdir(path: string): Promise<string[]>;
  readdir(path: string, options: { withFileTypes: true }): Promise<IDirent[]>;
  realpath(path: string): Promise<string>;
  rename(oldPath: string, newPath: string): Promise<void>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  stat(path: string): Promise<IStats>;
  writeFile(path: string, data: string, encoding?: BufferEncoding): Promise<void>;
}
