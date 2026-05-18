import type { Request, Response, NextFunction } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      byokKey?: string;
    }
  }
}

/**
 * Extracts the BYOK API key from X-Provider-API-Key header into req.byokKey,
 * then removes it from headers so it never appears in access logs.
 */
export function byokKeySanitizer(req: Request, _res: Response, next: NextFunction): void {
  const key = req.headers['x-provider-api-key'];
  if (typeof key === 'string' && key.length > 0) {
    req.byokKey = key;
    delete req.headers['x-provider-api-key'];
  }
  next();
}
