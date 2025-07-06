/**
 * @robota-sdk/core package is deprecated
 * 
 * This package has been deprecated and replaced with @robota-sdk/agents
 * which provides a more modern and flexible architecture.
 * 
 * Please migrate to @robota-sdk/agents:
 * 
 * ```bash
 * npm install @robota-sdk/agents
 * ```
 * 
 * @deprecated Use @robota-sdk/agents instead
 */

console.warn(
    '⚠️  @robota-sdk/core is deprecated. Please migrate to @robota-sdk/agents for the latest features and improvements.'
);

// Re-export everything from agents for backward compatibility
// @ts-ignore - Module resolution handled at runtime
export * from '@robota-sdk/agents'; 