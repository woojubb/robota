import { AbstractPlugin, PluginCategory, PluginPriority } from '@robota-sdk/agent-core';

import { JiraClient } from './jira-client.js';
import type {
  IJiraIssue,
  IJiraCreateIssueInput,
  IJiraProject,
  IJiraPluginOptions,
  IJiraPluginStats,
} from './types.js';

export class JiraPlugin extends AbstractPlugin<IJiraPluginOptions, IJiraPluginStats> {
  readonly name = 'JiraPlugin';
  readonly version = '1.0.0';

  private client: JiraClient;
  private issuesFetched = 0;
  private issuesCreated = 0;

  constructor(options: IJiraPluginOptions) {
    super();
    this.category = PluginCategory.CUSTOM;
    this.priority = PluginPriority.NORMAL;
    this.client = new JiraClient(options.baseUrl, options.email, options.apiToken);
  }

  async getIssue(issueKey: string): Promise<IJiraIssue> {
    this.updateCallStats();
    const issue = await this.client.getIssue(issueKey);
    this.issuesFetched++;
    return issue;
  }

  async searchIssues(jql: string, limit?: number): Promise<IJiraIssue[]> {
    this.updateCallStats();
    const issues = await this.client.searchIssues(jql, limit);
    this.issuesFetched += issues.length;
    return issues;
  }

  async createIssue(input: IJiraCreateIssueInput): Promise<IJiraIssue> {
    this.updateCallStats();
    const issue = await this.client.createIssue(input);
    this.issuesCreated++;
    return issue;
  }

  async getProjects(limit?: number): Promise<IJiraProject[]> {
    this.updateCallStats();
    return this.client.getProjects(limit);
  }

  override getStats(): IJiraPluginStats {
    return {
      ...super.getStats(),
      issuesFetched: this.issuesFetched,
      issuesCreated: this.issuesCreated,
    };
  }
}
