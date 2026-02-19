import type { TUniversalValue } from '@robota-sdk/agents';

export interface IBytedanceProviderOptions {
    apiKey: string;
    baseUrl: string;
    createVideoPath?: string;
    getVideoTaskPathTemplate?: string;
    cancelVideoTaskPathTemplate?: string;
    cancelVideoTaskMethod?: 'POST' | 'DELETE';
    timeoutMs?: number;
    defaultHeaders?: Record<string, string>;
}

export interface IBytedanceTaskContentText {
    type: 'text';
    text: string;
}

export interface IBytedanceTaskContentImageUrl {
    type: 'image_url';
    image_url: {
        url: string;
    };
}

export type TBytedanceTaskContent = IBytedanceTaskContentText | IBytedanceTaskContentImageUrl;

export interface IBytedanceCreateVideoTaskRequest {
    model: string;
    content: TBytedanceTaskContent[];
    generate_audio?: boolean;
    ratio?: string;
    duration?: number;
    watermark?: boolean;
}

export interface IBytedanceCreateVideoTaskResponse {
    id: string;
    status?: string;
    created_at?: string | number;
}

export interface IBytedanceTaskContentVideoUrl {
    type: 'video_url';
    video_url: {
        url: string;
    };
}

export interface IBytedanceVideoTaskResponse {
    id: string;
    status: string;
    video_url?: string;
    content?: {
        video_url?: string;
    };
    mime_type?: string;
    bytes?: number;
    error_message?: string;
    created_at?: string | number;
    updated_at?: string | number;
}

export interface IBytedanceApiErrorResponse {
    code?: string;
    message?: string;
    details?: Record<string, TUniversalValue>;
}
