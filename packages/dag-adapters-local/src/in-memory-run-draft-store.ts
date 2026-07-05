import type { IRunDraft, IRunDraftStore } from '@robota-sdk/dag-core';

export class InMemoryRunDraftStore implements IRunDraftStore {
  private readonly drafts = new Map<string, IRunDraft>();

  public async saveRunDraft(draft: IRunDraft): Promise<void> {
    this.drafts.set(draft.draftId, draft);
  }

  public async getRunDraft(draftId: string): Promise<IRunDraft | undefined> {
    return this.drafts.get(draftId);
  }

  public async listRunDrafts(): Promise<IRunDraft[]> {
    return [...this.drafts.values()].sort(compareRunDrafts);
  }

  public async deleteRunDraft(draftId: string): Promise<void> {
    this.drafts.delete(draftId);
  }
}

export function compareRunDrafts(a: IRunDraft, b: IRunDraft): number {
  const updatedAtComparison = b.updatedAt.localeCompare(a.updatedAt);
  if (updatedAtComparison !== 0) {
    return updatedAtComparison;
  }
  return a.draftId.localeCompare(b.draftId);
}
