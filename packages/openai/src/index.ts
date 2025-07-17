/**
 * @robota-sdk/openai package
 * 
 * Provides Provider implementation for using OpenAI API.
 */

// Export main provider (new architecture)
export { OpenAIProvider } from './provider';

// Export types and utilities
export * from './types';
export * from './adapter';

// Export payload logging interfaces only (implementations are in separate subpaths)
export type { PayloadLogger, PayloadLoggerOptions } from './interfaces/payload-logger';

// Export modular components (optional - for advanced users)
// export { OpenAIStreamHandler } from './streaming/stream-handler';
// export { OpenAIResponseParser } from './parsers/response-parser'; 