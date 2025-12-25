import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { SimpleLogger } from '@robota-sdk/agents';
import { SilentLogger } from '@robota-sdk/agents';
import type { TUniversalMessage, IChatOptions } from '@robota-sdk/agents';

/**
 * Server status interface
 */
interface ServerStatus {
    initialized: boolean;
    providers: string[];
    providerCount: number;
    timestamp: string;
}

/**
 * AI Provider interface
 */
interface AIProvider {
    chat(messages: TUniversalMessage[], options?: IChatOptions): Promise<TUniversalMessage>;
    chatStream?(messages: TUniversalMessage[], options?: IChatOptions): AsyncIterable<TUniversalMessage>;
}

/**
 * Remote server for handling AI provider requests
 */
export class RemoteServer {
    private app: express.Application;
    private providers: Map<string, any>;
    private router: express.Router;
    private readonly logger: SimpleLogger;

    constructor(config: IRemoteServerConfig = {}) {
        this.logger = config.logger || SilentLogger;
        this.app = express();
        this.providers = new Map();
        this.router = express.Router();

        if (config.enableCors) {
            this.app.use(cors());
        }
        if (config.enableHelmet) {
            this.app.use(helmet());
        }
        this.app.use(express.json());
        this.app.use(this.router);

        this.setupRoutes();
    }

    /**
     * Initialize server with AI providers
     */
    async initialize(providers: Record<string, AIProvider>): Promise<void> {
        try {
            // Register providers
            for (const [name, provider] of Object.entries(providers)) {
                this.providers.set(name, provider);
                this.logger.info(`✅ Registered provider: ${name}`);
            }

            this.logger.info(`🚀 RemoteServer initialized with ${this.providers.size} providers`);
        } catch (error) {
            this.logger.error('❌ Failed to initialize RemoteServer:', error);
            throw error;
        }
    }

    /**
     * Get Express router for mounting
     */
    getExpressRouter(): express.Router {
        return this.router;
    }

