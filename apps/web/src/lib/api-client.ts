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
        return await user.getIdToken();
    } catch (error) {
        console.error('Error getting auth token:', error);
        return null;
    }
}

/**
 * Make authenticated API request
 */
async function apiRequest<T = any>(
    endpoint: string,
    options: RequestInit = {}
): Promise<ApiResponse<T>> {
    const token = await getAuthToken();

    const url = `${API_BASE_URL}${endpoint}`;
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> || {}),
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    try {
        const response = await fetch(url, {
            ...options,
            headers,
        });

        const data = await response.json();

        if (!response.ok) {
            throw new ApiClientError(
                data.error || data.message || 'API request failed',
                data.code,
                response.status
            );
        }

        return data;
    } catch (error) {
        if (error instanceof ApiClientError) {
            throw error;
        }

        throw new ApiClientError(
            error instanceof Error ? error.message : 'Network error',
            'NETWORK_ERROR'
        );
    }
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