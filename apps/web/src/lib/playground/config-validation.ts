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

    // Check if playground is enabled
    const enabled = process.env.NEXT_PUBLIC_PLAYGROUND_ENABLED === 'true';

    if (!enabled) {
        return {
            enabled: false,
            serverUrl: '',
            apiUrl: '',
            features: {
                remoteExecution: false,
                streaming: false,
                tools: false
            }
        };
    }

    // Validate required URLs
    const serverUrl = process.env.NEXT_PUBLIC_PLAYGROUND_SERVER_URL || process.env.NEXT_PUBLIC_API_URL;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;

    if (!serverUrl) {
        errors.push('NEXT_PUBLIC_PLAYGROUND_SERVER_URL or NEXT_PUBLIC_API_URL is required when playground is enabled');
    }

    if (!apiUrl) {
        errors.push('NEXT_PUBLIC_API_URL is required when playground is enabled');
    }

    // Validate URL format
    if (serverUrl) {
        try {
            new URL(serverUrl);
        } catch {
            errors.push('NEXT_PUBLIC_PLAYGROUND_SERVER_URL must be a valid URL');
        }
    }

    if (apiUrl) {
        try {
            new URL(apiUrl);
        } catch {
            errors.push('NEXT_PUBLIC_API_URL must be a valid URL');
        }
    }

    if (errors.length > 0) {
        throw new Error(
            `Playground configuration validation failed:\n${errors.map(e => `- ${e}`).join('\n')}\n\n` +
            'Please check your .env.local file and ensure all required environment variables are set correctly.'
        );
    }

    return {
        enabled,
        serverUrl: serverUrl!,
        apiUrl: apiUrl!,
        features: {
            remoteExecution: process.env.NEXT_PUBLIC_FEATURES_REMOTE_EXECUTION === 'true',
            streaming: process.env.NEXT_PUBLIC_FEATURES_STREAMING === 'true',
            tools: process.env.NEXT_PUBLIC_FEATURES_TOOLS === 'true'
        }
    };
}

/**
 * Get playground configuration with validation
 */
export function getPlaygroundConfig(): PlaygroundConfig {
    try {
        return validatePlaygroundConfig();
    } catch (error) {
        console.error('Playground configuration error:', error);

        // Return disabled configuration on validation failure
        return {
            enabled: false,
            serverUrl: '',
            apiUrl: '',
            features: {
                remoteExecution: false,
                streaming: false,
                tools: false
            }
        };
    }
}

/**
 * Check if playground feature is enabled
 */
export function isFeatureEnabled(feature: keyof PlaygroundConfig['features']): boolean {
    try {
        const config = validatePlaygroundConfig();
        return config.enabled && config.features[feature];
    } catch {
        return false;
    }
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