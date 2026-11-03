import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { IPluginTextFileStore } from './text-file-store';

/** Reads and writes UTF-8 text files on the local file system. */
export class NodePluginTextFileStore implements IPluginTextFileStore {
  async readText(path: string): Promise<string | undefined> {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }

  async writeText(path: string, text: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, 'utf8');
  }

  async appendText(path: string, text: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, text, 'utf8');
  }
}
