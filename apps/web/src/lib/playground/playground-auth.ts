/**
 * Playground Authentication System
 * 
 * Manages user authentication and token generation for secure
 * RemoteExecutor communication with the backend API.
 */

import { auth } from '@/lib/firebase/config';
import { User } from 'firebase/auth';

interface PlaygroundSession {
    userToken: string;
    expiresAt: Date;
    userId: string;
    email?: string;
    permissions: string[];
}

export interface PlaygroundCredentials {
    serverUrl: string;
    userApiKey: string;
    sessionId: string;
}

/**
 * Generate secure user token for playground execution
 */
export async function generatePlaygroundToken(user: User): Promise<string> {
    try {
        // Get Firebase ID token for authentication
        const idToken = await user.getIdToken();

        // Call API to exchange Firebase token for playground-specific token
        const apiUrl = process.env.NEXT_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '');
        const response = await fetch(`${apiUrl}/api/v1/auth/playground-token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                userId: user.uid,
                email: user.email
            })
        });

        if (!response.ok) {
            throw new Error('Failed to generate playground token');
        }

        const { token } = await response.json();
        return token;

    } catch (error) {
        console.error('Error generating playground token:', error);
        // Fallback to demo token for development
        return `playground-demo-${user.uid}-${Date.now()}`;
    }
}

/**
 * Create playground credentials for RemoteExecutor
 */
export async function createPlaygroundCredentials(user: User | null): Promise<PlaygroundCredentials> {
    // Validate required environment variables
    const serverUrl = process.env.NEXT_PUBLIC_PLAYGROUND_SERVER_URL || process.env.NEXT_PUBLIC_API_URL;

    if (!serverUrl) {
        throw new Error(
            'Missing required environment variable: NEXT_PUBLIC_PLAYGROUND_SERVER_URL or NEXT_PUBLIC_API_URL. ' +
            'Please check your .env.local file.'
        );
    }

    if (!user) {
        // Anonymous/demo mode
        return {
            serverUrl,
            userApiKey: 'demo-token-anonymous',
            sessionId: `demo-${Date.now()}`
        };
    }

    try {
        const userToken = await generatePlaygroundToken(user);

        return {
            serverUrl,
            userApiKey: userToken,
            sessionId: `session-${user.uid}-${Date.now()}`
        };

    } catch (error) {
        console.error('Error creating playground credentials:', error);

        // Fallback credentials
        return {
            serverUrl,
            userApiKey: `fallback-${user.uid}`,
            sessionId: `fallback-${Date.now()}`
        };
    }
}

/**
 * Validate playground session
 */
export function validatePlaygroundSession(session: PlaygroundSession): boolean {
    return (
        !!session.userToken &&
        session.expiresAt > new Date() &&
        !!session.userId &&
        Array.isArray(session.permissions)
    );
}

/**
 * Get current user from Firebase Auth
 */
export function getCurrentUser(): Promise<User | null> {
    return new Promise((resolve) => {
        const unsubscribe = auth.onAuthStateChanged((user) => {
            unsubscribe();
            resolve(user);
        });
    });
}

/**
 * Check if user has playground access
 */
export async function hasPlaygroundAccess(user: User | null): Promise<{
    hasAccess: boolean;
    reason?: string;
    subscription?: string;
    needsEmailVerification?: boolean;
}> {
    if (!user) {
        return { hasAccess: true }; // Allow anonymous demo access
    }

    try {
        // Check user permissions/subscription status
        const idToken = await user.getIdToken();

        const response = await fetch('/api/v1/auth/playground-access', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${idToken}`
            }
        });

        if (!response.ok) {
            console.warn('Could not verify playground access, allowing for now');
            return { hasAccess: true }; // Allow access by default during development
        }

        const data = await response.json();

        return {
            hasAccess: data.hasAccess,
            reason: data.reason,
            subscription: data.subscription,
            needsEmailVerification: data.reason === 'Email not verified'
        };

    } catch (error) {
        console.error('Error checking playground access:', error);
        return { hasAccess: true }; // Allow access by default if check fails
    }
}

/**
 * Initialize playground authentication
 */
export async function initializePlaygroundAuth(): Promise<{
    credentials: PlaygroundCredentials | null;
    accessInfo?: {
        hasAccess: boolean;
        reason?: string;
        subscription?: string;
        needsEmailVerification?: boolean;
    };
}> {
    try {
        const user = await getCurrentUser();

        // Check if user has playground access
        const accessInfo = await hasPlaygroundAccess(user);
        if (!accessInfo.hasAccess) {
            return {
                credentials: null,
                accessInfo
            };
        }

        // Create credentials
        const credentials = await createPlaygroundCredentials(user);

        // Store session info
        sessionStorage.setItem('playground-session', JSON.stringify({
            userToken: credentials.userApiKey,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
            userId: user?.uid || 'anonymous',
            email: user?.email,
            permissions: ['playground:execute', 'playground:chat']
        } as PlaygroundSession));

        return {
            credentials,
            accessInfo
        };

    } catch (error) {
        console.error('Error initializing playground auth:', error);
        return {
            credentials: null,
            accessInfo: {
                hasAccess: false,
                reason: error instanceof Error ? error.message : 'Authentication failed'
            }
        };
    }
}

/**
 * Refresh playground credentials
 */
export async function refreshPlaygroundCredentials(): Promise<PlaygroundCredentials | null> {
    try {
        // Check if session is still valid
        const sessionData = sessionStorage.getItem('playground-session');
        if (sessionData) {
            const session: PlaygroundSession = JSON.parse(sessionData);
            if (validatePlaygroundSession(session)) {
                const user = await getCurrentUser();
                return createPlaygroundCredentials(user);
            }
        }

        // Re-initialize if session is invalid
        return await initializePlaygroundAuth();

    } catch (error) {
        console.error('Error refreshing playground credentials:', error);
        return null;
    }
}

/**
 * Cleanup playground session
 */
export function cleanupPlaygroundSession(): void {
    sessionStorage.removeItem('playground-session');
}

/**
 * Get usage limits for current user
 */
export async function getPlaygroundLimits(user: User | null): Promise<{
    dailyExecutions: number;
    maxConcurrentSessions: number;
    allowedProviders: string[];
    maxTokens: number;
}> {
    if (!user) {
        // Anonymous user limits
        return {
            dailyExecutions: 10,
            maxConcurrentSessions: 1,
            allowedProviders: ['openai'],
            maxTokens: 1000
        };
    }

    try {
        const idToken = await user.getIdToken();

        const apiUrl = process.env.NEXT_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '');
        const response = await fetch(`${apiUrl}/api/v1/auth/playground-limits`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${idToken}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch limits');
        }

        return await response.json();

    } catch (error) {
        console.error('Error fetching playground limits:', error);

        // Default limits for authenticated users
        return {
            dailyExecutions: 100,
            maxConcurrentSessions: 3,
            allowedProviders: ['openai', 'anthropic', 'google'],
            maxTokens: 4000
        };
    }
} 