import type { ILinearIssue, ILinearTeam, ILinearCreateIssueInput } from './types.js';

const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql';

// ---------------------------------------------------------------------------
// Raw GraphQL response shapes
// ---------------------------------------------------------------------------

interface IRawIssueNode {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  priority: number;
  state: { name: string } | null;
  assignee: { displayName: string } | null;
}

interface IRawIssueResponse {
  data: {
    issue: IRawIssueNode;
  };
  errors?: Array<{ message: string }>;
}

interface IRawIssuesResponse {
  data: {
    issues: {
      nodes: IRawIssueNode[];
    };
  };
  errors?: Array<{ message: string }>;
}

interface IRawIssueCreateNode {
  issue: IRawIssueNode | null;
  success: boolean;
}

interface IRawIssueCreateResponse {
  data: {
    issueCreate: IRawIssueCreateNode;
  };
  errors?: Array<{ message: string }>;
}

interface IRawTeamNode {
  id: string;
  name: string;
  key: string;
}

interface IRawTeamsResponse {
  data: {
    teams: {
      nodes: IRawTeamNode[];
    };
  };
  errors?: Array<{ message: string }>;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function mapIssueNode(node: IRawIssueNode): ILinearIssue {
  return {
    id: node.id,
    identifier: node.identifier,
    title: node.title,
    description: node.description,
    state: node.state?.name ?? 'Unknown',
    priority: node.priority,
    url: node.url,
    assignee: node.assignee?.displayName ?? null,
  };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class LinearClient {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async graphqlRequest<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await fetch(LINEAR_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      throw new Error(`Linear HTTP ${res.status}: ${await res.text()}`);
    }

    const json = (await res.json()) as T & { errors?: Array<{ message: string }> };
    if (json.errors && json.errors.length > 0) {
      throw new Error(`Linear GraphQL error: ${json.errors.map((e) => e.message).join(', ')}`);
    }
    return json;
  }

  /**
   * Fetch a single issue by its ID.
   */
  async getIssue(issueId: string): Promise<ILinearIssue> {
    const query = `
      query GetIssue($id: String!) {
        issue(id: $id) {
          id
          identifier
          title
          description
          url
          priority
          state { name }
          assignee { displayName }
        }
      }
    `;
    const data = await this.graphqlRequest<IRawIssueResponse>(query, { id: issueId });
    return mapIssueNode(data.data.issue);
  }

  /**
   * Search for issues matching a query string, optionally scoped to a team.
   */
  async searchIssues(query: string, teamId?: string, limit = 25): Promise<ILinearIssue[]> {
    const gql = `
      query SearchIssues($filter: IssueFilter, $first: Int) {
        issues(filter: $filter, first: $first) {
          nodes {
            id
            identifier
            title
            description
            url
            priority
            state { name }
            assignee { displayName }
          }
        }
      }
    `;

    const filter: Record<string, unknown> = {
      or: [
        { title: { containsIgnoreCase: query } },
        { description: { containsIgnoreCase: query } },
      ],
    };
    if (teamId) {
      filter['team'] = { id: { eq: teamId } };
    }

    const data = await this.graphqlRequest<IRawIssuesResponse>(gql, {
      filter,
      first: limit,
    });
    return data.data.issues.nodes.map(mapIssueNode);
  }

  /**
   * Create a new issue.
   */
  async createIssue(input: ILinearCreateIssueInput): Promise<ILinearIssue> {
    const mutation = `
      mutation IssueCreate($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id
            identifier
            title
            description
            url
            priority
            state { name }
            assignee { displayName }
          }
        }
      }
    `;

    const variables: Record<string, unknown> = {
      input: {
        teamId: input.teamId,
        title: input.title,
        ...(input.description !== undefined && { description: input.description }),
        ...(input.priority !== undefined && { priority: input.priority }),
      },
    };

    const data = await this.graphqlRequest<IRawIssueCreateResponse>(mutation, variables);
    if (!data.data.issueCreate.success || data.data.issueCreate.issue === null) {
      throw new Error('Linear issueCreate mutation did not return a created issue');
    }
    return mapIssueNode(data.data.issueCreate.issue);
  }

  /**
   * List all teams accessible with the configured API key.
   */
  async getTeams(): Promise<ILinearTeam[]> {
    const query = `
      query GetTeams {
        teams {
          nodes {
            id
            name
            key
          }
        }
      }
    `;
    const data = await this.graphqlRequest<IRawTeamsResponse>(query);
    return data.data.teams.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      key: node.key,
    }));
  }
}
