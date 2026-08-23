/** Projection used to render a resume picker. */
export interface IResumableSessionSummary {
  id: string;
  name?: string;
  cwd: string;
  updatedAt: string;
  messageCount: number;
  preview: string;
}
