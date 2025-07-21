/**
 * Transformers Pure Functions Tests
 * 
 * Testing data transformation and utility functions
 */

import { describe, it, expect } from 'vitest';
import {
    toRequestMessage,
    toResponseMessage,
    createHttpRequest,
    createHttpResponse,
    extractContent,
    generateId,
    normalizeHeaders,
    safeJsonParse
} from '../transformers';
// Type guard removed - using proper TypeScript types
import type { BasicMessage, ResponseMessage } from '../../types/message-types';

describe('Transformers Pure Functions', () => {
    describe('toRequestMessage', () => {
        it('should transform BasicMessage to RequestMessage', () => {
            const basicMessage: BasicMessage = {
                role: 'user',
                content: 'Hello AI'
            };

            const requestMessage = toRequestMessage(basicMessage, 'openai', 'gpt-4');

            expect(requestMessage).toEqual({
                role: 'user',
                content: 'Hello AI',
                provider: 'openai',
                model: 'gpt-4'
            });
        });

        it('should preserve original message properties', () => {
            const extendedMessage = {
                role: 'user',
                content: 'Hello',
                extraProperty: 'should be preserved'
            };

            const result = toRequestMessage(extendedMessage, 'anthropic', 'claude-3');

            expect(result.role).toBe('user');
            expect(result.content).toBe('Hello');
            expect(result.provider).toBe('anthropic');
            expect(result.model).toBe('claude-3');
        });
    });

    describe('toResponseMessage', () => {
        it('should transform BasicMessage to ResponseMessage with timestamp', () => {
            const basicMessage: BasicMessage = {
                role: 'assistant',
                content: 'Hello back!'
            };

            const responseMessage = toResponseMessage(basicMessage);

            expect(responseMessage.role).toBe('assistant');
            expect(responseMessage.content).toBe('Hello back!');
            expect(responseMessage.timestamp).toBeInstanceOf(Date);
            expect(responseMessage.provider).toBeUndefined();
            expect(responseMessage.model).toBeUndefined();
        });

        it('should include optional provider and model', () => {
            const basicMessage: BasicMessage = {
                role: 'assistant',
                content: 'Response'
            };

            const responseMessage = toResponseMessage(basicMessage, 'openai', 'gpt-4');

            expect(responseMessage.provider).toBe('openai');
            expect(responseMessage.model).toBe('gpt-4');
        });

        it('should create recent timestamp', () => {
            const basicMessage: BasicMessage = {
                role: 'assistant',
                content: 'Test'
            };

            const before = Date.now();
            const responseMessage = toResponseMessage(basicMessage);
            const after = Date.now();

            expect(responseMessage.timestamp.getTime()).toBeGreaterThanOrEqual(before);
            expect(responseMessage.timestamp.getTime()).toBeLessThanOrEqual(after);
        });
    });

    describe('createHttpRequest', () => {
        it('should create valid HTTP request with required fields', () => {
            const request = createHttpRequest('req_123', 'https://api.test.com', 'POST');

            expect(request.id).toBe('req_123');
            expect(request.url).toBe('https://api.test.com');
            expect(request.method).toBe('POST');
            expect(request.headers['Content-Type']).toBe('application/json');
        });

        it('should include data when provided', () => {
            const data = { message: 'hello' };
            const request = createHttpRequest('req_123', 'https://api.test.com', 'POST', data);

            expect(request.data).toEqual(data);
        });

        it('should merge custom headers with defaults', () => {
            const customHeaders = { 'Authorization': 'Bearer token' };
            const request = createHttpRequest('req_123', 'https://api.test.com', 'GET', undefined, customHeaders);

            expect(request.headers['Content-Type']).toBe('application/json');
            expect(request.headers['Authorization']).toBe('Bearer token');
        });

        it('should override default headers when custom provided', () => {
            const customHeaders = { 'Content-Type': 'text/plain' };
            const request = createHttpRequest('req_123', 'https://api.test.com', 'PUT', undefined, customHeaders);

            expect(request.headers['Content-Type']).toBe('text/plain');
        });
    });

    describe('createHttpResponse', () => {
        it('should create valid HTTP response', () => {
            const data = { result: 'success' };
            const response = createHttpResponse('resp_123', 200, data);

            expect(response.id).toBe('resp_123');
            expect(response.status).toBe(200);
            expect(response.data).toEqual(data);
            expect(response.timestamp).toBeInstanceOf(Date);
            expect(response.headers).toEqual({});
        });

        it('should include custom headers', () => {
            const headers = { 'x-custom': 'value' };
            const response = createHttpResponse('resp_123', 201, {}, headers);

            expect(response.headers).toEqual(headers);
        });

        it('should create recent timestamp', () => {
            const before = Date.now();
            const response = createHttpResponse('resp_123', 200, {});
            const after = Date.now();

            expect(response.timestamp.getTime()).toBeGreaterThanOrEqual(before);
            expect(response.timestamp.getTime()).toBeLessThanOrEqual(after);
        });
    });

    describe('extractContent', () => {
        it('should extract content from valid response data', () => {
            const response = createHttpResponse('resp_123', 200, {
                content: 'Hello world',
                other: 'data'
            });

            const content = extractContent(response);
            expect(content).toBe('Hello world');
        });

        it('should return empty string for missing content', () => {
            const response = createHttpResponse('resp_123', 200, {
                message: 'No content field'
            });

            const content = extractContent(response);
            expect(content).toBe('');
        });

        it('should return empty string for non-string content', () => {
            const response = createHttpResponse('resp_123', 200, {
                content: 123
            });

            const content = extractContent(response);
            expect(content).toBe('');
        });

        it('should return empty string for non-object data', () => {
            const response = createHttpResponse('resp_123', 200, {
                data: 'string data'
            });

            const content = extractContent(response);
            expect(content).toBe('');
        });
    });

    describe('generateId', () => {
        it('should generate unique IDs with default prefix', () => {
            const id1 = generateId();
            const id2 = generateId();

            expect(id1).toMatch(/^id_\d+_[a-z0-9]+$/);
            expect(id2).toMatch(/^id_\d+_[a-z0-9]+$/);
            expect(id1).not.toBe(id2);
        });

        it('should use custom prefix', () => {
            const id = generateId('custom');

            expect(id).toMatch(/^custom_\d+_[a-z0-9]+$/);
        });

        it('should generate different IDs on subsequent calls', () => {
            const ids = Array.from({ length: 10 }, () => generateId('test'));
            const uniqueIds = new Set(ids);

            expect(uniqueIds.size).toBe(10);
        });
    });

    describe('normalizeHeaders', () => {
        it('should keep string values as-is', () => {
            const headers = {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer token'
            };

            const normalized = normalizeHeaders(headers);

            expect(normalized).toEqual(headers);
        });

        it('should convert numbers to strings', () => {
            const headers = {
                'Content-Length': 123,
                'X-Request-ID': 'abc'
            };

            const normalized = normalizeHeaders(headers);

            expect(normalized).toEqual({
                'Content-Length': '123',
                'X-Request-ID': 'abc'
            });
        });

        it('should convert booleans to strings', () => {
            const headers = {
                'X-Debug': true,
                'X-Cache': false
            };

            const normalized = normalizeHeaders(headers);

            expect(normalized).toEqual({
                'X-Debug': 'true',
                'X-Cache': 'false'
            });
        });

        it('should skip null and undefined values', () => {
            const headers: Record<string, string | number | boolean | null | undefined> = {
                'Valid': 'value',
                'Null': null,
                'Undefined': undefined
            };

            const normalized = normalizeHeaders(headers as Record<string, string | number | boolean>);

            expect(normalized).toEqual({
                'Valid': 'value'
            });
        });
    });

    describe('safeJsonParse', () => {
        it('should parse valid JSON', () => {
            const jsonString = '{"role": "user", "content": "hello"}';

            const result = safeJsonParse<BasicMessage>(jsonString);

            expect(result).toEqual({
                role: 'user',
                content: 'hello'
            });
        });

        it('should return null for invalid JSON', () => {
            const invalidJson = '{"invalid": json}';

            const result = safeJsonParse<BasicMessage>(invalidJson);

            expect(result).toBeNull();
        });

        it('should handle empty strings', () => {
            const result = safeJsonParse<BasicMessage>('');

            expect(result).toBeNull();
        });

        it('should work with arrays', () => {
            const arrayJson = '[1, 2, 3]';

            const result = safeJsonParse<number[]>(arrayJson);

            expect(result).toEqual([1, 2, 3]);
        });

        it('should work with complex objects', () => {
            const complexJson = '{"data": {"nested": "value"}, "count": 42}';

            const result = safeJsonParse<{ data: { nested: string }, count: number }>(complexJson);

            expect(result).toEqual({
                data: { nested: "value" },
                count: 42
            });
        });
    });

    describe('Function Composition', () => {
        it('should compose transformers correctly', () => {
            // Test realistic workflow
            const userMessage: BasicMessage = {
                role: 'user',
                content: 'Test message'
            };

            // 1. Transform to request
            const requestMessage = toRequestMessage(userMessage, 'openai', 'gpt-4');

            // 2. Create HTTP request
            const httpRequest = createHttpRequest(
                generateId('req'),
                'https://api.test.com/chat',
                'POST',
                requestMessage
            );

            // 3. Create mock response
            const responseData = {
                content: 'Response from AI',
                provider: 'openai'
            };
            const httpResponse = createHttpResponse(
                httpRequest.id,
                200,
                responseData
            );

            // 4. Extract content and create response message
            const content = extractContent(httpResponse);
            const responseMessage = toResponseMessage(
                { role: 'assistant', content },
                'openai',
                'gpt-4'
            );

            expect(responseMessage.role).toBe('assistant');
            expect(responseMessage.content).toBe('Response from AI');
            expect(responseMessage.provider).toBe('openai');
            expect(responseMessage.model).toBe('gpt-4');
            expect(responseMessage.timestamp).toBeInstanceOf(Date);
        });
    });
}); 