    /**
     * Get server status
     */
    getStatus(): ServerStatus {
        return {
            initialized: true, // RemoteServer itself is always initialized
            providers: Array.from(this.providers.keys()),
            providerCount: this.providers.size,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Setup API routes
     */
    private setupRoutes(): void {
        // Health check
        this.router.get('/health', (_req, res) => {
            res.json({
                status: 'ok',
                service: 'robota-remote-server',
                ...this.getStatus()
            });
        });

        // List providers
        this.router.get('/providers', (_req, res) => {
            const providerList = Array.from(this.providers.entries()).map(([name, provider]) => ({
                name,
                type: provider.constructor.name,
                available: true
            }));

            res.json({
                success: true,
                providers: providerList,
                count: providerList.length
            });
        });

        // Chat endpoint
        this.router.post('/chat', async (req, res) => {
            try {
                const { provider, model, messages, tools } = req.body;

                this.logger.info('🔧 [REMOTE-SERVER] Chat request received:');
                this.logger.info('🔧 [REMOTE-SERVER] Provider:', provider);
                this.logger.info('🔧 [REMOTE-SERVER] Model:', model);
                this.logger.info('🔧 [REMOTE-SERVER] Messages count:', messages?.length || 0);
                this.logger.info('🔧 [REMOTE-SERVER] Tools:', tools?.length || 0);

                if (!provider || !model || !messages) {
                    res.status(400).json({
                        error: 'Missing required fields: provider, model, messages'
                    });
                    return;
                }

                const providerInstance = this.providers.get(provider);
                if (!providerInstance) {
                    res.status(400).json({
                        error: `Provider '${provider}' not found`,
                        availableProviders: Array.from(this.providers.keys())
                    });
                    return;
                }

                // Execute chat
                this.logger.info('🔧 [REMOTE-SERVER] Calling provider.chat with tools:', !!tools);
                const chatOptions = {
                    model,
                    ...(tools && tools.length > 0 && { tools })
                };
                this.logger.info('🔧 [REMOTE-SERVER] Chat options:', chatOptions);

                const response = await providerInstance.chat(messages, chatOptions);

                res.json({
                    success: true,
                    data: response,
                    provider,
                    model,
                    timestamp: new Date().toISOString()
                });

            } catch (error) {
                this.logger.error('Chat execution error:', error);
                res.status(500).json({
                    error: 'Chat execution failed',
                    message: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        });

        // Stream endpoint
        this.router.post('/stream', async (req, res) => {
            try {
                const { provider, model, messages, tools } = req.body;

                this.logger.info('🔧 [REMOTE-SERVER] Stream request received:');
                this.logger.info('🔧 [REMOTE-SERVER] Provider:', provider);
                this.logger.info('🔧 [REMOTE-SERVER] Model:', model);
                this.logger.info('🔧 [REMOTE-SERVER] Messages count:', messages?.length || 0);
                this.logger.info('🔧 [REMOTE-SERVER] Tools:', tools?.length || 0);

                if (!provider || !model || !messages) {
                    res.status(400).json({
                        error: 'Missing required fields: provider, model, messages'
                    });
                    return;
                }

                const providerInstance = this.providers.get(provider);
                if (!providerInstance) {
                    res.status(400).json({
                        error: `Provider '${provider}' not found`,
                        availableProviders: Array.from(this.providers.keys())
                    });
                    return;
                }

                // Setup SSE
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Cache-Control'
                });

                try {
                    // Execute streaming chat
                    if (!providerInstance.chatStream) {
                        throw new Error(`Provider ${provider} does not support streaming`);
                    }

                    this.logger.info('🔧 [REMOTE-SERVER] Calling provider.chatStream with tools:', !!tools);
                    const chatOptions = {
                        model,
                        ...(tools && tools.length > 0 && { tools })
                    };
                    this.logger.info('🔧 [REMOTE-SERVER] Chat options:', chatOptions);

                    const stream = providerInstance.chatStream(messages, chatOptions);

                    for await (const chunk of stream) {
                        // Debug: log raw chunks received from OpenAI
                        this.logger.debug('🔍 [REMOTE-SERVER-CHUNK] Raw chunk from OpenAI:', {
                            role: chunk.role,
                            content: chunk.content?.substring(0, 30) + '...',
                            hasToolCalls: !!chunk.toolCalls,
                            toolCallsLength: chunk.toolCalls?.length || 0,
                            toolCallsData: chunk.toolCalls
                        });

                        // Same behavior as OpenAIProvider: forward the raw TUniversalMessage (no metadata wrapping)
                        const data = JSON.stringify(chunk);
                        res.write(`data: ${data}\n\n`);
                    }

                    res.write('data: [DONE]\n\n');
                    res.end();

                } catch (streamError) {
                    const errorData = JSON.stringify({
                        error: 'Stream execution failed',
                        message: streamError instanceof Error ? streamError.message : 'Unknown error'
                    });
                    res.write(`data: ${errorData}\n\n`);
                    res.end();
                }

            } catch (error) {
                this.logger.error('Stream setup error:', error);
                res.status(500).json({
                    error: 'Stream setup failed',
                    message: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        });

        // Provider capabilities
        this.router.get('/providers/:provider/capabilities', (req, res) => {
            const { provider } = req.params;
            const providerInstance = this.providers.get(provider);

            if (!providerInstance) {
                res.status(404).json({
                    error: `Provider '${provider}' not found`,
                    availableProviders: Array.from(this.providers.keys())
                });
                return;
            }

            res.json({
                success: true,
                provider,
                capabilities: {
                    chat: typeof providerInstance.chat === 'function',
                    stream: typeof providerInstance.chatStream === 'function',
                    tools: 'supportsTools' in providerInstance && typeof (providerInstance as any).supportsTools === 'function' ? (providerInstance as any).supportsTools() : false
                }
            });
        });
    }
}

// Import server configuration
export interface IRemoteServerConfig {
    port?: number;
    enableCors?: boolean;
    enableHelmet?: boolean;
    logger?: SimpleLogger;
} 