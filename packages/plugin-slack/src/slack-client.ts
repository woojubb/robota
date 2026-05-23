import type { ISlackMessage, ISlackPostResult } from './types.js';

/** Raw shape returned by Slack chat.postMessage */
interface IRawPostMessageResponse {
  ok: boolean;
  ts: string;
  channel: string;
  error?: string;
}

/** Raw shape of a single message in conversations.history */
interface IRawHistoryMessage {
  ts: string;
  text: string;
  username?: string;
}

/** Raw shape returned by Slack conversations.history */
interface IRawHistoryResponse {
  ok: boolean;
  messages: IRawHistoryMessage[];
  error?: string;
}

/** Raw shape returned by files.getUploadURLExternal */
interface IRawUploadUrlResponse {
  ok: boolean;
  upload_url: string;
  file_id: string;
  error?: string;
}

/** Raw shape returned by files.completeUploadExternal */
interface IRawCompleteUploadResponse {
  ok: boolean;
  error?: string;
}

const SLACK_API_BASE = 'https://slack.com/api';

export class SlackClient {
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json; charset=utf-8',
    };
  }

  /**
   * Post a text message to a Slack channel.
   */
  async postMessage(
    channel: string,
    text: string,
    options?: { username?: string; iconEmoji?: string },
  ): Promise<ISlackPostResult> {
    const body: Record<string, string> = { channel, text };
    if (options?.username) body.username = options.username;
    if (options?.iconEmoji) body.icon_emoji = options.iconEmoji;

    const res = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Slack HTTP ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as IRawPostMessageResponse;
    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error ?? 'unknown'}`);
    }

    return { ok: data.ok, ts: data.ts, channel: data.channel };
  }

  /**
   * Fetch message history from a Slack channel.
   */
  async getChannelHistory(channel: string, limit = 20): Promise<ISlackMessage[]> {
    const params = new URLSearchParams({ channel, limit: String(limit) });
    const res = await fetch(`${SLACK_API_BASE}/conversations.history?${params.toString()}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
    });

    if (!res.ok) {
      throw new Error(`Slack HTTP ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as IRawHistoryResponse;
    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error ?? 'unknown'}`);
    }

    return data.messages.map((msg) => ({
      ts: msg.ts,
      channel,
      text: msg.text,
      ...(msg.username !== undefined && { username: msg.username }),
    }));
  }

  /**
   * Upload a text file to a Slack channel using the v2 upload flow.
   * Step 1: obtain a pre-signed upload URL via files.getUploadURLExternal.
   * Step 2: PUT the content to the URL.
   * Step 3: complete the upload via files.completeUploadExternal.
   */
  async uploadText(
    channel: string,
    filename: string,
    content: string,
    title?: string,
  ): Promise<void> {
    const length = new TextEncoder().encode(content).length;

    // Step 1: get upload URL
    const urlParams = new URLSearchParams({ filename, length: String(length) });
    if (title) urlParams.set('title', title);

    const urlRes = await fetch(
      `${SLACK_API_BASE}/files.getUploadURLExternal?${urlParams.toString()}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.token}` },
      },
    );

    if (!urlRes.ok) {
      throw new Error(`Slack HTTP ${urlRes.status}: ${await urlRes.text()}`);
    }

    const urlData = (await urlRes.json()) as IRawUploadUrlResponse;
    if (!urlData.ok) {
      throw new Error(`Slack API error (getUploadURLExternal): ${urlData.error ?? 'unknown'}`);
    }

    // Step 2: PUT the content
    const putRes = await fetch(urlData.upload_url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: content,
    });

    if (!putRes.ok) {
      throw new Error(`Slack upload PUT failed with HTTP ${putRes.status}`);
    }

    // Step 3: complete the upload
    const completeBody: Record<string, string | Array<{ id: string; title?: string }>> = {
      files: [{ id: urlData.file_id, ...(title !== undefined && { title }) }],
      channel_id: channel,
    };

    const completeRes = await fetch(`${SLACK_API_BASE}/files.completeUploadExternal`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(completeBody),
    });

    if (!completeRes.ok) {
      throw new Error(`Slack HTTP ${completeRes.status}: ${await completeRes.text()}`);
    }

    const completeData = (await completeRes.json()) as IRawCompleteUploadResponse;
    if (!completeData.ok) {
      throw new Error(
        `Slack API error (completeUploadExternal): ${completeData.error ?? 'unknown'}`,
      );
    }
  }
}
