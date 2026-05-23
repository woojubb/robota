import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginCategory, PluginPriority } from '@robota-sdk/agent-core';

// Mock SlackClient before importing SlackPlugin
vi.mock('../slack-client.js', () => {
  const SlackClient = vi.fn().mockImplementation(() => ({
    postMessage: vi.fn(),
    getChannelHistory: vi.fn(),
    uploadText: vi.fn(),
  }));
  return { SlackClient };
});

import { SlackPlugin } from '../slack-plugin.js';
import { SlackClient } from '../slack-client.js';
import type { ISlackMessage, ISlackPostResult } from '../types.js';

const MOCK_TOKEN = 'xoxb-test-token';
const MOCK_CHANNEL = '#general';
const DEFAULT_CHANNEL = '#announcements';

function makePostResult(overrides: Partial<ISlackPostResult> = {}): ISlackPostResult {
  return {
    ok: true,
    ts: '1234567890.123456',
    channel: MOCK_CHANNEL,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<ISlackMessage> = {}): ISlackMessage {
  return {
    ts: '1234567890.000001',
    channel: MOCK_CHANNEL,
    text: 'Hello from Slack',
    ...overrides,
  };
}

describe('SlackPlugin', () => {
  let plugin: SlackPlugin;
  let clientMock: {
    postMessage: ReturnType<typeof vi.fn>;
    getChannelHistory: ReturnType<typeof vi.fn>;
    uploadText: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new SlackPlugin({ token: MOCK_TOKEN });
    clientMock = vi.mocked(SlackClient).mock.results[0].value as typeof clientMock;
  });

  it('initializes with correct name, category, and priority', () => {
    expect(plugin.name).toBe('SlackPlugin');
    expect(plugin.version).toBe('1.0.0');
    expect(plugin.category).toBe(PluginCategory.NOTIFICATION);
    expect(plugin.priority).toBe(PluginPriority.NORMAL);
    expect(plugin.enabled).toBe(true);
  });

  it('postMessage sends to correct channel and increments stats', async () => {
    const result = makePostResult();
    clientMock.postMessage.mockResolvedValueOnce(result);

    const returned = await plugin.postMessage(MOCK_CHANNEL, 'Hello!');

    expect(clientMock.postMessage).toHaveBeenCalledWith(MOCK_CHANNEL, 'Hello!', undefined);
    expect(returned).toEqual(result);

    const stats = plugin.getStats();
    expect(stats.calls).toBe(1);
    expect(stats.messagesSent).toBe(1);
    expect(stats.messagesFetched).toBe(0);
  });

  it('postToDefault uses the configured default channel', async () => {
    vi.clearAllMocks();
    const pluginWithDefault = new SlackPlugin({
      token: MOCK_TOKEN,
      defaultChannel: DEFAULT_CHANNEL,
    });
    const defaultClientMock = vi.mocked(SlackClient).mock.results[0].value as typeof clientMock;

    const result = makePostResult({ channel: DEFAULT_CHANNEL });
    defaultClientMock.postMessage.mockResolvedValueOnce(result);

    const returned = await pluginWithDefault.postToDefault('Announcement!');

    expect(defaultClientMock.postMessage).toHaveBeenCalledWith(
      DEFAULT_CHANNEL,
      'Announcement!',
      undefined,
    );
    expect(returned.channel).toBe(DEFAULT_CHANNEL);
  });

  it('postToDefault throws when no default channel is configured', async () => {
    await expect(plugin.postToDefault('No channel!')).rejects.toThrow(
      'SlackPlugin: no defaultChannel configured',
    );
  });

  it('getHistory fetches messages and increments stats', async () => {
    const messages = [makeMessage({ ts: '1' }), makeMessage({ ts: '2' }), makeMessage({ ts: '3' })];
    clientMock.getChannelHistory.mockResolvedValueOnce(messages);

    const returned = await plugin.getHistory(MOCK_CHANNEL, 3);

    expect(clientMock.getChannelHistory).toHaveBeenCalledWith(MOCK_CHANNEL, 3);
    expect(returned).toHaveLength(3);

    const stats = plugin.getStats();
    expect(stats.calls).toBe(1);
    expect(stats.messagesFetched).toBe(3);
    expect(stats.messagesSent).toBe(0);
  });

  it('getStats returns merged stats including Slack-specific fields', async () => {
    clientMock.postMessage.mockResolvedValueOnce(makePostResult());
    clientMock.getChannelHistory.mockResolvedValueOnce([makeMessage(), makeMessage()]);

    await plugin.postMessage(MOCK_CHANNEL, 'Hi');
    await plugin.getHistory(MOCK_CHANNEL);

    const stats = plugin.getStats();
    expect(stats.enabled).toBe(true);
    expect(stats.calls).toBe(2);
    expect(stats.errors).toBe(0);
    expect(stats.messagesSent).toBe(1);
    expect(stats.messagesFetched).toBe(2);
    expect(stats.moduleEventsReceived).toBe(0);
    expect(stats.lastActivity).toBeInstanceOf(Date);
  });
});
