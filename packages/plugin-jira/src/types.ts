import type { IPluginOptions, IPluginStats } from '@robota-sdk/agent-core';

export interface IJiraPluginOptions extends IPluginOptions {
  /** Jira Cloud base URL, e.g. "https://yourorg.atlassian.net" */
  baseUrl: string;
  /** Atlassian account email address */
  email: string;
  /** Atlassian API token */
  apiToken: string;
  /** Default project key used when none is specified */
  projectKey?: string;
}

export interface IJiraIssue {
  id: string;
  /** Human-readable key, e.g. "PROJ-123" */
  key: string;
  summary: string;
  description: string | null;
  status: string;
  priority: string;
  issueType: string;
  assignee: string | null;
  /** Browsable URL to the issue in Jira */
  url: string;
}

export interface IJiraCreateIssueInput {
  projectKey: string;
  summary: string;
  description?: string;
  /** Defaults to "Task" when omitted */
  issueType?: string;
  priority?: string;
}

export interface IJiraProject {
  id: string;
  key: string;
  name: string;
}

export interface IJiraPluginStats extends IPluginStats {
  issuesFetched: number;
  issuesCreated: number;
}
