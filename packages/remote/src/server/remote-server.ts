import express from 'express';

/**
 * RemoteServer - Express.js integration for AI Provider proxying
 */
export class RemoteServer {
    private providers: Map<string, any> = new Map();
    private router: express.Router;
    private initialized = false;

    constructor() {
        this.router = express.Router();
        this.setupRoutes();
    }

    /**
     * Initialize server with AI providers
     */
    async initialize(providers: Record<string, any>): Promise<void> {
        try {
            // Register providers
            for (const [name, provider] of Object.entries(providers)) {
                this.providers.set(name, provider);
                console.log(`✅ Registered provider: ${name}`);
            }

            this.initialized = true;
            console.log(`🚀 RemoteServer initialized with ${this.providers.size} providers`);
        } catch (error) {
            console.error('❌ Failed to initialize RemoteServer:', error);
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
    getStatus(): any {
        return {
            initialized: this.initialized,
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
                const { provider, model, messages } = req.body;

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
                const response = await providerInstance.chat(messages, { model });

                res.json({
                    success: true,
                    data: response,
                    provider,
                    model,
                    timestamp: new Date().toISOString()
                });

            } catch (error) {
                console.error('Chat execution error:', error);
                res.status(500).json({
                    error: 'Chat execution failed',
                    message: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        });

        // Stream endpoint
        this.router.post('/stream', async (req, res) => {
            try {
                const { provider, model, messages } = req.body;

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
                    const stream = providerInstance.chatStream(messages, { model });

                    for await (const chunk of stream) {
                        const data = JSON.stringify({
                            success: true,
                            data: chunk,
                            provider,
                            model,
                            timestamp: new Date().toISOString()
                        });

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
                console.error('Stream setup error:', error);
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
                    tools: typeof providerInstance.supportsTools === 'function' ? providerInstance.supportsTools() : false
                }
            });
        });
    }
} 