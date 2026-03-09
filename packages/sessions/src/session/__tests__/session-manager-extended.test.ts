import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager } from '../session-manager';
import { ChatInstance } from '../../chat/chat-instance';
import type { ICreateChatOptions } from '../../types/core';
import type { IAgentConfig } from '@robota-sdk/agents';

// Mock AgentFactory to avoid real provider initialization
vi.mock('@robota-sdk/agents', async (importOriginal) => {
    const original = await importOriginal<typeof import('@robota-sdk/agents')>();

    // Create a mock Robota class that satisfies instanceof checks
    class MockRobota {
        private config: IAgentConfig;

        constructor(config: IAgentConfig) {
            this.config = config;
        }

        run = vi.fn().mockResolvedValue('mock response');
        getHistory = vi.fn().mockReturnValue([]);
        clearHistory = vi.fn();
        configure = vi.fn().mockResolvedValue(undefined);
    }

    class MockAgentFactory {
        async createAgent(
            AgentClass: unknown,
            _config: Partial<IAgentConfig>
        ): Promise<unknown> {
            // Return a MockRobota instance. The session-manager checks instanceof Robota,
            // but since we override Robota export to be MockRobota, instanceof will match.
            return new MockRobota(_config as IAgentConfig);
        }

        validateConfiguration() {
            return { isValid: true, errors: [] };
        }
    }

    return {
        ...original,
        Robota: MockRobota,
        AgentFactory: MockAgentFactory,
    };
});

function createDefaultChatOptions(overrides: Partial<ICreateChatOptions> = {}): ICreateChatOptions {
    return {
        name: 'Test Chat',
        agentConfig: {
            name: 'test-agent',
            aiProviders: [],
            defaultModel: { provider: 'openai', model: 'gpt-4' },
        },
        ...overrides,
    };
}

