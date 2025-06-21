import { SessionManager } from './session-manager';
import type { SessionOptions, SessionManagerConfig } from './types';

/**
 * Create a SessionManager with simplified configuration
 * 
 * @description
 * Convenience function for creating a SessionManager instance.
 * Similar to createTeam in the team package.
 * 
 * @example
 * ```typescript
 * import { createSessionManager } from '@robota-sdk/sessions';
 * import { OpenAIProvider } from '@robota-sdk/openai';
 * 
 * const openaiProvider = new OpenAIProvider({ apiKey: 'your-key' });
 * 
 * const sessionManager = createSessionManager({
 *   aiProviders: { openai: openaiProvider },
 *   maxActiveSessions: 10,
 *   debug: true
 * });
 * 
 * const session = await sessionManager.createSession('user123', {
 *   name: 'My Chat Session',
 *   maxChats: 5
 * });
 * 
 * const chat = await session.createChat({
 *   name: 'General Chat',
 *   robotaConfig: {
 *     provider: 'openai',
 *     model: 'gpt-4',
 *     systemMessage: 'You are a helpful assistant.'
 *   }
 * });
 * 
 * const response = await chat.run('Hello!');
 * ```
 */
export function createSessionManager(options: SessionOptions): SessionManager {
    const config: SessionManagerConfig = {
        maxActiveSessions: options.maxActiveSessions || 50,
        autoCleanup: true,
        cleanupInterval: 3600000, // 1 hour
        memoryThreshold: 500, // 500MB
        debug: options.debug || false
    };

    if (options.debug) {
        console.log('Creating SessionManager with options:', options);
    }

    return new SessionManager(config);
}

/**
 * Create a simple session for quick testing
 * 
 * @description
 * Convenience function for creating a simple session with minimal configuration.
 * Useful for testing and prototyping.
 * 
 * @example
 * ```typescript
 * import { createSimpleSession } from '@robota-sdk/sessions';
 * import { OpenAIProvider } from '@robota-sdk/openai';
 * 
 * const openaiProvider = new OpenAIProvider({ apiKey: 'your-key' });
 * 
 * const { session, chat } = await createSimpleSession('user123', {
 *   aiProviders: { openai: openaiProvider },
 *   robotaConfig: {
 *     provider: 'openai',
 *     model: 'gpt-4'
 *   }
 * });
 * 
 * const response = await chat.run('Hello!');
 * ```
 */
export async function createSimpleSession(
    userId: string,
    options: SessionOptions & { robotaConfig?: any }
) {
    const sessionManager = createSessionManager(options);

    const session = await sessionManager.createSession(userId, {
        name: 'Simple Session',
        maxChats: options.maxChats || 10,
        debug: options.debug
    });

    const chat = await session.createChat({
        name: 'Main Chat',
        robotaConfig: options.robotaConfig
    });

    return {
        sessionManager,
        session,
        chat
    };
} 