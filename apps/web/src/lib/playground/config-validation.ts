/**
 * Playground Configuration Validation
 * 
 * Validates and provides type-safe access to playground configuration
 * from environment variables.
 */

export interface PlaygroundConfig {
    enabled: boolean;
    serverUrl: string;
    apiUrl: string;
    features: {
        remoteExecution: boolean;
        streaming: boolean;
        tools: boolean;
    };
}

/**
 * Validate and parse playground configuration from environment variables
 */
export function validatePlaygroundConfig(): PlaygroundConfig {
    const errors: string[] = [];

    // Playground is always enabled - no environment variable check needed
    const enabled = true;

    // Validate required URLs with sensible defaults
    const serverUrl = process.env.NEXT_PUBLIC_PLAYGROUND_SERVER_URL ||
        process.env.NEXT_PUBLIC_API_URL ||
        'http://localhost:3001';
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

    // Validate URL format if provided
    if (serverUrl && serverUrl !== 'http://localhost:3001') {
        try {
            new URL(serverUrl);
        } catch {
            console.warn('Invalid serverUrl provided, using default localhost:3001');
        }
    }

    if (apiUrl && apiUrl !== 'http://localhost:3001') {
        try {
            new URL(apiUrl);
        } catch {
            console.warn('Invalid apiUrl provided, using default localhost:3001');
        }
    }

    return {
        enabled,
        serverUrl,
        apiUrl,
        features: {
            remoteExecution: true,  // Always enabled
            streaming: true,        // Always enabled
            tools: true            // Always enabled
        }
    };
}

/**
 * Get playground configuration with validation
 */
export function getPlaygroundConfig(): PlaygroundConfig {
    return validatePlaygroundConfig();
}

/**
 * Check if playground feature is enabled
 */
export function isFeatureEnabled(feature: keyof PlaygroundConfig['features']): boolean {
    const config = validatePlaygroundConfig();
    return config.enabled && config.features[feature];
}

/**
 * Validate Firebase configuration for playground
 */
export function validateFirebaseConfig(): {
    valid: boolean;
    missingVars: string[];
} {
    const requiredVars = [
        'NEXT_PUBLIC_FIREBASE_API_KEY',
        'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
        'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
        'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
        'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
        'NEXT_PUBLIC_FIREBASE_APP_ID'
    ];

    const missingVars = requiredVars.filter(varName => !process.env[varName]);

    return {
        valid: missingVars.length === 0,
        missingVars
    };
}

/**
 * Development helper to log configuration status
 */
export function logConfigurationStatus(): void {
    if (process.env.NODE_ENV !== 'development') return;

    console.group('🔧 Playground Configuration');

    try {
        const config = validatePlaygroundConfig();
        console.log('✅ Configuration valid');
        console.log('📍 Server URL:', config.serverUrl);
        console.log('🔗 API URL:', config.apiUrl);
        console.log('🎮 Features:', config.features);
    } catch (error) {
        console.error('❌ Configuration invalid:', error);
    }

    const firebaseConfig = validateFirebaseConfig();
    if (firebaseConfig.valid) {
        console.log('🔥 Firebase: Configured');
    } else {
        console.warn('⚠️ Firebase: Missing variables:', firebaseConfig.missingVars);
    }

    console.groupEnd();
} 