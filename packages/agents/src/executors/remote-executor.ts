import type {
    ExecutorInterface,
    ChatExecutionRequest,
    StreamExecutionRequest,
    RemoteExecutorConfig
} from '../interfaces/executor';
import type { UniversalMessage, AssistantMessage } from '../managers/conversation-history-manager';

/**
 * Remote executor that makes HTTP/WebSocket calls to a remote server
 * 
 * This executor sends chat execution requests to a remote server API,
 * enabling secure server-side execution without exposing API keys
 * to the client. Perfect for playground environments and secure deployments.
 * 
 * @example
 * ```typescript
 * import { RemoteExecutor } from '@robota-sdk/agents';
 * 
 * const executor = new RemoteExecutor({
 *   serverUrl: 'https://api.robota.io',
 *   userApiKey: 'user-token-123'
 * });
 * 
 * const response = await executor.executeChat({
 *   messages: [{ role: 'user', content: 'Hello!' }],
 *   provider: 'openai',
 *   model: 'gpt-4'
 * });
 * ```
 */
export class RemoteExecutor implements ExecutorInterface {
    readonly name = 'remote';
    readonly version = '1.0.0';

    private config: Required<RemoteExecutorConfig>;
    private abortController?: AbortController;

    constructor(config: RemoteExecutorConfig) {
        this.config = {
            timeout: 30000,
            maxRetries: 3,
            enableWebSocket: false,
            headers: {},
            ...config
        };

        // Validate configuration
        if (!this.validateConfig()) {
            throw new Error('Invalid RemoteExecutor configuration');
        }
    }

