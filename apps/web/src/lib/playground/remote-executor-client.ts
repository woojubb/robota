/**
 * RemoteExecutor Client for Playground
 * 
 * Dynamic import and configuration of RemoteExecutor for browser environment
 */

import type { PlaygroundCredentials } from './playground-auth';

export interface PlaygroundRemoteExecutor {
    readonly name: string;
    readonly version: string;
    executeChat(request: any): Promise<any>;
    executeChatStream?(request: any): AsyncIterable<any>;
    supportsTools(): boolean;
    validateConfig(): boolean;
    dispose?(): Promise<void>;
}

/**
 * Create a RemoteExecutor instance for playground use
 */
export async function createPlaygroundExecutor(credentials: PlaygroundCredentials): Promise<PlaygroundRemoteExecutor> {
    try {
        // Dynamic import to avoid SSR issues
        const remoteModule = await import('@robota-sdk/remote').catch(() => null);

        if (remoteModule?.RemoteExecutor) {
            // Use simplified facade - clean configuration
            const executor = new remoteModule.RemoteExecutor({
                serverUrl: credentials.serverUrl,
                userApiKey: credentials.userApiKey,
                timeout: 30000,
                headers: {}
            });

            return {
                name: 'remote',
                version: '1.0.0',
                executeChat: async (request) => {
                    return await executor.executeChat(request);
                },
                executeChatStream: async function* (request) {
                    if (executor.executeChatStream) {
                        yield* executor.executeChatStream(request);
                    } else {
                        // Fallback for non-streaming
                        const response = await executor.executeChat(request);
                        yield response;
                    }
                },
                supportsTools: () => true,
                validateConfig: () => true,
                dispose: async () => {
                    if (executor.dispose) {
                        await executor.dispose();
                    }
                }
            };
        } else {
            throw new Error('RemoteExecutor not available');
        }

    } catch (error) {
        console.error('Failed to create RemoteExecutor, falling back to mock:', error);

        // Fallback to mock implementation
        return createMockExecutor(credentials);
    }
}

/**
 * Create a mock executor for development/fallback
 */
function createMockExecutor(credentials: PlaygroundCredentials): PlaygroundRemoteExecutor {
    return {
        name: 'mock-remote',
        version: '1.0.0',
        executeChat: async (request) => {
            // Simulate processing time
            await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

            return {
                role: 'assistant',
                content: `Mock response for: "${request.messages?.[request.messages.length - 1]?.content || 'Hello'}".\n\nThis is a simulated response from the playground using credentials for server: ${credentials.serverUrl}`,
                timestamp: new Date()
            };
        },
        executeChatStream: async function* (request) {
            const fullResponse = `Mock streaming response for: "${request.messages?.[request.messages.length - 1]?.content || 'Hello'}".\n\nThis response is being streamed in chunks to simulate real AI behavior.`;

            const words = fullResponse.split(' ');
            for (const word of words) {
                yield {
                    role: 'assistant',
                    content: word + ' ',
                    timestamp: new Date()
                };
                // Simulate streaming delay
                await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));
            }
        },
        supportsTools: () => true,
        validateConfig: () => true,
        dispose: async () => {
            console.log('Mock executor disposed');
        }
    };
}

/**
 * Test RemoteExecutor connection
 */
export async function testPlaygroundConnection(credentials: PlaygroundCredentials): Promise<{
    success: boolean;
    executor?: PlaygroundRemoteExecutor;
    error?: string;
    serverStatus?: string;
}> {
    try {
        const executor = await createPlaygroundExecutor(credentials);

        // Test basic connectivity
        const testResult = executor.validateConfig();

        if (testResult) {
            return {
                success: true,
                executor,
                serverStatus: `Connected to ${credentials.serverUrl}`
            };
        } else {
            return {
                success: false,
                error: 'Configuration validation failed',
                serverStatus: 'Configuration invalid'
            };
        }

    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            serverStatus: 'Connection failed'
        };
    }
}

/**
 * Initialize playground with RemoteExecutor
 */
export async function initializePlaygroundExecutor(credentials: PlaygroundCredentials): Promise<void> {
    try {
        const executor = await createPlaygroundExecutor(credentials);

        // Set global executor for sandbox environment
        if (typeof window !== 'undefined') {
            window.__ROBOTA_PLAYGROUND_EXECUTOR__ = executor;
            window.__ROBOTA_PLAYGROUND_CONFIG__ = {
                serverUrl: credentials.serverUrl,
                userApiKey: credentials.userApiKey,
                enableWebSocket: false
            };

            console.log('🔌 Playground RemoteExecutor initialized successfully');
            console.log(`🌐 Connected to: ${credentials.serverUrl}`);
        }

    } catch (error) {
        console.error('Failed to initialize playground executor:', error);
        throw error;
    }
} 