import type { IPluginOptions, IPluginStats } from '@robota-sdk/agent-core';

/** Options for SlackPlugin */
export interface ISlackPluginOptions extends IPluginOptions {
  token: string;
  defaultChannel?: string;
}

/** A single message from a Slack channel */
export interface ISlackMessage {
  ts: string;
  channel: string;
  text: string;
  username?: string;
}

/** Result returned after posting a message to Slack */
export interface ISlackPostResult {
  ok: boolean;
  ts: string;
  channel: string;
}

/** Runtime statistics for SlackPlugin */
export interface ISlackPluginStats extends IPluginStats {
  messagesSent: number;
  messagesFetched: number;
}
