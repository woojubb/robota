/**
 * HTTP Types - Atomic HTTP Definitions
 *
 * Single responsibility: Define only HTTP-related types
 */

import type { TUniversalValue } from '@robota-sdk/agent-core';

// HTTP methods
export type THttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

// Basic HTTP headers
export interface IHttpHeaders {
  'Content-Type'?: string;
  Authorization?: string;
  [key: string]: string | undefined;
}

// Default data structure for requests - flexible JSON-serializable data
export type TDefaultRequestData = Record<string, TUniversalValue>;

// HTTP request structure
export interface IHttpRequest<TData = TDefaultRequestData> {
  id: string;
  url: string;
  method: THttpMethod;
  headers: IHttpHeaders;
  data?: TData;
}

// HTTP response structure
export interface IHttpResponse<TData = TDefaultRequestData> {
  id: string;
  status: number;
  headers: Record<string, string>;
  data: TData;
  timestamp: Date;
}

// HTTP error structure
export interface IHttpError {
  code: string;
  message: string;
  status?: number;
  details?: Record<string, string | number | boolean>;
}
