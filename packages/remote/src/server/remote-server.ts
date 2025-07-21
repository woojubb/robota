import type { Request, Response, NextFunction } from 'express';
import { Router } from 'express';
import type {
    ChatExecutionRequest,
    StreamExecutionRequest,
    UniversalMessage,
    AssistantMessage,
    UserContext,
    HealthStatus
} from '../shared/types';
import { AIProviderEngine } from '../core/ai-provider-engine';

/**
 * RemoteServer - Server implementation
 * Combines core business logic with server-side handling
 */
export class RemoteServer {
    readonly name = 'remote-server';
    readonly version = '1.0.0';

    private engine: AIProviderEngine;
    private startTime: Date;
    private providers: Map<string, any> = new Map();

    constructor() {
        this.engine = new AIProviderEngine();
        this.startTime = new Date();
    }

    /**
     * Register AI provider instance
     */
    registerProvider(name: string, provider: any): void {
        this.providers.set(name, provider);
    }

    /**
     * Get Express router with all endpoints
     */
    getExpressRouter(): Router {
        const router = Router();

        // Chat endpoint
        router.post('/chat', this.handleChat.bind(this));

        // Streaming endpoint  
        router.post('/stream', this.handleChatStream.bind(this));

        // Health check
        router.get('/health', this.handleHealth.bind(this));

        // Provider capabilities
        router.get('/providers/:provider/capabilities', this.handleProviderCapabilities.bind(this));

        return router;
    }

    /**
     * Handle chat completion request
     */
    private async handleChat(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const request: ChatExecutionRequest = req.body;

            // 1. Validate request using core engine
            this.engine.validateRequest(request);

            // 2. Get provider instance
            const provider = this.providers.get(request.provider);
            if (!provider) {
                throw new Error(`Provider '${request.provider}' not found`);
            }

            // 3. Execute chat via provider
            const response = await provider.chat(request.messages, request.options);

            // 4. Validate and transform response using core engine
            const validatedResponse = this.engine.validateResponse(response);

            res.json({
                success: true,
                data: validatedResponse,
                metadata: {
                    provider: request.provider,
                    timestamp: new Date().toISOString(),
                    requestId: this.generateRequestId()
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Handle streaming chat completion request
     */
    private async handleChatStream(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const request: StreamExecutionRequest = req.body;

            // 1. Validate request using core engine
            this.engine.validateStreamRequest(request);

            // 2. Get provider instance
            const provider = this.providers.get(request.provider);
            if (!provider) {
                throw new Error(`Provider '${request.provider}' not found`);
            }

            // 3. Set up Server-Sent Events
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('Access-Control-Allow-Origin', '*');

            // 4. Stream responses
            try {
                for await (const chunk of provider.chatStream(request.messages, request.options)) {
                    // Validate each chunk using core engine
                    const validatedChunk = this.engine.validateStreamChunk(chunk);

                    // Send as Server-Sent Event
                    res.write(`data: ${JSON.stringify(validatedChunk)}\n\n`);
                }

                // Send completion signal
                res.write('data: [DONE]\n\n');
                res.end();

            } catch (streamError) {
                const errorMessage = streamError instanceof Error ? streamError.message : 'Unknown streaming error';
                res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
                res.end();
            }

        } catch (error) {
            next(error);
        }
    }

    /**
     * Handle health check request
     */
    private async handleHealth(req: Request, res: Response): Promise<void> {
        const healthStatus: HealthStatus = {
            status: 'healthy',
            timestamp: new Date(),
            version: this.version,
            uptime: Date.now() - this.startTime.getTime(),
            services: {
                transport: true,
                providers: Object.fromEntries(
                    Array.from(this.providers.keys()).map(name => [name, true])
                )
            }
        };

        res.json(healthStatus);
    }

    /**
     * Handle provider capabilities request
     */
    private async handleProviderCapabilities(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { provider } = req.params;

            const capabilities = this.engine.getProviderCapabilities(provider);

            res.json({
                success: true,
                data: capabilities,
                provider
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Get server status
     */
    getStatus() {
        return {
            name: this.name,
            version: this.version,
            uptime: Date.now() - this.startTime.getTime(),
            providers: Array.from(this.providers.keys()),
            startTime: this.startTime
        };
    }

    /**
     * Initialize server with providers
     */
    async initialize(providers: Record<string, any>): Promise<void> {
        // Register all providers
        for (const [name, provider] of Object.entries(providers)) {
            this.registerProvider(name, provider);
        }

        console.log(`RemoteServer initialized with providers: ${Object.keys(providers).join(', ')}`);
    }

    /**
     * Generate unique request ID
     */
    private generateRequestId(): string {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
} 