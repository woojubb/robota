import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GoogleProvider } from './provider';
import type { TUniversalMessage, IExecutor } from '@robota-sdk/agents';

// Shared mock for generateContent and generateContentStream
const generateContentMock = vi.fn();
const generateContentStreamMock = vi.fn();

vi.mock('@google/generative-ai', () => {
    class GoogleGenerativeAI {
        public constructor(_apiKey: string) {}

        public getGenerativeModel(_options: { model: string }): {
            generateContent: typeof generateContentMock;
            generateContentStream: typeof generateContentStreamMock;
        } {
            return {
                generateContent: generateContentMock,
                generateContentStream: generateContentStreamMock
            };
        }
    }
    return { GoogleGenerativeAI };
});

function makeTextResponse(text: string) {
    return {
        response: {
            candidates: [
                { content: { parts: [{ text }] } }
            ]
        }
    };
}

function makeImageResponse(text: string, mimeType: string, data: string) {
    return {
        response: {
            candidates: [
                {
                    content: {
                        parts: [
                            { text },
                            { inlineData: { mimeType, data } }
                        ]
                    }
                }
            ]
        }
    };
}

describe('GoogleProvider - chat error paths', () => {
    beforeEach(() => {
        generateContentMock.mockReset();
        generateContentStreamMock.mockReset();
    });

    it('throws when model is not specified', async () => {
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        await expect(
            provider.chat(
                [{ role: 'user', content: 'hello', timestamp: new Date() }],
                {} // no model
            )
        ).rejects.toThrow('Google chat failed: Model is required');
    });

    it('throws when options are undefined (no model)', async () => {
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        await expect(
            provider.chat([{ role: 'user', content: 'hello', timestamp: new Date() }])
        ).rejects.toThrow('Google chat failed:');
    });

    it('wraps API errors in "Google chat failed" message', async () => {
        generateContentMock.mockRejectedValue(new Error('API quota exceeded'));
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        await expect(
            provider.chat(
                [{ role: 'user', content: 'hello', timestamp: new Date() }],
                { model: 'gemini-pro' }
            )
        ).rejects.toThrow('Google chat failed: API quota exceeded');
    });

    it('wraps non-Error API failures', async () => {
        generateContentMock.mockRejectedValue('string error');
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        await expect(
            provider.chat(
                [{ role: 'user', content: 'hello', timestamp: new Date() }],
                { model: 'gemini-pro' }
            )
        ).rejects.toThrow('Google chat failed: Google API request failed');
    });

    it('passes tools as function declarations', async () => {
        generateContentMock.mockResolvedValue(makeTextResponse('done'));
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        await provider.chat(
            [{ role: 'user', content: 'hello', timestamp: new Date() }],
            {
                model: 'gemini-pro',
                tools: [
                    {
                        name: 'search',
                        description: 'Search the web',
                        parameters: { type: 'object', properties: { q: { type: 'string' } } }
                    }
                ]
            }
        );
        const payload = generateContentMock.mock.calls[0]?.[0];
        expect(payload.tools).toBeDefined();
        expect(payload.tools[0].functionDeclarations).toHaveLength(1);
        expect(payload.tools[0].functionDeclarations[0].name).toBe('search');
    });

    it('throws on IMAGE modality when response lacks image part', async () => {
        generateContentMock.mockResolvedValue(makeTextResponse('no image here'));
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        await expect(
            provider.chat(
                [{ role: 'user', content: 'create image', timestamp: new Date() }],
                {
                    model: 'gemini-2.5-flash-image',
                    google: { responseModalities: ['TEXT', 'IMAGE'] }
                }
            )
        ).rejects.toThrow('Gemini response did not include an image part');
    });
});

