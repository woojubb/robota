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

/**
 * Get Firebase Auth token for API calls
 */
async function getAuthToken(): Promise<string | null> {
    const user = auth.currentUser;
    if (!user) return null;

    try {
        return await user.getIdToken(true); // Force refresh
    } catch (error) {
        console.error('Error getting auth token:', error);
        return null;
    }
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

    for (let attempt = 0; attempt <= retry.count; attempt++) {
        try {
            const token = await getAuthToken();

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

                    // Don't retry on 4xx errors (except 401/403 which might be token issues)
                    if (response.status >= 400 && response.status < 500 &&
                        response.status !== 401 && response.status !== 403) {
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

                return data;
            } catch (fetchError) {
                clearTimeout(timeoutId);

                if (fetchError instanceof ApiClientError) {
                    throw fetchError;
                }

                lastError = fetchError instanceof Error ? fetchError : new Error('Network error');

                // If this is the last attempt, throw the error
                if (attempt === retry.count) {
                    throw new ApiClientError(
                        lastError.message,
                        'NETWORK_ERROR'
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