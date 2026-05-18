import { Router, type IRouter } from 'express';

import { getProviderCatalog } from '../catalog/providers.js';
import { byokKeySanitizer } from '../middleware/byok-key-sanitizer.js';

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

// PLG-017: GET /api/playground/catalog/tools — added in PLG-017
// PLG-015: POST /api/playground/execute — added in PLG-015
