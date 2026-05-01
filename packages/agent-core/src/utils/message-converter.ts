import type { TUniversalMessage } from '../interfaces/messages';
import type { IUniversalObjectValue } from '../interfaces/types';

/**
 * Provider message format type.
 *
 * Provider packages own concrete message shapes. Core only carries the generic
 * conversion hook and never branches on provider names.
 */
export type TProviderMessage = TUniversalMessage | IUniversalObjectValue;

export type TMessageFormatConverter<TMessage extends TProviderMessage = TProviderMessage> = (
  messages: readonly TUniversalMessage[],
) => TMessage[];

export type TMessageConverterRegistry = Readonly<Record<string, TMessageFormatConverter>>;

/**
 * Universal message converter utility
 *
 * The converter is registry-based so provider-specific message conversion is
 * injected by provider packages or callers instead of being hardcoded in core.
 */
export class MessageConverter {
  /**
   * Convert messages using an injected converter or converter registry.
   */
  static toProviderFormat(
    messages: TUniversalMessage[],
    converter?: TMessageFormatConverter | string,
    registry: TMessageConverterRegistry = {},
  ): TProviderMessage[] {
    if (typeof converter === 'function') {
      return converter(messages);
    }

    if (typeof converter === 'string') {
      const registeredConverter = registry[converter];
      if (registeredConverter !== undefined) {
        return registeredConverter(messages);
      }
    }

    return this.toUniversalFormat(messages);
  }

  /**
   * Convert to universal format (no conversion)
   */
  private static toUniversalFormat(messages: TUniversalMessage[]): TUniversalMessage[] {
    return messages;
  }

  /**
   * Extract system message from messages
   */
  static extractSystemMessage(messages: TUniversalMessage[]): string | undefined {
    const systemMsg = messages.find((msg) => msg.role === 'system');
    return systemMsg?.content;
  }

  /**
   * Filter non-system messages
   */
  static filterNonSystemMessages(messages: TUniversalMessage[]): TUniversalMessage[] {
    return messages.filter((msg) => msg.role !== 'system');
  }
}
