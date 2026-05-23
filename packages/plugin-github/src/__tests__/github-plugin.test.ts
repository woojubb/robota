import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginCategory, PluginPriority } from '@robota-sdk/agent-core';

// Mock GitHubClient before importing GitHubPlugin
vi.mock('../github-client.js', () => {
  const GitHubClient = vi.fn().mockImplementation(() => ({
    getIssue: vi.fn(),
    getPR: vi.fn(),
    listOpenIssues: vi.fn(),
  }));
  return { GitHubClient };
});

import { GitHubPlugin } from '../github-plugin.js';
import { GitHubClient } from '../github-client.js';
import type { IGitHubIssue, IGitHubPR } from '../types.js';

const MOCK_TOKEN = 'ghp_test_token';
const MOCK_OWNER = 'acme';
const MOCK_REPO = 'widget';

function makeIssue(overrides: Partial<IGitHubIssue> = {}): IGitHubIssue {
  return {
    number: 1,
    title: 'Test issue',
    body: 'Issue body',
    state: 'open',
    labels: ['bug'],
    url: 'https://github.com/acme/widget/issues/1',
    ...overrides,
  };
}

function makePR(overrides: Partial<IGitHubPR> = {}): IGitHubPR {
  return {
    number: 42,
    title: 'Test PR',
    body: 'PR body',
    state: 'open',
    headBranch: 'feature/foo',
    baseBranch: 'main',
    url: 'https://github.com/acme/widget/pull/42',
    additions: 10,
    deletions: 3,
    ...overrides,
  };
}

describe('GitHubPlugin', () => {
  let plugin: GitHubPlugin;
  let clientMock: {
    getIssue: ReturnType<typeof vi.fn>;
    getPR: ReturnType<typeof vi.fn>;
    listOpenIssues: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new GitHubPlugin({ token: MOCK_TOKEN });
    // Grab the mock instance created inside the constructor
    clientMock = vi.mocked(GitHubClient).mock.results[0].value as typeof clientMock;
  });

  it('initializes with correct name, category, and priority', () => {
    expect(plugin.name).toBe('GitHubPlugin');
    expect(plugin.version).toBe('1.0.0');
    expect(plugin.category).toBe(PluginCategory.CUSTOM);
    expect(plugin.priority).toBe(PluginPriority.NORMAL);
    expect(plugin.enabled).toBe(true);
  });

  it('getIssue delegates to client and increments stats', async () => {
    const issue = makeIssue();
    clientMock.getIssue.mockResolvedValueOnce(issue);

    const result = await plugin.getIssue(MOCK_OWNER, MOCK_REPO, 1);

    expect(clientMock.getIssue).toHaveBeenCalledWith(MOCK_OWNER, MOCK_REPO, 1);
    expect(result).toEqual(issue);
    const stats = plugin.getStats();
    expect(stats.calls).toBe(1);
    expect(stats.issuesFetched).toBe(1);
    expect(stats.prsFetched).toBe(0);
  });

  it('getPR delegates to client and increments stats', async () => {
    const pr = makePR();
    clientMock.getPR.mockResolvedValueOnce(pr);

    const result = await plugin.getPR(MOCK_OWNER, MOCK_REPO, 42);

    expect(clientMock.getPR).toHaveBeenCalledWith(MOCK_OWNER, MOCK_REPO, 42);
    expect(result).toEqual(pr);
    const stats = plugin.getStats();
    expect(stats.calls).toBe(1);
    expect(stats.prsFetched).toBe(1);
    expect(stats.issuesFetched).toBe(0);
  });

  it('listOpenIssues returns filtered results and increments stats by count', async () => {
    const issues = [makeIssue({ number: 1 }), makeIssue({ number: 2 }), makeIssue({ number: 3 })];
    clientMock.listOpenIssues.mockResolvedValueOnce(issues);

    const result = await plugin.listOpenIssues(MOCK_OWNER, MOCK_REPO, 3);

    expect(clientMock.listOpenIssues).toHaveBeenCalledWith(MOCK_OWNER, MOCK_REPO, 3);
    expect(result).toHaveLength(3);
    const stats = plugin.getStats();
    expect(stats.issuesFetched).toBe(3);
    expect(stats.calls).toBe(1);
  });

  it('getStats returns merged base and GitHub-specific stats', async () => {
    clientMock.getIssue.mockResolvedValueOnce(makeIssue());
    clientMock.getPR.mockResolvedValueOnce(makePR());

    await plugin.getIssue(MOCK_OWNER, MOCK_REPO, 1);
    await plugin.getPR(MOCK_OWNER, MOCK_REPO, 42);

    const stats = plugin.getStats();
    expect(stats.enabled).toBe(true);
    expect(stats.calls).toBe(2);
    expect(stats.errors).toBe(0);
    expect(stats.issuesFetched).toBe(1);
    expect(stats.prsFetched).toBe(1);
    expect(stats.moduleEventsReceived).toBe(0);
    expect(stats.lastActivity).toBeInstanceOf(Date);
  });

  it('plugin is disabled after disable() and re-enabled after enable()', () => {
    expect(plugin.isEnabled()).toBe(true);

    plugin.disable();
    expect(plugin.isEnabled()).toBe(false);
    expect(plugin.getStats().enabled).toBe(false);

    plugin.enable();
    expect(plugin.isEnabled()).toBe(true);
    expect(plugin.getStats().enabled).toBe(true);
  });
});
