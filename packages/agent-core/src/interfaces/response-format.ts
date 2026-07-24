import type { TConfigValue } from './types';

/**
 * Response format configuration
 */
export interface IResponseFormatConfig {
  type?: 'text' | 'json_object' | 'json_schema';
  /** JSON schema payload; required when `type` is `'json_schema'` (CORE-015). */
  schema?: Record<string, TConfigValue>;
  /** Schema name forwarded to provider native structured-output surfaces. */
  name?: string;
}

/**
 * Safety setting configuration
 */
export interface ISafetySetting {
  category: string;
  threshold: string;
  [key: string]: TConfigValue;
}
