import { AbstractPlugin, PluginCategory, PluginPriority } from '@robota-sdk/agent-core';

import { SlackClient } from './slack-client.js';
import type {
  ISlackMessage,
  ISlackPluginOptions,
  ISlackPluginStats,
  ISlackPostResult,
} from './types.js';

export class SlackPlugin extends AbstractPlugin<ISlackPluginOptions, ISlackPluginStats> {
  readonly name = 'SlackPlugin';
  readonly version = '1.0.0';

  private client: SlackClient;
  private messagesSent = 0;
  private messagesFetched = 0;

  constructor(options: ISlackPluginOptions) {
    super();
    this.category = PluginCategory.NOTIFICATION;
    this.priority = PluginPriority.NORMAL;
    this.client = new SlackClient(options.token);
    // Store options so postToDefault can reference defaultChannel
    this.options = options;
  }

  /**
   * Post a message to the given Slack channel.
   */
  async postMessage(
    channel: string,
    text: string,
    options?: { username?: string; iconEmoji?: string },
  ): Promise<ISlackPostResult> {
    this.updateCallStats();
    const result = await this.client.postMessage(channel, text, options);
    this.messagesSent++;
    return result;
  }

  /**
   * Post a message to the default channel configured in plugin options.
   * Throws if no default channel is set.
   */
  async postToDefault(
    text: string,
    options?: { username?: string; iconEmoji?: string },
  ): Promise<ISlackPostResult> {
    const defaultChannel = this.options?.defaultChannel;
    if (!defaultChannel) {
      throw new Error('SlackPlugin: no defaultChannel configured');
    }
    return this.postMessage(defaultChannel, text, options);
  }

  /**
   * Fetch the message history for a Slack channel.
   */
  async getHistory(channel: string, limit?: number): Promise<ISlackMessage[]> {
    this.updateCallStats();
    const messages = await this.client.getChannelHistory(channel, limit);
    this.messagesFetched += messages.length;
    return messages;
  }

  override getStats(): ISlackPluginStats {
    return {
      ...super.getStats(),
      messagesSent: this.messagesSent,
      messagesFetched: this.messagesFetched,
    };
  }
}
