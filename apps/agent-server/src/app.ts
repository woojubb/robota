import { createLogger } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';
import { DeepSeekProvider } from '@robota-sdk/agent-provider/deepseek';
import { GeminiProvider } from '@robota-sdk/agent-provider/gemini';
import { GoogleProvider } from '@robota-sdk/agent-provider/google';
import { OpenAIProvider } from '@robota-sdk/agent-provider/openai';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import { playgroundRouter } from './routes/playground.js';
import { resolveApiDocsEnabled } from './utils/env-flags.js';

import type { PlaygroundWebSocketServer } from './websocket-server';
import type { IAIProvider } from '@robota-sdk/agent-core';

const appLogger = createLogger('agent-server');

// Global WebSocket server instance (will be initialized in server.ts)
export let playgroundWebSocketServer: PlaygroundWebSocketServer | null = null;

export function setPlaygroundWebSocketServer(server: PlaygroundWebSocketServer): void {
  playgroundWebSocketServer = server;
}

/**
 * Create Express application with RemoteServer
 * This app can be used both standalone and in Firebase Functions
 */
export function createApp(): express.Application {
  const app = express();

  // Trust proxy for Firebase Functions and load balancers
  app.set('trust proxy', true);

  // Security middleware
  app.use(
    helmet({
      contentSecurityPolicy: false, // Allow for API usage
      crossOriginEmbedderPolicy: false,
    }),
  );

  // CORS configuration
  app.use(
    cors({
      origin: process.env.CORS_ORIGINS?.split(',') || [
        'http://localhost:3000',
        'http://localhost:7071',
        'https://robota.io',
      ],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Provider-API-Key'],
    }),
  );

  // Rate limiting
  const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10);
  if (!Number.isFinite(rateLimitMax) || rateLimitMax <= 0) {
    throw new Error(`Invalid RATE_LIMIT_MAX: "${process.env.RATE_LIMIT_MAX}"`);
  }
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: rateLimitMax,
    validate: { trustProxy: false }, // trust proxy is intentionally true for Firebase Functions
    message: {
      error: 'Too many requests',
      retryAfter: '15 minutes',
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use(limiter);

  // Body parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Initialize providers based on available API keys
  const providers: Record<string, IAIProvider> = {};

  if (process.env.OPENAI_API_KEY) {
    providers.openai = new OpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  if (process.env.ANTHROPIC_API_KEY) {
    providers.anthropic = new AnthropicProvider({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  if (process.env.GEMINI_API_KEY) {
    providers.google = new GoogleProvider({
      apiKey: process.env.GEMINI_API_KEY,
    });
  }

  // Provider chat/stream routes — inline (formerly in agent-remote-server-core)
  const providerNames = Object.keys(providers);
  app.get('/api/v1/remote/health', (_req, res) => {
    res.json({ status: 'ok', providers: providerNames, timestamp: new Date().toISOString() });
  });
  app.post('/api/v1/remote/chat', async (req, res) => {
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
      const response = await provider.chat(messages, { model });
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
      const response = await byokProvider.chat(messages, { model: modelStr });
      res.json(response);
    } catch (err) {
      appLogger.error(
        'BYOK chat failed',
        new Error(err instanceof Error ? err.message : 'Chat error'),
      );
      res.status(500).json({ error: 'Chat request failed' });
    }
  });

  // Root endpoint
  app.get('/', (_req, res) => {
    res.json({
      name: 'Robota SDK API Server',
      version: '1.0.0',
      description: 'Remote AI Provider Proxy Server',
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
      endpoints: {
        health: '/api/v1/remote/health',
        chat: '/api/v1/remote/chat',
      },
      providers: providerNames,
    });
  });

  // WebSocket status endpoint
  app.get('/api/v1/remote/ws/status', (_req, res) => {
    if (playgroundWebSocketServer) {
      const stats = playgroundWebSocketServer.getStats();
      res.json({
        websocket: {
          enabled: true,
          endpoint: '/ws/playground',
          ...stats,
        },
      });
    } else {
      res.json({
        websocket: {
          enabled: false,
          message: 'WebSocket server not initialized',
        },
      });
    }
  });

  // Global health endpoint
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'robota-agent-server',
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
    });
  });

  // Playground API routes (PLG-015~017 endpoints added here incrementally)
  app.use('/api/playground', playgroundRouter);

  // 404 handler
  app.use('*', (req, res) => {
    res.status(404).json({
      error: 'Not Found',
      message: `Route ${req.method} ${req.originalUrl} not found`,
      timestamp: new Date().toISOString(),
    });
  });

  // Error handling
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      appLogger.error('API Error:', error as Error);
      const statusCode =
        typeof error === 'object' &&
        error !== null &&
        'statusCode' in error &&
        typeof (error as { statusCode?: unknown }).statusCode === 'number'
          ? (error as { statusCode: number }).statusCode
          : 500;
      const isProduction = process.env.NODE_ENV === 'production';
      const errorMessage =
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : 'Unknown error';

      res.status(statusCode).json({
        error: {
          message: isProduction && statusCode === 500 ? 'Internal Server Error' : errorMessage,
          status: statusCode,
          timestamp: new Date().toISOString(),
        },
      });
    },
  );

  return app;
}
