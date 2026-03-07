import { describe, it, expect } from 'vitest';
import { Validator } from './validation';
import type { IAgentConfig } from '../interfaces/agent';
import type { IAIProvider } from '../interfaces/provider';
import type { TUniversalMessage } from '../interfaces/messages';
import type { IChatOptions } from '../interfaces/provider';

/**
 * Minimal mock AI provider for validation tests.
 */
function createMockProvider(name: string): IAIProvider {
    return {
        name,
        version: '1.0.0',
        chat: async (_messages: TUniversalMessage[], _options?: IChatOptions): Promise<TUniversalMessage> => ({
            role: 'assistant',
            content: 'mock response',
            timestamp: new Date(),
        }),
    };
}

function createValidConfig(overrides?: Partial<IAgentConfig>): Partial<IAgentConfig> {
    return {
        name: 'test-agent',
        aiProviders: [createMockProvider('openai')],
        defaultModel: {
            provider: 'openai',
            model: 'gpt-4',
        },
        ...overrides,
    };
}

describe('Validator', () => {
    describe('validateAgentConfig', () => {
        it('should pass for a valid config', () => {
            const result = Validator.validateAgentConfig(createValidConfig());
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should fail when name is missing', () => {
            const result = Validator.validateAgentConfig(createValidConfig({ name: '' }));
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('name is required');
        });

        it('should fail when aiProviders is missing', () => {
            const result = Validator.validateAgentConfig(createValidConfig({ aiProviders: undefined }));
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes('aiProviders'))).toBe(true);
        });

        it('should fail when aiProviders is empty', () => {
            const result = Validator.validateAgentConfig(createValidConfig({ aiProviders: [] }));
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes('aiProviders'))).toBe(true);
        });

        it('should fail when defaultModel is missing', () => {
            const result = Validator.validateAgentConfig(createValidConfig({ defaultModel: undefined }));
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('defaultModel is required');
        });

        it('should fail when defaultModel.provider is missing', () => {
            const config = createValidConfig({
                defaultModel: { provider: '', model: 'gpt-4' },
            });
            const result = Validator.validateAgentConfig(config);
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('defaultModel.provider is required');
        });

        it('should fail when defaultModel.model is missing', () => {
            const config = createValidConfig({
                defaultModel: { provider: 'openai', model: '' },
            });
            const result = Validator.validateAgentConfig(config);
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('defaultModel.model is required');
        });

        it('should fail when defaultModel.provider is not in aiProviders list', () => {
            const config = createValidConfig({
                defaultModel: { provider: 'anthropic', model: 'claude-3' },
            });
            const result = Validator.validateAgentConfig(config);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes('not found in aiProviders'))).toBe(true);
        });

        it('should fail when temperature is out of range (below 0)', () => {
            const config = createValidConfig({
                defaultModel: { provider: 'openai', model: 'gpt-4', temperature: -1 },
            });
            const result = Validator.validateAgentConfig(config);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes('temperature'))).toBe(true);
        });

        it('should fail when temperature is out of range (above 2)', () => {
            const config = createValidConfig({
                defaultModel: { provider: 'openai', model: 'gpt-4', temperature: 3 },
            });
            const result = Validator.validateAgentConfig(config);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes('temperature'))).toBe(true);
        });

        it('should fail when maxTokens is negative', () => {
            const config = createValidConfig({
                defaultModel: { provider: 'openai', model: 'gpt-4', maxTokens: -10 },
            });
            const result = Validator.validateAgentConfig(config);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes('maxTokens'))).toBe(true);
        });

        it('should fail when maxTokens is zero', () => {
            const config = createValidConfig({
                defaultModel: { provider: 'openai', model: 'gpt-4', maxTokens: 0 },
            });
            const result = Validator.validateAgentConfig(config);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes('maxTokens'))).toBe(true);
        });

        it('should warn when systemMessage is very long', () => {
            const config = createValidConfig({
                systemMessage: 'x'.repeat(1001),
            });
            const result = Validator.validateAgentConfig(config);
            expect(result.isValid).toBe(true);
            expect(result.warnings?.some(w => w.includes('systemMessage'))).toBe(true);
        });

        it('should warn when too many tools are provided', () => {
            const manyTools = Array.from({ length: 21 }, (_, i) => ({
                name: `tool_${i}`,
                description: `Tool ${i}`,
                execute: async () => `result_${i}`,
                setEventService: () => { /* noop */ },
            }));
            const config = createValidConfig({
                tools: manyTools,
            });
            const result = Validator.validateAgentConfig(config);
            expect(result.isValid).toBe(true);
            expect(result.warnings?.some(w => w.includes('tools') || w.includes('performance'))).toBe(true);
        });
    });

    describe('validateUserInput', () => {
        it('should pass for valid input', () => {
            const result = Validator.validateUserInput('Hello, world!');
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should fail for empty string', () => {
            const result = Validator.validateUserInput('');
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes('non-empty'))).toBe(true);
        });

        it('should fail for whitespace only', () => {
            const result = Validator.validateUserInput('   \t\n  ');
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes('whitespace'))).toBe(true);
        });

        it('should warn for very long input', () => {
            const result = Validator.validateUserInput('a'.repeat(10001));
            expect(result.isValid).toBe(true);
            expect(result.warnings?.some(w => w.includes('long') || w.includes('truncated'))).toBe(true);
        });
    });

    describe('validateProviderName', () => {
        it('should pass for valid names', () => {
            expect(Validator.validateProviderName('openai').isValid).toBe(true);
            expect(Validator.validateProviderName('my-provider').isValid).toBe(true);
            expect(Validator.validateProviderName('provider_v2').isValid).toBe(true);
            expect(Validator.validateProviderName('A123').isValid).toBe(true);
        });

        it('should fail for empty string', () => {
            const result = Validator.validateProviderName('');
            expect(result.isValid).toBe(false);
        });

        it('should fail when name starts with a number', () => {
            const result = Validator.validateProviderName('1provider');
            expect(result.isValid).toBe(false);
        });

        it('should fail when name contains special characters', () => {
            const result = Validator.validateProviderName('my.provider');
            expect(result.isValid).toBe(false);
            const result2 = Validator.validateProviderName('my provider');
            expect(result2.isValid).toBe(false);
        });
    });

    describe('validateModelName', () => {
        it('should pass for valid model names', () => {
            expect(Validator.validateModelName('gpt-4').isValid).toBe(true);
            expect(Validator.validateModelName('claude-3-opus').isValid).toBe(true);
        });

        it('should fail for empty string', () => {
            const result = Validator.validateModelName('');
            expect(result.isValid).toBe(false);
        });

        it('should fail for whitespace only', () => {
            const result = Validator.validateModelName('   ');
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes('whitespace'))).toBe(true);
        });
    });

    describe('validateApiKey', () => {
        it('should pass for a valid key', () => {
            const result = Validator.validateApiKey('sk-abcdefghij1234567890');
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should fail for empty string', () => {
            const result = Validator.validateApiKey('');
            expect(result.isValid).toBe(false);
        });

        it('should fail for too short key', () => {
            const result = Validator.validateApiKey('short');
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes('too short'))).toBe(true);
        });

        it('should fail for key with whitespace', () => {
            const result = Validator.validateApiKey('sk-abc def ghij klmno');
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.includes('whitespace'))).toBe(true);
        });

        it('should warn when OpenAI key does not start with sk-', () => {
            const result = Validator.validateApiKey('not-an-openai-key', 'openai');
            expect(result.isValid).toBe(true);
            expect(result.warnings?.some(w => w.includes('sk-'))).toBe(true);
        });

        it('should warn when Anthropic key does not start with sk-ant-', () => {
            const result = Validator.validateApiKey('sk-not-anthropic-key', 'anthropic');
            expect(result.isValid).toBe(true);
            expect(result.warnings?.some(w => w.includes('sk-ant-'))).toBe(true);
        });

        it('should not warn when OpenAI key starts with sk-', () => {
            const result = Validator.validateApiKey('sk-1234567890abcdef', 'openai');
            expect(result.isValid).toBe(true);
            expect(result.warnings ?? []).toHaveLength(0);
        });

        it('should not warn when Anthropic key starts with sk-ant-', () => {
            const result = Validator.validateApiKey('sk-ant-1234567890ab', 'anthropic');
            expect(result.isValid).toBe(true);
            expect(result.warnings ?? []).toHaveLength(0);
        });
    });
});
