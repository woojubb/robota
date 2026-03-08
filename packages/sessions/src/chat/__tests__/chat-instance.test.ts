import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatInstance } from '../chat-instance';
import type { IChatConfig, IChatMetadata, ITemplateManager } from '../../types/chat';
import type { IAgentConfig, TUniversalMessage } from '@robota-sdk/agents';

// Minimal mock for Robota - only the methods ChatInstance uses
function createMockRobota(overrides: {
    run?: (content: string) => Promise<string>;
    getHistory?: () => TUniversalMessage[];
    clearHistory?: () => void;
    configure?: (config: IAgentConfig) => Promise<void>;
} = {}) {
    return {
        run: overrides.run ?? vi.fn().mockResolvedValue('mock response'),
        getHistory: overrides.getHistory ?? vi.fn().mockReturnValue([]),
        clearHistory: overrides.clearHistory ?? vi.fn(),
        configure: overrides.configure ?? vi.fn().mockResolvedValue(undefined),
    } as unknown as import('@robota-sdk/agents').Robota;
}

function createMockMetadata(overrides: Partial<IChatMetadata> = {}): IChatMetadata {
    const now = new Date();
    return {
        chatId: 'chat-1',
        sessionId: 'session-1',
        chatName: 'Test Chat',
        createdAt: now,
        updatedAt: now,
        lastAccessedAt: now,
        messageCount: 0,
        isActive: true,
        ...overrides,
    };
}

function createMockConfig(overrides: Partial<IChatConfig> = {}): IChatConfig {
    return {
        chatName: 'Test Chat',
        robotaConfig: {
            name: 'test-agent',
            aiProviders: [],
            defaultModel: { provider: 'openai', model: 'gpt-4' },
        },
        ...overrides,
    };
}

describe('ChatInstance', () => {
    let chatInstance: ChatInstance;
    let mockRobota: ReturnType<typeof createMockRobota>;
    let metadata: IChatMetadata;
    let config: IChatConfig;

    beforeEach(() => {
        mockRobota = createMockRobota();
        metadata = createMockMetadata();
        config = createMockConfig();
        chatInstance = new ChatInstance(metadata, config, mockRobota);
    });

    describe('creation', () => {
        it('should store metadata and config on construction', () => {
            expect(chatInstance.metadata).toBe(metadata);
            expect(chatInstance.config).toBe(config);
        });

        it('should expose the robota instance as readonly', () => {
            expect(chatInstance.robota).toBe(mockRobota);
        });

        it('should create a default template manager when none is provided', () => {
            const tm = chatInstance.getTemplateManager();
            expect(tm).toBeDefined();
        });

        it('should use injected template manager when provided', () => {
            const customTm: ITemplateManager = {
                getTemplate: vi.fn(),
                listTemplates: vi.fn().mockReturnValue([]),
                validateTemplate: vi.fn().mockReturnValue(true),
            };
            const instance = new ChatInstance(metadata, config, mockRobota, customTm);
            expect(instance.getTemplateManager()).toBe(customTm);
        });
    });

    describe('sendMessage', () => {
        it('should delegate to robota.run and return response', async () => {
            const robota = createMockRobota({
                run: vi.fn().mockResolvedValue('hello world'),
            });
            const instance = new ChatInstance(createMockMetadata(), config, robota);

            const result = await instance.sendMessage('hi');

            expect(result).toBe('hello world');
        });

        it('should increment messageCount after send', async () => {
            const md = createMockMetadata({ messageCount: 5 });
            const instance = new ChatInstance(md, config, mockRobota);

            await instance.sendMessage('test');

            expect(md.messageCount).toBe(6);
        });

        it('should update lastAccessedAt after send', async () => {
            const before = new Date(metadata.lastAccessedAt);
            // small delay to ensure time difference
            await new Promise((r) => setTimeout(r, 5));
            await chatInstance.sendMessage('test');

            expect(chatInstance.metadata.lastAccessedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
        });

        it('should throw wrapped error when robota.run fails', async () => {
            const robota = createMockRobota({
                run: vi.fn().mockRejectedValue(new Error('provider error')),
            });
            const instance = new ChatInstance(createMockMetadata(), config, robota);

            await expect(instance.sendMessage('hi')).rejects.toThrow('Failed to send message: provider error');
        });
    });

    describe('history management', () => {
        it('should delegate getHistory to robota', () => {
            const history: TUniversalMessage[] = [
                { role: 'user', content: 'hi' },
                { role: 'assistant', content: 'hello' },
            ];
            const robota = createMockRobota({
                getHistory: vi.fn().mockReturnValue(history),
            });
            const instance = new ChatInstance(createMockMetadata(), config, robota);

            expect(instance.getHistory()).toEqual(history);
        });

        it('should delegate clearHistory to robota and reset messageCount', () => {
            const clearFn = vi.fn();
            const robota = createMockRobota({ clearHistory: clearFn });
            const md = createMockMetadata({ messageCount: 10 });
            const instance = new ChatInstance(md, config, robota);

            instance.clearHistory();

            expect(clearFn).toHaveBeenCalledOnce();
            expect(md.messageCount).toBe(0);
        });
    });

    describe('activate / deactivate', () => {
        it('should set isActive to true on activate', () => {
            chatInstance.metadata.isActive = false;
            chatInstance.activate();
            expect(chatInstance.metadata.isActive).toBe(true);
        });

        it('should set isActive to false on deactivate', () => {
            chatInstance.metadata.isActive = true;
            chatInstance.deactivate();
            expect(chatInstance.metadata.isActive).toBe(false);
        });
    });

    describe('getRobotaConfig', () => {
        it('should return the config.robotaConfig', () => {
            expect(chatInstance.getRobotaConfig()).toBe(config.robotaConfig);
        });
    });

    describe('getStats', () => {
        it('should return stats reflecting current metadata', () => {
            const md = createMockMetadata({ messageCount: 7 });
            const instance = new ChatInstance(md, config, mockRobota);

            const stats = instance.getStats();

            expect(stats.messageCount).toBe(7);
            expect(stats.createdAt).toBe(md.createdAt);
            expect(stats.lastActivity).toBe(md.lastAccessedAt);
        });
    });

    describe('updateConfig', () => {
        it('should merge partial config into existing config', () => {
            chatInstance.updateConfig({ description: 'updated' });
            expect(chatInstance.config.description).toBe('updated');
        });

        it('should update metadata.updatedAt', () => {
            const before = new Date(chatInstance.metadata.updatedAt);
            chatInstance.updateConfig({ chatName: 'new name' });
            expect(chatInstance.metadata.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
        });
    });
});
