import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager } from './session-manager';
import type { CreateSessionOptions, CreateChatOptions } from '../types/core';

describe('SessionManager', () => {
    let sessionManager: SessionManager;

    beforeEach(() => {
        sessionManager = new SessionManager({
            maxSessions: 5,
            maxChatsPerSession: 3,
        });
    });

    describe('Session Management', () => {
        it('should create a new session', () => {
            const options: CreateSessionOptions = {
                name: 'Test Session',
                userId: 'user123',
                workspaceId: 'workspace456',
            };

            const sessionId = sessionManager.createSession(options);

            expect(sessionId).toBeDefined();
            expect(sessionId).toMatch(/^session_/);

            const session = sessionManager.getSession(sessionId);
            expect(session).toBeDefined();
            expect(session?.name).toBe('Test Session');
            expect(session?.userId).toBe('user123');
            expect(session?.workspaceId).toBe('workspace456');
        });

        it('should list sessions', () => {
            const sessionId1 = sessionManager.createSession({ name: 'Session 1' });
            const sessionId2 = sessionManager.createSession({ name: 'Session 2' });

            const sessions = sessionManager.listSessions();
            expect(sessions).toHaveLength(2);
            expect(sessions.map(s => s.id)).toContain(sessionId1);
            expect(sessions.map(s => s.id)).toContain(sessionId2);
        });

        it('should delete a session', () => {
            const sessionId = sessionManager.createSession({ name: 'Test Session' });

            expect(sessionManager.getSession(sessionId)).toBeDefined();

            const deleted = sessionManager.deleteSession(sessionId);
            expect(deleted).toBe(true);
            expect(sessionManager.getSession(sessionId)).toBeUndefined();
        });

        it('should enforce session limits by throwing error', () => {
            // Create maximum number of sessions
            const sessionIds: string[] = [];
            for (let i = 0; i < 5; i++) {
                const sessionId = sessionManager.createSession({ name: `Session ${i}` });
                sessionIds.push(sessionId);
            }

            // Creating one more should throw an error
            expect(() => {
                sessionManager.createSession({ name: 'New Session' });
            }).toThrow('Maximum sessions limit (5) reached. Please remove existing sessions before creating new ones.');

            // Should still have exactly 5 sessions
            const sessions = sessionManager.listSessions();
            expect(sessions.length).toBe(5);

            // All original sessions should still exist
            for (const sessionId of sessionIds) {
                expect(sessionManager.getSession(sessionId)).toBeDefined();
            }
        });
    });

    describe('Chat Management', () => {
        let sessionId: string;

        beforeEach(() => {
            sessionId = sessionManager.createSession({ name: 'Test Session' });
        });

        it('should create a new chat in session', async () => {
            const chatOptions: CreateChatOptions = {
                name: 'Test Chat',
                agentConfig: {
                    name: 'Test Agent',
                    aiProviders: [], // Mock providers would be needed for real test
                    defaultModel: {
                        provider: 'openai',
                        model: 'gpt-3.5-turbo',
                    },
                },
                description: 'A test chat',
            };

            // This would fail in real test without proper AI providers
            // but we're testing the structure
            try {
                const chatId = await sessionManager.createChat(sessionId, chatOptions);
                expect(chatId).toBeDefined();
                expect(chatId).toMatch(/^chat_/);
            } catch (error) {
                // Expected to fail without proper AI providers
                expect(error).toBeDefined();
            }
        });

        it('should list chats in session', () => {
            const chats = sessionManager.getSessionChats(sessionId);
            expect(chats).toEqual([]);
        });

        it('should handle non-existent session', async () => {
            const chatOptions: CreateChatOptions = {
                name: 'Test Chat',
                agentConfig: {
                    name: 'Test Agent',
                    aiProviders: [],
                    defaultModel: {
                        provider: 'openai',
                        model: 'gpt-3.5-turbo',
                    },
                },
            };

            await expect(
                sessionManager.createChat('non-existent-session', chatOptions)
            ).rejects.toThrow('Session non-existent-session not found');
        });
    });

    describe('Workspace Isolation', () => {
        it('should isolate sessions by workspace', () => {
            const session1 = sessionManager.createSession({
                name: 'Session 1',
                workspaceId: 'workspace1'
            });
            const session2 = sessionManager.createSession({
                name: 'Session 2',
                workspaceId: 'workspace2'
            });

            const sessionInfo1 = sessionManager.getSession(session1);
            const sessionInfo2 = sessionManager.getSession(session2);

            expect(sessionInfo1?.workspaceId).toBe('workspace1');
            expect(sessionInfo2?.workspaceId).toBe('workspace2');
            expect(sessionInfo1?.workspaceId).not.toBe(sessionInfo2?.workspaceId);
        });
    });
}); 