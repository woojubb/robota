import type { IExecutor, TProviderOptionValueBase } from '@robota-sdk/agent-core';

/**
 * Valid provider option value types
 */
export type TGeminiProviderOptionValue =
  | string
  | number
  | boolean
  | undefined
  | null
  | IExecutor
  | TProviderOptionValueBase
  | TGeminiProviderOptionValue[]
  | { [key: string]: TGeminiProviderOptionValue };

/**
 * Gemini API provider options
 */
export interface IGeminiProviderOptions {
  /**
   * Additional provider-specific options
   */
  [key: string]: TGeminiProviderOptionValue;

  /** Google AI API key */
  apiKey: string;

  /**
   * Response MIME type
   * - 'text/plain': Plain text response (default)
   * - 'application/json': JSON response format
   */
  responseMimeType?: 'text/plain' | 'application/json';

  /**
   * Response schema for JSON output (only used when responseMimeType is 'application/json')
   */
  responseSchema?: Record<string, TGeminiProviderOptionValue>;

  /**
   * Optional default response modalities for Gemini generation config.
   * Example: ['TEXT', 'IMAGE']
   */
  defaultResponseModalities?: Array<'TEXT' | 'IMAGE'>;

  /**
   * Optional allowlist of models that support image generation/editing.
   * If not provided, provider validates using model name heuristics.
   */
  imageCapableModels?: string[];

  /**
   * Optional executor for handling AI requests
   *
   * When provided, the provider will delegate all chat operations to this executor
   * instead of making direct API calls. This enables remote execution capabilities.
   *
   * @example
   * ```typescript
   * import { LocalExecutor, RemoteExecutor } from '@robota-sdk/agent-core';
   *
   * // Local execution (registers this provider)
   * const localExecutor = new LocalExecutor();
   * localExecutor.registerProvider('gemini', new GeminiProvider({ apiKey: 'AIza...' }));
   *
   * // Remote execution
   * const remoteExecutor = new RemoteExecutor({
   *   serverUrl: 'https://api.robota.io',
   *   userApiKey: 'user-token-123'
   * });
   *
   * const provider = new GeminiProvider({
   *   apiKey: 'placeholder', // Required for type safety but not used
   *   executor: remoteExecutor
   * });
   * ```
   */
  executor?: IExecutor;
}
