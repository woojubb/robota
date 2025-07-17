/**
 * @robota-sdk/tools package is deprecated
 * 
 * This package has been deprecated and its functionality has been integrated
 * into @robota-sdk/agents which provides a unified and more powerful tool system.
 * 
 * Please migrate to @robota-sdk/agents:
 * 
 * ```bash
 * npm install @robota-sdk/agents
 * ```
 * 
 * @deprecated Use @robota-sdk/agents instead
 */

// eslint-disable-next-line no-console
console.warn(
  '⚠️  @robota-sdk/tools is deprecated. Please migrate to @robota-sdk/agents for the latest tool management features.'
);

// Re-export tool-related functionality from agents for backward compatibility
// @ts-ignore - Module resolution handled at runtime
export * from '@robota-sdk/agents'; 