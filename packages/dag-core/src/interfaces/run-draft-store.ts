import type { IRunDraft } from '../types/run-draft.js';

export interface IRunDraftStore {
  saveRunDraft(draft: IRunDraft): Promise<void>;
  getRunDraft(draftId: string): Promise<IRunDraft | undefined>;
  listRunDrafts(): Promise<IRunDraft[]>;
  deleteRunDraft(draftId: string): Promise<void>;
}
