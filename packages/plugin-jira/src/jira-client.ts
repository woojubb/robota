import type { IJiraIssue, IJiraCreateIssueInput, IJiraProject } from './types.js';

// ---------------------------------------------------------------------------
// Raw API response shapes (typed locally — no `any`)
// ---------------------------------------------------------------------------

interface IRawIssueStatus {
  name: string;
}

interface IRawIssuePriority {
  name: string;
}

interface IRawIssueType {
  name: string;
}

interface IRawUser {
  displayName: string;
}

interface IRawAdfContent {
  type: string;
  text?: string;
  content?: IRawAdfContent[];
}

interface IRawAdfDocument {
  type: string;
  content?: IRawAdfContent[];
}

interface IRawIssueFields {
  summary: string;
  description: IRawAdfDocument | null;
  status: IRawIssueStatus;
  priority: IRawIssuePriority;
  issuetype: IRawIssueType;
  assignee: IRawUser | null;
}

interface IRawIssue {
  id: string;
  key: string;
  self: string;
  fields: IRawIssueFields;
}

interface IRawSearchResponse {
  issues: IRawIssue[];
}

interface IRawCreatedIssue {
  id: string;
  key: string;
  self: string;
}

interface IRawProject {
  id: string;
  key: string;
  name: string;
}

interface IRawProjectSearchResponse {
  values: IRawProject[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extracts plain text from an Atlassian Document Format (ADF) node. */
function extractAdfText(node: IRawAdfContent | IRawAdfDocument | null): string | null {
  if (!node) return null;
  if (node.type === 'text' && 'text' in node && typeof node.text === 'string') return node.text;
  if (!node.content || node.content.length === 0) return null;
  const parts = node.content.map((child) => extractAdfText(child)).filter(Boolean);
  return parts.length > 0 ? parts.join('') : null;
}

function mapRawIssue(raw: IRawIssue, baseUrl: string): IJiraIssue {
  return {
    id: raw.id,
    key: raw.key,
    summary: raw.fields.summary,
    description: extractAdfText(raw.fields.description),
    status: raw.fields.status.name,
    priority: raw.fields.priority.name,
    issueType: raw.fields.issuetype.name,
    assignee: raw.fields.assignee ? raw.fields.assignee.displayName : null,
    url: `${baseUrl}/browse/${raw.key}`,
  };
}

// ---------------------------------------------------------------------------
// JiraClient
// ---------------------------------------------------------------------------

export class JiraClient {
  private readonly baseUrl: string;
  private readonly apiBase: string;
  private readonly authHeader: string;

  constructor(baseUrl: string, email: string, apiToken: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiBase = `${this.baseUrl}/rest/api/3`;
    this.authHeader = `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: this.authHeader,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }

  async getIssue(issueKey: string): Promise<IJiraIssue> {
    const res = await fetch(`${this.apiBase}/issue/${issueKey}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Jira API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as IRawIssue;
    return mapRawIssue(data, this.baseUrl);
  }

  async searchIssues(jql: string, limit = 50): Promise<IJiraIssue[]> {
    const res = await fetch(`${this.apiBase}/issue/search`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        jql,
        maxResults: limit,
        fields: ['summary', 'description', 'status', 'priority', 'issuetype', 'assignee'],
      }),
    });
    if (!res.ok) throw new Error(`Jira API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as IRawSearchResponse;
    return data.issues.map((raw) => mapRawIssue(raw, this.baseUrl));
  }

  async createIssue(input: IJiraCreateIssueInput): Promise<IJiraIssue> {
    const body = {
      fields: {
        project: { key: input.projectKey },
        summary: input.summary,
        issuetype: { name: input.issueType ?? 'Task' },
        ...(input.description && {
          description: {
            type: 'doc',
            version: 1,
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: input.description }],
              },
            ],
          },
        }),
        ...(input.priority && { priority: { name: input.priority } }),
      },
    };

    const res = await fetch(`${this.apiBase}/issue`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Jira API ${res.status}: ${await res.text()}`);
    const created = (await res.json()) as IRawCreatedIssue;
    return this.getIssue(created.key);
  }

  async getProjects(limit = 50): Promise<IJiraProject[]> {
    const res = await fetch(`${this.apiBase}/project/search?maxResults=${limit}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Jira API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as IRawProjectSearchResponse;
    return data.values.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
    }));
  }
}
