import jwt from 'jsonwebtoken';

import type { NextFunction, Request, Response } from 'express';

/**
 * SEC-008 — a route that spends the OPERATOR's provider credit must know who is spending it.
 *
 * `POST /api/v1/remote/chat` reaches providers constructed from the operator's `OPENAI_API_KEY` /
 * `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` and had no authentication at all. The only control was a
 * global IP rate limiter, which bounds the RATE of anonymous spending rather than preventing it.
 *
 * BYOK (`/api/v1/byok/chat`) is deliberately NOT behind this: the caller supplies their own key, so
 * there is no operator credit to protect and requiring an account would be a different product
 * decision, not a security fix.
 *
 * Same shape as the playground WebSocket gate: no secret means no authentication is possible, and a
 * server that cannot verify a token refuses rather than inventing a weaker check.
 */
export function requireOperatorKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(503).json({
      error:
        "This endpoint spends the operator's provider credit and requires authentication, but " +
        'JWT_SECRET is not set, so no token can be verified. Set JWT_SECRET to serve it.',
    });
    return;
  }

  const header = req.header('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    res.status(401).json({ error: 'Missing bearer token' });
    return;
  }

  try {
    jwt.verify(token, secret);
  } catch {
    res.status(401).json({ error: 'Invalid or expired authentication token' });
    return;
  }

  next();
}
