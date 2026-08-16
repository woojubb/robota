/**
 * Provider chat routes for the agent server.
 *
 * Split out of `app.ts` to keep each file under 300 lines: composing the app (security middleware,
 * CORS, rate limiting, provider construction, lifecycle) and serving a provider call are separate
 * responsibilities, and the second is the one with a request contract to keep — see
 * `remote-chat-options.ts`, which owns what a request body is allowed to say.
 */

import { createLogger } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import { GeminiProvider } from '@robota-sdk/agent-provider-gemini';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';
import { DeepSeekProvider } from '@robota-sdk/agent-provider-openai-compatible';

import { requireOperatorKeyAuth } from '../middleware/require-operator-key-auth.js';
import { parseChatOptionsFromBody } from '../remote-chat-options.js';

import type { IAIProvider } from '@robota-sdk/agent-core';
import type { Express } from 'express';

const routeLogger = createLogger('agent-server');

/** Register the operator-key and BYOK chat routes, plus the remote health probe. */
export function registerProviderChatRoutes(
  app: Express,
  providers: Record<string, IAIProvider>,
): void {
  // Provider CHAT routes — inline (formerly in agent-remote-server-core). There is deliberately no
  // stream route: this comment claimed one for as long as the client posted to a nonexistent
  // `/stream`, which is how a 404 stayed dressed as a capability. Restoring remote streaming is
  // CORE-046 — it needs a transport decision and an owner for chunk assembly, not a route alone.
  const providerNames = Object.keys(providers);
  app.get('/api/v1/remote/health', (_req, res) => {
    res.json({ status: 'ok', providers: providerNames, timestamp: new Date().toISOString() });
  });
  // SEC-008: this route spends the OPERATOR's provider credit (the providers above are built from
  // the operator's API keys), and it had no authentication — only a global IP rate limiter, which
  // bounds the rate of anonymous spending rather than preventing it. BYOK below is deliberately not
  // gated: the caller brings their own key.
  app.post('/api/v1/remote/chat', requireOperatorKeyAuth, async (req, res) => {
    try {
      const { provider: providerName, messages, model } = req.body;
      if (!providerName || typeof providerName !== 'string') {
        res.status(400).json({ error: 'Missing or invalid "provider" field' });
        return;
      }
      if (!Array.isArray(messages) || messages.length === 0) {
        res
          .status(400)
          .json({ error: 'Missing or invalid "messages" field: must be a non-empty array' });
        return;
      }
      const provider = providers[providerName];
      if (!provider) {
        res.status(400).json({ error: `Unknown provider: ${providerName}` });
        return;
      }
      // CORE-044: the client had always sent `tools`, and this handler read only `{ model }` --
      // so a remote agent configured with tools reached the model with NONE of them, silently,
      // because nothing fails when a model is merely never offered a tool. Every per-call option
      // was dropped the same way. `rejected` is returned rather than swallowed: replacing one
      // silent drop with another would not be a fix.
      const { options, rejected } = parseChatOptionsFromBody(
        req.body,
        typeof model === 'string' ? model : undefined,
      );
      if (rejected.length > 0) {
        // Refusing beats proceeding: a request whose `toolChoice: 'requried'` is quietly ignored
        // produces a plausible answer the caller never asked for, and that is indistinguishable
        // from success. Applying part of what was asked is the failure mode this route already had.
        res.status(400).json({ error: 'Invalid request options', rejected });
        return;
      }
      const response = await provider.chat(messages, options);
      res.json(response);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // BYOK (Bring Your Own Key) endpoint — creates a per-request provider using the caller's API key.
  // The apiKey is intentionally never logged to avoid leaking credentials.
  app.post('/api/v1/byok/chat', async (req, res) => {
    const { provider: providerName, apiKey, messages, model } = req.body;
    if (typeof providerName !== 'string' || !providerName) {
      res.status(400).json({ error: 'Missing or invalid "provider" field' });
      return;
    }
    if (typeof apiKey !== 'string' || !apiKey) {
      res.status(400).json({ error: 'Missing "apiKey" field' });
      return;
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      res
        .status(400)
        .json({ error: 'Missing or invalid "messages" field: must be a non-empty array' });
      return;
    }
    const modelStr = typeof model === 'string' ? model : undefined;
    let byokProvider: IAIProvider;
    switch (providerName) {
      case 'anthropic':
        byokProvider = new AnthropicProvider({ apiKey });
        break;
      case 'openai':
        byokProvider = new OpenAIProvider({ apiKey });
        break;
      case 'gemini':
        byokProvider = new GeminiProvider({ apiKey });
        break;
      case 'deepseek':
        byokProvider = new DeepSeekProvider({ apiKey });
        break;
      default:
        res.status(400).json({ error: `Unsupported provider: ${providerName}` });
        return;
    }
    try {
      // Same drop as the operator-key route above, in an identical handler shape (CORE-044).
      const { options, rejected } = parseChatOptionsFromBody(req.body, modelStr);
      if (rejected.length > 0) {
        res.status(400).json({ error: 'Invalid request options', rejected });
        return;
      }
      const response = await byokProvider.chat(messages, options);
      res.json(response);
    } catch (err) {
      routeLogger.error(
        'BYOK chat failed',
        new Error(err instanceof Error ? err.message : 'Chat error'),
      );
      res.status(500).json({ error: 'Chat request failed' });
    }
  });
}
