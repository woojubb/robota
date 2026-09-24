import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

import {
  parseKeybindingsDocument,
  type IKeybindingDiagnostic,
  type IKeybindingSnapshot,
} from './keybinding-registry.js';

const RELOAD_DEBOUNCE_MS = 10;

export interface IKeybindingsFilePort {
  ensureFile(): Promise<string>;
}

export interface IKeybindingsSource extends IKeybindingsFilePort {
  readonly filePath: string;
  start(): Promise<void>;
  isStarted(): boolean;
  getSnapshot(): IKeybindingSnapshot;
  subscribe(listener: (snapshot: IKeybindingSnapshot) => void): () => void;
  dispose(): void;
}

export interface INodeKeybindingsSourceOptions {
  readonly filePath: string;
  readonly schemaUrl: string;
  readonly onDiagnostic?: (diagnostic: IKeybindingDiagnostic) => void;
}

function defaultDocument(schemaUrl: string) {
  return { $schema: schemaUrl, version: 1 as const, bindings: {} };
}

function defaultSnapshot(filePath: string, schemaUrl: string): IKeybindingSnapshot {
  const parsed = parseKeybindingsDocument(JSON.stringify(defaultDocument(schemaUrl)), filePath);
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  return parsed.snapshot;
}

class NodeKeybindingsSource implements IKeybindingsSource {
  readonly filePath: string;
  readonly #schemaUrl: string;
  readonly #onDiagnostic: ((diagnostic: IKeybindingDiagnostic) => void) | undefined;
  readonly #listeners = new Set<(snapshot: IKeybindingSnapshot) => void>();
  #snapshot: IKeybindingSnapshot;
  #watcher: FSWatcher | undefined;
  #reloadTimer: ReturnType<typeof setTimeout> | undefined;
  #startPromise: Promise<void> | undefined;
  #disposed = false;

  constructor(options: INodeKeybindingsSourceOptions) {
    if (options.filePath.trim() === '') throw new Error('Keybindings file path must not be empty.');
    if (options.schemaUrl.trim() === '') throw new Error('Keybindings schema URL must not be empty.');
    this.filePath = options.filePath;
    this.#schemaUrl = options.schemaUrl;
    this.#onDiagnostic = options.onDiagnostic;
    this.#snapshot = defaultSnapshot(this.filePath, this.#schemaUrl);
  }

  start(): Promise<void> {
    if (this.#disposed) return Promise.reject(new Error('Keybindings source is disposed.'));
    if (this.#startPromise !== undefined) return this.#startPromise;
    this.#startPromise = this.#start().catch((cause) => {
      this.#watcher?.close();
      this.#watcher = undefined;
      this.#startPromise = undefined;
      throw cause;
    });
    return this.#startPromise;
  }

  async #start(): Promise<void> {
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true });
    await this.#load();
    if (this.#disposed) throw new Error('Keybindings source is disposed.');
    this.#watcher = watch(directory, { persistent: false }, (_event, filename) => {
      if (filename !== null && filename.toString() !== basename(this.filePath)) return;
      this.#scheduleReload();
    });
  }

  isStarted(): boolean {
    return this.#watcher !== undefined && !this.#disposed;
  }

  getSnapshot(): IKeybindingSnapshot {
    return this.#snapshot;
  }

  subscribe(listener: (snapshot: IKeybindingSnapshot) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async ensureFile(): Promise<string> {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      await writeFile(this.filePath, `${JSON.stringify(defaultDocument(this.#schemaUrl), null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
    } catch (cause) {
      if (!isAlreadyExists(cause as object)) throw cause;
    }
    return this.filePath;
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#reloadTimer !== undefined) clearTimeout(this.#reloadTimer);
    this.#reloadTimer = undefined;
    this.#watcher?.close();
    this.#watcher = undefined;
    this.#listeners.clear();
  }

  #scheduleReload(): void {
    if (this.#disposed) return;
    if (this.#reloadTimer !== undefined) clearTimeout(this.#reloadTimer);
    this.#reloadTimer = setTimeout(() => {
      this.#reloadTimer = undefined;
      void this.#load();
    }, RELOAD_DEBOUNCE_MS);
  }

  async #load(): Promise<void> {
    let text: string;
    try {
      text = await readFile(this.filePath, 'utf8');
    } catch (cause) {
      if (isNotFound(cause as object)) return;
      this.#publishInvalid({
        file: this.filePath,
        path: '$',
        message: errorMessage(cause as object),
      });
      return;
    }
    const parsed = parseKeybindingsDocument(text, this.filePath);
    if (!parsed.ok) {
      this.#publishInvalid(parsed.diagnostic);
      return;
    }
    this.#publish(Object.freeze({ ...parsed.snapshot, generation: this.#snapshot.generation + 1 }));
  }

  #publishInvalid(diagnostic: IKeybindingDiagnostic): void {
    this.#onDiagnostic?.(diagnostic);
    this.#publish(
      Object.freeze({
        ...this.#snapshot,
        generation: this.#snapshot.generation + 1,
        diagnostic,
      }),
    );
  }

  #publish(snapshot: IKeybindingSnapshot): void {
    if (this.#disposed) return;
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener(snapshot);
  }
}

function isNotFound(cause: object): boolean {
  return isNodeError(cause) && cause.code === 'ENOENT';
}

function isAlreadyExists(cause: object): boolean {
  return isNodeError(cause) && cause.code === 'EEXIST';
}

function isNodeError(cause: object): cause is NodeJS.ErrnoException {
  return cause instanceof Error && 'code' in cause;
}

function errorMessage(cause: object): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function createNodeKeybindingsSource(
  options: INodeKeybindingsSourceOptions,
): IKeybindingsSource {
  return new NodeKeybindingsSource(options);
}
