import type { IPluginOptions, IPluginStats } from '@robota-sdk/agent-core';

/** Options for LinearPlugin */
export interface ILinearPluginOptions extends IPluginOptions {
  apiKey: string;
  teamId?: string;
}

/** A single Linear issue */
export interface ILinearIssue {
  id: string;
  /** Human-readable identifier, e.g. "ENG-123" */
  identifier: string;
  title: string;
  description: string | null;
  state: string;
  priority: number;
  url: string;
  assignee: string | null;
}

/** A Linear team */
export interface ILinearTeam {
  id: string;
  name: string;
  key: string;
}

/** Input for creating a Linear issue */
export interface ILinearCreateIssueInput {
  teamId: string;
  title: string;
  description?: string;
  priority?: number;
}

/** Runtime statistics for LinearPlugin */
export interface ILinearPluginStats extends IPluginStats {
  issuesFetched: number;
  issuesCreated: number;
}
