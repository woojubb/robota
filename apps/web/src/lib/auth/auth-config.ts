/**
 * Authentication configuration based on environment variables
 */
export interface AuthConfig {
    enableGoogleLogin: boolean;
    enableGitHubLogin: boolean;
    enableSocialLogin: boolean;
    enableEmailLogin: boolean;
}

/**
 * Get authentication configuration from environment variables
 */
export function getAuthConfig(): AuthConfig {
    return {
        enableGoogleLogin: process.env.NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN === 'true',
        enableGitHubLogin: process.env.NEXT_PUBLIC_ENABLE_GITHUB_LOGIN === 'true',
        enableSocialLogin: process.env.NEXT_PUBLIC_ENABLE_SOCIAL_LOGIN === 'true',
        enableEmailLogin: process.env.NEXT_PUBLIC_ENABLE_EMAIL_LOGIN !== 'false', // Default to true
    };
}

/**
 * Check if any social login is enabled
 */
export function isSocialLoginEnabled(): boolean {
    const config = getAuthConfig();
    return config.enableSocialLogin && (config.enableGoogleLogin || config.enableGitHubLogin);
}

/**
 * Check if specific social provider is enabled
 */
export function isProviderEnabled(provider: 'google' | 'github'): boolean {
    const config = getAuthConfig();

    if (!config.enableSocialLogin) {
        return false;
    }

    switch (provider) {
        case 'google':
            return config.enableGoogleLogin;
        case 'github':
            return config.enableGitHubLogin;
        default:
            return false;
    }
}

/**
 * Get enabled social providers
 */
export function getEnabledProviders(): string[] {
    const config = getAuthConfig();
    const providers: string[] = [];

    if (config.enableSocialLogin) {
        if (config.enableGoogleLogin) providers.push('google');
        if (config.enableGitHubLogin) providers.push('github');
    }

    return providers;
} 