describe('GoogleProvider - chatStream', () => {
    beforeEach(() => {
        generateContentMock.mockReset();
        generateContentStreamMock.mockReset();
    });

    it('yields streaming text chunks', async () => {
        generateContentStreamMock.mockResolvedValue({
            stream: (async function* () {
                yield { text: () => 'Hello' };
                yield { text: () => ' world' };
            })()
        });

        const provider = new GoogleProvider({ apiKey: 'test-key' });
        const chunks: TUniversalMessage[] = [];
        for await (const chunk of provider.chatStream(
            [{ role: 'user', content: 'hello', timestamp: new Date() }],
            { model: 'gemini-pro' }
        )) {
            chunks.push(chunk);
        }
        expect(chunks).toHaveLength(2);
        expect(chunks[0]?.content).toBe('Hello');
        expect(chunks[1]?.content).toBe(' world');
        expect(chunks[0]?.role).toBe('assistant');
    });

    it('skips empty text chunks', async () => {
        generateContentStreamMock.mockResolvedValue({
            stream: (async function* () {
                yield { text: () => '' };
                yield { text: () => 'data' };
            })()
        });

        const provider = new GoogleProvider({ apiKey: 'test-key' });
        const chunks: TUniversalMessage[] = [];
        for await (const chunk of provider.chatStream(
            [{ role: 'user', content: 'hello', timestamp: new Date() }],
            { model: 'gemini-pro' }
        )) {
            chunks.push(chunk);
        }
        expect(chunks).toHaveLength(1);
        expect(chunks[0]?.content).toBe('data');
    });

    it('throws when IMAGE modality is requested in stream mode', async () => {
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        const iter = provider.chatStream(
            [{ role: 'user', content: 'hello', timestamp: new Date() }],
            {
                model: 'gemini-2.5-flash-image',
                google: { responseModalities: ['IMAGE'] }
            }
        );
        await expect(async () => {
            for await (const _chunk of iter) {
                // consume
            }
        }).rejects.toThrow('Google stream failed:');
    });

    it('throws when model is not specified', async () => {
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        const iter = provider.chatStream(
            [{ role: 'user', content: 'hello', timestamp: new Date() }],
            {} // no model
        );
        await expect(async () => {
            for await (const _chunk of iter) {
                // consume
            }
        }).rejects.toThrow('Google stream failed:');
    });

    it('wraps stream errors', async () => {
        generateContentStreamMock.mockRejectedValue(new Error('network timeout'));
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        const iter = provider.chatStream(
            [{ role: 'user', content: 'hello', timestamp: new Date() }],
            { model: 'gemini-pro' }
        );
        await expect(async () => {
            for await (const _chunk of iter) {
                // consume
            }
        }).rejects.toThrow('Google stream failed: network timeout');
    });

    it('passes tools in streaming request', async () => {
        generateContentStreamMock.mockResolvedValue({
            stream: (async function* () {
                yield { text: () => 'ok' };
            })()
        });
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        const chunks: TUniversalMessage[] = [];
        for await (const chunk of provider.chatStream(
            [{ role: 'user', content: 'hello', timestamp: new Date() }],
            {
                model: 'gemini-pro',
                tools: [{
                    name: 'fn',
                    description: 'A function',
                    parameters: { type: 'object', properties: {} }
                }]
            }
        )) {
            chunks.push(chunk);
        }
        expect(chunks).toHaveLength(1);
        const payload = generateContentStreamMock.mock.calls[0]?.[0];
        expect(payload.tools).toBeDefined();
    });
});

describe('GoogleProvider - validateConfig and dispose', () => {
    it('returns true when client and apiKey exist', () => {
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        expect(provider.validateConfig()).toBe(true);
    });

    it('returns false when apiKey is empty string', () => {
        const provider = new GoogleProvider({ apiKey: '' });
        expect(provider.validateConfig()).toBe(false);
    });

    it('supportsTools returns true', () => {
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        expect(provider.supportsTools()).toBe(true);
    });

    it('dispose resolves without error', async () => {
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        await expect(provider.dispose()).resolves.toBeUndefined();
    });
});

