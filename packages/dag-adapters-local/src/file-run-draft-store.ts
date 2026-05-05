import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { IRunDraft, IRunDraftStore } from '@robota-sdk/dag-core';
import { compareRunDrafts } from './in-memory-run-draft-store.js';

const TEMPORARY_SUFFIX_RADIX = 36;
const TEMPORARY_SUFFIX_LENGTH = 10;
const TEMPORARY_SUFFIX_START = 2;

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

export class FileRunDraftStore implements IRunDraftStore {
  private isInitialized = false;

  public constructor(private readonly storageRootPath: string) {}

  private async ensureInitialized(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    await mkdir(this.storageRootPath, { recursive: true });
    this.isInitialized = true;
  }

  private resolveDraftFilePath(draftId: string): string {
    return path.join(this.storageRootPath, `${encodeSegment(draftId)}.json`);
  }

  public async saveRunDraft(draft: IRunDraft): Promise<void> {
    await this.ensureInitialized();
    const draftFilePath = this.resolveDraftFilePath(draft.draftId);
    const temporarySuffix = Math.random()
      .toString(TEMPORARY_SUFFIX_RADIX)
      .slice(TEMPORARY_SUFFIX_START, TEMPORARY_SUFFIX_LENGTH);
    const temporaryFilePath = `${draftFilePath}.tmp-${Date.now()}-${temporarySuffix}`;
    await writeFile(temporaryFilePath, JSON.stringify(draft, null, 2), 'utf-8');
    await rename(temporaryFilePath, draftFilePath);
  }

  public async getRunDraft(draftId: string): Promise<IRunDraft | undefined> {
    await this.ensureInitialized();
    try {
      const content = await readFile(this.resolveDraftFilePath(draftId), 'utf-8');
      return JSON.parse(content) as IRunDraft;
    } catch {
      return undefined;
    }
  }

  public async listRunDrafts(): Promise<IRunDraft[]> {
    await this.ensureInitialized();
    const entries = await readdir(this.storageRootPath, { withFileTypes: true });
    const drafts: IRunDraft[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }
      try {
        const content = await readFile(path.join(this.storageRootPath, entry.name), 'utf-8');
        drafts.push(JSON.parse(content) as IRunDraft);
      } catch {
        // Ignore unreadable draft files; callers can still use valid drafts.
      }
    }
    return drafts.sort(compareRunDrafts);
  }

  public async deleteRunDraft(draftId: string): Promise<void> {
    await this.ensureInitialized();
    await rm(this.resolveDraftFilePath(draftId), { force: true });
  }
}
