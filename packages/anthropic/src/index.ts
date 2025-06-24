

/**
 * @robota-sdk/anthropic package
 * 
 * Provides Provider implementation for using Anthropic API.
 */

// Import all exports from types.ts and provider.ts
export * from './provider';
export * from './types';
export * from './adapter';
export * from './payload-logger';

// Export modular components (optional - for advanced users)
export { AnthropicStreamHandler } from './streaming/stream-handler';
export { AnthropicResponseParser } from './parsers/response-parser';

import { AnthropicProviderOptions } from './types';

export function createAnthropicProvider(_options: AnthropicProviderOptions) {
    // Implementation of createAnthropicProvider function
} 