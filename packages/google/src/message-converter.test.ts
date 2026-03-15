import { describe, expect, it, vi } from 'vitest';
import type { TUniversalMessage, IAssistantMessage, IToolSchema } from '@robota-sdk/agents';
import {
    mapMessagePartsToGeminiParts,
    convertToGeminiFormat,
    convertFromGeminiResponse,
    convertToolsToGeminiFormat,
    generateCallId
} from './message-converter';

describe('mapMessagePartsToGeminiParts', () => {
    it('converts text parts to Gemini text parts', () => {
        const message: TUniversalMessage = {
            role: 'user',
            content: '',
            parts: [{ type: 'text', text: 'hello' }],
            timestamp: new Date()
        };
        const result = mapMessagePartsToGeminiParts(message);
        expect(result).toEqual([{ text: 'hello' }]);
    });

    it('converts inline image parts to Gemini inlineData parts', () => {
        const message: TUniversalMessage = {
            role: 'user',
            content: '',
            parts: [{ type: 'image_inline', mimeType: 'image/png', data: 'abc123' }],
            timestamp: new Date()
        };
        const result = mapMessagePartsToGeminiParts(message);
        expect(result).toEqual([{ inlineData: { mimeType: 'image/png', data: 'abc123' } }]);
    });

    it('throws on image_uri parts', () => {
        const message: TUniversalMessage = {
            role: 'user',
            content: '',
            parts: [{ type: 'image_uri', uri: 'https://example.com/img.png', mimeType: 'image/png' }],
            timestamp: new Date()
        };
        expect(() => mapMessagePartsToGeminiParts(message)).toThrow(
            'Google provider does not support image URI parts directly: https://example.com/img.png'
        );
    });

    it('falls back to content when no parts are present', () => {
        const message: TUniversalMessage = {
            role: 'user',
            content: 'plain text',
            timestamp: new Date()
        };
        const result = mapMessagePartsToGeminiParts(message);
        expect(result).toEqual([{ text: 'plain text' }]);
    });

    it('returns empty array when no parts and empty content', () => {
        const message: TUniversalMessage = {
            role: 'user',
            content: '',
            timestamp: new Date()
        };
        const result = mapMessagePartsToGeminiParts(message);
        expect(result).toEqual([]);
    });

    it('converts mixed text and image parts', () => {
        const message: TUniversalMessage = {
            role: 'user',
            content: '',
            parts: [
                { type: 'text', text: 'describe this' },
                { type: 'image_inline', mimeType: 'image/jpeg', data: 'base64data' }
            ],
            timestamp: new Date()
        };
        const result = mapMessagePartsToGeminiParts(message);
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ text: 'describe this' });
        expect(result[1]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'base64data' } });
    });
});

