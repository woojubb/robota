import { auth } from './firebase/config';
import { API_CONFIG } from '@/config/api';

// Base URL for all API endpoints
const API_BASE_URL = API_CONFIG.baseUrl;

// API response types
export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
}

export interface ApiError {
    message: string;
    code?: string;
    status?: number;
}

// Custom error class for API errors
export class ApiClientError extends Error {
    code?: string;
    status?: number;

    constructor(message: string, code?: string, status?: number) {
        super(message);
        this.name = 'ApiClientError';
        this.code = code;
        this.status = status;
    }
}

// Auth redirect callback - can be set by AuthContext
let authRedirectCallback: (() => void) | null = null;

// Toast callback for showing notifications
let toastCallback: ((message: { title: string; description: string; variant?: 'default' | 'destructive' }) => void) | null = null;

export function setAuthRedirectCallback(callback: (() => void) | null) {
    authRedirectCallback = callback;
}

export function setToastCallback(callback: ((message: { title: string; description: string; variant?: 'default' | 'destructive' }) => void) | null) {
    toastCallback = callback;
}

/**
 * Get Firebase Auth token for API calls
 */
async function getAuthToken(forceRefresh = false): Promise<string | null> {
    const user = auth.currentUser;
    if (!user) return null;

    try {
        // Wait a bit for auth to settle if we're forcing refresh
        if (forceRefresh) {
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        return await user.getIdToken(forceRefresh);
    } catch (error) {
        console.error('Error getting auth token:', error);
        return null;
    }
}

/**
 * Handle authentication errors
 */
function handleAuthError(status: number, error: ApiClientError) {
    if (status === 401 || status === 403) {
        console.warn('Authentication failed, handling auth error:', error.message);

        // Call auth redirect callback if available
        if (authRedirectCallback) {
            authRedirectCallback();
        } else {
            // Fallback: redirect to login page
            if (typeof window !== 'undefined') {
                const currentPath = window.location.pathname;
                const redirectUrl = currentPath !== '/auth/login' && currentPath !== '/'
                    ? `?redirect=${encodeURIComponent(currentPath)}`
                    : '';
                window.location.href = `/auth/login${redirectUrl}`;
            }
        }
    }
    throw error;
}

/**
 * Check if we should attempt token refresh
 */
function shouldAttemptTokenRefresh(error: ApiClientError, hasTriedTokenRefresh: boolean): boolean {
    // Don't attempt refresh if we already tried
    if (hasTriedTokenRefresh) {
        return false;
    }

    // Don't attempt refresh if there's no current user
    if (!auth.currentUser) {
        return false;
    }

    // Only attempt refresh for 401/403 errors
    if (error.status !== 401 && error.status !== 403) {
        return false;
    }

    return true;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Make authenticated API request with retry logic
 */
async function apiRequest<T = any>(
    endpoint: string,
    options: RequestInit = {}
): Promise<ApiResponse<T>> {
    const { retry } = API_CONFIG;
    let lastError: Error | null = null;
    let hasTriedTokenRefresh = false;

    for (let attempt = 0; attempt <= retry.count; attempt++) {
        try {
            // Try to get token (force refresh on auth errors after first attempt)
            const shouldForceRefresh = hasTriedTokenRefresh || (attempt > 0 && lastError instanceof ApiClientError && (lastError.status === 401 || lastError.status === 403));
            const token = await getAuthToken(shouldForceRefresh);

            const url = `${API_BASE_URL}${endpoint}`;
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                ...(options.headers as Record<string, string> || {}),
            };

            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.timeout);

            try {
                const response = await fetch(url, {
                    ...options,
                    headers,
                    signal: controller.signal,
                });

                clearTimeout(timeoutId);

                const data = await response.json();

                if (!response.ok) {
                    const error = new ApiClientError(
                        data.error || data.message || 'API request failed',
                        data.code,
                        response.status
                    );

                    // Handle authentication errors
                    if (response.status === 401 || response.status === 403) {
                        // Check if we should attempt token refresh
                        if (shouldAttemptTokenRefresh(error, hasTriedTokenRefresh)) {
                            hasTriedTokenRefresh = true;
                            lastError = error;
                            console.log('Authentication failed, attempting token refresh...');

                            // Show toast for token refresh attempt
                            if (toastCallback) {
                                toastCallback({
                                    title: "Refreshing session",
                                    description: "Your session expired. Attempting to refresh...",
                                    variant: "default"
                                });
                            }

                            // Wait a bit before retrying
                            await sleep(1000);
                            continue;
                        } else {
                            // Token refresh didn't work or can't be attempted, handle auth error
                            console.log('Token refresh failed or not possible, redirecting to login');
                            handleAuthError(response.status, error);
                        }
                    }

                    // Don't retry on other 4xx errors
                    if (response.status >= 400 && response.status < 500) {
                        throw error;
                    }

                    lastError = error;

                    // If this is the last attempt, throw the error
                    if (attempt === retry.count) {
                        throw error;
                    }

                    // Wait before retrying with exponential backoff
                    const delay = retry.delay * Math.pow(retry.backoff, attempt);
                    await sleep(delay);
                    continue;
                }

                // Success - clear any previous auth error toasts
                return data;
            } catch (fetchError) {
                clearTimeout(timeoutId);

                if (fetchError instanceof ApiClientError) {
                    throw fetchError;
                }

                // Handle network errors
                if (fetchError instanceof Error && fetchError.name === 'AbortError') {
                    lastError = new Error('Request timeout');
                } else {
                    lastError = fetchError instanceof Error ? fetchError : new Error('Network error');
                }

                // If this is the last attempt, throw the error
                if (attempt === retry.count) {
                    const errorMessage = lastError.message === 'Request timeout'
                        ? 'Request timed out. Please check your connection and try again.'
                        : 'Network error. Please check your connection and try again.';

                    throw new ApiClientError(
                        errorMessage,
                        lastError.message === 'Request timeout' ? 'TIMEOUT_ERROR' : 'NETWORK_ERROR'
                    );
                }

                // Wait before retrying
                const delay = retry.delay * Math.pow(retry.backoff, attempt);
                await sleep(delay);
            }
        } catch (error) {
            if (error instanceof ApiClientError) {
                throw error;
            }

            lastError = error instanceof Error ? error : new Error('Unknown error');

            // If this is the last attempt, throw the error
            if (attempt === retry.count) {
                throw new ApiClientError(
                    lastError.message,
                    'UNKNOWN_ERROR'
                );
            }

            // Wait before retrying
            const delay = retry.delay * Math.pow(retry.backoff, attempt);
            await sleep(delay);
        }
    }

    // This should never be reached, but just in case
    throw new ApiClientError(
        lastError?.message || 'Max retries exceeded',
        'MAX_RETRIES_EXCEEDED'
    );
}

