import { destroySession } from '../../session/playground-session-store.js';

import type { Request, Response } from 'express';

export async function playgroundSessionDestroyHandler(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };

  await destroySession(id);
  res.json({ ok: true });
}