describe('convertToGeminiFormat', () => {
    it('converts user messages with role "user"', () => {
        const messages: TUniversalMessage[] = [
            { role: 'user', content: 'hello', timestamp: new Date() }
        ];
        const result = convertToGeminiFormat(messages);
        expect(result).toHaveLength(1);
        expect(result[0]?.role).toBe('user');
        expect(result[0]?.parts).toEqual([{ text: 'hello' }]);
    });

    it('converts assistant messages with role "model"', () => {
        const messages: TUniversalMessage[] = [
            { role: 'assistant', content: 'hi there', timestamp: new Date() }
        ];
        const result = convertToGeminiFormat(messages);
        expect(result).toHaveLength(1);
        expect(result[0]?.role).toBe('model');
        expect(result[0]?.parts).toEqual([{ text: 'hi there' }]);
    });

    it('converts assistant messages with tool calls to function call parts', () => {
        const messages: TUniversalMessage[] = [
            {
                role: 'assistant',
                content: 'Let me check',
                toolCalls: [
                    {
                        id: 'call_1',
                        type: 'function' as const,
                        function: {
                            name: 'get_weather',
                            arguments: '{"city":"Seoul"}'
                        }
                    }
                ],
                timestamp: new Date()
            } as IAssistantMessage
        ];
        const result = convertToGeminiFormat(messages);
        expect(result[0]?.role).toBe('model');
        expect(result[0]?.parts).toHaveLength(2);
        expect(result[0]?.parts[0]).toEqual({ text: 'Let me check' });
        expect(result[0]?.parts[1]).toEqual({
            functionCall: { name: 'get_weather', args: { city: 'Seoul' } }
        });
    });

    it('converts assistant messages with only tool calls and no content', () => {
        const messages: TUniversalMessage[] = [
            {
                role: 'assistant',
                content: null,
                toolCalls: [
                    {
                        id: 'call_2',
                        type: 'function' as const,
                        function: {
                            name: 'search',
                            arguments: '{"query":"test"}'
                        }
                    }
                ],
                timestamp: new Date()
            } as IAssistantMessage
        ];
        const result = convertToGeminiFormat(messages);
        expect(result[0]?.role).toBe('model');
        // Should have only the function call part since content is null
        expect(result[0]?.parts).toHaveLength(1);
        expect(result[0]?.parts[0]).toHaveProperty('functionCall');
    });

    it('converts tool messages with role "user"', () => {
        const messages: TUniversalMessage[] = [
            { role: 'tool', content: 'tool result', toolCallId: 'call_1', timestamp: new Date() }
        ];
        const result = convertToGeminiFormat(messages);
        expect(result[0]?.role).toBe('user');
        expect(result[0]?.parts).toEqual([{ text: 'tool result' }]);
    });

    it('converts system messages with content as text part', () => {
        const messages: TUniversalMessage[] = [
            { role: 'system', content: 'You are helpful', timestamp: new Date() }
        ];
        const result = convertToGeminiFormat(messages);
        expect(result[0]?.role).toBe('user');
        // mapMessagePartsToGeminiParts falls back to content when no parts
        expect(result[0]?.parts).toEqual([{ text: 'You are helpful' }]);
    });

    it('converts system messages with empty content to "System:" prefixed text', () => {
        const messages: TUniversalMessage[] = [
            { role: 'system', content: '', timestamp: new Date() }
        ];
        const result = convertToGeminiFormat(messages);
        expect(result[0]?.role).toBe('user');
        // When mapMessagePartsToGeminiParts returns empty, the System: prefix is added
        expect(result[0]?.parts).toEqual([{ text: 'System: ' }]);
    });

    it('converts system messages with parts directly', () => {
        const messages: TUniversalMessage[] = [
            {
                role: 'system',
                content: '',
                parts: [{ type: 'text', text: 'System instruction' }],
                timestamp: new Date()
            }
        ];
        const result = convertToGeminiFormat(messages);
        expect(result[0]?.role).toBe('user');
        expect(result[0]?.parts).toEqual([{ text: 'System instruction' }]);
    });

    it('handles multiple messages in sequence', () => {
        const messages: TUniversalMessage[] = [
            { role: 'system', content: 'Be helpful', timestamp: new Date() },
            { role: 'user', content: 'Hello', timestamp: new Date() },
            { role: 'assistant', content: 'Hi!', timestamp: new Date() }
        ];
        const result = convertToGeminiFormat(messages);
        expect(result).toHaveLength(3);
        expect(result[0]?.role).toBe('user');
        expect(result[1]?.role).toBe('user');
        expect(result[2]?.role).toBe('model');
    });
});