    /**
     * Execute a chat completion request via remote server
     */
    async executeChat(request: ChatExecutionRequest): Promise<AssistantMessage> {
        try {
            const response = await this.makeHttpRequest('/api/v1/chat', {
                method: 'POST',
                body: JSON.stringify({
                    ...request,
                    stream: false
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${await response.text()}`);
            }

            const data = await response.json();

            // Handle OpenAI-style response format
            if (data.choices && Array.isArray(data.choices) && data.choices[0]?.message) {
                const message = data.choices[0].message;
                return {
                    role: message.role as 'assistant',
                    content: message.content,
                    timestamp: new Date(),
                    ...(message.tool_calls && { toolCalls: message.tool_calls })
                };
            }

            // Handle direct response format
            if (data.role && data.content) {
                return {
                    role: data.role as 'assistant',
                    content: data.content,
                    timestamp: new Date(),
                    ...(data.toolCalls && { toolCalls: data.toolCalls })
                };
            }

            throw new Error('Invalid response format from remote server');

        } catch (error) {
            if (error instanceof Error) {
                throw new Error(`RemoteExecutor chat failed: ${error.message}`);
            }
            throw new Error('RemoteExecutor chat failed with unknown error');
        }
    }

    /**
     * Execute a streaming chat completion request via remote server
     */
    async *executeChatStream(request: StreamExecutionRequest): AsyncIterable<UniversalMessage> {
        if (!this.config.enableWebSocket) {
            // Use Server-Sent Events for streaming
            yield* this.executeStreamViaSSE(request);
        } else {
            // Use WebSocket for streaming
            yield* this.executeStreamViaWebSocket(request);
        }
    }

    /**
     * Stream via Server-Sent Events (HTTP)
     */
    private async *executeStreamViaSSE(request: StreamExecutionRequest): AsyncIterable<UniversalMessage> {
        try {
            const response = await this.makeHttpRequest('/api/v1/chat', {
                method: 'POST',
                body: JSON.stringify({
                    ...request,
                    stream: true
                }),
                headers: {
                    'Accept': 'text/event-stream',
                    'Cache-Control': 'no-cache'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${await response.text()}`);
            }

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('Response body is not readable');
            }

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
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6).trim();

                            if (data === '[DONE]') {
                                return;
                            }

                            try {
                                const parsed = JSON.parse(data);

                                // Handle error responses
                                if (parsed.error) {
                                    throw new Error(parsed.error.message || 'Stream error');
                                }

                                // Handle chunk responses
                                if (parsed.choices && parsed.choices[0]?.delta) {
                                    const delta = parsed.choices[0].delta;
                                    if (delta.content) {
                                        yield {
                                            role: 'assistant',
                                            content: delta.content,
                                            timestamp: new Date()
                                        };
                                    }
                                }
                            } catch (parseError) {
                                console.warn('Failed to parse SSE data:', data);
                            }
                        }
                    }
                }
            } finally {
                reader.releaseLock();
            }

        } catch (error) {
            if (error instanceof Error) {
                throw new Error(`RemoteExecutor stream failed: ${error.message}`);
            }
            throw new Error('RemoteExecutor stream failed with unknown error');
        }
    }

    /**
     * Stream via WebSocket
     */
    private async *executeStreamViaWebSocket(request: StreamExecutionRequest): AsyncIterable<UniversalMessage> {
        const wsUrl = this.config.serverUrl.replace(/^https?/, 'wss').replace(/^http/, 'ws') + '/ws/chat';

        const chunks = await new Promise<UniversalMessage[]>((resolve, reject) => {
            const ws = new WebSocket(wsUrl);
            const messageChunks: UniversalMessage[] = [];
            let isResolved = false;

            ws.onopen = () => {
                // Send authentication and request
                ws.send(JSON.stringify({
                    type: 'auth',
                    token: this.config.userApiKey
                }));

                ws.send(JSON.stringify({
                    type: 'chat_stream',
                    ...request
                }));
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    if (data.type === 'chunk' && data.content) {
                        messageChunks.push({
                            role: 'assistant',
                            content: data.content,
                            timestamp: new Date()
                        });
                    } else if (data.type === 'done') {
                        if (!isResolved) {
                            isResolved = true;
                            resolve(messageChunks);
                        }
                        ws.close();
                    } else if (data.type === 'error') {
                        reject(new Error(data.message || 'WebSocket stream error'));
                    }
                } catch (parseError) {
                    console.warn('Failed to parse WebSocket message:', event.data);
                }
            };

            ws.onerror = () => {
                reject(new Error('WebSocket connection error'));
            };

            ws.onclose = () => {
                if (!isResolved) {
                    resolve(messageChunks);
                }
            };

            // Set timeout
            setTimeout(() => {
                if (!isResolved) {
                    ws.close();
                    reject(new Error('WebSocket stream timeout'));
                }
            }, this.config.timeout);
        });

        // Yield chunks one by one
        for (const chunk of chunks) {
            yield chunk;
        }
    }

    /**
     * Check if the executor supports tool calling
     */
    supportsTools(): boolean {
        return true; // Remote server should handle tool support
    }

    /**
     * Validate executor configuration
     */
    validateConfig(): boolean {
        if (!this.config.serverUrl) {
            console.error('RemoteExecutor: serverUrl is required');
            return false;
        }

        if (!this.config.userApiKey) {
            console.error('RemoteExecutor: userApiKey is required');
            return false;
        }

        try {
            new URL(this.config.serverUrl);
        } catch {
            console.error('RemoteExecutor: invalid serverUrl format');
            return false;
        }

        if (this.config.timeout <= 0) {
            console.error('RemoteExecutor: timeout must be positive');
            return false;
        }

        if (this.config.maxRetries < 0) {
            console.error('RemoteExecutor: maxRetries must be non-negative');
            return false;
        }

        return true;
    }

    /**
     * Clean up resources when executor is no longer needed
     */
    async dispose(): Promise<void> {
        if (this.abortController) {
            this.abortController.abort();
            delete this.abortController;
        }
    }

    /**
     * Make HTTP request with retry logic and authentication
     */
    private async makeHttpRequest(endpoint: string, options: RequestInit): Promise<Response> {
        const url = `${this.config.serverUrl}${endpoint}`;
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
            try {
                this.abortController = new AbortController();

                const response = await fetch(url, {
                    ...options,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.config.userApiKey}`,
                        ...this.config.headers,
                        ...options.headers
                    },
                    signal: AbortSignal.timeout(this.config.timeout)
                });

                return response;

            } catch (error) {
                lastError = error instanceof Error ? error : new Error('Unknown error');

                if (attempt < this.config.maxRetries) {
                    // Exponential backoff
                    const delay = Math.pow(2, attempt) * 1000;
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw lastError || new Error('HTTP request failed after retries');
    }
} 