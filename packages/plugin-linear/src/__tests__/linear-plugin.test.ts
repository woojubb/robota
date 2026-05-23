import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginCategory, PluginPriority } from '@robota-sdk/agent-core';

// Mock LinearClient before importing LinearPlugin
vi.mock('../linear-client.js', () => {
  const LinearClient = vi.fn().mockImplementation(() => ({
    getIssue: vi.fn(),
    searchIssues: vi.fn(),
    createIssue: vi.fn(),
    getTeams: vi.fn(),
  }));
  return { LinearClient };
});

import { LinearPlugin } from '../linear-plugin.js';
import { LinearClient } from '../linear-client.js';
import type { ILinearIssue, ILinearTeam } from '../types.js';

const MOCK_API_KEY = 'lin_api_test_key';

function makeIssue(overrides: Partial<ILinearIssue> = {}): ILinearIssue {
  return {
    id: 'issue-id-1',
    identifier: 'ENG-123',
    title: 'Fix the bug',
    description: 'Something is broken',
    state: 'In Progress',
    priority: 2,
    url: 'https://linear.app/team/issue/ENG-123',
    assignee: 'Jane Doe',
    ...overrides,
  };
}

function makeTeam(overrides: Partial<ILinearTeam> = {}): ILinearTeam {
  return {
    id: 'team-id-1',
    name: 'Engineering',
    key: 'ENG',
    ...overrides,
  };
}

describe('LinearPlugin', () => {
  let plugin: LinearPlugin;
  let clientMock: {
    getIssue: ReturnType<typeof vi.fn>;
    searchIssues: ReturnType<typeof vi.fn>;
    createIssue: ReturnType<typeof vi.fn>;
    getTeams: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new LinearPlugin({ apiKey: MOCK_API_KEY });
    clientMock = vi.mocked(LinearClient).mock.results[0].value as typeof clientMock;
  });

  it('has correct name, category, and priority', () => {
    expect(plugin.name).toBe('LinearPlugin');
    expect(plugin.version).toBe('1.0.0');
    expect(plugin.category).toBe(PluginCategory.CUSTOM);
    expect(plugin.priority).toBe(PluginPriority.NORMAL);
    expect(plugin.enabled).toBe(true);
  });

  it('getIssue delegates to client and increments issuesFetched', async () => {
    const issue = makeIssue();
    clientMock.getIssue.mockResolvedValueOnce(issue);

    const result = await plugin.getIssue('issue-id-1');

    expect(clientMock.getIssue).toHaveBeenCalledWith('issue-id-1');
    expect(result).toEqual(issue);

    const stats = plugin.getStats();
    expect(stats.calls).toBe(1);
    expect(stats.issuesFetched).toBe(1);
    expect(stats.issuesCreated).toBe(0);
  });

  it('searchIssues delegates to client and increments issuesFetched by count', async () => {
    const issues = [makeIssue({ id: '1' }), makeIssue({ id: '2' }), makeIssue({ id: '3' })];
    clientMock.searchIssues.mockResolvedValueOnce(issues);

    const result = await plugin.searchIssues('bug', 'team-id-1', 10);

    expect(clientMock.searchIssues).toHaveBeenCalledWith('bug', 'team-id-1', 10);
    expect(result).toHaveLength(3);

    const stats = plugin.getStats();
    expect(stats.calls).toBe(1);
    expect(stats.issuesFetched).toBe(3);
    expect(stats.issuesCreated).toBe(0);
  });

  it('createIssue delegates to client and increments issuesCreated', async () => {
    const issue = makeIssue({ id: 'new-id', identifier: 'ENG-124', title: 'New feature' });
    clientMock.createIssue.mockResolvedValueOnce(issue);

    const input = { teamId: 'team-id-1', title: 'New feature', description: 'Details here' };
    const result = await plugin.createIssue(input);

    expect(clientMock.createIssue).toHaveBeenCalledWith(input);
    expect(result).toEqual(issue);

    const stats = plugin.getStats();
    expect(stats.calls).toBe(1);
    expect(stats.issuesFetched).toBe(0);
    expect(stats.issuesCreated).toBe(1);
  });

  it('getTeams delegates to client and returns teams', async () => {
    const teams = [makeTeam(), makeTeam({ id: 'team-id-2', name: 'Design', key: 'DES' })];
    clientMock.getTeams.mockResolvedValueOnce(teams);

    const result = await plugin.getTeams();

    expect(clientMock.getTeams).toHaveBeenCalled();
    expect(result).toHaveLength(2);
    expect(result[0].key).toBe('ENG');
    expect(result[1].key).toBe('DES');
  });

  it('getStats returns merged stats including Linear-specific fields', async () => {
    const issues = [makeIssue({ id: '1' }), makeIssue({ id: '2' })];
    clientMock.searchIssues.mockResolvedValueOnce(issues);
    clientMock.createIssue.mockResolvedValueOnce(makeIssue({ id: '3' }));

    await plugin.searchIssues('test');
    await plugin.createIssue({ teamId: 'team-id-1', title: 'New' });

    const stats = plugin.getStats();
    expect(stats.enabled).toBe(true);
    expect(stats.calls).toBe(2);
    expect(stats.errors).toBe(0);
    expect(stats.issuesFetched).toBe(2);
    expect(stats.issuesCreated).toBe(1);
    expect(stats.moduleEventsReceived).toBe(0);
    expect(stats.lastActivity).toBeInstanceOf(Date);
  });
});
