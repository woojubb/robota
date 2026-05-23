import { AbstractPlugin, PluginCategory, PluginPriority } from '@robota-sdk/agent-core';

import { LinearClient } from './linear-client.js';
import type {
  ILinearCreateIssueInput,
  ILinearIssue,
  ILinearPluginOptions,
  ILinearPluginStats,
  ILinearTeam,
} from './types.js';

export class LinearPlugin extends AbstractPlugin<ILinearPluginOptions, ILinearPluginStats> {
  readonly name = 'LinearPlugin';
  readonly version = '1.0.0';

  private readonly client: LinearClient;
  private issuesFetched = 0;
  private issuesCreated = 0;

  constructor(options: ILinearPluginOptions) {
    super();
    this.category = PluginCategory.CUSTOM;
    this.priority = PluginPriority.NORMAL;
    this.client = new LinearClient(options.apiKey);
    this.options = options;
  }

  /**
   * Fetch a single issue by its ID.
   */
  async getIssue(issueId: string): Promise<ILinearIssue> {
    this.updateCallStats();
    const issue = await this.client.getIssue(issueId);
    this.issuesFetched++;
    return issue;
  }

  /**
   * Search for issues matching a query string, optionally scoped to a team.
   */
  async searchIssues(query: string, teamId?: string, limit?: number): Promise<ILinearIssue[]> {
    this.updateCallStats();
    const issues = await this.client.searchIssues(query, teamId, limit);
    this.issuesFetched += issues.length;
    return issues;
  }

  /**
   * Create a new Linear issue.
   */
  async createIssue(input: ILinearCreateIssueInput): Promise<ILinearIssue> {
    this.updateCallStats();
    const issue = await this.client.createIssue(input);
    this.issuesCreated++;
    return issue;
  }

  /**
   * List all teams accessible with the configured API key.
   */
  async getTeams(): Promise<ILinearTeam[]> {
    this.updateCallStats();
    return this.client.getTeams();
  }

  override getStats(): ILinearPluginStats {
    return {
      ...super.getStats(),
      issuesFetched: this.issuesFetched,
      issuesCreated: this.issuesCreated,
    };
  }
}
