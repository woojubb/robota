/**
 * basic-session-usage.ts
 * 
 * This example demonstrates basic usage of @robota-sdk/sessions:
 * - Session management using SessionManager
 * - Create and manage multiple chats within a session
 * - Switch between chats
 * - Session state management
 */

import { SessionManagerImpl } from '@robota-sdk/sessions';

async function main() {
    console.log('📝 Basic Session Management Usage Example');

    // 1. Create session manager
    const sessionManager = new SessionManagerImpl({
        maxActiveSessions: 3,
        autoCleanup: true
    });

    // 2. Create user session
    const session = await sessionManager.createSession('user123', {
        sessionName: 'My Work Session'
    });

    console.log(`✅ Session created: ${session.metadata.sessionName}`);

    // 3. Create chat
    const chat1 = await session.createNewChat({
        chatName: 'General Chat',
        robotaConfig: {
            // Robota configuration (AI provider settings required for actual use)
        }
    });

    console.log(`💬 First chat created: ${chat1.metadata.chatName}`);

    // 4. Send message (AI provider must be configured in practice)
    try {
        // await chat1.sendMessage('Hello!');
        console.log('💡 Message sending feature ready (AI provider configuration required)');
    } catch (error) {
        console.log('⚠️  Skipping message sending due to unconfigured AI provider');
    }

    // 5. Create additional chat
    const chat2 = await session.createNewChat({
        chatName: 'Code Review'
    });

    console.log(`💬 Second chat created: ${chat2.metadata.chatName}`);

    // 6. Switch chat
    await session.switchToChat(chat1.metadata.chatId);
    console.log(`🔄 Switched to first chat`);

    // 7. Check session information
    const stats = session.getStats();
    console.log(`📊 Session statistics:`, {
        'Chat count': stats.chatCount,
        'Total messages': stats.totalMessages,
        'Created at': stats.createdAt.toLocaleString()
    });

    // 8. Session state management
    await session.pause();
    console.log('⏸️  Session paused');

    await session.resume();
    console.log('▶️  Session resumed');

    // 9. Manage multiple sessions
    const session2 = await sessionManager.createSession('user123', {
        sessionName: 'Another Session'
    });

    const userSessions = sessionManager.getUserSessions('user123');
    console.log(`👤 User session count: ${userSessions.length}`);

    // 10. Cleanup
    await sessionManager.shutdown();
    console.log('🧹 Session manager cleanup completed');
}

// Execute
main().catch(error => {
    console.error('Error occurred:', error);
}); 