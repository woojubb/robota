import {
  AbstractPlugin,
  PluginCategory,
  PluginPriority,
  type IPluginExecutionContext,
} from '@robota-sdk/agent-core';

import { GitHubClient } from './github-client.js';
import type { IGitHubIssue, IGitHubPR, IGitHubPluginOptions, IGitHubPluginStats } from './types.js';

export class GitHubPlugin extends AbstractPlugin<IGitHubPluginOptions, IGitHubPluginStats> {
  readonly name = 'GitHubPlugin';
  readonly version = '1.0.0';

  private client: GitHubClient;
  private issuesFetched = 0;
  private prsFetched = 0;

  constructor(options: IGitHubPluginOptions) {
    super();
    this.category = PluginCategory.CUSTOM;
    this.priority = PluginPriority.NORMAL;
    this.client = new GitHubClient(options.token);
  }

  async getIssue(owner: string, repo: string, number: number): Promise<IGitHubIssue> {
    this.updateCallStats();
    const issue = await this.client.getIssue(owner, repo, number);
    this.issuesFetched++;
    return issue;
  }

  async getPR(owner: string, repo: string, number: number): Promise<IGitHubPR> {
    this.updateCallStats();
    const pr = await this.client.getPR(owner, repo, number);
    this.prsFetched++;
    return pr;
  }

  async listOpenIssues(owner: string, repo: string, limit = 10): Promise<IGitHubIssue[]> {
    this.updateCallStats();
    const issues = await this.client.listOpenIssues(owner, repo, limit);
    this.issuesFetched += issues.length;
    return issues;
  }

  override async beforeExecution(context: IPluginExecutionContext): Promise<void> {
    // Hook point: subclasses can inject GitHub context into the system prompt here
    await super.beforeExecution?.(context);
  }

  override getStats(): IGitHubPluginStats {
    return {
      ...super.getStats(),
      issuesFetched: this.issuesFetched,
      prsFetched: this.prsFetched,
    };
  }
}
