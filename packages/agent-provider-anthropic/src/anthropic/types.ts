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
   * Model to request when a chat call names none. A provider definition sets it from the configured
   * model.
   */
  defaultModel?: string;

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
   * When provided, the provider delegates every chat call to this executor instead of calling the
   * API itself — for example to route calls through your own server. Implement `IExecutor` from
   * `@robota-sdk/agent-core`; `LocalExecutor` is the in-process one.
   *
   * @example
   * ```typescript
   * import { LocalExecutor } from '@robota-sdk/agent-core';
   *
   * const executor = new LocalExecutor();
   * executor.registerProvider('anthropic', new AnthropicProvider({ apiKey: 'sk-ant-...' }));
   *
   * const provider = new AnthropicProvider({ executor });
   * ```
   */
  executor?: IExecutor;
}
