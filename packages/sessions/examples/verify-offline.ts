import { AbstractAIProvider } from '@robota-sdk/agents';
import type { IChatOptions, TUniversalMessage } from '@robota-sdk/agents';
import { SessionManager } from '../src/session/session-manager';

class MockAIProvider extends AbstractAIProvider {
    override readonly name = 'mock-provider';
    override readonly version = '1.0.0';

    override async chat(messages: TUniversalMessage[], _options?: IChatOptions): Promise<TUniversalMessage> {
        const last = messages.at(-1);
        const content = typeof last?.content === 'string' ? last.content : '';

        return {
            role: 'assistant',
            content: `session:${content}`,
            timestamp: new Date(),
        };
    }

    override async *chatStream(_messages: TUniversalMessage[], _options?: IChatOptions): AsyncIterable<TUniversalMessage> {
        yield {
            role: 'assistant',
            content: 'session-stream',
            timestamp: new Date(),
        };
    }
}

async function main(): Promise<void> {
    const sessionManager = new SessionManager({
        maxSessions: 2,
        maxChatsPerSession: 2,
    });

    const sessionId = sessionManager.createSession({
        name: 'Offline Session',
        workspaceId: 'workspace-offline',
    });
    const chatId = await sessionManager.createChat(sessionId, {
        name: 'Offline Chat',
        agentConfig: {
            name: 'Offline Chat',
            aiProviders: [new MockAIProvider()],
            defaultModel: {
                provider: 'mock-provider',
                model: 'offline-model',
            },
            logging: {
                enabled: false,
                level: 'silent',
            },
        },
    });

    if (!sessionManager.switchChat(sessionId, chatId)) {
        throw new Error('Failed to activate created chat.');
    }

    const chat = sessionManager.getChat(chatId);
    if (!chat) {
        throw new Error('Created chat was not found.');
    }

    const response = await chat.sendMessage('verify-session-run');
    if (response !== 'session:verify-session-run') {
        throw new Error(`Unexpected session response: ${response}`);
    }

    const chats = sessionManager.getSessionChats(sessionId);
    if (chats.length !== 1 || chats[0]?.isActive !== true) {
        throw new Error('Session chat state is inconsistent after activation.');
    }

    if (!sessionManager.deleteSession(sessionId)) {
        throw new Error('Failed to delete verified session.');
    }

    process.stdout.write('sessions offline verify passed.\n');
}

void main();