describe('GoogleProvider - constructor with executor', () => {
    it('uses executor instead of direct client', async () => {
        const mockExecutor: IExecutor = {
            executeChat: vi.fn().mockResolvedValue({
                role: 'assistant',
                content: 'executor response',
                timestamp: new Date()
            }),
            supportsTools: () => false,
            validateConfig: () => true,
            name: 'mock-executor',
            version: '1.0.0',
        };
        const provider = new GoogleProvider({
            apiKey: 'placeholder',
            executor: mockExecutor
        });
        const result = await provider.chat(
            [{ role: 'user', content: 'hello', timestamp: new Date() }],
            { model: 'gemini-pro' }
        );
        expect(result.content).toBe('executor response');
        expect(mockExecutor.executeChat).toHaveBeenCalledTimes(1);
    });

    it('propagates executor chat errors', async () => {
        const mockExecutor: IExecutor = {
            executeChat: vi.fn().mockRejectedValue(new Error('executor failed')),
            supportsTools: () => false,
            validateConfig: () => true,
            name: 'mock-executor',
            version: '1.0.0',
        };
        const provider = new GoogleProvider({
            apiKey: 'placeholder',
            executor: mockExecutor
        });
        await expect(
            provider.chat(
                [{ role: 'user', content: 'hello', timestamp: new Date() }],
                { model: 'gemini-pro' }
            )
        ).rejects.toThrow('executor failed');
    });
});

