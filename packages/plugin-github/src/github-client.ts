import type { IGitHubIssue, IGitHubPR } from './types.js';

interface IRawLabel {
  name: string;
}

interface IRawIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: IRawLabel[];
  html_url: string;
  pull_request?: unknown;
}

interface IRawPR {
  number: number;
  title: string;
  body: string | null;
  state: string;
  head: { ref: string };
  base: { ref: string };
  html_url: string;
  additions: number;
  deletions: number;
}

export class GitHubClient {
  private readonly baseUrl = 'https://api.github.com';
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  async getIssue(owner: string, repo: string, number: number): Promise<IGitHubIssue> {
    const res = await fetch(`${this.baseUrl}/repos/${owner}/${repo}/issues/${number}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as IRawIssue;
    return {
      number: data.number,
      title: data.title,
      body: data.body,
      state: data.state,
      labels: data.labels.map((l) => l.name),
      url: data.html_url,
    };
  }

  async getPR(owner: string, repo: string, number: number): Promise<IGitHubPR> {
    const res = await fetch(`${this.baseUrl}/repos/${owner}/${repo}/pulls/${number}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as IRawPR;
    return {
      number: data.number,
      title: data.title,
      body: data.body,
      state: data.state,
      headBranch: data.head.ref,
      baseBranch: data.base.ref,
      url: data.html_url,
      additions: data.additions,
      deletions: data.deletions,
    };
  }

  async listOpenIssues(owner: string, repo: string, limit = 10): Promise<IGitHubIssue[]> {
    const res = await fetch(
      `${this.baseUrl}/repos/${owner}/${repo}/issues?state=open&per_page=${limit}&pulls=false`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as IRawIssue[];
    return data
      .filter((item) => !item.pull_request)
      .map((item) => ({
        number: item.number,
        title: item.title,
        body: item.body,
        state: item.state,
        labels: item.labels.map((l) => l.name),
        url: item.html_url,
      }));
  }
}
