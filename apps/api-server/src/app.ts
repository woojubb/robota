import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { RemoteServer } from '@robota-sdk/remote/server';
import { OpenAIProvider } from '@robota-sdk/openai';
import { AnthropicProvider } from '@robota-sdk/anthropic';
import { GoogleProvider } from '@robota-sdk/google';
import { PlaygroundWebSocketServer } from './websocket-server';

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
    app.use(helmet({
        contentSecurityPolicy: false, // Allow for API usage
        crossOriginEmbedderPolicy: false
    }));

    // CORS configuration
    app.use(cors({
        origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000', 'https://robota.io'],
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
    }));

    // Rate limiting
    const limiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
        message: {
            error: 'Too many requests',
            retryAfter: '15 minutes'
        },
        standardHeaders: true,
        legacyHeaders: false
    });
    app.use(limiter);

    // Body parsing
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Initialize RemoteServer
    const remoteServer = new RemoteServer();

    // Initialize providers based on available API keys
    const providers: Record<string, any> = {};

    if (process.env.OPENAI_API_KEY) {
        providers.openai = new OpenAIProvider({
            apiKey: process.env.OPENAI_API_KEY
        });
    }

    if (process.env.ANTHROPIC_API_KEY) {
        providers.anthropic = new AnthropicProvider({
            apiKey: process.env.ANTHROPIC_API_KEY
        });
    }

    if (process.env.GOOGLE_API_KEY) {
        providers.google = new GoogleProvider({
            apiKey: process.env.GOOGLE_API_KEY
        });
    }

    // Initialize server with providers
    remoteServer.initialize(providers).catch(console.error);

    // Mount remote API routes
    app.use('/v1/remote', remoteServer.getExpressRouter());

    // Root endpoint
    app.get('/', (req, res) => {
        res.json({
            name: 'Robota SDK API Server',
            version: '1.0.0',
            description: 'Remote AI Provider Proxy Server',
            environment: process.env.NODE_ENV || 'development',
            timestamp: new Date().toISOString(),
            endpoints: {
                health: '/v1/remote/health',
                chat: '/v1/remote/chat',
                stream: '/v1/remote/stream',
                capabilities: '/v1/remote/providers/:provider/capabilities'
            },
            status: remoteServer.getStatus()
        });
    });

    // WebSocket status endpoint
    app.get('/v1/remote/ws/status', (req, res) => {
        if (playgroundWebSocketServer) {
            const stats = playgroundWebSocketServer.getStats();
            res.json({
                websocket: {
                    enabled: true,
                    endpoint: '/ws/playground',
                    ...stats
                }
            });
        } else {
            res.json({
                websocket: {
                    enabled: false,
                    message: 'WebSocket server not initialized'
                }
            });
        }
    });

    // Global health endpoint
    app.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            service: 'robota-api-server',
            version: '1.0.0',
            environment: process.env.NODE_ENV || 'development'
        });
    });

    // 404 handler
    app.use('*', (req, res) => {
        res.status(404).json({
            error: 'Not Found',
            message: `Route ${req.method} ${req.originalUrl} not found`,
            timestamp: new Date().toISOString()
        });
    });

    // Error handling
    app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
        console.error('API Error:', error);

        const statusCode = error.statusCode || 500;
        const isProduction = process.env.NODE_ENV === 'production';

        res.status(statusCode).json({
            error: {
                message: isProduction && statusCode === 500 ? 'Internal Server Error' : error.message,
                status: statusCode,
                timestamp: new Date().toISOString()
            }
        });
    });

    return app;
} 