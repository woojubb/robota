import type { IPluginOptions, IPluginStats } from '@robota-sdk/agent-core';

export interface IGitHubPluginOptions extends IPluginOptions {
  token: string;
  owner?: string;
  repo?: string;
}

export interface IGitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: string[];
  url: string;
}

export interface IGitHubPR {
  number: number;
  title: string;
  body: string | null;
  state: string;
  headBranch: string;
  baseBranch: string;
  url: string;
  additions: number;
  deletions: number;
}

export interface IGitHubPluginStats extends IPluginStats {
  issuesFetched: number;
  prsFetched: number;
}