describe('GoogleProvider - generateImage', () => {
    beforeEach(() => {
        generateContentMock.mockReset();
    });

    it('returns error for empty prompt', async () => {
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        const result = await provider.generateImage({ prompt: '', model: 'gemini-2.5-flash-image' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('PROVIDER_INVALID_REQUEST');
            expect(result.error.message).toContain('non-empty prompt');
        }
    });

    it('returns error for whitespace-only prompt', async () => {
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        const result = await provider.generateImage({ prompt: '   ', model: 'gemini-2.5-flash-image' });
        expect(result.ok).toBe(false);
    });

    it('returns error for empty model', async () => {
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        const result = await provider.generateImage({ prompt: 'a cat', model: '' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('PROVIDER_INVALID_REQUEST');
            expect(result.error.message).toContain('non-empty model');
        }
    });

    it('returns image result on success', async () => {
        generateContentMock.mockResolvedValue(
            makeImageResponse('generated', 'image/png', 'imgdata')
        );
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        const result = await provider.generateImage({
            prompt: 'a cat',
            model: 'gemini-2.5-flash-image'
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.outputs).toHaveLength(1);
            expect(result.value.outputs[0]?.mimeType).toBe('image/png');
            expect(result.value.model).toBe('gemini-2.5-flash-image');
        }
    });

    it('returns upstream error when chat fails', async () => {
        generateContentMock.mockRejectedValue(new Error('API error'));
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        const result = await provider.generateImage({
            prompt: 'a cat',
            model: 'gemini-2.5-flash-image'
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('PROVIDER_UPSTREAM_ERROR');
        }
    });

    it('returns upstream error when response has no image parts', async () => {
        generateContentMock.mockResolvedValue(makeTextResponse('no image'));
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        // Need to bypass the IMAGE modality check — the response must contain image
        // but this test validates runImageRequest when mapInlineImagePartsToMediaOutputs returns empty
        // Since chat() will throw first due to missing image, this exercises that path
        const result = await provider.generateImage({
            prompt: 'a cat',
            model: 'gemini-2.5-flash-image'
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('PROVIDER_UPSTREAM_ERROR');
        }
    });
});

describe('GoogleProvider - editImage', () => {
    beforeEach(() => {
        generateContentMock.mockReset();
    });

    it('returns error for empty prompt', async () => {
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        const result = await provider.editImage({
            prompt: '',
            model: 'gemini-2.5-flash-image',
            image: { kind: 'inline', mimeType: 'image/png', data: 'abc' }
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.message).toContain('non-empty prompt');
        }
    });

    it('returns error for empty model', async () => {
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        const result = await provider.editImage({
            prompt: 'make it blue',
            model: '',
            image: { kind: 'inline', mimeType: 'image/png', data: 'abc' }
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.message).toContain('non-empty model');
        }
    });

    it('returns error for invalid image source', async () => {
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        const result = await provider.editImage({
            prompt: 'make it blue',
            model: 'gemini-2.5-flash-image',
            image: { kind: 'inline', mimeType: '', data: 'abc' }
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('PROVIDER_INVALID_REQUEST');
        }
    });

    it('returns image result on success', async () => {
        generateContentMock.mockResolvedValue(
            makeImageResponse('edited', 'image/png', 'newdata')
        );
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        const result = await provider.editImage({
            prompt: 'make it blue',
            model: 'gemini-2.5-flash-image',
            image: { kind: 'inline', mimeType: 'image/png', data: 'original' }
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.outputs).toHaveLength(1);
        }
    });

    it('handles URI image source with data URI', async () => {
        generateContentMock.mockResolvedValue(
            makeImageResponse('edited', 'image/jpeg', 'newdata')
        );
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        const result = await provider.editImage({
            prompt: 'crop it',
            model: 'gemini-2.5-flash-image',
            image: { kind: 'uri', uri: 'data:image/jpeg;base64,originaldata' }
        });
        expect(result.ok).toBe(true);
    });

    it('returns error for non-data URI image source', async () => {
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        const result = await provider.editImage({
            prompt: 'crop it',
            model: 'gemini-2.5-flash-image',
            image: { kind: 'uri', uri: 'https://example.com/img.png' }
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('PROVIDER_INVALID_REQUEST');
        }
    });
});

describe('GoogleProvider - composeImage', () => {
    beforeEach(() => {
        generateContentMock.mockReset();
    });

    it('returns error for empty prompt', async () => {
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        const result = await provider.composeImage({
            prompt: '',
            model: 'gemini-2.5-flash-image',
            images: [
                { kind: 'inline', mimeType: 'image/png', data: 'a' },
                { kind: 'inline', mimeType: 'image/png', data: 'b' }
            ]
        });
        expect(result.ok).toBe(false);
    });

    it('returns error for empty model', async () => {
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        const result = await provider.composeImage({
            prompt: 'merge these',
            model: '',
            images: [
                { kind: 'inline', mimeType: 'image/png', data: 'a' },
                { kind: 'inline', mimeType: 'image/png', data: 'b' }
            ]
        });
        expect(result.ok).toBe(false);
    });

    it('returns error for fewer than 2 images', async () => {
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        const result = await provider.composeImage({
            prompt: 'merge these',
            model: 'gemini-2.5-flash-image',
            images: [{ kind: 'inline', mimeType: 'image/png', data: 'a' }]
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.message).toContain('at least two');
        }
    });

    it('returns error for empty images array', async () => {
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        const result = await provider.composeImage({
            prompt: 'merge these',
            model: 'gemini-2.5-flash-image',
            images: []
        });
        expect(result.ok).toBe(false);
    });

    it('returns error when one of the image sources is invalid', async () => {
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        const result = await provider.composeImage({
            prompt: 'merge these',
            model: 'gemini-2.5-flash-image',
            images: [
                { kind: 'inline', mimeType: 'image/png', data: 'valid' },
                { kind: 'inline', mimeType: '', data: 'invalid' }
            ]
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('PROVIDER_INVALID_REQUEST');
        }
    });

    it('returns composed image result on success', async () => {
        generateContentMock.mockResolvedValue(
            makeImageResponse('composed', 'image/png', 'composed-data')
        );
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        const result = await provider.composeImage({
            prompt: 'merge these',
            model: 'gemini-2.5-flash-image',
            images: [
                { kind: 'inline', mimeType: 'image/png', data: 'img1' },
                { kind: 'inline', mimeType: 'image/png', data: 'img2' }
            ]
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.outputs).toHaveLength(1);
            expect(result.value.model).toBe('gemini-2.5-flash-image');
        }
    });
});

describe('GoogleProvider - name and version', () => {
    it('has name "google"', () => {
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        expect(provider.name).toBe('google');
    });

    it('has version "1.0.0"', () => {
        const provider = new GoogleProvider({ apiKey: 'test-key' });
        expect(provider.version).toBe('1.0.0');
    });
});
