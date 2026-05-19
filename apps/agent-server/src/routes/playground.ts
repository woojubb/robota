import { Router, type IRouter } from 'express';

import { getProviderCatalog } from '../catalog/providers.js';
import { getSkillCatalog } from '../catalog/skills.js';
import { getToolCatalog } from '../catalog/tools.js';
import { byokKeySanitizer } from '../middleware/byok-key-sanitizer.js';
import { playgroundExecuteHandler } from './handlers/playground-execute.js';
import { playgroundSessionCreateHandler } from './handlers/playground-session-create.js';
import { playgroundSessionDestroyHandler } from './handlers/playground-session-destroy.js';
import { playgroundSessionSubmitHandler } from './handlers/playground-session-submit.js';

export const playgroundRouter: IRouter = Router();

// Apply BYOK key sanitizer to all playground routes
playgroundRouter.use(byokKeySanitizer);

// Health check for playground API
playgroundRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'playground' });
});

// PLG-016: Provider & Model Catalog
playgroundRouter.get('/catalog/providers', (_req, res) => {
  res.json(getProviderCatalog());
});

// PLG-017: Tool Catalog
playgroundRouter.get('/catalog/tools', (_req, res) => {
  res.json(getToolCatalog());
});

// PLG-014: Skill Catalog
playgroundRouter.get('/catalog/skills', (_req, res) => {
  res.json(getSkillCatalog());
});

// PLG-015: POST /api/playground/execute — SSE streaming agent execution (legacy)
playgroundRouter.post('/execute', (req, res) => {
  void playgroundExecuteHandler(req, res);
});

// PLG-F-002: InteractiveSession-based session lifecycle
playgroundRouter.post('/sessions', (req, res) => {
  void playgroundSessionCreateHandler(req, res);
});
playgroundRouter.post('/sessions/:id/submit', (req, res) => {
  void playgroundSessionSubmitHandler(req, res);
});
playgroundRouter.delete('/sessions/:id', (req, res) => {
  void playgroundSessionDestroyHandler(req, res);
});
