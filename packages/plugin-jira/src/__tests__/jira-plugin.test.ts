import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginCategory, PluginPriority } from '@robota-sdk/agent-core';

// Mock JiraClient before importing JiraPlugin
vi.mock('../jira-client.js', () => {
  const JiraClient = vi.fn().mockImplementation(() => ({
    getIssue: vi.fn(),
    searchIssues: vi.fn(),
    createIssue: vi.fn(),
    getProjects: vi.fn(),
  }));
  return { JiraClient };
});

import { JiraPlugin } from '../jira-plugin.js';
import { JiraClient } from '../jira-client.js';
import type { IJiraIssue, IJiraProject } from '../types.js';

const MOCK_OPTIONS = {
  baseUrl: 'https://test.atlassian.net',
  email: 'user@example.com',
  apiToken: 'test-api-token',
  projectKey: 'TEST',
};

function makeIssue(overrides: Partial<IJiraIssue> = {}): IJiraIssue {
  return {
    id: '10001',
    key: 'TEST-1',
    summary: 'Test issue summary',
    description: 'Test issue description',
    status: 'To Do',
    priority: 'Medium',
    issueType: 'Task',
    assignee: null,
    url: 'https://test.atlassian.net/browse/TEST-1',
    ...overrides,
  };
}

function makeProject(overrides: Partial<IJiraProject> = {}): IJiraProject {
  return {
    id: '10000',
    key: 'TEST',
    name: 'Test Project',
    ...overrides,
  };
}

describe('JiraPlugin', () => {
  let plugin: JiraPlugin;
  let clientMock: {
    getIssue: ReturnType<typeof vi.fn>;
    searchIssues: ReturnType<typeof vi.fn>;
    createIssue: ReturnType<typeof vi.fn>;
    getProjects: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new JiraPlugin(MOCK_OPTIONS);
    clientMock = vi.mocked(JiraClient).mock.results[0].value as typeof clientMock;
  });

  it('initializes with correct name, category, and priority', () => {
    expect(plugin.name).toBe('JiraPlugin');
    expect(plugin.version).toBe('1.0.0');
    expect(plugin.category).toBe(PluginCategory.CUSTOM);
    expect(plugin.priority).toBe(PluginPriority.NORMAL);
    expect(plugin.enabled).toBe(true);
  });

  it('getIssue delegates to client and increments issuesFetched', async () => {
    const issue = makeIssue();
    clientMock.getIssue.mockResolvedValueOnce(issue);

    const result = await plugin.getIssue('TEST-1');

    expect(clientMock.getIssue).toHaveBeenCalledWith('TEST-1');
    expect(result).toEqual(issue);

    const stats = plugin.getStats();
    expect(stats.calls).toBe(1);
    expect(stats.issuesFetched).toBe(1);
    expect(stats.issuesCreated).toBe(0);
  });

  it('searchIssues delegates to client and increments issuesFetched by results count', async () => {
    const issues = [
      makeIssue({ key: 'TEST-1' }),
      makeIssue({ key: 'TEST-2' }),
      makeIssue({ key: 'TEST-3' }),
    ];
    clientMock.searchIssues.mockResolvedValueOnce(issues);

    const result = await plugin.searchIssues('project = TEST ORDER BY created DESC', 3);

    expect(clientMock.searchIssues).toHaveBeenCalledWith('project = TEST ORDER BY created DESC', 3);
    expect(result).toHaveLength(3);

    const stats = plugin.getStats();
    expect(stats.calls).toBe(1);
    expect(stats.issuesFetched).toBe(3);
    expect(stats.issuesCreated).toBe(0);
  });

  it('createIssue delegates to client and increments issuesCreated', async () => {
    const created = makeIssue({ key: 'TEST-2', summary: 'New task' });
    clientMock.createIssue.mockResolvedValueOnce(created);

    const input = { projectKey: 'TEST', summary: 'New task', issueType: 'Task' };
    const result = await plugin.createIssue(input);

    expect(clientMock.createIssue).toHaveBeenCalledWith(input);
    expect(result).toEqual(created);

    const stats = plugin.getStats();
    expect(stats.calls).toBe(1);
    expect(stats.issuesFetched).toBe(0);
    expect(stats.issuesCreated).toBe(1);
  });

  it('getProjects delegates to client correctly', async () => {
    const projects = [
      makeProject(),
      makeProject({ id: '10001', key: 'DEMO', name: 'Demo Project' }),
    ];
    clientMock.getProjects.mockResolvedValueOnce(projects);

    const result = await plugin.getProjects(10);

    expect(clientMock.getProjects).toHaveBeenCalledWith(10);
    expect(result).toHaveLength(2);
    expect(result[0].key).toBe('TEST');
    expect(result[1].key).toBe('DEMO');

    const stats = plugin.getStats();
    expect(stats.calls).toBe(1);
    expect(stats.issuesFetched).toBe(0);
    expect(stats.issuesCreated).toBe(0);
  });

  it('getStats returns merged base stats with Jira-specific fields', async () => {
    clientMock.getIssue.mockResolvedValueOnce(makeIssue());
    clientMock.searchIssues.mockResolvedValueOnce([
      makeIssue({ key: 'TEST-2' }),
      makeIssue({ key: 'TEST-3' }),
    ]);
    clientMock.createIssue.mockResolvedValueOnce(makeIssue({ key: 'TEST-4' }));

    await plugin.getIssue('TEST-1');
    await plugin.searchIssues('project = TEST', 2);
    await plugin.createIssue({ projectKey: 'TEST', summary: 'New issue' });

    const stats = plugin.getStats();
    expect(stats.enabled).toBe(true);
    expect(stats.calls).toBe(3);
    expect(stats.errors).toBe(0);
    expect(stats.issuesFetched).toBe(3);
    expect(stats.issuesCreated).toBe(1);
    expect(stats.moduleEventsReceived).toBe(0);
    expect(stats.lastActivity).toBeInstanceOf(Date);
  });
});