describe('SessionManager - extended coverage', () => {
    let manager: SessionManager;

    beforeEach(() => {
        manager = new SessionManager({ maxSessions: 10, maxChatsPerSession: 5 });
    });

    describe('createSession with defaults', () => {
        it('should create session with default name when none provided', () => {
            const sessionId = manager.createSession();
            const session = manager.getSession(sessionId);

            expect(session).toBeDefined();
            expect(session!.name).toContain('Session');
            expect(session!.userId).toBe('anonymous');
        });

        it('should return false when deleting non-existent session', () => {
            const result = manager.deleteSession('nonexistent');
            expect(result).toBe(false);
        });
    });

    describe('createChat', () => {
        let sessionId: string;

        beforeEach(() => {
            sessionId = manager.createSession({ name: 'Test Session' });
        });

        it('should create a chat and return a chat ID', async () => {
            const chatId = await manager.createChat(sessionId, createDefaultChatOptions());

            expect(chatId).toMatch(/^chat_/);

            const chat = manager.getChat(chatId);
            expect(chat).toBeInstanceOf(ChatInstance);
        });

        it('should increment session chatCount', async () => {
            await manager.createChat(sessionId, createDefaultChatOptions());

            const session = manager.getSession(sessionId);
            expect(session!.chatCount).toBe(1);
        });

        it('should create chat with default name when none provided', async () => {
            const chatId = await manager.createChat(sessionId, {
                agentConfig: {
                    name: 'agent',
                    aiProviders: [],
                    defaultModel: { provider: 'openai', model: 'gpt-4' },
                },
            });

            const chat = manager.getChat(chatId);
            expect(chat!.metadata.chatName).toContain('Chat');
        });

        it('should set description when provided', async () => {
            const chatId = await manager.createChat(sessionId, createDefaultChatOptions({
                description: 'A test description',
            }));

            const chat = manager.getChat(chatId);
            expect(chat!.metadata.description).toBe('A test description');
        });

        it('should set agentTemplate in config when provided', async () => {
            const chatId = await manager.createChat(sessionId, createDefaultChatOptions({
                agentTemplate: 'my-template',
            }));

            const chat = manager.getChat(chatId);
            expect(chat!.config.agentTemplate).toBe('my-template');
        });

        it('should throw when session not found', async () => {
            await expect(
                manager.createChat('nonexistent', createDefaultChatOptions())
            ).rejects.toThrow('Session nonexistent not found');
        });

        it('should throw when chat limit per session is reached', async () => {
            const limitedManager = new SessionManager({ maxSessions: 10, maxChatsPerSession: 2 });
            const sid = limitedManager.createSession({ name: 'Limited Session' });

            await limitedManager.createChat(sid, createDefaultChatOptions({ name: 'Chat 1' }));
            await limitedManager.createChat(sid, createDefaultChatOptions({ name: 'Chat 2' }));

            await expect(
                limitedManager.createChat(sid, createDefaultChatOptions({ name: 'Chat 3' }))
            ).rejects.toThrow('Maximum chats per session (2) reached');
        });

        it('should update session lastUsedAt after creating chat', async () => {
            const session = manager.getSession(sessionId);
            const beforeTime = session!.lastUsedAt;

            await manager.createChat(sessionId, createDefaultChatOptions());

            const updatedSession = manager.getSession(sessionId);
            expect(updatedSession!.lastUsedAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
        });
    });

    describe('getSessionChats', () => {
        it('should return empty array for non-existent session', () => {
            const chats = manager.getSessionChats('nonexistent');
            expect(chats).toEqual([]);
        });

        it('should return chat info for all chats in a session', async () => {
            const sessionId = manager.createSession({ name: 'Chat Session' });
            await manager.createChat(sessionId, createDefaultChatOptions({ name: 'Chat A' }));
            await manager.createChat(sessionId, createDefaultChatOptions({ name: 'Chat B' }));

            const chats = manager.getSessionChats(sessionId);

            expect(chats).toHaveLength(2);
            expect(chats[0].sessionId).toBe(sessionId);
            expect(chats[1].sessionId).toBe(sessionId);
            expect(chats.map(c => c.name)).toContain('Chat A');
            expect(chats.map(c => c.name)).toContain('Chat B');
        });

        it('should include agentTemplate in chat info when set', async () => {
            const sessionId = manager.createSession({ name: 'Template Session' });
            await manager.createChat(sessionId, createDefaultChatOptions({
                name: 'Templated Chat',
                agentTemplate: 'code-assistant',
            }));

            const chats = manager.getSessionChats(sessionId);
            expect(chats[0].agentTemplate).toBe('code-assistant');
        });
    });

    describe('switchChat', () => {
        let sessionId: string;

        beforeEach(() => {
            sessionId = manager.createSession({ name: 'Switch Session' });
        });

        it('should activate target chat and set activeChatId on session', async () => {
            const chatId1 = await manager.createChat(sessionId, createDefaultChatOptions({ name: 'Chat 1' }));
            const chatId2 = await manager.createChat(sessionId, createDefaultChatOptions({ name: 'Chat 2' }));

            const result = manager.switchChat(sessionId, chatId1);

            expect(result).toBe(true);
            const chat1 = manager.getChat(chatId1);
            expect(chat1!.metadata.isActive).toBe(true);

            const session = manager.getSession(sessionId);
            expect(session!.activeChatId).toBe(chatId1);

            // Switch to second chat - first should deactivate
            const result2 = manager.switchChat(sessionId, chatId2);
            expect(result2).toBe(true);

            expect(manager.getChat(chatId1)!.metadata.isActive).toBe(false);
            expect(manager.getChat(chatId2)!.metadata.isActive).toBe(true);
            expect(manager.getSession(sessionId)!.activeChatId).toBe(chatId2);
        });

        it('should return false for non-existent session', async () => {
            const chatId = await manager.createChat(sessionId, createDefaultChatOptions());
            const result = manager.switchChat('nonexistent', chatId);
            expect(result).toBe(false);
        });

        it('should return false for non-existent chat', () => {
            const result = manager.switchChat(sessionId, 'nonexistent-chat');
            expect(result).toBe(false);
        });

        it('should return false when chat belongs to different session', async () => {
            const otherSession = manager.createSession({ name: 'Other Session' });
            const chatId = await manager.createChat(otherSession, createDefaultChatOptions());

            const result = manager.switchChat(sessionId, chatId);
            expect(result).toBe(false);
        });

        it('should update session lastUsedAt', async () => {
            const chatId = await manager.createChat(sessionId, createDefaultChatOptions());
            const before = manager.getSession(sessionId)!.lastUsedAt;

            manager.switchChat(sessionId, chatId);

            expect(manager.getSession(sessionId)!.lastUsedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
        });
    });

    describe('deleteChat', () => {
        let sessionId: string;

        beforeEach(() => {
            sessionId = manager.createSession({ name: 'Delete Chat Session' });
        });

        it('should remove chat and decrement session chatCount', async () => {
            const chatId = await manager.createChat(sessionId, createDefaultChatOptions());
            expect(manager.getSession(sessionId)!.chatCount).toBe(1);

            const result = manager.deleteChat(chatId);

            expect(result).toBe(true);
            expect(manager.getChat(chatId)).toBeUndefined();
            expect(manager.getSession(sessionId)!.chatCount).toBe(0);
        });

        it('should return false for non-existent chat', () => {
            const result = manager.deleteChat('nonexistent');
            expect(result).toBe(false);
        });

        it('should clear activeChatId if the active chat is deleted', async () => {
            const chatId = await manager.createChat(sessionId, createDefaultChatOptions());
            manager.switchChat(sessionId, chatId);

            expect(manager.getSession(sessionId)!.activeChatId).toBe(chatId);

            manager.deleteChat(chatId);

            expect(manager.getSession(sessionId)!.activeChatId).toBeUndefined();
        });

        it('should not affect activeChatId when deleting a non-active chat', async () => {
            const chatId1 = await manager.createChat(sessionId, createDefaultChatOptions({ name: 'Chat 1' }));
            const chatId2 = await manager.createChat(sessionId, createDefaultChatOptions({ name: 'Chat 2' }));

            manager.switchChat(sessionId, chatId1);
            manager.deleteChat(chatId2);

            expect(manager.getSession(sessionId)!.activeChatId).toBe(chatId1);
        });

        it('should remove chat from session chat list', async () => {
            const chatId = await manager.createChat(sessionId, createDefaultChatOptions());

            manager.deleteChat(chatId);

            const chats = manager.getSessionChats(sessionId);
            expect(chats).toHaveLength(0);
        });
    });

    describe('deleteSession cascade', () => {
        it('should delete all chats when session is deleted', async () => {
            const sessionId = manager.createSession({ name: 'Cascade Session' });
            const chatId1 = await manager.createChat(sessionId, createDefaultChatOptions({ name: 'Chat 1' }));
            const chatId2 = await manager.createChat(sessionId, createDefaultChatOptions({ name: 'Chat 2' }));

            const result = manager.deleteSession(sessionId);

            expect(result).toBe(true);
            expect(manager.getSession(sessionId)).toBeUndefined();
            expect(manager.getChat(chatId1)).toBeUndefined();
            expect(manager.getChat(chatId2)).toBeUndefined();
        });

        it('should return false for non-existent session', () => {
            const result = manager.deleteSession('nonexistent');
            expect(result).toBe(false);
        });

        it('should handle deleting session with no chats', () => {
            const sessionId = manager.createSession({ name: 'Empty Session' });

            const result = manager.deleteSession(sessionId);

            expect(result).toBe(true);
            expect(manager.getSession(sessionId)).toBeUndefined();
        });
    });

    describe('getChat', () => {
        it('should return undefined for non-existent chat', () => {
            expect(manager.getChat('nonexistent')).toBeUndefined();
        });
    });

    describe('default config values', () => {
        it('should use default maxSessions and maxChatsPerSession', () => {
            const defaultManager = new SessionManager();
            // Default is 50 sessions. Create one and verify it works.
            const sid = defaultManager.createSession({ name: 'Default' });
            expect(defaultManager.getSession(sid)).toBeDefined();
        });
    });
});
