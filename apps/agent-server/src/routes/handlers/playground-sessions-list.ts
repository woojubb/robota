import { listResumableSessionSummaries } from '@robota-sdk/agent-framework';

import { getPlaygroundSessionStore } from '../../session/persistent-session-store.js';

import type { Request, Response } from 'express';

export function playgroundSessionsListHandler(_req: Request, res: Response): void {
  const store = getPlaygroundSessionStore();
  const summaries = listResumableSessionSummaries(store, process.cwd());
  res.json(summaries);
}