describe('convertFromGeminiResponse', () => {
    it('extracts text from response candidates', () => {
        const response = {
            candidates: [
                {
                    content: {
                        parts: [{ text: 'Hello world' }]
                    }
                }
            ]
        };
        const result = convertFromGeminiResponse(response as never);
        expect(result.role).toBe('assistant');
        expect(result.content).toBe('Hello world');
        expect(result.parts).toEqual([{ type: 'text', text: 'Hello world' }]);
    });

    it('throws when no candidates in response', () => {
        const response = { candidates: [] };
        expect(() => convertFromGeminiResponse(response as never)).toThrow('No candidate in Gemini response');
    });

    it('throws when candidates is undefined', () => {
        const response = {};
        expect(() => convertFromGeminiResponse(response as never)).toThrow('No candidate in Gemini response');
    });

    it('throws when no content in response', () => {
        const response = {
            candidates: [{ content: { parts: [] } }]
        };
        expect(() => convertFromGeminiResponse(response as never)).toThrow('No content in Gemini response');
    });

    it('throws when content is undefined', () => {
        const response = {
            candidates: [{}]
        };
        expect(() => convertFromGeminiResponse(response as never)).toThrow('No content in Gemini response');
    });

    it('extracts function calls from response', () => {
        const response = {
            candidates: [
                {
                    content: {
                        parts: [
                            {
                                functionCall: {
                                    name: 'get_weather',
                                    args: { city: 'Seoul' }
                                }
                            }
                        ]
                    }
                }
            ]
        };
        const result = convertFromGeminiResponse(response as never) as IAssistantMessage;
        expect(result.toolCalls).toBeDefined();
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls![0]?.function.name).toBe('get_weather');
        expect(result.toolCalls![0]?.function.arguments).toBe('{"city":"Seoul"}');
        expect(result.toolCalls![0]?.type).toBe('function');
        expect(result.toolCalls![0]?.id).toMatch(/^call_/);
    });

    it('handles mixed text and function call parts', () => {
        const response = {
            candidates: [
                {
                    content: {
                        parts: [
                            { text: 'Let me check the weather' },
                            {
                                functionCall: {
                                    name: 'get_weather',
                                    args: { city: 'Tokyo' }
                                }
                            }
                        ]
                    }
                }
            ]
        };
        const result = convertFromGeminiResponse(response as never) as IAssistantMessage;
        expect(result.content).toBe('Let me check the weather');
        expect(result.parts).toHaveLength(1); // only text parts in messageParts
        expect(result.toolCalls).toHaveLength(1);
    });

    it('handles inline image parts in response', () => {
        const response = {
            candidates: [
                {
                    content: {
                        parts: [
                            { text: 'Here is the image' },
                            { inlineData: { mimeType: 'image/png', data: 'base64data' } }
                        ]
                    }
                }
            ]
        };
        const result = convertFromGeminiResponse(response as never);
        expect(result.parts).toHaveLength(2);
        expect(result.parts![0]).toEqual({ type: 'text', text: 'Here is the image' });
        expect(result.parts![1]).toEqual({ type: 'image_inline', data: 'base64data', mimeType: 'image/png' });
    });

    it('includes usage metadata when present', () => {
        const response = {
            candidates: [
                {
                    content: {
                        parts: [{ text: 'response' }]
                    }
                }
            ],
            usageMetadata: {
                promptTokenCount: 10,
                candidatesTokenCount: 20,
                totalTokenCount: 30
            }
        };
        const result = convertFromGeminiResponse(response as never);
        expect(result.metadata).toEqual({
            promptTokens: 10,
            completionTokens: 20,
            totalTokens: 30
        });
    });

    it('does not include metadata when usageMetadata is absent', () => {
        const response = {
            candidates: [
                {
                    content: {
                        parts: [{ text: 'response' }]
                    }
                }
            ]
        };
        const result = convertFromGeminiResponse(response as never);
        expect(result.metadata).toBeUndefined();
    });

    it('joins multiple text parts into one content string', () => {
        const response = {
            candidates: [
                {
                    content: {
                        parts: [
                            { text: 'Hello ' },
                            { text: 'world' }
                        ]
                    }
                }
            ]
        };
        const result = convertFromGeminiResponse(response as never);
        expect(result.content).toBe('Hello world');
        expect(result.parts).toHaveLength(2);
    });

    it('sets content to null when no text parts exist', () => {
        const response = {
            candidates: [
                {
                    content: {
                        parts: [
                            {
                                functionCall: {
                                    name: 'search',
                                    args: { q: 'test' }
                                }
                            }
                        ]
                    }
                }
            ]
        };
        const result = convertFromGeminiResponse(response as never);
        expect(result.content).toBeNull();
    });

    it('handles multiple function calls', () => {
        const response = {
            candidates: [
                {
                    content: {
                        parts: [
                            { functionCall: { name: 'fn_a', args: { a: 1 } } },
                            { functionCall: { name: 'fn_b', args: { b: 2 } } }
                        ]
                    }
                }
            ]
        };
        const result = convertFromGeminiResponse(response as never) as IAssistantMessage;
        expect(result.toolCalls).toHaveLength(2);
        expect(result.toolCalls![0]?.function.name).toBe('fn_a');
        expect(result.toolCalls![1]?.function.name).toBe('fn_b');
    });
});

describe('convertToolsToGeminiFormat', () => {
    it('converts tool schemas to Gemini function declarations', () => {
        const tools: IToolSchema[] = [
            {
                name: 'get_weather',
                description: 'Get weather information',
                parameters: {
                    type: 'object',
                    properties: {
                        city: { type: 'string', description: 'City name' }
                    },
                    required: ['city']
                }
            }
        ];
        const result = convertToolsToGeminiFormat(tools);
        expect(result).toHaveLength(1);
        expect(result[0]?.name).toBe('get_weather');
        expect(result[0]?.description).toBe('Get weather information');
        expect(result[0]?.parameters).toEqual(tools[0]?.parameters);
    });

    it('converts multiple tools', () => {
        const tools: IToolSchema[] = [
            {
                name: 'tool_a',
                description: 'Tool A',
                parameters: { type: 'object', properties: {} }
            },
            {
                name: 'tool_b',
                description: 'Tool B',
                parameters: { type: 'object', properties: { x: { type: 'number' } } }
            }
        ];
        const result = convertToolsToGeminiFormat(tools);
        expect(result).toHaveLength(2);
        expect(result[0]?.name).toBe('tool_a');
        expect(result[1]?.name).toBe('tool_b');
    });

    it('returns empty array for empty tools', () => {
        const result = convertToolsToGeminiFormat([]);
        expect(result).toEqual([]);
    });
});

describe('generateCallId', () => {
    it('returns a string starting with "call_"', () => {
        const id = generateCallId();
        expect(id).toMatch(/^call_/);
    });

    it('generates unique IDs across calls', () => {
        const ids = new Set(Array.from({ length: 50 }, () => generateCallId()));
        expect(ids.size).toBe(50);
    });

    it('contains a timestamp component', () => {
        const before = Date.now();
        const id = generateCallId();
        const after = Date.now();
        // Extract timestamp between "call_" and the second "_"
        const parts = id.split('_');
        const timestamp = Number(parts[1]);
        expect(timestamp).toBeGreaterThanOrEqual(before);
        expect(timestamp).toBeLessThanOrEqual(after);
    });
});
