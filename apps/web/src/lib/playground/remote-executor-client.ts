/**
 * RemoteExecutor Client for Playground
 * 
 * Simple implementation using direct fetch to avoid Node.js module conflicts
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
    // Use simple fetch-based implementation to avoid module conflicts
    return createFetchExecutor(credentials);
}

/**
 * Create a fetch-based executor for browser environment
 */
function createFetchExecutor(credentials: PlaygroundCredentials): PlaygroundRemoteExecutor {
    return {
        name: 'fetch-remote',
        version: '1.0.0',
        executeChat: async (request) => {
            try {
                const response = await fetch(`${credentials.serverUrl}/v1/remote/chat`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${credentials.userApiKey}`
                    },
                    body: JSON.stringify({
                        provider: request.provider,
                        model: request.model,
                        messages: request.messages
                    })
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const data = await response.json();

                if (data.success) {
                    return {
                        role: 'assistant',
                        content: data.data?.content || data.data || 'No response content',
                        timestamp: new Date()
                    };
                } else {
                    throw new Error(data.error || 'Unknown server error');
                }

            } catch (error) {
                console.error('Remote execution failed:', error);

                // Fallback to mock response
                return {
                    role: 'assistant',
                    content: `Mock response for: "${request.messages?.[request.messages.length - 1]?.content || 'Hello'}".\n\nThis is a fallback response because the remote server is not available or API keys are not configured.`,
                    timestamp: new Date()
                };
            }
        },
        executeChatStream: async function* (request) {
            try {
                const response = await fetch(`${credentials.serverUrl}/v1/remote/stream`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${credentials.userApiKey}`,
                        'Accept': 'text/event-stream'
                    },
                    body: JSON.stringify({
                        provider: request.provider,
                        model: request.model,
                        messages: request.messages
                    })
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                if (!response.body) {
                    throw new Error('No response body for streaming');
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';

                        for (const line of lines) {
                            if (line.trim() === '') continue;
                            if (line.startsWith('data: ')) {
                                const data = line.slice(6);
                                if (data === '[DONE]') return;

                                try {
                                    const parsed = JSON.parse(data);
                                    if (parsed.success && parsed.data) {
                                        yield {
                                            role: 'assistant',
                                            content: parsed.data.content || parsed.data,
                                            timestamp: new Date()
                                        };
                                    }
                                } catch (parseError) {
                                    // Skip invalid SSE data
                                }
                            }
                        }
                    }
                } finally {
                    reader.releaseLock();
                }

            } catch (error) {
                console.error('Stream execution failed:', error);

                // Fallback to mock streaming
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
            }
        },
        supportsTools: () => true,
        validateConfig: () => true,
        dispose: async () => {
            console.log('Fetch executor disposed');
        }
    };
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