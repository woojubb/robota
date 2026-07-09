import type Anthropic from '@anthropic-ai/sdk';
import type { IExecutor, TProviderOptionValueBase } from '@robota-sdk/agent-core';

/**
 * Valid provider option value types
 */
export type TAnthropicProviderOptionValue =
  | string
  | number
  | boolean
  | undefined
  | null
  | Anthropic
  | IExecutor
  | TProviderOptionValueBase
  | TAnthropicProviderOptionValue[]
  | { [key: string]: TAnthropicProviderOptionValue };

/**
 * Anthropic provider options
 *
 * Note: Anthropic API doesn't support response format configuration.
 * JSON output can be requested through prompt instructions.
 */
export interface IAnthropicProviderOptions {
  /**
   * Additional provider-specific options
   */
  [key: string]: TAnthropicProviderOptionValue;

  /**
   * Anthropic API key (required when client and executor are not provided)
   */
  apiKey?: string;

  /**
   * API request timeout (milliseconds)
   */
  timeout?: number;

  /**
   * API base URL (default: Anthropic's official endpoint).
   * Point this at any Anthropic-Messages-API-compatible endpoint — e.g. a
   * proxy/gateway that speaks the Messages protocol. For OpenAI-protocol
   * gateways (Vercel AI Gateway, LiteLLM, OpenRouter) use the OpenAI provider's
   * `baseURL` with a gateway model slug instead.
   */
  baseURL?: string;

  /**
   * Anthropic client instance (optional: will be created from apiKey if not provided)
   * Use this path for advanced Anthropic SDK authentication that is outside
   * Robota's normal API-key setup flow.
   */
  client?: Anthropic;

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
   * localExecutor.registerProvider('anthropic', new AnthropicProvider({ apiKey: 'sk-ant-...' }));
   *
   * // Remote execution
   * const remoteExecutor = new RemoteExecutor({
   *   serverUrl: 'https://api.robota.io',
   *   userApiKey: 'user-token-123'
   * });
   *
   * const provider = new AnthropicProvider({
   *   executor: remoteExecutor // No direct API key needed
   * });
   * ```
   */
  executor?: IExecutor;
}
