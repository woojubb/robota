import type { TUniversalValue } from '@robota-sdk/agents';

export interface IBytedanceProviderOptions {
    apiKey: string;
    baseUrl: string;
    createVideoPath?: string;
    getVideoJobPathTemplate?: string;
    cancelVideoJobPathTemplate?: string;
    timeoutMs?: number;
    defaultHeaders?: Record<string, string>;
}

export interface IBytedanceCreateVideoResponse {
    jobId: string;
    status: string;
    createdAt?: string;
}

export interface IBytedanceVideoJobResponse {
    jobId: string;
    status: string;
    outputUrl?: string;
    mimeType?: string;
    bytes?: number;
    errorMessage?: string;
    updatedAt?: string;
}

export interface IBytedanceApiErrorResponse {
    code?: string;
    message?: string;
    details?: Record<string, TUniversalValue>;
}
