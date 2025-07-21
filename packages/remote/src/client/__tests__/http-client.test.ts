/**
 * HttpClient Tests
 * 
 * Testing the HTTP client implementation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpClient, type HttpClientConfig } from '../http-client';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('HttpClient', () => {
    let httpClient: HttpClient;
    let config: HttpClientConfig;

    beforeEach(() => {
        config = {
            baseUrl: 'https://api.test.com',
            timeout: 30000,
            headers: { 'Authorization': 'Bearer test-api-key' }
        };
        httpClient = new HttpClient(config);
        mockFetch.mockClear();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('Configuration', () => {
        it('should initialize with valid config', () => {
            expect(httpClient).toBeInstanceOf(HttpClient);
        });

        it('should validate correct configuration', () => {
            expect(httpClient.validateConfig()).toBe(true);
        });

        it('should fail validation with empty baseUrl', () => {
            const invalidConfig: HttpClientConfig = {
                baseUrl: '',
                timeout: 30000,
                headers: {}
            };
            const invalidClient = new HttpClient(invalidConfig);
            expect(invalidClient.validateConfig()).toBe(false);
        });

        it('should fail validation with invalid timeout', () => {
            const invalidConfig: HttpClientConfig = {
                baseUrl: 'https://api.test.com',
                timeout: 0,
                headers: {}
            };
            const invalidClient = new HttpClient(invalidConfig);
            expect(invalidClient.validateConfig()).toBe(false);
        });

        it('should fail validation with invalid headers', () => {
            const invalidConfig = {
                baseUrl: 'https://api.test.com',
                timeout: 30000,
                headers: null as any
            };
            const invalidClient = new HttpClient(invalidConfig);
            expect(invalidClient.validateConfig()).toBe(false);
        });
    });

    describe('POST requests', () => {
        it('should make POST requests with data', async () => {
            const testData = { message: 'test' };
            const mockResponse = {
                ok: true,
                status: 200,
                json: vi.fn().mockResolvedValue({ result: 'success' }),
                headers: new Map()
            };

            mockFetch.mockResolvedValue(mockResponse);

            const result = await httpClient.post('/test', testData);

            expect(mockFetch).toHaveBeenCalledWith(
                'https://api.test.com/test',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'Authorization': 'Bearer test-api-key'
                    }),
                    body: JSON.stringify(testData)
                })
            );

            expect(result.status).toBe(200);
            expect(result.data).toEqual({ result: 'success' });
        });

        it('should handle POST request errors', async () => {
            const mockResponse = {
                ok: false,
                status: 400,
                statusText: 'Bad Request'
            };

            mockFetch.mockResolvedValue(mockResponse);

            await expect(httpClient.post('/test', { data: 'test' }))
                .rejects.toThrow('HTTP 400: Bad Request');
        });

        it('should handle network errors', async () => {
            const networkError = new Error('Network error');
            mockFetch.mockRejectedValue(networkError);

            await expect(httpClient.post('/test', { data: 'test' }))
                .rejects.toThrow('Request failed: Network error');
        });
    });

    describe('GET requests', () => {
        it('should make GET requests', async () => {
            const mockResponse = {
                ok: true,
                status: 200,
                json: vi.fn().mockResolvedValue({ data: 'test' }),
                headers: new Map()
            };

            mockFetch.mockResolvedValue(mockResponse);

            const result = await httpClient.get('/data');

            expect(mockFetch).toHaveBeenCalledWith(
                'https://api.test.com/data',
                expect.objectContaining({
                    method: 'GET',
                    headers: expect.objectContaining({
                        'Authorization': 'Bearer test-api-key'
                    })
                })
            );

            expect(result.status).toBe(200);
            expect(result.data).toEqual({ data: 'test' });
        });

        it('should handle GET request errors', async () => {
            const mockResponse = {
                ok: false,
                status: 404,
                statusText: 'Not Found'
            };

            mockFetch.mockResolvedValue(mockResponse);

            await expect(httpClient.get('/nonexistent'))
                .rejects.toThrow('HTTP 404: Not Found');
        });
    });

    describe('URL construction', () => {
        it('should handle baseUrl with trailing slash', () => {
            const configWithSlash: HttpClientConfig = {
                baseUrl: 'https://api.test.com/',
                timeout: 30000,
                headers: {}
            };
            const clientWithSlash = new HttpClient(configWithSlash);

            const mockResponse = {
                ok: true,
                status: 200,
                json: vi.fn().mockResolvedValue({}),
                headers: new Map()
            };

            mockFetch.mockResolvedValue(mockResponse);

            clientWithSlash.get('/data');

            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/data'),
                expect.any(Object)
            );
        });

        it('should handle paths correctly', () => {
            const mockResponse = {
                ok: true,
                status: 200,
                json: vi.fn().mockResolvedValue({}),
                headers: new Map()
            };

            mockFetch.mockResolvedValue(mockResponse);

            httpClient.get('/api/test');

            expect(mockFetch).toHaveBeenCalledWith(
                'https://api.test.com/api/test',
                expect.any(Object)
            );
        });
    });

    describe('Error handling', () => {
        it('should provide detailed error messages for HTTP errors', async () => {
            const mockResponse = {
                ok: false,
                status: 422,
                statusText: 'Unprocessable Entity'
            };

            mockFetch.mockResolvedValue(mockResponse);

            await expect(httpClient.post('/test', { data: 'test' }))
                .rejects.toThrow('HTTP 422: Unprocessable Entity');
        });

        it('should handle JSON parsing errors gracefully', async () => {
            const mockResponse = {
                ok: true,
                status: 200,
                json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
                headers: new Map()
            };

            mockFetch.mockResolvedValue(mockResponse);

            await expect(httpClient.get('/test'))
                .rejects.toThrow('Request failed: Invalid JSON');
        });

        it('should handle fetch failures', async () => {
            const fetchError = new Error('Failed to fetch');
            mockFetch.mockRejectedValue(fetchError);

            await expect(httpClient.get('/test'))
                .rejects.toThrow('Request failed: Failed to fetch');
        });
    });

    describe('Headers handling', () => {
        it('should include custom headers in requests', async () => {
            const mockResponse = {
                ok: true,
                status: 200,
                json: vi.fn().mockResolvedValue({}),
                headers: new Map([['x-custom', 'value']])
            };

            mockFetch.mockResolvedValue(mockResponse);

            await httpClient.get('/test');

            expect(mockFetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'Authorization': 'Bearer test-api-key'
                    })
                })
            );
        });

        it('should handle response headers correctly', async () => {
            const mockResponse = {
                ok: true,
                status: 200,
                json: vi.fn().mockResolvedValue({ data: 'test' }),
                headers: new Map([
                    ['content-type', 'application/json'],
                    ['x-request-id', '123456']
                ])
            };

            mockFetch.mockResolvedValue(mockResponse);

            const result = await httpClient.get('/test');

            expect(result.headers).toEqual({
                'content-type': 'application/json',
                'x-request-id': '123456'
            });
        });
    });

    describe('Type Safety', () => {
        it('should maintain type safety for request data', async () => {
            const typedData = {
                name: 'test',
                count: 42,
                active: true
            };

            const mockResponse = {
                ok: true,
                status: 200,
                json: vi.fn().mockResolvedValue({ success: true }),
                headers: new Map()
            };

            mockFetch.mockResolvedValue(mockResponse);

            const result = await httpClient.post('/typed', typedData);

            expect(result.data).toEqual({ success: true });
            expect(mockFetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    body: JSON.stringify(typedData)
                })
            );
        });

        it('should handle undefined request data', async () => {
            const mockResponse = {
                ok: true,
                status: 200,
                json: vi.fn().mockResolvedValue({ result: 'ok' }),
                headers: new Map()
            };

            mockFetch.mockResolvedValue(mockResponse);

            await httpClient.get('/no-body');

            expect(mockFetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    body: undefined
                })
            );
        });
    });
}); 