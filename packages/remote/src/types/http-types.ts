/**
 * HTTP Types - Atomic HTTP Definitions
 * 
 * Single responsibility: Define only HTTP-related types
 */

// HTTP methods
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

// Basic HTTP headers
export interface HttpHeaders {
    'Content-Type'?: string;
    'Authorization'?: string;
    [key: string]: string | undefined;
}

// Default data structure for requests - flexible JSON-serializable data
export interface DefaultRequestData {
    [key: string]: any; // 더 유연한 타입으로 변경
}

// HTTP request structure
export interface HttpRequest<TData = DefaultRequestData> {
    id: string;
    url: string;
    method: HttpMethod;
    headers: HttpHeaders;
    data?: TData;
}

// HTTP response structure
export interface HttpResponse<TData = DefaultRequestData> {
    id: string;
    status: number;
    headers: Record<string, string>;
    data: TData;
    timestamp: Date;
}

// HTTP error structure
export interface HttpError {
    code: string;
    message: string;
    status?: number;
    details?: Record<string, string | number | boolean>;
} 