/**
 * API client with methods for all endpoints
 */
export const apiClient = {
    // User endpoints
    user: {
        getProfile: () => apiRequest('/user/profile'),
        updateProfile: (data: any) => apiRequest('/user/profile', {
            method: 'PUT',
            body: JSON.stringify(data),
        }),
        getCredits: () => apiRequest('/user/credits'),
        getTransactions: (params?: { page?: number; limit?: number }) => {
            const queryParams = new URLSearchParams();
            if (params?.page) queryParams.append('page', params.page.toString());
            if (params?.limit) queryParams.append('limit', params.limit.toString());
            const query = queryParams.toString();
            return apiRequest(`/user/transactions${query ? `?${query}` : ''}`);
        },
    },

    // Chat endpoints
    chat: {
        completions: (data: any) => apiRequest('/chat/completions', {
            method: 'POST',
            body: JSON.stringify(data),
        }),
    },

    // Agent endpoints
    agents: {
        create: (data: any) => apiRequest('/agents/create', {
            method: 'POST',
            body: JSON.stringify(data),
        }),
        run: (agentId: string, data: any) => apiRequest(`/agents/${agentId}/run`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),
        list: () => apiRequest('/agents'),
        get: (agentId: string) => apiRequest(`/agents/${agentId}`),
        update: (agentId: string, data: any) => apiRequest(`/agents/${agentId}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),
        delete: (agentId: string) => apiRequest(`/agents/${agentId}`, {
            method: 'DELETE',
        }),
    },

    // Tool endpoints
    tools: {
        execute: (toolId: string, data: any) => apiRequest(`/tools/${toolId}/execute`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),
        list: () => apiRequest('/tools'),
    },

    // Health check
    health: () => apiRequest('/health'),
}; 