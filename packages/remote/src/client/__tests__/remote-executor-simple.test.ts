/**
 * SimpleRemoteExecutor Facade Tests
 * 
 * Testing the main facade pattern implementation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SimpleRemoteExecutor } from '../remote-executor-simple';
import type { SimpleRemoteConfig, SimpleExecutionRequest } from '../remote-executor-simple';
import type { BasicMessage } from '../../types/message-types';

// Mock the HttpClient
const mockHttpClient = {
    post: vi.fn(),
    get: vi.fn(),
    validateConfig: vi.fn().mockReturnValue(true)
};

vi.mock('../http-client', () => ({
    HttpClient: vi.fn().mockImplementation(() => mockHttpClient)
}));

describe('SimpleRemoteExecutor Facade', () => {
    let executor: SimpleRemoteExecutor;
    let mockConfig: SimpleRemoteConfig;

    beforeEach(() => {
        mockConfig = {
            serverUrl: 'https://api.test.com',
            userApiKey: 'test-api-key'
        };
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('Configuration', () => {
        it('should initialize with valid config', () => {
            expect(() => {
                executor = new SimpleRemoteExecutor(mockConfig);
            }).not.toThrow();

            expect(executor.name).toBe('simple-remote');
            expect(executor.version).toBe('1.0.0');
        });

        it('should throw on invalid config - missing serverUrl', () => {
            const invalidConfig = {
                userApiKey: 'test-key'
            } as SimpleRemoteConfig;

            expect(() => {
                new SimpleRemoteExecutor(invalidConfig);
            }).toThrow('Invalid configuration provided');
        });

        it('should throw on invalid config - empty serverUrl', () => {
            const invalidConfig: SimpleRemoteConfig = {
                serverUrl: '',
                userApiKey: 'test-key'
            };

            expect(() => {
                new SimpleRemoteExecutor(invalidConfig);
            }).toThrow('Invalid configuration provided');
        });

        it('should throw on invalid config - missing userApiKey', () => {
            const invalidConfig = {
                serverUrl: 'https://api.test.com'
            } as SimpleRemoteConfig;

            expect(() => {
                new SimpleRemoteExecutor(invalidConfig);
            }).toThrow('Invalid configuration provided');
        });

        it('should accept optional configuration parameters', () => {
            const configWithOptionals: SimpleRemoteConfig = {
                serverUrl: 'https://api.test.com',
                userApiKey: 'test-key',
                timeout: 60000,
                headers: { 'X-Custom': 'value' }
            };

            expect(() => {
                executor = new SimpleRemoteExecutor(configWithOptionals);
            }).not.toThrow();
        });
    });

    describe('validateConfig', () => {
        beforeEach(() => {
            executor = new SimpleRemoteExecutor(mockConfig);
        });

        it('should validate current config when no parameter provided', () => {
            expect(executor.validateConfig()).toBe(true);
        });

        it('should validate provided config parameter', () => {
            const validConfig: SimpleRemoteConfig = {
                serverUrl: 'https://other.api.com',
                userApiKey: 'other-key'
            };

            expect(executor.validateConfig(validConfig)).toBe(true);
        });

        it('should return false for invalid config', () => {
            const invalidConfig = {
                serverUrl: '',
                userApiKey: 'key'
            } as SimpleRemoteConfig;

            expect(executor.validateConfig(invalidConfig)).toBe(false);
        });
    });

    describe('Chat Execution', () => {
        let validRequest: SimpleExecutionRequest;

        beforeEach(() => {
            executor = new SimpleRemoteExecutor(mockConfig);

            validRequest = {
                messages: [
                    { role: 'user', content: 'Hello AI' }
                ],
                provider: 'openai',
                model: 'gpt-4'
            };
        });

        it('should execute chat requests successfully', async () => {
            const expectedResponse = {
                role: 'assistant',
                content: 'Hello back!',
                timestamp: new Date(),
                provider: 'openai',
                model: 'gpt-4'
            };

            mockHttpClient.chat.mockResolvedValue(expectedResponse);

            const result = await executor.executeChat(validRequest);

            expect(result).toEqual(expectedResponse);
            expect(mockHttpClient.chat).toHaveBeenCalled();
        });

        it('should validate request before execution', async () => {
            const invalidRequest = {
                messages: [],
                provider: 'openai',
                model: 'gpt-4'
            } as SimpleExecutionRequest;

            await expect(executor.executeChat(invalidRequest))
                .rejects.toThrow('Messages array is required and cannot be empty');
        });

        it('should validate provider field', async () => {
            const invalidRequest = {
                messages: [{ role: 'user', content: 'test' }],
                provider: '',
                model: 'gpt-4'
            } as SimpleExecutionRequest;

            await expect(executor.executeChat(invalidRequest))
                .rejects.toThrow('Provider is required');
        });

        it('should validate model field', async () => {
            const invalidRequest = {
                messages: [{ role: 'user', content: 'test' }],
                provider: 'openai',
                model: ''
            } as SimpleExecutionRequest;

            await expect(executor.executeChat(invalidRequest))
                .rejects.toThrow('Model is required');
        });

        it('should validate individual messages', async () => {
            const invalidRequest = {
                messages: [
                    { role: 'user', content: 'valid' },
                    { role: 123, content: 'invalid role' } as any
                ],
                provider: 'openai',
                model: 'gpt-4'
            } as SimpleExecutionRequest;

            await expect(executor.executeChat(invalidRequest))
                .rejects.toThrow('Invalid message at index 1: role and content must be strings');
        });

        it('should handle HTTP client errors', async () => {
            const httpError = new Error('Network error');
            mockHttpClient.chat.mockRejectedValue(httpError);

            await expect(executor.executeChat(validRequest))
                .rejects.toThrow('Network error');
        });
    });

    describe('Stream Execution', () => {
        let validRequest: SimpleExecutionRequest;

        beforeEach(() => {
            executor = new SimpleRemoteExecutor(mockConfig);

            validRequest = {
                messages: [{ role: 'user', content: 'Hello' }],
                provider: 'openai',
                model: 'gpt-4'
            };
        });

        it('should handle streaming responses', async () => {
            const expectedResponse = {
                role: 'assistant',
                content: 'Streaming response',
                timestamp: new Date()
            };

            mockHttpClient.chat.mockResolvedValue(expectedResponse);

            const stream = executor.executeChatStream(validRequest);
            const chunks = [];

            for await (const chunk of stream) {
                chunks.push(chunk);
            }

            expect(chunks).toHaveLength(1);
            expect(chunks[0]).toEqual(expectedResponse);
        });

        it('should validate request before streaming', async () => {
            const invalidRequest = {
                messages: [],
                provider: 'openai',
                model: 'gpt-4'
            } as SimpleExecutionRequest;

            const stream = executor.executeChatStream(invalidRequest);

            await expect(async () => {
                for await (const chunk of stream) {
                    // This should throw before yielding any chunks
                }
            }).rejects.toThrow('Messages array is required and cannot be empty');
        });
    });

    describe('Utility Methods', () => {
        beforeEach(() => {
            executor = new SimpleRemoteExecutor(mockConfig);
        });

        it('should support tools', () => {
            expect(executor.supportsTools()).toBe(true);
        });

        it('should dispose cleanly', async () => {
            await expect(executor.dispose()).resolves.toBeUndefined();
        });
    });

    describe('Integration Scenarios', () => {
        beforeEach(() => {
            // Mock is already set up globally
        });

        it('should handle complete conversation flow', async () => {
            executor = new SimpleRemoteExecutor(mockConfig);

            const messages: BasicMessage[] = [
                { role: 'user', content: 'What is TypeScript?' }
            ];

            const mockResponse = {
                role: 'assistant',
                content: 'TypeScript is a typed superset of JavaScript.',
                timestamp: new Date(),
                provider: 'openai',
                model: 'gpt-4'
            };

            mockHttpClient.chat.mockResolvedValue(mockResponse);

            const request: SimpleExecutionRequest = {
                messages,
                provider: 'openai',
                model: 'gpt-4'
            };

            const response = await executor.executeChat(request);

            expect(response.role).toBe('assistant');
            expect(response.content).toContain('TypeScript');
            expect(response.timestamp).toBeInstanceOf(Date);
        });

        it('should handle configuration changes', () => {
            executor = new SimpleRemoteExecutor(mockConfig);

            // Should work with initial config
            expect(executor.validateConfig()).toBe(true);

            // Should validate different config
            const newConfig: SimpleRemoteConfig = {
                serverUrl: 'https://api.example.com',
                userApiKey: 'new-key'
            };

            expect(executor.validateConfig(newConfig)).toBe(true);
        });

        it('should maintain facade simplicity', () => {
            executor = new SimpleRemoteExecutor(mockConfig);

            // Facade should expose minimal, clean interface
            const publicMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(executor))
                .filter(name => name !== 'constructor' && !name.startsWith('_'));

            expect(publicMethods).toEqual([
                'executeChat',
                'executeChatStream',
                'supportsTools',
                'validateConfig',
                'dispose'
            ]);
        });
    });
}); 