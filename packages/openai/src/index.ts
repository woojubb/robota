/**
 * @robota-sdk/openai package
 * 
 * Provides Provider implementation for using OpenAI API.
 */

// Export main provider (new architecture)
export { OpenAIProvider, ChatOptions } from './provider';

// Export types and utilities
export * from './types';
export * from './adapter';
export { PayloadLogger } from './payload-logger';

// Export modular components (optional - for advanced users)
// export { OpenAIStreamHandler } from './streaming/stream-handler';
// export { OpenAIResponseParser } from './parsers/response-parser'; 